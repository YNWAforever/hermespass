"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DID_PREFIX,
  SEED_AGENTS,
  SEED_EVENTS,
  SEED_WALLETS,
  buildChain,
  publicKeyFor,
  thumbprintFor,
  type Agent,
  type ChainBlock,
  type Decision,
  type GatewayEvent,
  type RiskTier,
  type Wallet,
} from "./hermes-data";

type NewPassport = {
  name: string;
  role: string;
  org: string;
  risk: RiskTier;
  scopes: string[];
  spendCap: number;
};

type HermesContextValue = {
  agents: Agent[];
  events: GatewayEvent[];
  wallets: Wallet[];
  chain: ChainBlock[];
  streaming: boolean;
  setStreaming: (v: boolean) => void;
  issuePassport: (input: NewPassport) => Agent;
  resolveEvent: (id: string, decision: Exclude<Decision, "hold">) => void;
  escalateEvent: (id: string) => void;
  updateWallet: (agentSlug: string, patch: Partial<Wallet>) => void;
  agentBySlug: (slug: string) => Agent | undefined;
};

const HermesContext = createContext<HermesContextValue | null>(null);

const STREAM_TEMPLATES: Array<Omit<GatewayEvent, "id" | "timestamp">> = [
  {
    agentSlug: "kinnso-recommendation",
    tool: "catalog.read",
    summary: "Fetch trending SKUs for storefront carousel",
    decision: "allow",
    reason: "Read-only scope within passport capabilities.",
  },
  {
    agentSlug: "fimmick-merchant-concierge",
    tool: "refund.issue",
    summary: "Refund of HK$ 640.00 for Order #9903",
    amount: 640,
    decision: "hold",
    reason: "Exceeds HK$ 500 auto-approval cap for medium-risk agents.",
  },
  {
    agentSlug: "adfocate-campaign-optimizer",
    tool: "ads.bid",
    summary: "Shift S$ 1,150.00 budget to campaign SG-Retarget",
    amount: 1150,
    decision: "hold",
    reason: "Agent under audit — budget mutations require human review.",
  },
  {
    agentSlug: "autoprocure-bot",
    tool: "vendor.contract",
    summary: "Countersign supply agreement with Nordwind Logistics",
    decision: "deny",
    reason: "Passport revoked — credential status list entry is invalid.",
  },
  {
    agentSlug: "fimmick-merchant-concierge",
    tool: "email.dispatch",
    summary: "Send order-delay apology to 96 customers",
    decision: "allow",
    reason: "Within scope email.dispatch, no payment mandate attached.",
  },
  {
    agentSlug: "kinnso-recommendation",
    tool: "crm.read",
    summary: "Read consented profile segments (1,004 records)",
    decision: "allow",
    reason: "PDPA consent flag present on every record.",
  },
];

export function HermesProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<Agent[]>(SEED_AGENTS);
  const [events, setEvents] = useState<GatewayEvent[]>(SEED_EVENTS);
  const [wallets, setWallets] = useState<Wallet[]>(SEED_WALLETS);
  const [streaming, setStreaming] = useState(true);
  const [, setCounter] = useState(0);

  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => {
      setCounter((c) => {
        const next = c + 1;
        const template = STREAM_TEMPLATES[next % STREAM_TEMPLATES.length]!;
        setEvents((prev) => [
          {
            ...template,
            id: `evt-live-${next}`,
            timestamp: new Date().toISOString(),
          },
          ...prev,
        ]);
        return next;
      });
    }, 7000);
    return () => clearInterval(timer);
  }, [streaming]);

  const issuePassport = useCallback((input: NewPassport) => {
    const slug =
      input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "agent";
    const today = new Date().toISOString().slice(0, 10);
    const expires = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
    const created: Agent = {
      ...input,
      slug,
      id: DID_PREFIX + slug,
      status: "active",
      issued: today,
      expires,
      thumbprint: thumbprintFor(slug),
      publicKey: publicKeyFor(slug),
    };
    setAgents((prev) => [created, ...prev]);
    setWallets((prev) => [
      {
        agentSlug: slug,
        pan: String(4000 + ((slug.length * 137) % 999)),
        network: "Visa Commercial",
        perTx: Math.max(1, Math.round(input.spendCap / 10)),
        daily: Math.max(1, input.spendCap),
        monthly: Math.max(1, input.spendCap * 12),
        spentThisMonth: 0,
        mcc: ["SaaS & Software"],
      },
      ...prev,
    ]);
    setEvents((prev) => [
      {
        id: `evt-issue-${slug}`,
        agentSlug: slug,
        timestamp: new Date().toISOString(),
        tool: "passport.issue",
        summary: `Passport issued — risk tier ${input.risk}, ${input.scopes.length} scopes`,
        decision: "allow",
        reason: "Ed25519 key pair generated, private key sealed in vault.",
      },
      ...prev,
    ]);
    return created;
  }, []);

  const resolveEvent = useCallback((id: string, decision: Exclude<Decision, "hold">) => {
    setEvents((prev) =>
      prev.map((e) =>
        e.id === id
          ? {
              ...e,
              decision,
              resolvedBy: "you@hermespass.asia",
              reason:
                decision === "allow"
                  ? "Released by human reviewer — mandate re-signed and executed."
                  : "Rejected by human reviewer — mandate voided.",
            }
          : e,
      ),
    );
  }, []);

  const escalateEvent = useCallback((id: string) => {
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, escalated: true } : e)));
  }, []);

  const updateWallet = useCallback((agentSlug: string, patch: Partial<Wallet>) => {
    setWallets((prev) => prev.map((w) => (w.agentSlug === agentSlug ? { ...w, ...patch } : w)));
  }, []);

  const value = useMemo<HermesContextValue>(
    () => ({
      agents,
      events,
      wallets,
      chain: buildChain(events),
      streaming,
      setStreaming,
      issuePassport,
      resolveEvent,
      escalateEvent,
      updateWallet,
      agentBySlug: (slug) => agents.find((a) => a.slug === slug),
    }),
    [agents, events, wallets, streaming, issuePassport, resolveEvent, escalateEvent, updateWallet],
  );

  return <HermesContext.Provider value={value}>{children}</HermesContext.Provider>;
}

export function useHermes() {
  const ctx = useContext(HermesContext);
  if (!ctx) throw new Error("useHermes must be used inside HermesProvider");
  return ctx;
}
