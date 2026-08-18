const HKD_DECIMAL_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/;
const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

export function parseHkdCents(value: string): number | null {
  const match = HKD_DECIMAL_PATTERN.exec(value);
  if (!match) return null;

  const wholeDigits = match[1]!.replace(/^0+(?=\d)/, "");
  if (wholeDigits.length > 14) return null;

  const fractionalDigits = (match[2] ?? "").padEnd(2, "0");
  const cents = BigInt(wholeDigits) * 100n + BigInt(fractionalDigits || "0");
  if (cents > MAX_SAFE_CENTS) return null;

  const amount = Number(cents);
  return Number.isSafeInteger(amount) ? amount : null;
}
