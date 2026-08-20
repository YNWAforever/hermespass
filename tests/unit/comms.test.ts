import { describe, expect, it } from "vitest";

import { validateInboundMessage } from "@/lib/comms/service";

describe("inbound communications validation", () => {
  it("normalizes a strict agent recipient and removes controls from content", () => {
    expect(
      validateInboundMessage({
        from: "sender@example.test",
        to: "Kinnso-Recommendation@agents.hermespass.asia",
        subject: "Hello\u0000 report",
        text: "Line\u0007 one",
        providerMessageId: "provider-1",
      }),
    ).toEqual({
      from: "sender@example.test",
      to: "kinnso-recommendation@agents.hermespass.asia",
      subject: "Hello report",
      text: "Line one",
      providerMessageId: "provider-1",
    });
  });

  it.each([
    "kinnso@evil.example",
    "kinnso@agents.hermespass.asia.evil",
    "kinnso+tag@agents.hermespass.asia",
    "-kinnso@agents.hermespass.asia",
    "k@agents.hermespass.asia",
  ])("rejects recipient %s", (to) => {
    expect(() => validateInboundMessage({ from: "sender@example.test", to })).toThrow(
      "COMMS_INBOUND_INVALID",
    );
  });

  it("rejects oversized fields and malformed input", () => {
    expect(() => validateInboundMessage(null)).toThrow("COMMS_INBOUND_INVALID");
    expect(() =>
      validateInboundMessage({
        from: "sender@example.test",
        to: "agent@agents.hermespass.asia",
        text: "x".repeat(16_385),
      }),
    ).toThrow("COMMS_INBOUND_INVALID");
  });
});
