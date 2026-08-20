"use server";

import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth/server";
import { safeDashboardDestination } from "@/lib/auth/redirects";

export type LoginState = { error?: string };
export type MagicLinkState = { sent: boolean; error?: string };

const GENERIC_MAGIC_LINK_ERROR = "We couldn't send a sign-in link right now.";

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

export async function requestMagicLinkAction(
  _: MagicLinkState,
  formData: FormData,
): Promise<MagicLinkState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { sent: false, error: "Enter a valid email address." };
  }

  try {
    const { error } = await getAuth().signIn.magicLink({
      email,
      callbackURL: "/dashboard",
    });
    if (error) return { sent: false, error: GENERIC_MAGIC_LINK_ERROR };
    return { sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("NEON_AUTH_BASE_URL") || message.includes("NEON_AUTH_COOKIE_SECRET")) {
      return { sent: false, error: "Authentication is not available for this environment." };
    }

    return { sent: false, error: GENERIC_MAGIC_LINK_ERROR };
  }
}

export async function signOutAction() {
  try {
    await getAuth().signOut();
  } catch {
    // Treat an already-expired session as signed out.
  }
  redirect("/login");
}
