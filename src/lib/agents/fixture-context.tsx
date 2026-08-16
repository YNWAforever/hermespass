"use client";

import { createContext, type ReactNode, useContext } from "react";

const AgentFixtureContext = createContext(process.env["NODE_ENV"] === "test");

export function AgentFixtureProvider({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  return <AgentFixtureContext value={enabled}>{children}</AgentFixtureContext>;
}

export function useAgentFixtureMode(): boolean {
  return useContext(AgentFixtureContext);
}
