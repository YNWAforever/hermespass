import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentsClient } from "@/components/hermes/dashboard/agents-client";
import { ApprovalsClient } from "@/components/hermes/dashboard/approvals-client";
import { ComplianceClient } from "@/components/hermes/dashboard/compliance-client";
import { AgentGovernanceControls } from "@/components/hermes/dashboard/agent-governance-controls";
import { WalletsClient } from "@/components/hermes/dashboard/wallets-client";
import { AgentFixtureProvider } from "@/lib/agents/fixture-context";
import type { AgentDto } from "@/lib/agents/types";
import { HermesProvider } from "@/lib/hermes-store";

function renderWithHermes(children: ReactNode) {
  return render(<HermesProvider>{children}</HermesProvider>);
}

const livePolicyAgent: AgentDto = {
  databaseId: "11111111-1111-4111-8111-111111111111",
  id: "did:web:hermespass.test:agent:policy",
  slug: "policy-agent",
  name: "Policy Agent",
  role: "Procurement",
  org: "Test Organization",
  orgSlug: "test-org",
  status: "active",
  risk: "medium",
  scopes: ["purchase.create"],
  spendCap: 500,
  issued: "2026-08-18",
  expires: "2027-08-18",
  keyStatus: "enrollment_required",
  keyCustody: null,
  thumbprint: null,
  publicKey: null,
  credentialId: "urn:uuid:policy-agent",
  credentialJws: "",
  governanceNotes: null,
};

function renderLiveGovernance() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AgentFixtureProvider enabled={false}>
        <AgentGovernanceControls agent={livePolicyAgent} canMutate />
      </AgentFixtureProvider>
    </QueryClientProvider>,
  );
}

