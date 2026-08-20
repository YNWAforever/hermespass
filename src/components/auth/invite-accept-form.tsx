"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export function InviteAcceptForm({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function accept() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        setError(payload.error?.message ?? "This invitation cannot be accepted.");
        return;
      }
      router.push("/dashboard");
    } catch {
      setError("The invitation service is unavailable.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Sign in with the invited email, then accept this invitation.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="button" onClick={() => void accept()} disabled={pending}>
        {pending ? "Accepting…" : "Accept invitation"}
      </Button>
    </div>
  );
}
