import { apiGet, apiPost } from "@/services/apiClient";

export type ServiceProduct = { id:string; service:string; vendorId:string; vendorName:string; name:string; description:string; price:number; stock:number; rating:number; eta:string };
export type ServicePricing = { service:string; baseFare:number; perKm:number; platformFee:number; partnerPayoutPercent:number };
export type ServiceOrder = { id:string; reference:string; service:string; vendorName:string; status:string; total:number; details:Record<string,unknown>; partner:{id:string;name:string|null}|null; createdAt:string; updatedAt:string };

export const serviceOrderService = {
  async products(key:string){ return (await apiGet<{products:ServiceProduct[]}>(`/api/v1/customer/services/${key}/products`)).products; },
  async configuration(){ return apiGet<{services:{key:string;name:string;enabled:boolean}[];pricing:ServicePricing[]}>("/api/v1/customer/services"); },
  async place(body:unknown){ return (await apiPost<{order:ServiceOrder}>("/api/v1/customer/service-orders",body)).order; },
  async activity(){ return (await apiGet<{orders:ServiceOrder[]}>("/api/v1/customer/service-orders")).orders; },
};
