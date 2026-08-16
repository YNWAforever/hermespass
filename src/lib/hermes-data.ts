export type RiskTier = "low" | "medium" | "high";
export type PassportStatus = "active" | "revoked" | "audit";
export type Decision = "allow" | "deny" | "hold";

export type Agent = {
  id: string;
  slug: string;
  name: string;
  role: string;
  org: string;
  status: PassportStatus;
  risk: RiskTier;
  scopes: string[];
  spendCap: number;
  issued: string;
  expires: string;
  thumbprint: string;
  publicKey: string;
};

export type GatewayEvent = {
  id: string;
  agentSlug: string;
  timestamp: string;
  tool: string;
  summary: string;
  amount?: number;
  decision: Decision;
  reason: string;
  resolvedBy?: string;
  escalated?: boolean;
};

export type Wallet = {
  agentSlug: string;
  pan: string;
  network: "Visa Commercial" | "Mastercard Corporate";
  perTx: number;
  daily: number;
  monthly: number;
  spentThisMonth: number;
  mcc: string[];
};

export type ChainBlock = {
  index: number;
  timestamp: string;
  agentSlug: string;
  action: string;
  payloadHash: string;
  prevHash: string;
  signatureValid: boolean;
  decision: Decision;
};

export const DID_PREFIX = "did:web:hermespass.asia:agent:";

export const MCC_CATEGORIES = [
  "Cloud Services",
  "SaaS & Software",
  "Advertising Media",
  "Travel & Transport",
  "Office Supplies",
  "Logistics & Freight",
  "Professional Services",
  "Crypto & Gambling",
];

export const TOOL_SCOPES = [
  "catalog.read",
  "crm.read",
  "refund.issue",
  "email.dispatch",
  "checkout.external",
  "invoice.approve",
  "ads.bid",
  "vendor.contract",
];

/** Deterministic pseudo-hash so SSR and client render identically. */
export function mockHash(seed: string, length = 64): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < seed.length; i++) {
    h1 = (h1 ^ seed.charCodeAt(i)) * 0x01000193;
    h2 = (h2 + seed.charCodeAt(i) * (i + 7)) * 0x85ebca6b;
    h1 >>>= 0;
    h2 >>>= 0;
  }
  let out = "";
  let x = h1 || 1;
  let y = h2 || 2;
  while (out.length < length) {
    x = (x * 1664525 + 1013904223) >>> 0;
    y = (y ^ (y << 13)) >>> 0;
    y = (y ^ (y >>> 17)) >>> 0;
    out += ((x ^ y) >>> 0).toString(16).padStart(8, "0");
  }
  return out.slice(0, length);
}

export function thumbprintFor(seed: string): string {
  return mockHash(seed, 40)
    .toUpperCase()
    .match(/.{1,4}/g)!
    .slice(0, 8)
    .join(" ");
}

export function publicKeyFor(seed: string): string {
  return `z6Mk${mockHash(seed + "-ed25519", 40)}`;
}

function agent(a: Omit<Agent, "id" | "thumbprint" | "publicKey">): Agent {
  return {
    ...a,
    id: DID_PREFIX + a.slug,
    thumbprint: thumbprintFor(a.slug),
    publicKey: publicKeyFor(a.slug),
  };
}

