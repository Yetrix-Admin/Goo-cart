import mongoose from "mongoose";
import { AuditLog, Product, Reservation } from "../models.js";

// How long a hold survives before the sweep releases it back to stock.
// Checkout today is synchronous (reserve and consume happen in the same
// request), so this window is mostly a safety net; it becomes load-bearing
// once order confirmation gains an async step (e.g. a payment callback).
export const RESERVATION_TTL_MS = Number(process.env.INVENTORY_RESERVATION_TTL_MS) || 5 * 60_000;

export type ReserveLine = { productId: unknown; quantity: number };
export type HeldReservation = { productId: string; reservationId: string; quantity: number };

export type ReserveResult =
  | { ok: true; reservations: HeldReservation[] }
  | { ok: false; code: "OUT_OF_STOCK"; productId: string };

/**
 * Atomically holds stock for every line in a cart. All-or-nothing: if any
 * line can't be reserved, the whole attempt rolls back so a multi-item
 * order never ends up holding some items but not others. Each line's
 * decrement is itself guarded (stock >= quantity) so two customers racing
 * for the last unit can never both succeed.
 */
export async function reserveLines(lines: ReserveLine[], customerId: unknown): Promise<ReserveResult> {
  const session = await mongoose.startSession();
  const held: HeldReservation[] = [];
  try {
    await session.withTransaction(async () => {
      held.length = 0;
      for (const line of lines) {
        const product = await Product.findOneAndUpdate(
          { _id: line.productId, stock: { $gte: line.quantity } },
          { $inc: { stock: -line.quantity } },
          { new: true, session },
        );
        if (!product) {
          const err = new Error("OUT_OF_STOCK") as Error & { productId: string };
          err.productId = String(line.productId);
          throw err;
        }
        const [reservation] = await Reservation.create(
          [{ productId: product._id, vendorId: product.vendorId, quantity: line.quantity, customerId, status: "RESERVED", expiresAt: new Date(Date.now() + RESERVATION_TTL_MS) }],
          { session },
        );
        held.push({ productId: String(product._id), reservationId: String(reservation._id), quantity: line.quantity });
      }
    });
    return { ok: true, reservations: held };
  } catch (e) {
    const productId = (e as { productId?: string }).productId;
    if (productId) return { ok: false, code: "OUT_OF_STOCK", productId };
    throw e;
  } finally {
    await session.endSession();
  }
}

/** Ties a hold to the order it was made for once that order is confirmed. */
export async function consumeReservations(reservationIds: unknown[], orderId: unknown): Promise<void> {
  if (!reservationIds.length) return;
  await Reservation.updateMany({ _id: { $in: reservationIds }, status: "RESERVED" }, { $set: { status: "CONSUMED", orderId } });
}

/**
 * Returns held stock to the product and closes out the reservation. Only
 * ever acts on reservations still in RESERVED — calling this twice, or on
 * something already CONSUMED, is a safe no-op rather than double-crediting
 * stock.
 */
export async function releaseReservations(reservationIds: unknown[], toStatus: "RELEASED" | "EXPIRED" = "RELEASED"): Promise<number> {
  if (!reservationIds.length) return 0;
  const session = await mongoose.startSession();
  let released = 0;
  try {
    await session.withTransaction(async () => {
      released = 0;
      const reservations = await Reservation.find({ _id: { $in: reservationIds }, status: "RESERVED" }).session(session);
      for (const reservation of reservations) {
        await Product.updateOne({ _id: reservation.productId }, { $inc: { stock: reservation.quantity } }, { session });
        reservation.status = toStatus;
        await reservation.save({ session });
        released += 1;
      }
    });
    return released;
  } finally {
    await session.endSession();
  }
}

/** Sweeps holds nobody consumed in time and gives the stock back. */
export async function sweepExpiredReservations(): Promise<number> {
  const stale = await Reservation.find({ status: "RESERVED", expiresAt: { $lte: new Date() } }, { _id: 1 }).limit(200).lean();
  if (!stale.length) return 0;
  const released = await releaseReservations(stale.map((r) => r._id), "EXPIRED");
  if (released) {
    await AuditLog.create({ actorId: null, actorRole: "system", action: "inventory.reservation_expired", entityType: "reservation", entityId: null, after: { count: released } });
  }
  return released;
}

const SWEEP_INTERVAL_MS = 30_000;

export function startReservationWatchdog(): NodeJS.Timeout {
  return setInterval(() => void sweepExpiredReservations().catch((e) => console.error("Reservation watchdog failed:", e)), SWEEP_INTERVAL_MS);
}
