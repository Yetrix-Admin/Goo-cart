export const ORDER_STATUSES = [
  "PLACED",
  "VENDOR_ACCEPTED",
  "PREPARING",
  "READY_FOR_PICKUP",
  "DELIVERY_PARTNER_ASSIGNED",
  "GOING_TO_VENDOR",
  "ARRIVED_AT_VENDOR",
  "PICKED_UP",
  "ON_THE_WAY",
  "ARRIVED",
  "DELIVERED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number] | "VENDOR_REJECTED" | "CANCELLED_BY_CUSTOMER" | "CANCELLED_BY_ADMIN";

export const TERMINAL_STATUSES: OrderStatus[] = ["DELIVERED", "VENDOR_REJECTED", "CANCELLED_BY_CUSTOMER", "CANCELLED_BY_ADMIN"];

// Statuses during which a delivery partner has an active job and should be
// pushing GPS updates (spec section 32).
export const ACTIVE_DELIVERY_STATUSES: OrderStatus[] = [
  "DELIVERY_PARTNER_ASSIGNED",
  "GOING_TO_VENDOR",
  "ARRIVED_AT_VENDOR",
  "PICKED_UP",
  "ON_THE_WAY",
  "ARRIVED",
];

// Who may move an order from which status to which. Anything absent here is
// rejected — there is no path from PLACED straight to DELIVERED.
const TRANSITIONS: Record<string, Partial<Record<OrderStatus, OrderStatus[]>>> = {
  vendor: {
    PLACED: ["VENDOR_ACCEPTED", "VENDOR_REJECTED"],
    VENDOR_ACCEPTED: ["PREPARING"],
    PREPARING: ["READY_FOR_PICKUP"],
  },
  partner: {
    READY_FOR_PICKUP: ["DELIVERY_PARTNER_ASSIGNED"],
    DELIVERY_PARTNER_ASSIGNED: ["GOING_TO_VENDOR"],
    GOING_TO_VENDOR: ["ARRIVED_AT_VENDOR"],
    ARRIVED_AT_VENDOR: ["PICKED_UP"],
    PICKED_UP: ["ON_THE_WAY"],
    ON_THE_WAY: ["ARRIVED"],
    ARRIVED: ["DELIVERED"],
  },
  customer: {
    PLACED: ["CANCELLED_BY_CUSTOMER"],
    VENDOR_ACCEPTED: ["CANCELLED_BY_CUSTOMER"],
  },
  admin: {
    PLACED: ["CANCELLED_BY_ADMIN", "VENDOR_ACCEPTED"],
    VENDOR_ACCEPTED: ["CANCELLED_BY_ADMIN", "PREPARING"],
    PREPARING: ["CANCELLED_BY_ADMIN", "READY_FOR_PICKUP"],
    READY_FOR_PICKUP: ["CANCELLED_BY_ADMIN"],
    DELIVERY_PARTNER_ASSIGNED: ["CANCELLED_BY_ADMIN"],
    GOING_TO_VENDOR: ["CANCELLED_BY_ADMIN"],
    ARRIVED_AT_VENDOR: ["CANCELLED_BY_ADMIN"],
    PICKED_UP: ["CANCELLED_BY_ADMIN"],
    ON_THE_WAY: ["CANCELLED_BY_ADMIN"],
    ARRIVED: ["CANCELLED_BY_ADMIN", "DELIVERED"],
  },
};

export function canTransition(group: string, from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[group]?.[from]?.includes(to) ?? false;
}

export function allowedTransitions(group: string, from: OrderStatus): OrderStatus[] {
  return TRANSITIONS[group]?.[from] ?? [];
}

export function generateOrderNumber(sequence: number): string {
  return `GOO-FD-${new Date().getFullYear()}-${String(sequence).padStart(6, "0")}`;
}

export function generateOtp(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// --- Vendor App user permissions (spec sections 14, 18) --------------------

export const VENDOR_PERMISSIONS = [
  "CAN_VIEW_ORDERS",
  "CAN_ACCEPT_ORDER",
  "CAN_REJECT_ORDER",
  "CAN_UPDATE_ORDER_STATUS",
  "CAN_MARK_READY",
  "CAN_MANAGE_PRODUCTS",
  "CAN_MANAGE_STOCK",
  "CAN_MANAGE_PRICES",
  "CAN_MANAGE_OFFERS",
  "CAN_VIEW_REPORTS",
  "CAN_MANAGE_VENDOR_USERS",
] as const;
export type VendorPermission = (typeof VENDOR_PERMISSIONS)[number];