export const SEED_AGENTS: Agent[] = [
  agent({
    slug: "kinnso-recommendation",
    name: "Kinnso Recommendation Agent",
    role: "Retail personalisation",
    org: "Kinnso Retail Group",
    status: "active",
    risk: "low",
    scopes: ["catalog.read", "crm.read", "email.dispatch"],
    spendCap: 0,
    issued: "2026-02-11",
    expires: "2027-02-11",
  }),
  agent({
    slug: "fimmick-merchant-concierge",
    name: "Fimmick Merchant Concierge",
    role: "Customer support & refunds",
    org: "Fimmick Ltd (HK)",
    status: "active",
    risk: "medium",
    scopes: ["crm.read", "refund.issue", "email.dispatch"],
    spendCap: 500,
    issued: "2026-01-06",
    expires: "2026-12-31",
  }),
  agent({
    slug: "adfocate-campaign-optimizer",
    name: "Adfocate Campaign Optimizer",
    role: "Paid media buying",
    org: "Adfocate Media Pte Ltd",
    status: "audit",
    risk: "medium",
    scopes: ["ads.bid", "invoice.approve"],
    spendCap: 12000,
    issued: "2025-11-20",
    expires: "2026-11-20",
  }),
  agent({
    slug: "autoprocure-bot",
    name: "AutoProcure Bot",
    role: "Financial actions & procurement",
    org: "Hermes Industrial Supply",
    status: "revoked",
    risk: "high",
    scopes: ["checkout.external", "invoice.approve", "vendor.contract"],
    spendCap: 45000,
    issued: "2025-09-02",
    expires: "2026-09-02",
  }),
];

export const SEED_WALLETS: Wallet[] = [
  {
    agentSlug: "fimmick-merchant-concierge",
    pan: "4921",
    network: "Visa Commercial",
    perTx: 500,
    daily: 2500,
    monthly: 18000,
    spentThisMonth: 9420,
    mcc: ["SaaS & Software", "Professional Services"],
  },
  {
    agentSlug: "adfocate-campaign-optimizer",
    pan: "5310",
    network: "Mastercard Corporate",
    perTx: 4000,
    daily: 12000,
    monthly: 120000,
    spentThisMonth: 74300,
    mcc: ["Advertising Media", "Cloud Services", "SaaS & Software"],
  },
  {
    agentSlug: "autoprocure-bot",
    pan: "4055",
    network: "Visa Commercial",
    perTx: 15000,
    daily: 45000,
    monthly: 260000,
    spentThisMonth: 132750,
    mcc: ["Logistics & Freight", "Office Supplies", "Cloud Services"],
  },
  {
    agentSlug: "kinnso-recommendation",
    pan: "4788",
    network: "Visa Commercial",
    perTx: 250,
    daily: 1000,
    monthly: 6000,
    spentThisMonth: 480,
    mcc: ["SaaS & Software"],
  },
];

export const SEED_EVENTS: GatewayEvent[] = [
  {
    id: "evt-1041",
    agentSlug: "fimmick-merchant-concierge",
    timestamp: "2026-08-15T09:42:11Z",
    tool: "refund.issue",
    summary: "Refund of HK$ 820.00 for Order #9812",
    amount: 820,
    decision: "hold",
    reason: "Exceeds HK$ 500 auto-approval cap for medium-risk agents.",
  },
  {
    id: "evt-1040",
    agentSlug: "autoprocure-bot",
    timestamp: "2026-08-15T09:38:04Z",
    tool: "checkout.external",
    summary: "Purchase order HK$ 26,400.00 — Vendor: Sunlite Freight",
    amount: 26400,
    decision: "deny",
    reason: "Passport revoked — credential status list entry 44 is invalid.",
  },
  {
    id: "evt-1039",
    agentSlug: "adfocate-campaign-optimizer",
    timestamp: "2026-08-15T09:31:58Z",
    tool: "ads.bid",
    summary: "Raise daily budget to S$ 3,200.00 on campaign SG-Q3-Perf",
    amount: 3200,
    decision: "hold",
    reason: "Agent under audit — all budget mutations require human review.",
  },
  {
    id: "evt-1038",
    agentSlug: "kinnso-recommendation",
    timestamp: "2026-08-15T09:24:12Z",
    tool: "email.dispatch",
    summary: "Send 1,240 personalised recommendation emails",
    decision: "allow",
    reason: "Within scope email.dispatch, volume under 5,000/day threshold.",
  },
  {
    id: "evt-1037",
    agentSlug: "fimmick-merchant-concierge",
    timestamp: "2026-08-15T09:12:40Z",
    tool: "refund.issue",
    summary: "Refund of HK$ 180.00 for Order #9788",
    amount: 180,
    decision: "allow",
    reason: "Under HK$ 500 auto-cap, signature verified (Ed25519).",
  },
  {
    id: "evt-1036",
    agentSlug: "adfocate-campaign-optimizer",
    timestamp: "2026-08-15T08:58:03Z",
    tool: "invoice.approve",
    summary: "Approve media invoice S$ 41,900.00 — Publisher: NewsWire",
    amount: 41900,
    decision: "deny",
    reason: "Per-transaction ceiling S$ 4,000 exceeded by 947%.",
  },
  {
    id: "evt-1035",
    agentSlug: "kinnso-recommendation",
    timestamp: "2026-08-15T08:44:22Z",
    tool: "catalog.read",
    summary: "Sync 8,412 SKUs from merchandising catalogue",
    decision: "allow",
    reason: "Read-only scope, no payment mandate attached.",
  },
];