async function openFirstHeldAction(user: ReturnType<typeof userEvent.setup>) {
  const event = screen.getByRole("button", {
    name: /Refund of HK\$ 820\.00 for Order #9812/i,
  });
  await user.click(event);
  expect(screen.getByRole("heading", { name: "Human review" })).toBeInTheDocument();
  return event;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("agent policy controls", () => {
  it("fails closed when the current policy cannot be loaded", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/members") {
        return Response.json({
          data: {
            members: [
              {
                userId: "owner-1",
                nameSnapshot: "Owner",
                emailSnapshot: "owner@example.com",
                role: "owner",
                active: true,
              },
            ],
          },
        });
      }
      if (url.endsWith("/policy") && init?.method !== "PUT") {
        return Response.json(
          {
            error: {
              code: "POLICY_UPDATE_FAILED",
              message: "Unable to load current policy.",
              requestId: "req-policy-load",
            },
          },
          { status: 500 },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    renderLiveGovernance();

    await user.click(screen.getByRole("button", { name: "Manage policy" }));

    expect(await screen.findByText("Unable to load the policy controls.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry policy controls" })).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save new policy version" });
    expect(save).toBeDisabled();
    expect(screen.getByLabelText("Per transaction limit (HKD)")).toBeDisabled();
    await user.click(save);
    expect(fetchSpy.mock.calls.some(([, request]) => request?.method === "PUT")).toBe(false);
  });

  it("saves exact fractional HKD values after policy and members load", async () => {
    const user = userEvent.setup();
    const submitted: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/members") {
        return Response.json({
          data: {
            members: [
              {
                userId: "owner-1",
                nameSnapshot: "Owner",
                emailSnapshot: "owner@example.com",
                role: "owner",
                active: true,
              },
            ],
          },
        });
      }
      if (url.endsWith("/policy") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        submitted.push(body);
        return Response.json({
          data: {
            policy: {
              id: "policy-1",
              agentId: livePolicyAgent.databaseId,
              version: 1,
              ...body,
              isActive: true,
              supersededAt: null,
              createdAt: "2026-08-18T00:00:00.000Z",
            },
          },
        });
      }
      if (url.endsWith("/policy")) {
        return Response.json({ data: { policy: null } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    renderLiveGovernance();

    await user.click(screen.getByRole("button", { name: "Manage policy" }));
    const perTransaction = screen.getByLabelText("Per transaction limit (HKD)");
    await waitFor(() => expect(perTransaction).toBeEnabled());

    await user.clear(perTransaction);
    await user.type(perTransaction, "0.29");
    const daily = screen.getByLabelText("Daily limit (HKD)");
    await user.clear(daily);
    await user.type(daily, "1.15");
    const monthly = screen.getByLabelText("Monthly limit (HKD)");
    await user.clear(monthly);
    await user.type(monthly, "2.30");
    const approval = screen.getByLabelText("Approval threshold (HKD)");
    await user.clear(approval);
    await user.type(approval, "0.29");
    await user.click(screen.getByRole("button", { name: "Save new policy version" }));

    await waitFor(() =>
      expect(submitted).toEqual([
        {
          currency: "HKD",
          perTransactionLimitCents: 29,
          dailyLimitCents: 115,
          monthlyLimitCents: 230,
          approvalThresholdCents: 29,
          assignedReviewerUserId: "owner-1",
          mccRequired: false,
          mccAllowlist: [],
        },
      ]),
    );
  });
});

describe("dashboard mock interactions", () => {
  it("issues a passport without creating a wallet", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderWithHermes(
      <>
        <AgentsClient />
        <WalletsClient />
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Issue new agent passport" }));
    await user.type(screen.getByLabelText("Agent name"), "Parity Agent");
    await user.type(screen.getByLabelText("Role"), "Support operations");
    await user.click(screen.getByRole("button", { name: "Mint passport" }));

    expect(await screen.findByText("Parity Agent")).toBeInTheDocument();
    expect(screen.getByText("Support operations")).toBeInTheDocument();
    expect(
      screen.getByText(/did:web:hermespass\.asia:agent:parity-agent-test/i),
    ).toBeInTheDocument();
    const passport = screen.getByText("Parity Agent").closest("article");
    expect(passport).not.toBeNull();
    expect(within(passport!).getByText("Enrollment required")).toBeInTheDocument();

    await user.click(within(passport!).getByRole("button", { name: "Enroll external key" }));
    await user.click(screen.getByRole("button", { name: "Create one-time token" }));
    expect(await screen.findByLabelText("One-time enrollment token")).toHaveValue(
      "fixture-enrollment-token",
    );
    await user.click(screen.getByRole("button", { name: "Close enrollment" }));

    await user.click(within(passport!).getByRole("button", { name: "Manage policy" }));
    expect(screen.getByLabelText("Per transaction limit (HKD)")).toBeInTheDocument();
    expect(screen.getByLabelText("Daily limit (HKD)")).toBeInTheDocument();
    expect(screen.getByLabelText("Monthly limit (HKD)")).toBeInTheDocument();
    expect(screen.getByLabelText("Approval threshold (HKD)")).toBeInTheDocument();
    expect(screen.getByLabelText("Assigned reviewer")).toBeInTheDocument();
    expect(screen.getByLabelText("Require merchant category code")).toBeInTheDocument();
    expect(screen.getByLabelText("Allowed MCCs")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getAllByRole("button", { name: "Freeze card" })).toHaveLength(4);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("pauses and resumes the live gateway stream", async () => {
    const user = userEvent.setup();
    renderWithHermes(<ApprovalsClient />);

    await user.click(screen.getByRole("button", { name: "Pause stream" }));
    expect(screen.getByRole("button", { name: "Resume stream" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Resume stream" }));
    expect(screen.getByRole("button", { name: "Pause stream" })).toBeInTheDocument();
  });

  it.each([
    ["Approve action", "allow"],
    ["Reject action", "deny"],
  ] as const)("can %s for a held gateway event", async (action, decision) => {
    const user = userEvent.setup();
    renderWithHermes(<ApprovalsClient />);
    const event = await openFirstHeldAction(user);

    await user.click(screen.getByRole("button", { name: action }));
    expect(within(event).getByText(new RegExp(`^${decision}$`, "i"))).toBeInTheDocument();
  });

  it("escalates a held gateway event to Telegram", async () => {
    const user = userEvent.setup();
    renderWithHermes(<ApprovalsClient />);
    await openFirstHeldAction(user);

    await user.click(screen.getByRole("button", { name: "Escalate to Telegram" }));
    expect(screen.getByText("escalated · telegram")).toBeInTheDocument();
  });

  it("changes wallet limits and freezes a card", async () => {
    const user = userEvent.setup();
    renderWithHermes(<WalletsClient />);
    const sliders = screen.getAllByRole("slider");
    const perTransaction = sliders[0]!;

    expect(perTransaction).toHaveAttribute("aria-valuenow", "500");
    fireEvent.keyDown(perTransaction, { key: "ArrowRight" });
    expect(perTransaction).toHaveAttribute("aria-valuenow", "600");

    await user.click(screen.getAllByRole("button", { name: "Freeze card" })[0]!);
    expect(sliders[0]).toHaveAttribute("aria-valuenow", "0");
    expect(sliders[1]).toHaveAttribute("aria-valuenow", "0");
  });

  it("prints a report and links to the server compliance CSV", async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    renderWithHermes(<ComplianceClient />);

    await user.click(screen.getByRole("button", { name: "PDF report" }));
    expect(print).toHaveBeenCalledOnce();

    expect(screen.getByRole("link", { name: "1-click regulatory export" })).toHaveAttribute(
      "href",
      "/api/audit/export.csv",
    );
  });
});
