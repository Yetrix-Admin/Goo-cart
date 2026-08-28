import { Setting } from "../models.js";

export type DispatchWeights = {
  distance: number;
  arrival: number;
  availability: number;
  reliability: number;
  fairness: number;
  workload: number;
};

export type AutomationSettings = {
  featureFlags: Record<string, boolean>;
  dispatch: {
    offerTimeoutSeconds: number;
    initialRadiusKm: number;
    maxRadiusKm: number;
    radiusStepKm: number;
    maxOfferAttempts: number;
    averageCitySpeedKmph: number;
    targetArrivalBufferMinutes: number;
    weights: DispatchWeights;
  };
  vendor: {
    smartAutoAcceptEnabled: boolean;
    defaultMaxSimultaneousOrders: number;
    defaultAveragePreparationMinutes: number;
    defaultMaximumQueue: number;
  };
};

const SETTINGS_ID = "automation";

export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  featureFlags: {
    ai_assistant: false,
    voice_ordering: false,
    smart_dispatch: true,
    vendor_auto_accept: true,
    smart_coupons: false,
    group_orders: false,
    subscriptions: false,
    order_recovery: false,
    wallet: false,
    loyalty: false,
    fraud_detection: false,
    demand_prediction: false,
  },
  dispatch: {
    offerTimeoutSeconds: Number(process.env.DELIVERY_OFFER_TIMEOUT_SECONDS) || 30,
    initialRadiusKm: Number(process.env.DELIVERY_INITIAL_RADIUS_KM) || 3,
    maxRadiusKm: Number(process.env.DELIVERY_MAX_RADIUS_KM) || 12,
    radiusStepKm: Number(process.env.DELIVERY_RADIUS_STEP_KM) || 3,
    maxOfferAttempts: Number(process.env.DELIVERY_MAX_OFFER_ATTEMPTS) || 3,
    averageCitySpeedKmph: Number(process.env.DISPATCH_AVERAGE_CITY_SPEED_KMPH) || 22,
    targetArrivalBufferMinutes: Number(process.env.DISPATCH_TARGET_ARRIVAL_BUFFER_MINUTES) || 3,
    weights: {
      distance: 35,
      arrival: 20,
      availability: 15,
      reliability: 15,
      fairness: 10,
      workload: 5,
    },
  },
  vendor: {
    smartAutoAcceptEnabled: true,
    defaultMaxSimultaneousOrders: 12,
    defaultAveragePreparationMinutes: 25,
    defaultMaximumQueue: 20,
  },
};

export async function getAutomationSettings(): Promise<AutomationSettings> {
  const doc: any = await Setting.findById(SETTINGS_ID).lean();
  return normalizeSettings(doc?.value ?? {});
}

export async function updateAutomationSettings(patch: Partial<AutomationSettings>): Promise<AutomationSettings> {
  const current = await getAutomationSettings();
  const next = normalizeSettings({
    ...current,
    ...patch,
    featureFlags: { ...current.featureFlags, ...(patch.featureFlags ?? {}) },
    dispatch: {
      ...current.dispatch,
      ...(patch.dispatch ?? {}),
      weights: { ...current.dispatch.weights, ...(patch.dispatch?.weights ?? {}) },
    },
    vendor: { ...current.vendor, ...(patch.vendor ?? {}) },
  });
  await Setting.findByIdAndUpdate(SETTINGS_ID, { $set: { value: next } }, { upsert: true });
  return next;
}

function normalizeSettings(raw: Partial<AutomationSettings>): AutomationSettings {
  const base = DEFAULT_AUTOMATION_SETTINGS;
  const dispatch: Partial<AutomationSettings["dispatch"]> = raw.dispatch ?? {};
  const vendor: Partial<AutomationSettings["vendor"]> = raw.vendor ?? {};
  return {
    featureFlags: Object.fromEntries(Object.entries({ ...base.featureFlags, ...(raw.featureFlags ?? {}) }).map(([key, value]) => [key, Boolean(value)])),
    dispatch: {
      offerTimeoutSeconds: bounded(dispatch.offerTimeoutSeconds, base.dispatch.offerTimeoutSeconds, 5, 180),
      initialRadiusKm: bounded(dispatch.initialRadiusKm, base.dispatch.initialRadiusKm, 1, 50),
      maxRadiusKm: bounded(dispatch.maxRadiusKm, base.dispatch.maxRadiusKm, 1, 100),
      radiusStepKm: bounded(dispatch.radiusStepKm, base.dispatch.radiusStepKm, 1, 25),
      maxOfferAttempts: bounded(dispatch.maxOfferAttempts, base.dispatch.maxOfferAttempts, 1, 20),
      averageCitySpeedKmph: bounded(dispatch.averageCitySpeedKmph, base.dispatch.averageCitySpeedKmph, 5, 80),
      targetArrivalBufferMinutes: bounded(dispatch.targetArrivalBufferMinutes, base.dispatch.targetArrivalBufferMinutes, 0, 15),
      weights: {
        distance: bounded(dispatch.weights?.distance, base.dispatch.weights.distance, 0, 100),
        arrival: bounded(dispatch.weights?.arrival, base.dispatch.weights.arrival, 0, 100),
        availability: bounded(dispatch.weights?.availability, base.dispatch.weights.availability, 0, 100),
        reliability: bounded(dispatch.weights?.reliability, base.dispatch.weights.reliability, 0, 100),
        fairness: bounded(dispatch.weights?.fairness, base.dispatch.weights.fairness, 0, 100),
        workload: bounded(dispatch.weights?.workload, base.dispatch.weights.workload, 0, 100),
      },
    },
    vendor: {
      smartAutoAcceptEnabled: vendor.smartAutoAcceptEnabled !== undefined ? Boolean(vendor.smartAutoAcceptEnabled) : base.vendor.smartAutoAcceptEnabled,
      defaultMaxSimultaneousOrders: bounded(vendor.defaultMaxSimultaneousOrders, base.vendor.defaultMaxSimultaneousOrders, 1, 200),
      defaultAveragePreparationMinutes: bounded(vendor.defaultAveragePreparationMinutes, base.vendor.defaultAveragePreparationMinutes, 5, 180),
      defaultMaximumQueue: bounded(vendor.defaultMaximumQueue, base.vendor.defaultMaximumQueue, 1, 500),
    },
  };
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
