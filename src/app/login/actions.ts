"use server";

import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth/server";
import { safeDashboardDestination } from "@/lib/auth/redirects";

export type LoginState = { error?: string };

export async function signInAction(_: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeDashboardDestination(formData.get("next"));
  if (!email || !password) return { error: "Email and password are required." };

  try {
    const { error } = await getAuth().signIn.email({ email, password });
    if (error) return { error: "Unable to sign in with those credentials." };
  } catch {
    return { error: "Authentication is not available for this environment." };
  }
  redirect(next);
}

export async function signOutAction() {
  try {
    await getAuth().signOut();
  } catch {
    // Treat an already-expired session as signed out.
  }
  redirect("/login");
}
