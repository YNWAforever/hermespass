import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ComplianceClient } from "@/components/hermes/dashboard/compliance-client";
import { csvCell, verifyAudit } from "@/lib/audit/service";
import { useIssueAgent } from "@/lib/agents/client";

const hookState = vi.hoisted(() => ({
  verification: {
    data: undefined as { valid: boolean; checked: number; firstInvalid: number | null } | undefined,
    error: null as Error | null,
    isError: false,
    isLoading: true,
  },
}));
const auditServiceMocks = vi.hoisted(() => ({
  withActorTransaction: vi.fn(),
}));

vi.mock("@/lib/agents/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/agents/client")>();
  return {
    ...original,
    useAgents: () => ({ data: { agents: [] } }),
    useAudit: () => ({
      data: {
        entries: [
          {
            id: 1,
            timestamp: "2026-08-17T00:00:00.000Z",
            agentDid: "did:web:example:agent:test",
            agentSlug: "test",
            action: "passport.issued",
            summary: "Issued",
            payloadHash: "ab".repeat(32),
            previousHash: "",
            decision: "allow",
            tool: "passport.issue",
          },
        ],
      },
    }),
    useAuditVerification: () => hookState.verification,
  };
});

vi.mock("@/lib/auth/authorization", () => ({
  withActorTransaction: auditServiceMocks.withActorTransaction,
}));

beforeEach(() => {
  hookState.verification = { data: undefined, error: null, isError: false, isLoading: true };
});

describe("audit CSV hardening", () => {
  it.each(["=1+1", " +SUM(A1:A2)", "\t-2+3", "\r\n@cmd", '\u0000=HYPERLINK("x")'])(
    "neutralizes spreadsheet formulas after leading whitespace/control characters: %j",
    (value) => {
      expect(csvCell(value)).toBe(`"'${value.replaceAll('"', '""')}"`);
    },
  );
});

describe("audit verification response normalization", () => {
  it("converts the nullable bigint invalid block identifier to a number", async () => {
    auditServiceMocks.withActorTransaction.mockImplementationOnce(
      async (
        _actor: unknown,
        operation: (transaction: { execute: () => Promise<unknown> }) => Promise<unknown>,
      ) =>
        operation({
          execute: vi.fn(async () => ({
            rows: [{ valid: false, checked: "3", first_invalid: "42" }],
          })),
        }),
    );

    await expect(verifyAudit({} as never)).resolves.toEqual({
      valid: false,
      checked: 3,
      firstInvalid: 42,
    });
  });
});

describe("successful issuance invalidation", () => {
  it("invalidates both agent and audit queries", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useIssueAgent(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        name: "Audit invalidation agent",
        role: "Support",
        risk: "low",
        scopes: ["catalog.read"],
        spendCap: 0,
        governanceNotes: null,
      });
    });

    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["agents"] }));
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["audit"] }));
  });
});

describe("Compliance chain verification", () => {
  it("shows a loading state until verification completes", () => {
    render(<ComplianceClient />);
    expect(screen.getByText("Verifying chain integrity…")).toBeInTheDocument();
    expect(screen.queryByText("Chain integrity verified")).not.toBeInTheDocument();
  });

  it("shows an error state without claiming zero breaks", () => {
    hookState.verification = {
      data: undefined,
      error: new Error("offline"),
      isError: true,
      isLoading: false,
    };
    render(<ComplianceClient />);
    expect(screen.getByText("Unable to verify chain integrity")).toBeInTheDocument();
    expect(screen.queryByText(/0 breaks/i)).not.toBeInTheDocument();
  });

  it("shows a proven valid result", () => {
    hookState.verification = {
      data: { valid: true, checked: 1, firstInvalid: null },
      error: null,
      isError: false,
      isLoading: false,
    };
    render(<ComplianceClient />);
    expect(screen.getByText("Chain integrity verified")).toBeInTheDocument();
    expect(screen.getByText("1 block · 0 breaks")).toBeInTheDocument();
  });

  it("shows the first invalid block and never displays per-row signatures", () => {
    hookState.verification = {
      data: { valid: false, checked: 1, firstInvalid: 1 },
      error: null,
      isError: false,
      isLoading: false,
    };
    render(<ComplianceClient />);
    expect(screen.getByText("Chain integrity broken")).toBeInTheDocument();
    expect(screen.getByText("First invalid block: #1")).toBeInTheDocument();
    expect(screen.queryByText("Sig")).not.toBeInTheDocument();
  });

  it("uses the reviewed server CSV endpoint", () => {
    render(<ComplianceClient />);
    expect(screen.getByRole("link", { name: "1-click regulatory export" })).toHaveAttribute(
      "href",
      "/api/audit/export.csv",
    );
  });
});
