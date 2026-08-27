import { FoodOrderStatus, ORDER_STATUSES } from "@/types";

export const ORDER_STATUS_LABEL: Partial<Record<FoodOrderStatus, string>> = {
  PLACED: "Order placed",
  VENDOR_ACCEPTED: "Restaurant accepted",
  PREPARING: "Preparing your food",
  READY_FOR_PICKUP: "Ready for pickup",
  DELIVERY_PARTNER_ASSIGNED: "Delivery partner assigned",
  GOING_TO_VENDOR: "Delivery partner heading to restaurant",
  ARRIVED_AT_VENDOR: "Delivery partner reached the restaurant",
  PICKED_UP: "Picked up",
  ON_THE_WAY: "On the way",
  ARRIVED: "Delivery partner has arrived",
  DELIVERED: "Delivered",
  VENDOR_REJECTED: "Rejected by restaurant",
  CANCELLED_BY_CUSTOMER: "Cancelled by you",
  CANCELLED_BY_ADMIN: "Cancelled by Goocart",
};

export const ORDER_STATUS_SEQUENCE: FoodOrderStatus[] = [...ORDER_STATUSES];

export function statusIndex(status: FoodOrderStatus): number {
  return ORDER_STATUS_SEQUENCE.indexOf(status);
}

export function nextStatus(status: FoodOrderStatus): FoodOrderStatus | null {
  const idx = statusIndex(status);
  if (idx === -1 || idx === ORDER_STATUS_SEQUENCE.length - 1) return null;
  return ORDER_STATUS_SEQUENCE[idx + 1];
}
