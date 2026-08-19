"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { createAuthClient } from "@neondatabase/auth/next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const authClient = createAuthClient();

export function SignupForm() {
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    setError(null);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const name = String(formData.get("name") ?? "").trim();
    const organizationName = String(formData.get("organizationName") ?? "").trim();
    const slug = String(formData.get("slug") ?? "").trim();
    try {
      const signup = await authClient.signUp.email({
        email,
        password,
        name,
        callbackURL: "/dashboard",
      });
      if (signup.error || !signup.data) {
        setError("Unable to create an account with those details.");
        return;
      }
      const organization = await fetch("/api/orgs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: organizationName, slug }),
      });
      const payload = (await organization.json()) as { error?: { message?: string } };
      if (!organization.ok) {
        setError(
          payload.error?.message ?? "Your account was created, but the organization was not.",
        );
        return;
      }
      router.push("/dashboard");
    } catch {
      setError("Authentication is not available for this environment.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(new FormData(event.currentTarget));
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="name">Your name</Label>
        <Input id="name" name="name" autoComplete="name" required maxLength={120} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="email">Work email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="organizationName">Organization name</Label>
        <Input id="organizationName" name="organizationName" required maxLength={120} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="slug">Organization slug</Label>
        <Input id="slug" name="slug" placeholder="acme-hk" required maxLength={62} />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="shadow-glow-emerald">
        {pending ? "Creating workspace…" : "Create workspace"}
      </Button>
    </form>
  );
}
