import { describe, expect, it } from "vitest";

import { parsePaymentProviderEvent } from "@/lib/payments/payment-events";

describe("payment provider events", () => {
  it("extracts only safe reversal metadata", () => {
    const event = parsePaymentProviderEvent(
      JSON.stringify({
        id: "evt_reversal_1",
        type: "issuing_transaction.created",
        data: {
          object: {
            id: "ia_1",
            card: "ic_1",
            amount: 2000,
            currency: "hkd",
            status: "reversed",
            created: 1_755_552_000,
            pan: "4242424242424242",
          },
        },
      }),
      "stripe",
    );
    expect(event).toEqual({
      rail: "stripe",
      eventId: "evt_reversal_1",
      type: "issuing_transaction.created",
      railAuthorizationId: "ia_1",
      status: "reversed",
      amountCents: 2000,
      currency: "HKD",
      occurredAt: new Date(1_755_552_000 * 1000),
    });
    expect(event).not.toHaveProperty("pan");
  });

  it("accepts the authorization-created event family", () => {
    const event = parsePaymentProviderEvent(
      JSON.stringify({
        id: "evt_created_1",
        type: "issuing_authorization.created",
        data: { object: { id: "ia_created", amount: 100, currency: "HKD" } },
      }),
      "stripe",
    );
    expect(event?.type).toBe("issuing_authorization.created");
    expect(event?.railAuthorizationId).toBe("ia_created");
  });
  it("rejects unsupported or malformed provider events", () => {
    expect(parsePaymentProviderEvent("{}", "mock")).toBeNull();
    expect(
      parsePaymentProviderEvent(
        JSON.stringify({ id: "evt", type: "charge.succeeded", data: { object: {} } }),
        "mock",
      ),
    ).toBeNull();
  });
});
