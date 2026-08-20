import type { InsuranceStatus } from "./types";

const ALLOWED: Readonly<Record<InsuranceStatus, readonly InsuranceStatus[]>> = {
  quoted: ["binding"],
  binding: ["active"],
  active: ["active", "lapsed", "canceled"],
  lapsed: [],
  canceled: [],
};

export function canTransition(from: InsuranceStatus, to: InsuranceStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function assertTransition(from: InsuranceStatus, to: InsuranceStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Insurance transition ${from} -> ${to} is not allowed`);
  }
}
