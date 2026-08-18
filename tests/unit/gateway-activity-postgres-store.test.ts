import { describe, expect, it, vi } from "vitest";

import { createPostgresGatewayActivityStore } from "@/lib/gateway/activity-postgres-store";

describe("gateway activity PostgreSQL store", () => {
  it("maps safe request metadata and aggregate rows without returning payload bytes", async () => {
    const digest = Buffer.alloc(32, 7);
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "10000000-0000-4000-8000-000000000001",
            agent_id: "20000000-0000-4000-8000-000000000001",
            agent_slug: "procurement-agent",
            agent_name: "Procurement agent",
            agent_did: "did:web:example.test:agent:procurement",
            decided_at: "2026-08-18T04:03:02.000Z",
            tool: "vendor.contract",
            summary: "Approve a contract digest",
            amount_cents: 82_000,
            currency: "HKD",
            current_decision: "hold",
            reason: "Approval threshold exceeded.",
            request_digest: digest,
            key_thumbprint: "key-thumbprint",
            policy_version: 7,
            approval_id: "30000000-0000-4000-8000-000000000001",
            approval_status: "pending",
            assigned_reviewer_user_id: "reviewer-1",
            assigned_reviewer_name: "Ada Reviewer",
            assigned_reviewer_email: "ada@example.com",
            authorization_expires_at: null,
            telegram_delivery_state: "sent",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            actions_today: 42,
            pending_holds: 1,
            blocked_spend_cents: 2_640_000,
            denied_count: 3,
            allow_count: 38,
            hold_count: 1,
            deny_count: 3,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ hour: "04:00", allow_count: 38, hold_count: 1, deny_count: 3 }],
      });
    const runTransaction = vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) =>
      callback({ execute }),
    );
    const store = createPostgresGatewayActivityStore(runTransaction as never);

    const result = await store.list("reviewer-1", "22222222-2222-4222-8222-222222222222");

    expect(result).toEqual({
      activity: [
        {
          id: "10000000-0000-4000-8000-000000000001",
          agentId: "20000000-0000-4000-8000-000000000001",
          agentSlug: "procurement-agent",
          agentName: "Procurement agent",
          agentDid: "did:web:example.test:agent:procurement",
          timestamp: "2026-08-18T04:03:02.000Z",
          tool: "vendor.contract",
          summary: "Approve a contract digest",
          amountCents: 82_000,
          currency: "HKD",
          decision: "hold",
          reason: "Approval threshold exceeded.",
          requestDigest: digest.toString("base64url"),
          keyThumbprint: "key-thumbprint",
          policyVersion: 7,
          approvalId: "30000000-0000-4000-8000-000000000001",
          approvalStatus: "pending",
          assignedReviewerUserId: "reviewer-1",
          assignedReviewerName: "Ada Reviewer",
          assignedReviewerEmail: "ada@example.com",
          authorizationExpiresAt: null,
          telegramDeliveryState: "sent",
        },
      ],
      aggregates: {
        actionsToday: 42,
        pendingHolds: 1,
        blockedSpendCents: 2_640_000,
        deniedCount: 3,
        decisionCounts: { allow: 38, hold: 1, deny: 3 },
        trend: [{ hour: "04:00", allow: 38, hold: 1, deny: 3 }],
      },
    });
    expect(execute).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(result)).not.toContain("payload");
    expect(JSON.stringify(result)).not.toContain("signature");
  });
});
