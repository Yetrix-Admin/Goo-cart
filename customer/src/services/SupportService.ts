import { SupportReason, SupportTicket } from "@/types";

let ticketSequence = 100000 + Math.floor(Math.random() * 500);

export interface SupportServiceInterface {
  createTicket(orderId: string, reason: SupportReason, details?: string): SupportTicket;
}

class MockSupportService implements SupportServiceInterface {
  createTicket(orderId: string, reason: SupportReason, details?: string): SupportTicket {
    ticketSequence += 1;
    return {
      id: `SUP-${ticketSequence}`,
      orderId,
      reason,
      details,
      createdAt: new Date().toISOString(),
    };
  }
}

export const supportService: SupportServiceInterface = new MockSupportService();
