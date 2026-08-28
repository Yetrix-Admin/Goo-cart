import { apiGet, apiPost } from "@/services/apiClient";
import { ServiceJob, ServiceJobStatus } from "@/types";

export const serviceJobService = {
  async list() {
    return (await apiGet<{ jobs: ServiceJob[] }>("/api/v1/partner/service-jobs")).jobs;
  },
  async claim(id: string) {
    return (await apiPost<{ job: ServiceJob }>(`/api/v1/partner/service-jobs/${id}/claim`)).job;
  },
  async transition(id: string, to: ServiceJobStatus, code?: string) {
    return (await apiPost<{ job: ServiceJob }>(`/api/v1/partner/service-jobs/${id}/status`, { to, code })).job;
  },
};
