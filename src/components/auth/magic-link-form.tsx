"use client";

import { useActionState } from "react";

import { requestMagicLinkAction, type MagicLinkState } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: MagicLinkState = { sent: false };

export function MagicLinkForm({ next: _next }: { next: string }) {
  const [state, action, pending] = useActionState(requestMagicLinkAction, initialState);

  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="magic-link-email">Magic-link email</Label>
        <Input
          id="magic-link-email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </div>
      {state.sent ? (
        <p role="status" className="text-sm text-muted-foreground">
          If an account exists, check your email.
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} variant="outline">
        {pending ? "Sending sign-in link…" : "Email me a sign-in link"}
      </Button>
    </form>
  );
}
