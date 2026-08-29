import { SupportReason, SupportTicket } from "@/types";
import { apiPost } from "./apiClient";

export interface SupportServiceInterface {
  createTicket(orderId: string, reason: SupportReason, details?: string): Promise<SupportTicket>;
}

class ApiSupportService implements SupportServiceInterface {
  async createTicket(orderId: string, reason: SupportReason, details?: string): Promise<SupportTicket> {
    const data = await apiPost<{ ticket: SupportTicket }>("/api/v1/customer/support-tickets", { orderId, reason, details });
    return data.ticket;
  }
}

export const supportService: SupportServiceInterface = new ApiSupportService();
