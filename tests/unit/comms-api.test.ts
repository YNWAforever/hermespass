import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  receiveInboundMessage: vi.fn(),
  commsInboundSecret: vi.fn(),
}));

vi.mock("@/lib/comms/service", () => ({
  receiveInboundMessage: mocks.receiveInboundMessage,
  validateInboundMessage: (value: unknown) => value,
  MAX_BODY_BYTES: 16 * 1024,
}));
vi.mock("@/lib/env", () => ({ commsInboundSecret: mocks.commsInboundSecret }));

beforeEach(() => {
  mocks.receiveInboundMessage.mockReset().mockResolvedValue({ messageId: "m-1", agentId: "a-1" });
  mocks.commsInboundSecret.mockReset().mockReturnValue("inbound-secret");
});

describe("inbound communications route", () => {
  it("rejects a missing or wrong constant-time secret without invoking the service", async () => {
    const { POST } = await import("@/app/api/comms/inbound/route");
    const response = await POST(
      new Request("http://localhost/api/comms/inbound", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: "sender@example.test", to: "agent@agents.hermespass.asia" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(mocks.receiveInboundMessage).not.toHaveBeenCalled();
  });

  it("caps raw bodies before JSON parsing and never echoes the payload", async () => {
    const { POST } = await import("@/app/api/comms/inbound/route");
    const secret = "inbound-secret";
    const response = await POST(
      new Request("http://localhost/api/comms/inbound", {
        method: "POST",
        headers: { "x-comms-secret": secret, "content-type": "application/json" },
        body: "x".repeat(16_385),
      }),
    );
    expect(response.status).toBe(413);
    expect(await response.text()).not.toContain("x".repeat(100));
    expect(mocks.receiveInboundMessage).not.toHaveBeenCalled();
  });

  it("returns only the safe idempotent message result", async () => {
    const { POST } = await import("@/app/api/comms/inbound/route");
    const response = await POST(
      new Request("http://localhost/api/comms/inbound", {
        method: "POST",
        headers: { "x-comms-secret": "inbound-secret", "content-type": "application/json" },
        body: JSON.stringify({
          from: "sender@example.test",
          to: "agent@agents.hermespass.asia",
          text: "private body",
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ data: { messageId: "m-1", agentId: "a-1" } });
    expect(JSON.stringify(body)).not.toContain("private body");
    expect(mocks.receiveInboundMessage).toHaveBeenCalledWith({
      from: "sender@example.test",
      to: "agent@agents.hermespass.asia",
      text: "private body",
    });
  });
});
