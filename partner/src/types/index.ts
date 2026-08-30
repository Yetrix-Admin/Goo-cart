export type PartnerUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  partnerApprovalStatus: "PENDING" | "APPROVED" | "REJECTED";
};

// --- Orders (shapes mirror the /api/v1/orders DTOs in server/src/routes/orders.ts) --

export type Address = {
  id: string;
  label: "Home" | "Work" | "Other";
  line1: string;
  building?: string;
  street?: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: string;
  contactName: string;
  contactPhone: string;
  latitude: number;
  longitude: number;
};

export type SelectedAddon = { id: string; name: string; price: number };
export type SelectedVariant = { id: string; name: string; price: number };

export type CartLineItem = {
  lineId: string;
  foodItemId: string;
  name: string;
  imageUrl?: string | null;
  veg: boolean;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  selectedVariant?: SelectedVariant;
  selectedAddons: SelectedAddon[];
};

export type BillBreakdown = {
  itemTotal: number;
  restaurantDiscount: number;
  couponDiscount: number;
  deliveryFee: number;
  platformFee: number;
  taxes: number;
  tip: number;
  total: number;
};

// Forward-progress statuses relevant to a delivery partner. PLACED,
// VENDOR_ACCEPTED and PREPARING happen before a job ever reaches the
// available-jobs pool, but still appear in an order's statusHistory.
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
export const TERMINAL_ORDER_STATUSES = ["VENDOR_REJECTED", "CANCELLED_BY_CUSTOMER", "CANCELLED_BY_ADMIN"] as const;
export type FoodOrderStatus = (typeof ORDER_STATUSES)[number] | (typeof TERMINAL_ORDER_STATUSES)[number];

export type OrderStatusEvent = {
  status: FoodOrderStatus;
  at: string;
};

export type PaymentMethod = "UPI" | "GPAY" | "PHONEPE" | "PAYTM" | "CARD" | "NETBANKING" | "WALLET" | "COD";
export type PaymentStatus = "PENDING" | "PAID" | "FAILED" | "NOT_APPLICABLE";

export type FoodOrder = {
  id: string;
  orderNumber: string;
  serviceType: "FOOD";
  customerId: string;
  customerName: string;
  restaurantId: string;
  restaurantName: string;
  restaurantArea: string;
  restaurantLatitude: number;
  restaurantLongitude: number;
  items: CartLineItem[];
  deliveryAddress: Address;
  instructions: string[];
  couponCode?: string | null;
  bill: BillBreakdown;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: FoodOrderStatus;
  createdAt: string;
  estimatedDeliveryMinutes: number;
  statusHistory: OrderStatusEvent[];
  deliveryPartner: { id: string; name: string | null } | null;
  deliveryOtp: string | null;
};

export type ServiceJobStatus =
  | "READY_FOR_PICKUP"
  | "PARTNER_ASSIGNED"
  | "ARRIVING"
  | "IN_PROGRESS"
  | "PICKED_UP"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "COMPLETED";

export type ServiceJob = {
  id: string;
  reference: string;
  service: "Grocery" | "Vegetables" | "Mart" | "Bike Taxi" | "Parcel";
  vendorName: string;
  customerName: string;
  status: ServiceJobStatus;
  total: number;
  details: Record<string, unknown>;
  partnerId: string | null;
  partnerName: string | null;
  // Distance from this partner's last known location to the pickup point —
  // only available once both have a real fix (see server's /service-jobs).
  pickupDistanceKm: number | null;
  createdAt: string;
  updatedAt: string;
};