export const DECISION_TREND = [
  { hour: "02:00", allow: 142, deny: 4, hold: 2 },
  { hour: "04:00", allow: 168, deny: 6, hold: 3 },
  { hour: "06:00", allow: 245, deny: 9, hold: 5 },
  { hour: "08:00", allow: 412, deny: 18, hold: 11 },
  { hour: "10:00", allow: 508, deny: 22, hold: 14 },
  { hour: "12:00", allow: 466, deny: 15, hold: 9 },
  { hour: "14:00", allow: 531, deny: 26, hold: 16 },
  { hour: "16:00", allow: 487, deny: 19, hold: 12 },
  { hour: "18:00", allow: 322, deny: 11, hold: 7 },
];

export function buildChain(events: GatewayEvent[]): ChainBlock[] {
  const ordered = [...events].reverse();
  const blocks: ChainBlock[] = [];
  let prevHash = mockHash("hermespass-genesis");
  ordered.forEach((e, i) => {
    const payloadHash = mockHash(e.id + e.tool + e.decision + e.summary);
    blocks.push({
      index: 1024 + i,
      timestamp: e.timestamp,
      agentSlug: e.agentSlug,
      action: e.tool,
      payloadHash,
      prevHash,
      signatureValid: true,
      decision: e.decision,
    });
    prevHash = mockHash(payloadHash + prevHash);
  });
  return blocks.reverse();
}

export function credentialFor(a: Agent) {
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2", "https://hermespass.asia/contexts/kya/v1"],
    id: `urn:uuid:${mockHash(a.slug + "-vc", 32).replace(
      /^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/,
      "$1-$2-$3-$4-$5",
    )}`,
    type: ["VerifiableCredential", "AgentPassportCredential"],
    issuer: "did:web:hermespass.asia",
    validFrom: `${a.issued}T00:00:00Z`,
    validUntil: `${a.expires}T23:59:59Z`,
    credentialSubject: {
      id: a.id,
      name: a.name,
      ownerOrganization: a.org,
      riskTier: a.risk,
      capabilities: a.scopes,
      spendCapHKD: a.spendCap,
      jurisdictions: ["HK", "SG"],
    },
    credentialStatus: {
      type: "StatusList2021Entry",
      statusPurpose: "revocation",
      statusListIndex: String(a.slug.length * 4),
    },
    proof: {
      type: "DataIntegrityProof",
      cryptosuite: "eddsa-jcs-2022",
      created: `${a.issued}T00:00:04Z`,
      verificationMethod: `${a.id}#key-1`,
      proofPurpose: "assertionMethod",
      proofValue: `z${mockHash(a.slug + "-proof", 86)}`,
    },
  };
}

export function formatHKD(n: number) {
  return `HK$ ${n.toLocaleString("en-HK", { minimumFractionDigits: 0 })}`;
}
