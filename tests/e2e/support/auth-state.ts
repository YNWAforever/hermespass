import path from "node:path";

export const E2E_AUTH_STORAGE_STATE = path.join(
  process.cwd(),
  "test-results",
  "e2e-auth-state.json",
);
