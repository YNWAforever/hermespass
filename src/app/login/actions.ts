"use server";

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/server";

export type LoginState = { error?: string };

function safeNext(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//"))
    return "/dashboard";
  return value;
}

export async function signInAction(_: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));
  if (!email || !password) return { error: "Email and password are required." };

  try {
    const { error } = await auth.signIn.email({ email, password });
    if (error) return { error: "Unable to sign in with those credentials." };
  } catch {
    return { error: "Authentication is not available for this environment." };
  }
  redirect(next);
}

export async function signOutAction() {
  try {
    await auth.signOut();
  } catch {
    // Treat an already-expired session as signed out.
  }
  redirect("/login");
}
