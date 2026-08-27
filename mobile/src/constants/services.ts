import { IconName } from "@/components/Icon";
import { ServiceType } from "@/types";

export type ServiceMeta = {
  type: ServiceType;
  label: string;
  icon: IconName;
  note: string;
  color: string;
  tint: string;
  usesCart: boolean;
};

export const SERVICES: ServiceMeta[] = [
  { type: "FOOD", label: "Food", icon: "food", note: "25–35 min", color: "#A7431E", tint: "#FFF0E8", usesCart: true },
  { type: "GROCERY", label: "Grocery", icon: "grocery", note: "30–45 min", color: "#28733F", tint: "#E8F7ED", usesCart: true },
  { type: "VEGETABLES", label: "Vegetables", icon: "vegetables", note: "Farm fresh", color: "#507329", tint: "#EEF8DF", usesCart: true },
  { type: "MART", label: "Mart", icon: "mart", note: "10–20 min", color: "#986B21", tint: "#FFF4D8", usesCart: true },
  { type: "BIKE_TAXI", label: "Bike Taxi", icon: "bike", note: "From ₹29", color: "#415B9C", tint: "#E9EFFF", usesCart: false },
  { type: "PARCEL", label: "Parcel", icon: "parcel", note: "Send local", color: "#74518F", tint: "#F4EAFF", usesCart: false },
];

export const serviceMeta = (type: ServiceType): ServiceMeta => {
  const found = SERVICES.find((s) => s.type === type);
  if (!found) throw new Error(`Unknown service type: ${type}`);
  return found;
};
