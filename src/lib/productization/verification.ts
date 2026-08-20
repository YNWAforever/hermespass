import { sql } from "drizzle-orm";

import { withPublicDatabase } from "@/lib/db";
import { requestId } from "@/lib/http";
import { hashApiKey } from "@/lib/productization/api-keys";

const MAX_DID_LENGTH = 512;
const MAX_BODY_BYTES = 16 * 1024;

export type SafeVerificationDto = {
  valid: boolean;
  status: string;
  did: string;
  credentialId?: string;
  issuer?: unknown;
  credential?: unknown;
};

export class ApiKeyRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("API_KEY_RATE_LIMITED");
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

type VerificationRecord = {
  valid?: unknown;
  status?: unknown;
  did?: unknown;
  credentialId?: unknown;
  issuer?: unknown;
  credential?: unknown;
} & Record<string, unknown>;

export function safeVerificationDto(value: VerificationRecord): SafeVerificationDto {
  const credential = sanitizeCredential(value["credential"]);
  return {
    valid: value["valid"] === true,
    status: typeof value["status"] === "string" ? value["status"] : "invalid",
    did: typeof value["did"] === "string" ? value["did"] : "",
    ...(typeof value["credentialId"] === "string" ? { credentialId: value["credentialId"] } : {}),
    ...(value["issuer"] !== undefined ? { issuer: value["issuer"] } : {}),
    ...(credential !== undefined ? { credential } : {}),
  };
}

export async function verifyWithApiKey(
  request: Request,
  did: string,
): Promise<{ status: 200; body: SafeVerificationDto }> {
  const key = extractApiKey(request);
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) {
    throw new Error("PAYLOAD_TOO_LARGE");
  }
  if (!isSafeDid(did)) throw new Error("DID_INVALID");

  const metered = await withPublicDatabase((db) =>
    db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        select api_key_id, organization_id, allowed, retry_after_seconds
        from public.hermes_consume_api_key(
          ${hashApiKey(key)},
          'v1/verify',
          ${requestId(request)},
          200
        )
      `);
      return result.rows[0] as
        | {
            api_key_id?: string | null;
            organization_id?: string | null;
            allowed?: boolean;
            retry_after_seconds?: number | string;
          }
        | undefined;
    }),
  );
  if (!metered?.api_key_id) throw new Error("API_KEY_INVALID");
  if (metered.allowed !== true) {
    throw new ApiKeyRateLimitError(Number(metered.retry_after_seconds ?? 60) || 60);
  }

  const { verifyPublicAgentByDid } = await import("@/lib/agents/service");
  const verified = await verifyPublicAgentByDid(did);
  if (!verified) throw new Error("AGENT_NOT_FOUND");
  return { status: 200, body: safeVerificationDto(verified as VerificationRecord) };
}

function extractApiKey(request: Request): string {
  const authorization = request.headers.get("authorization");
  if (!authorization) throw new Error("API_KEY_REQUIRED");
  const match = /^Bearer (hp_live_[A-Za-z0-9_-]+)$/.exec(authorization);
  if (!match || authorization.includes(",")) throw new Error("API_KEY_INVALID");
  return match[1]!;
}

function isSafeDid(value: string): boolean {
  return (
    value.length > "did:web:".length &&
    value.length <= MAX_DID_LENGTH &&
    value.startsWith("did:web:") &&
    !/[\u0000-\u001f\s?#]/.test(value)
  );
}

function sanitizeCredential(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const credential = { ...(value as Record<string, unknown>) };
  delete credential["credentialJws"];
  delete credential["governanceNotes"];
  if (credential["credentialSubject"] && typeof credential["credentialSubject"] === "object") {
    const subject = { ...(credential["credentialSubject"] as Record<string, unknown>) };
    delete subject["ownerOrganization"];
    delete subject["ownerOrganizationSlug"];
    delete subject["organizationId"];
    delete subject["governanceNotes"];
    credential["credentialSubject"] = subject;
  }
  return credential;
}
