import { createHash, randomBytes } from "node:crypto";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,60}[a-z0-9])?$/;
const EMAIL_RE = /^[^\s@\u0000-\u001f@]+@[^\s@\u0000-\u001f@]+\.[^\s@\u0000-\u001f@]+$/;

export type OrganizationInput = { name: string; slug: string };

export function normalizeOrganizationInput(input: OrganizationInput): OrganizationInput {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (/[\\/]|\.\.|[\u0000-\u001f]/.test(input.slug)) throw new Error("ORGANIZATION_INVALID");
  const slug = input.slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 62);
  if (name.length < 2 || name.length > 120 || !SLUG_RE.test(slug)) {
    throw new Error("ORGANIZATION_INVALID");
  }
  return { name, slug };
}

export function normalizeInviteEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 320 || !EMAIL_RE.test(email)) throw new Error("INVITE_INVALID");
  return email;
}

export function createInviteToken(): { raw: string; hash: Buffer } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashInviteToken(raw) };
}

export function hashInviteToken(raw: string): Buffer {
  return createHash("sha256").update(raw, "utf8").digest();
}

export function tierAgentLimit(tier: string): number {
  switch (tier) {
    case "pilot":
      return 3;
    case "starter":
      return 5;
    case "growth":
      return 25;
    case "scale":
      return 100;
    default:
      return 0;
  }
}
