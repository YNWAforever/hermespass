const DEFAULT_DASHBOARD_PATH = "/dashboard";
const UNSAFE_PATH_CHARACTER = /[\\\u0000-\u001f\u007f]/;

function decodeForValidation(value: string): string | null {
  let decoded = value;
  try {
    for (let index = 0; index < 2; index += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function safeDashboardDestination(value: FormDataEntryValue | string | null): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_DASHBOARD_PATH;
  }

  const decoded = decodeForValidation(value);
  if (!decoded || UNSAFE_PATH_CHARACTER.test(value) || UNSAFE_PATH_CHARACTER.test(decoded)) {
    return DEFAULT_DASHBOARD_PATH;
  }

  const url = new URL(decoded, "http://hermespass.local");
  if (url.origin !== "http://hermespass.local") return DEFAULT_DASHBOARD_PATH;
  if (url.pathname !== "/dashboard" && !url.pathname.startsWith("/dashboard/")) {
    return DEFAULT_DASHBOARD_PATH;
  }

  return `${url.pathname}${url.search}${url.hash}`;
}
