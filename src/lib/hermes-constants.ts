export type RiskTier = "low" | "medium" | "high";
export type PassportStatus = "active" | "revoked" | "audit";
export type Decision = "allow" | "deny" | "hold";

export const MCC_CATEGORIES = [
  "Cloud Services",
  "SaaS & Software",
  "Advertising Media",
  "Travel & Transport",
  "Office Supplies",
  "Logistics & Freight",
  "Professional Services",
  "Crypto & Gambling",
] as const;

export const TOOL_SCOPES = [
  "catalog.read",
  "crm.read",
  "refund.issue",
  "email.dispatch",
  "checkout.external",
  "invoice.approve",
  "ads.bid",
  "vendor.contract",
] as const;

export const DECISION_TREND = [
  { hour: "02:00", allow: 142, deny: 4, hold: 2 },
  { hour: "04:00", allow: 168, deny: 6, hold: 3 },
  { hour: "06:00", allow: 245, deny: 9, hold: 5 },
  { hour: "08:00", allow: 412, deny: 18, hold: 11 },
  { hour: "10:00", allow: 508, deny: 22, hold: 14 },
  { hour: "12:00", allow: 466, deny: 15, hold: 9 },
  { hour: "14:00", allow: 531, deny: 26, hold: 16 },
  { hour: "16:00", allow: 487, deny: 19, hold: 12 },
  { hour: "18:00", allow: 322, deny: 11, hold: 7 },
] as const;

export function formatHKD(value: number): string {
  return `HK$ ${value.toLocaleString("en-HK", { minimumFractionDigits: 0 })}`;
}
