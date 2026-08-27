import { Order, User } from "../models.js";
import { emitToAdmin, emitToVendor } from "./realtime.js";
import { notifyUsers } from "./push.js";

const CHECK_INTERVAL_MS = 30_000;

/**
 * Spec section 43: a customer must not be left waiting indefinitely on a
 * vendor who never responds to a manual-acceptance order. This sweeps for
 * orders past their acceptance deadline, still PLACED, and escalates once —
 * a reminder push to the vendor plus an admin-visible flag — rather than
 * auto-cancelling behind the customer's back.
 */
export function startAcceptanceWatchdog(): NodeJS.Timeout {
  return setInterval(() => void sweep().catch((e) => console.error("Acceptance watchdog failed:", e)), CHECK_INTERVAL_MS);
}

async function sweep(): Promise<void> {
  const overdue = await Order.find({
    status: "PLACED",
    manualAcceptanceRequired: true,
    manualAcceptanceDeadlineAt: { $lte: new Date() },
    "events.event": { $ne: "VENDOR_ACCEPTANCE_ESCALATED" },
  }).limit(50);

  for (const order of overdue) {
    order.events.push({ event: "VENDOR_ACCEPTANCE_ESCALATED", actorType: "system", metadata: { deadline: order.manualAcceptanceDeadlineAt } } as any);
    await order.save();

    const staff = await User.find({ $or: [{ vendorId: order.restaurantId }] }, { _id: 1 }).lean();
    if (staff.length) {
      void notifyUsers(
        staff.map((s) => s._id),
        "Order needs attention",
        `Order ${order.orderNumber} is still waiting to be accepted.`,
        { type: "ACCEPTANCE_OVERDUE", orderId: String(order._id) },
        "VENDOR",
      );
    }
    emitToVendor(order.restaurantId, "order:acceptance_overdue", { orderId: String(order._id), orderNumber: order.orderNumber });
    emitToAdmin("order:acceptance_overdue", { orderId: String(order._id), orderNumber: order.orderNumber, restaurantName: order.restaurantName });
  }
}
