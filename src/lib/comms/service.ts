import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { withPublicDatabase } from "@/lib/db";

export type InboundMessage = {
  from: string;
  to: string;
  subject?: string;
  text?: string;
  providerMessageId?: string;
};

const RECIPIENT_PATTERN = /^([a-z0-9][a-z0-9-]{1,62})@agents\.hermespass\.asia$/;
export const MAX_BODY_BYTES = 16 * 1024;
const MAX_TEXT_BYTES = 16 * 1024;

function invalid(): never {
  throw new Error("COMMS_INBOUND_INVALID");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stripControls(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, "");
}

function boundedText(value: unknown, maxBytes: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") invalid();
  const normalized = stripControls(value).trim();
  if (Buffer.byteLength(normalized, "utf8") > maxBytes) invalid();
  return normalized;
}

export function validateInboundMessage(value: unknown): InboundMessage {
  if (!isRecord(value)) invalid();
  const allowed = new Set(["from", "to", "subject", "text", "providerMessageId"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) invalid();

  if (typeof value["from"] !== "string") invalid();
  const from = value["from"].trim();
  if (from.length < 3 || from.length > 320 || /[\u0000-\u001f\u007f]/.test(from)) invalid();

  if (typeof value["to"] !== "string") invalid();
  const to = value["to"].trim().toLowerCase();
  if (!RECIPIENT_PATTERN.test(to)) invalid();

  const subject = boundedText(value["subject"], 280);
  const text = boundedText(value["text"], MAX_TEXT_BYTES);
  const providerMessageId = boundedText(value["providerMessageId"], 255);
  if (providerMessageId && /[\u0000-\u001f\u007f]/.test(providerMessageId)) invalid();

  return {
    from,
    to,
    ...(subject ? { subject } : {}),
    ...(text ? { text } : {}),
    ...(providerMessageId ? { providerMessageId } : {}),
  };
}

function digestMessage(input: InboundMessage): Buffer {
  return createHash("sha256")
    .update(
      JSON.stringify({
        from: input.from,
        to: input.to,
        subject: input.subject ?? null,
        text: input.text ?? null,
        providerMessageId: input.providerMessageId ?? null,
      }),
      "utf8",
    )
    .digest();
}

export async function receiveInboundMessage(
  input: InboundMessage,
): Promise<{ messageId: string; agentId: string }> {
  const message = validateInboundMessage(input);
  const match = RECIPIENT_PATTERN.exec(message.to);
  if (!match) invalid();
  const digest = digestMessage(message);
  const providerReplayKey = message.providerMessageId
    ? createHash("sha256").update(message.providerMessageId, "utf8").digest("hex")
    : null;

  return withPublicDatabase((database) =>
    database.transaction(async (tx) => {
      await tx.execute(sql`select public.hermes_set_productization_claim('system:comms')`);
      const lookup = await tx.execute(sql`
        select agent_id, organization_id
        from public.hermes_find_agent_by_slug(${match[1]})
      `);
      const agent = lookup.rows[0] as { agent_id?: string; organization_id?: string } | undefined;
      if (!agent?.agent_id || !agent.organization_id) throw new Error("COMMS_AGENT_NOT_FOUND");

      const result = await tx.execute(sql`
        select id, agent_id, inserted
        from public.hermes_insert_agent_message(
          ${agent.organization_id}::uuid,
          ${agent.agent_id}::uuid,
          ${message.from},
          ${message.to},
          ${message.subject ?? null},
          ${message.text ?? null},
          ${providerReplayKey},
          ${digest}
        )
      `);
      const row = result.rows[0] as { id?: string; agent_id?: string } | undefined;
      if (!row?.id || !row.agent_id) throw new Error("COMMS_UNAVAILABLE");
      return { messageId: row.id, agentId: row.agent_id };
    }),
  );
}
