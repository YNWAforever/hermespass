"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { Actor } from "@/lib/auth/authorization";

const ActorContext = createContext<Actor | null>(null);

export function ActorProvider({ actor, children }: { actor: Actor; children: ReactNode }) {
  return <ActorContext.Provider value={actor}>{children}</ActorContext.Provider>;
}

export function useActor(): Actor | null {
  return useContext(ActorContext);
}
