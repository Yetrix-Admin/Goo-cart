import type { Server as HttpServer } from "node:http";
import { Server, Socket } from "socket.io";
import { userFromToken } from "./auth.js";
import { Order, Restaurant } from "../models.js";
import { corsOrigin } from "./cors.js";

// --- Room naming (spec section 39) -----------------------------------------
// customer:<customerId>   — that customer's own orders
// vendor:<restaurantId>   — every user (owner/manager/staff) of that vendor
// delivery:<partnerId>    — that delivery partner's own offers/assignments
// order:<orderId>         — anyone actively viewing one order's timeline/map
// admin                   — every admin, platform-wide

export const rooms = {
  customer: (id: string) => `customer:${id}`,
  vendor: (id: string) => `vendor:${id}`,
  delivery: (id: string) => `delivery:${id}`,
  order: (id: string) => `order:${id}`,
  admin: "admin",
};

let io: Server | null = null;

type AuthedSocket = Socket & {
  data: { userId: string; role: string; vendorId: string | null };
};

const ADMIN_ROLES = ["SUPER_ADMIN", "OPERATIONS_ADMIN", "FINANCE_ADMIN", "SUPPORT_ADMIN", "MARKETING_ADMIN", "CITY_ADMIN"];

/**
 * A socket may only ever be in rooms that belong to the account it
 * authenticated as. There is no client-supplied room name that grants access
 * to someone else's data — every join below is computed server-side from the
 * verified session, and order:<id> is joined on request only after an
 * ownership check (see the "subscribe:order" handler).
 */
export function initRealtime(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: corsOrigin, credentials: true },
    // Mobile networks flap; a slightly longer ping window avoids spurious
    // reconnect storms on cellular data.
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });

  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth?.token as string | undefined) ?? bearerFromHeader(socket);
      if (!token) return next(new Error("AUTH_REQUIRED"));
      const user = await userFromToken(token);
      if (!user) return next(new Error("AUTH_REQUIRED"));

      const s = socket as AuthedSocket;
      s.data.userId = String(user._id);
      s.data.role = user.role;
      s.data.vendorId = (user as any).vendorId ? String((user as any).vendorId) : null;
      next();
    } catch {
      next(new Error("AUTH_REQUIRED"));
    }
  });

  io.on("connection", (socket) => {
    const s = socket as AuthedSocket;
    void joinIdentityRooms(s);

    // A client viewing a specific order's tracking screen asks to join that
    // order's room. Authorization is re-checked here, not assumed from the
    // identity rooms above — a customer can only watch their own order.
    socket.on("subscribe:order", async (orderId: unknown, ack?: (ok: boolean) => void) => {
      const id = String(orderId ?? "");
      const authorized = id && (await mayWatchOrder(s, id));
      if (authorized) socket.join(rooms.order(id));
      ack?.(Boolean(authorized));
    });

    socket.on("unsubscribe:order", (orderId: unknown) => {
      socket.leave(rooms.order(String(orderId ?? "")));
    });
  });

  return io;
}

function bearerFromHeader(socket: Socket): string | null {
  const header = socket.handshake.headers.authorization;
  if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return null;
}

async function joinIdentityRooms(s: AuthedSocket): Promise<void> {
  if (ADMIN_ROLES.includes(s.data.role)) {
    s.join(rooms.admin);
    return;
  }
  if (s.data.role === "DELIVERY_PARTNER") {
    s.join(rooms.delivery(s.data.userId));
    return;
  }
  if (s.data.role === "VENDOR_OWNER" || s.data.role === "VENDOR_MANAGER" || s.data.role === "VENDOR_STAFF") {
    // Owners are matched by Restaurant.ownerUserId (may predate vendorId
    // existing); everyone else by their own vendorId field.
    const vendorId = s.data.vendorId ?? (await Restaurant.findOne({ ownerUserId: s.data.userId }, { _id: 1 }).lean().then((r) => (r ? String(r._id) : null)));
    if (vendorId) s.join(rooms.vendor(vendorId));
    return;
  }
  s.join(rooms.customer(s.data.userId));
}

async function mayWatchOrder(s: AuthedSocket, orderId: string): Promise<boolean> {
  if (ADMIN_ROLES.includes(s.data.role)) return true;
  const order: any = await Order.findById(orderId, { customerId: 1, partnerId: 1, restaurantId: 1 }).lean().catch(() => null);
  if (!order) return false;
  if (String(order.customerId) === s.data.userId) return true;
  if (order.partnerId && String(order.partnerId) === s.data.userId) return true;
  if (s.data.role === "VENDOR_OWNER" || s.data.role === "VENDOR_MANAGER" || s.data.role === "VENDOR_STAFF") {
    const owns = await Restaurant.exists({ _id: order.restaurantId, ownerUserId: s.data.userId });
    if (owns || (s.data.vendorId && s.data.vendorId === String(order.restaurantId))) return true;
  }
  return false;
}

export function getIO(): Server | null {
  return io;
}

/** Broadcast the same event to every room an order's stakeholders live in. */
export function emitOrderUpdate(order: { _id: unknown; customerId: unknown; restaurantId: unknown; partnerId?: unknown }, event: string, payload: unknown) {
  if (!io) return;
  io.to(rooms.order(String(order._id))).emit(event, payload);
  io.to(rooms.customer(String(order.customerId))).emit(event, payload);
  io.to(rooms.vendor(String(order.restaurantId))).emit(event, payload);
  if (order.partnerId) io.to(rooms.delivery(String(order.partnerId))).emit(event, payload);
  io.to(rooms.admin).emit(event, payload);
}

export function emitToPartner(partnerId: unknown, event: string, payload: unknown) {
  io?.to(rooms.delivery(String(partnerId))).emit(event, payload);
}

export function emitToVendor(restaurantId: unknown, event: string, payload: unknown) {
  io?.to(rooms.vendor(String(restaurantId))).emit(event, payload);
}

export function emitToCustomer(customerId: unknown, event: string, payload: unknown) {
  io?.to(rooms.customer(String(customerId))).emit(event, payload);
}

export function emitToAdmin(event: string, payload: unknown) {
  io?.to(rooms.admin).emit(event, payload);
}
