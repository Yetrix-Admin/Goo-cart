export type VendorUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

// --- Restaurant / menu (shapes mirror server/src/routes/catalog.ts's DTOs, --
// --- the same ones the mobile Customer app reads) ---------------------------

export type RestaurantOffer = {
  title: string;
  description?: string | null;
};

export type Restaurant = {
  id: string;
  name: string;
  imageUrl: string | null;
  rating: number;
  ratingCount: number;
  cuisines: string[];
  deliveryTimeMin: number;
  deliveryTimeMax: number;
  distanceKm: number;
  priceForOne?: number | null;
  priceForTwo?: number | null;
  vegOnly: boolean;
  offers: RestaurantOffer[];
  isOpen: boolean;
  area: string;
  latitude: number;
  longitude: number;
};

export type FoodItem = {
  id: string;
  restaurantId: string;
  categoryId: string;
  name: string;
  description: string;
  imageUrl: string | null;
  price: number;
  veg: boolean;
  rating?: number | null;
  ratingCount?: number | null;
  bestseller?: boolean;
  available: boolean;
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

export const ORDER_STATUSES = [
  "PLACED",
  "VENDOR_ACCEPTED",
  "PREPARING",
  "READY_FOR_PICKUP",
  "DELIVERY_PARTNER_ASSIGNED",
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
};
