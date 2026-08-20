"use client";

import { Copy, KeyRound, Settings2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AgentDto } from "@/lib/agents/types";
import { useCreateAgentEnrollment } from "@/lib/agents/client";
import {
  useAgentPolicy,
  useMembers,
  useSaveAgentPolicy,
  type PolicyInput,
} from "@/lib/policies/client";
import { parseHkdCents } from "@/lib/policies/money";

export function AgentKeySummary({ agent }: { agent: AgentDto }) {
  const status =
    agent.keyStatus === "enrollment_required"
      ? "Enrollment required"
      : agent.keyCustody === "external"
        ? "External BYOK active"
        : "Legacy sealed key active";
  const custody =
    agent.keyCustody === "external"
      ? "External"
      : agent.keyCustody === "legacy_encrypted"
        ? "Legacy encrypted"
        : "No active key";

  return (
    <div className="mt-4 grid gap-3 rounded-lg border border-border bg-background/45 p-3 sm:grid-cols-2">
      <div>
        <p className="text-[10px] tracking-wide text-muted-foreground uppercase">Key status</p>
        <p
          className={
            agent.keyStatus === "active"
              ? "mt-1 text-xs font-medium text-emerald-accent"
              : "mt-1 text-xs font-medium text-amber-300"
          }
        >
          {status}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Custody: {custody}</p>
      </div>
      <div className="min-w-0">
        <p className="text-[10px] tracking-wide text-muted-foreground uppercase">JWK thumbprint</p>
        <p className="mt-1 truncate font-mono text-[11px] text-cyan-accent">
          {agent.thumbprint ?? "Not enrolled"}
        </p>
      </div>
    </div>
  );
}

export function AgentGovernanceControls({
  agent,
  canMutate,
}: {
  agent: AgentDto;
  canMutate: boolean;
}) {
  return (
    <>
      {canMutate && agent.status === "active" ? <EnrollmentDialog agent={agent} /> : null}
      <PolicyDialog agent={agent} canMutate={canMutate} />
    </>
  );
}

