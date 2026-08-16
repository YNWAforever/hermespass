import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentsClient } from "@/components/hermes/dashboard/agents-client";
import { ApprovalsClient } from "@/components/hermes/dashboard/approvals-client";
import { ComplianceClient } from "@/components/hermes/dashboard/compliance-client";
import { WalletsClient } from "@/components/hermes/dashboard/wallets-client";
import { HermesProvider } from "@/lib/hermes-store";

function renderWithHermes(children: ReactNode) {
  return render(<HermesProvider>{children}</HermesProvider>);
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

describe("dashboard mock interactions", () => {
  it("issues a passport without creating a wallet", async () => {
    const user = userEvent.setup();
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
    expect(screen.getAllByRole("button", { name: "Freeze card" })).toHaveLength(4);
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

  it("prints a report and downloads the compliance CSV", async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const createObjectURL = vi.fn(() => "blob:hermespass-audit");
    const revokeObjectURL = vi.fn();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    renderWithHermes(<ComplianceClient />);

    await user.click(screen.getByRole("button", { name: "PDF report" }));
    expect(print).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "1-click regulatory export" }));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:hermespass-audit");
  });
});
