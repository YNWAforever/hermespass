import { configuredPaymentRail } from "@/lib/payments/rail-config";

import { mockRail } from "./mock";
import { createStripePaymentRail } from "./stripe";
import type { PaymentRail } from "./types";

export type { PaymentAuthorizationInput, PaymentDecision, PaymentRail, RailCard } from "./types";
export { mockRail } from "./mock";
export { STRIPE_API_VERSION, createStripePaymentRail } from "./stripe";

export function activePaymentRail(): PaymentRail {
  switch (configuredPaymentRail()) {
    case "mock":
      return mockRail;
    case "stripe":
      return createStripePaymentRail();
    case "airwallex":
    case "nium":
      throw new Error("PAYMENT_RAIL_PROVIDER_DISABLED");
  }
}
