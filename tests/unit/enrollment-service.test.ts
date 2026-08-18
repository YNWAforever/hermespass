import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildEnrollmentProofMessage,
  consumeAgentKeyEnrollment,
  createAgentKeyEnrollment,
} from "@/lib/agents/enrollment";
import { generateEd25519KeyPair } from "@/lib/identity/keys";

const actor = {
  userId: "admin-1",
  organizationId: "11111111-1111-4111-8111-111111111111",
  organizationName: "Test org",
  organizationSlug: "test-org",
  email: "admin@example.com",
  name: "Admin",
  role: "admin" as const,
};
const agentId = "22222222-2222-4222-8222-222222222222";
const keyId = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => {
  const execute = vi.fn();
  const values = vi.fn();
  const insert = vi.fn();
  const transaction = vi.fn();
  const assertCanMutate = vi.fn();
  const withActorTransaction = vi.fn();
  const withPublicDatabase = vi.fn();
  const tx = { execute, insert };
  return {
    assertCanMutate,
    execute,
    insert,
    transaction,
    tx,
    values,
    withActorTransaction,
    withPublicDatabase,
  };
});

vi.mock("@/lib/auth/authorization", () => ({
  assertCanMutate: mocks.assertCanMutate,
  withActorTransaction: mocks.withActorTransaction,
}));
vi.mock("@/lib/db", () => ({
  withPublicDatabase: mocks.withPublicDatabase,
}));

beforeEach(() => {
  for (const mock of [
    mocks.assertCanMutate,
    mocks.execute,
    mocks.insert,
    mocks.transaction,
    mocks.values,
    mocks.withActorTransaction,
    mocks.withPublicDatabase,
  ]) {
    mock.mockReset();
  }
  mocks.assertCanMutate.mockImplementation((current) => {
    if (current.role === "viewer") throw new Error("PERMISSION_DENIED");
  });
  mocks.insert.mockReturnValue({ values: mocks.values });
  mocks.values.mockResolvedValue(undefined);
  mocks.withActorTransaction.mockImplementation(async (_actor, callback) => callback(mocks.tx));
  mocks.transaction.mockImplementation(async (callback) => callback(mocks.tx));
  mocks.withPublicDatabase.mockImplementation(async (callback) =>
    callback({ transaction: mocks.transaction }),
  );
});

async function signedEnrollmentInput() {
  const pair = await generateEd25519KeyPair();
  if (!pair.publicJwk.x) throw new Error("test key missing x");
  const token = Buffer.alloc(32, 41).toString("base64url");
  const publicJwk = { kty: "OKP", crv: "Ed25519", x: pair.publicJwk.x };
  const privateKey = await (globalThis.crypto ?? webcrypto).subtle.importKey(
    "jwk",
    pair.privateJwk,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = await (globalThis.crypto ?? webcrypto).subtle.sign(
    { name: "Ed25519" },
    privateKey,
    buildEnrollmentProofMessage(token, publicJwk),
  );
  return {
    token,
    publicJwk,
    proof: Buffer.from(signature).toString("base64url"),
  };
}

describe("BYOK enrollment transaction orchestration", () => {
  it("returns plaintext only once while hashing and auditing creation in the actor transaction", async () => {
    const expiresAt = new Date("2026-08-18T01:15:00.000Z");
    mocks.execute.mockResolvedValueOnce({
      rows: [
        {
          enrollment_id: "44444444-4444-4444-8444-444444444444",
          expires_at: expiresAt,
        },
      ],
    });

    const result = await createAgentKeyEnrollment(actor, agentId);

    expect(result).toEqual({
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expiresAt: expiresAt.toISOString(),
    });
    expect(result).not.toHaveProperty("tokenHash");
    expect(mocks.withActorTransaction).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.values).toHaveBeenCalledOnce();
    const audit = mocks.values.mock.calls[0]?.[0];
    expect(audit).toMatchObject({
      organizationId: actor.organizationId,
      agentId,
      actorType: "user",
      actorId: actor.userId,
      action: "agent.key.enrollment.created",
    });
    expect(JSON.stringify(audit)).not.toContain(result.token);
    expect(JSON.stringify(audit)).not.toContain("tokenHash");
  });

  it("rejects viewer creation before opening an actor transaction", async () => {
    await expect(createAgentKeyEnrollment({ ...actor, role: "viewer" }, agentId)).rejects.toThrow(
      "PERMISSION_DENIED",
    );
    expect(mocks.withActorTransaction).not.toHaveBeenCalled();
  });

  it("consumes, sets the verified claim, and audits through one public transaction", async () => {
    const input = await signedEnrollmentInput();
    mocks.execute
      .mockResolvedValueOnce({
        rows: [
          {
            agent_id: agentId,
            organization_id: actor.organizationId,
            key_id: keyId,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{}] });

    const result = await consumeAgentKeyEnrollment(input);

    expect(result).toMatchObject({ agentId, keyId });
    expect(mocks.withPublicDatabase).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    const audit = mocks.values.mock.calls[0]?.[0];
    expect(audit).toMatchObject({
      organizationId: actor.organizationId,
      agentId,
      actorType: "agent",
      actorId: agentId,
      action: "agent.key.enrolled",
      payload: {
        keyId,
        custody: "external",
      },
    });
    expect(JSON.stringify(audit)).not.toContain(input.token);
    expect(JSON.stringify(audit)).not.toContain("tokenHash");
    expect(audit).not.toHaveProperty("publicJwk");
  });

  it("normalizes a stale or replayed database result and rolls back the public transaction", async () => {
    const input = await signedEnrollmentInput();
    mocks.execute.mockRejectedValueOnce(
      Object.assign(new Error("row unavailable"), { code: "P0002" }),
    );

    await expect(consumeAgentKeyEnrollment(input)).rejects.toThrow("AGENT_ENROLLMENT_INVALID");
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.values).not.toHaveBeenCalled();
  });
});