function EnrollmentDialog({ agent }: { agent: AgentDto }) {
  const createEnrollment = useCreateAgentEnrollment();
  const [open, setOpen] = useState(false);
  const [enrollment, setEnrollment] = useState<{
    token: string;
    expiresAt: string;
  } | null>(null);

  function setDialogOpen(next: boolean) {
    setOpen(next);
    if (!next) {
      setEnrollment(null);
      createEnrollment.reset();
    }
  }

  function createToken() {
    createEnrollment.mutate(agent.databaseId, {
      onSuccess: (result) => setEnrollment(result),
      onError: (error) =>
        toast.error("Unable to create enrollment token", {
          description: error.message,
        }),
    });
  }

  async function copyToken() {
    if (!enrollment) return;
    try {
      await navigator.clipboard.writeText(enrollment.token);
      toast.success("Enrollment token copied");
    } catch {
      toast.error("Copy failed", { description: "Select and copy the token manually." });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="bg-surface-raised">
          <KeyRound className="size-4" />
          {agent.keyStatus === "active" ? "Rotate external key" : "Enroll external key"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>External key enrollment</DialogTitle>
          <DialogDescription>
            Create a 15-minute, single-use token for this agent. The agent signs the canonical
            enrollment message with its own Ed25519 key; HermesPass receives only the public JWK.
          </DialogDescription>
        </DialogHeader>

        {enrollment ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`enrollment-token-${agent.databaseId}`}>
                One-time enrollment token
              </Label>
              <div className="flex gap-2">
                <Input
                  id={`enrollment-token-${agent.databaseId}`}
                  aria-label="One-time enrollment token"
                  value={enrollment.token}
                  readOnly
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Copy enrollment token"
                  onClick={() => void copyToken()}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Expires {new Date(enrollment.expiresAt).toLocaleString()}. This token will not be
              shown again after you close the dialog.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-background/50 p-4 text-sm text-muted-foreground">
            Creating a token does not generate or store private key material. Deliver it over a
            trusted channel to the agent operator.
          </div>
        )}

        {createEnrollment.error ? (
          <p className="text-sm text-risk-high">{createEnrollment.error.message}</p>
        ) : null}
        <DialogFooter>
          {!enrollment ? (
            <Button onClick={createToken} disabled={createEnrollment.isPending}>
              {createEnrollment.isPending ? "Creating…" : "Create one-time token"}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => setDialogOpen(false)}>
            Close enrollment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type PolicyForm = {
  perTransaction: string;
  daily: string;
  monthly: string;
  approvalThreshold: string;
  reviewer: string;
  mccRequired: boolean;
  mccAllowlist: string;
};

function PolicyDialog({ agent, canMutate }: { agent: AgentDto; canMutate: boolean }) {
  const [open, setOpen] = useState(false);
  const [edits, setEdits] = useState<Partial<PolicyForm>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const policyQuery = useAgentPolicy(agent.databaseId, open);
  const membersQuery = useMembers(open);
  const savePolicy = useSaveAgentPolicy(agent.databaseId);
  const controlsReady = policyQuery.isSuccess && membersQuery.isSuccess;
  const controlsFailed = policyQuery.isError || membersQuery.isError;
  const controlsLoading = !controlsReady && !controlsFailed;
  const eligibleMembers = useMemo(
    () =>
      (membersQuery.data?.members ?? []).filter(
        (member) => member.active && (member.role === "owner" || member.role === "admin"),
      ),
    [membersQuery.data?.members],
  );

  const policy = controlsReady ? policyQuery.data?.policy : undefined;
  const fallbackLimit = Math.max(0, agent.spendCap);
  const baseForm: PolicyForm = controlsReady
    ? {
        perTransaction: String((policy?.perTransactionLimitCents ?? fallbackLimit * 100) / 100),
        daily: String((policy?.dailyLimitCents ?? fallbackLimit * 100) / 100),
        monthly: String((policy?.monthlyLimitCents ?? fallbackLimit * 100) / 100),
        approvalThreshold: String((policy?.approvalThresholdCents ?? fallbackLimit * 100) / 100),
        reviewer: policy?.assignedReviewerUserId ?? eligibleMembers[0]?.userId ?? "",
        mccRequired: policy?.mccRequired ?? false,
        mccAllowlist: policy?.mccAllowlist.join(", ") ?? "",
      }
    : {
        perTransaction: "",
        daily: "",
        monthly: "",
        approvalThreshold: "",
        reviewer: "",
        mccRequired: false,
        mccAllowlist: "",
      };
  const form = { ...baseForm, ...edits };

  function setDialogOpen(next: boolean) {
    setOpen(next);
    if (!next) {
      setEdits({});
      setFormError(null);
    }
  }

  function update<K extends keyof PolicyForm>(key: K, value: PolicyForm[K]) {
    setEdits((current) => ({ ...current, [key]: value }));
  }

  function retryControls() {
    setFormError(null);
    void Promise.all([policyQuery.refetch(), membersQuery.refetch()]);
  }

  function save() {
    if (!controlsReady) {
      setFormError("Load the current policy and reviewer list before saving.");
      return;
    }

    const limits = [
      parseHkdCents(form.perTransaction),
      parseHkdCents(form.daily),
      parseHkdCents(form.monthly),
      parseHkdCents(form.approvalThreshold),
    ];
    if (limits.some((limit) => limit === null) || !form.reviewer) {
      setFormError("Enter valid HKD limits and select an eligible reviewer.");
      return;
    }
    const input: PolicyInput = {
      currency: "HKD",
      perTransactionLimitCents: limits[0]!,
      dailyLimitCents: limits[1]!,
      monthlyLimitCents: limits[2]!,
      approvalThresholdCents: limits[3]!,
      assignedReviewerUserId: form.reviewer,
      mccRequired: form.mccRequired,
      mccAllowlist: Array.from(
        new Set(
          form.mccAllowlist
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ),
    };
    setFormError(null);
    savePolicy.mutate(input, {
      onSuccess: ({ policy }) => {
        toast.success(`Policy version ${policy.version} saved`);
        setDialogOpen(false);
      },
      onError: (error) => setFormError(error.message),
    });
  }

  const disabled = !canMutate || savePolicy.isPending || !controlsReady;

  return (
    <Dialog open={open} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="bg-surface-raised">
          <Settings2 className="size-4" />
          Manage policy
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Agent spending policy</DialogTitle>
          <DialogDescription>
            {controlsReady
              ? policy
                ? `Active immutable version ${policy.version}. Saving creates the next version.`
                : "No policy is active. Saving creates version 1."
              : "Load the current policy and eligible reviewers before making changes."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor={`policy-currency-${agent.databaseId}`}>Currency</Label>
            <Input id={`policy-currency-${agent.databaseId}`} value="HKD only" disabled />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["perTransaction", "Per transaction limit (HKD)"],
                ["daily", "Daily limit (HKD)"],
                ["monthly", "Monthly limit (HKD)"],
                ["approvalThreshold", "Approval threshold (HKD)"],
              ] as const
            ).map(([key, label]) => (
              <div className="space-y-1.5" key={key}>
                <Label htmlFor={`policy-${key}-${agent.databaseId}`}>{label}</Label>
                <Input
                  id={`policy-${key}-${agent.databaseId}`}
                  aria-label={label}
                  type="number"
                  min={0}
                  step="0.01"
                  value={form[key]}
                  disabled={disabled}
                  onChange={(event) => update(key, event.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`policy-reviewer-${agent.databaseId}`}>Assigned reviewer</Label>
            <Select
              value={form.reviewer}
              onValueChange={(value) => update("reviewer", value)}
              disabled={disabled}
            >
              <SelectTrigger
                id={`policy-reviewer-${agent.databaseId}`}
                aria-label="Assigned reviewer"
              >
                <SelectValue placeholder="Select an owner or administrator" />
              </SelectTrigger>
              <SelectContent>
                {eligibleMembers.map((member) => (
                  <SelectItem key={member.userId} value={member.userId}>
                    {member.nameSnapshot ?? member.emailSnapshot ?? member.userId} · {member.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`policy-mcc-required-${agent.databaseId}`}
              aria-label="Require merchant category code"
              checked={form.mccRequired}
              disabled={disabled}
              onCheckedChange={(checked) => update("mccRequired", checked === true)}
            />
            <Label htmlFor={`policy-mcc-required-${agent.databaseId}`}>
              Require merchant category code
            </Label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`policy-mcc-list-${agent.databaseId}`}>Allowed MCCs</Label>
            <Input
              id={`policy-mcc-list-${agent.databaseId}`}
              aria-label="Allowed MCCs"
              value={form.mccAllowlist}
              disabled={disabled}
              placeholder="5411, 5732"
              onChange={(event) => update("mccAllowlist", event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated four-digit merchant category codes.
            </p>
          </div>
        </div>

        {controlsLoading ? (
          <p className="text-sm text-muted-foreground">Loading policy controls…</p>
        ) : null}
        {controlsFailed ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-risk-high/40 p-3">
            <p className="text-sm text-risk-high">Unable to load the policy controls.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={retryControls}
              disabled={policyQuery.isFetching || membersQuery.isFetching}
            >
              {policyQuery.isFetching || membersQuery.isFetching
                ? "Retrying..."
                : "Retry policy controls"}
            </Button>
          </div>
        ) : null}
        {formError ? <p className="text-sm text-risk-high">{formError}</p> : null}

        <DialogFooter>
          {canMutate ? (
            <Button onClick={save} disabled={disabled}>
              {savePolicy.isPending ? "Saving…" : "Save new policy version"}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              View-only members cannot change policy versions.
            </p>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
