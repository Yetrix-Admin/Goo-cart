import { apiGet } from "@/services/apiClient";
import { Banner } from "@/types";

// Banners are the admin-managed home-screen promo carousel — image-first
// display content, distinct from Coupon (a functional discount code).
export async function fetchBanners(): Promise<Banner[]> {
  const data = await apiGet<{ banners: Banner[] }>("/api/v1/catalog/banners");
  return data.banners;
}
