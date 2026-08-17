import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const READY_TIMEOUT_MS = 180_000;
const STOP_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 250;

interface ServerSpec {
  name: string;
  script: string;
  snapshotPath?: string;
  url: string;
  env: Record<string, string>;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function isAvailable(url: string) {
  try {
    const response = await fetch(url, { redirect: "manual" });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function waitUntilAvailable(spec: ServerSpec, child: ChildProcess) {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `${spec.name} parity server exited before ${spec.url} became available ` +
          `(exit=${String(child.exitCode)}, signal=${String(child.signalCode)})`,
      );
    }
    if (await isAvailable(spec.url)) return;
    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(`${spec.name} parity server did not become ready within 180 seconds`);
}

async function waitForExit(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null || child.signalCode !== null) return true;

  return Promise.race([
    new Promise<boolean>((resolve) => child.once("exit", () => resolve(true))),
    delay(timeoutMs).then(() => false),
  ]);
}

async function stopServer(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  child.kill("SIGTERM");
  if (await waitForExit(child, STOP_TIMEOUT_MS)) return;

  child.kill("SIGKILL");
  if (!(await waitForExit(child, STOP_TIMEOUT_MS))) {
    throw new Error(`Unable to stop parity server process ${String(child.pid)}`);
  }
}

export default async function globalSetup() {
  const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const e2eAuthSecret = randomBytes(32).toString("base64url");
  const e2eAuthStatePath = path.join(projectDirectory, "test-results", "e2e-auth-state.json");
  await mkdir(path.dirname(e2eAuthStatePath), { recursive: true });
  await writeFile(
    e2eAuthStatePath,
    JSON.stringify({
      cookies: [
        {
          name: "HERMESPASS_E2E_AUTH_COOKIE",
          value: e2eAuthSecret,
          domain: "127.0.0.1",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    }),
    { encoding: "utf8", mode: 0o600 },
  );
  const legacyDirectory = process.env["LEGACY_DIR"]
    ? path.resolve(process.env["LEGACY_DIR"])
    : path.resolve(projectDirectory, "../..");
  const legacyUrl = process.env["LEGACY_BASE_URL"] ?? "http://127.0.0.1:3100";
  const nextUrl = process.env["NEXT_BASE_URL"] ?? "http://127.0.0.1:3101";
  const specs: ServerSpec[] = [
    {
      name: "legacy",
      script: path.join(projectDirectory, "tests/e2e/support/serve-legacy.mjs"),
      snapshotPath: path.join(legacyDirectory, "src/routeTree.gen.ts"),
      url: legacyUrl,
      env: {
        HERMESPASS_LEGACY_DIR: legacyDirectory,
        HERMESPASS_SERVER_PORT: new URL(legacyUrl).port || "3100",
      },
    },
    {
      name: "next",
      script: path.join(projectDirectory, "tests/e2e/support/serve-next.mjs"),
      url: nextUrl,
      env: {
        HERMESPASS_NEXT_DIR: projectDirectory,
        HERMESPASS_SERVER_PORT: new URL(nextUrl).port || "3101",
        HERMESPASS_E2E_ADAPTER: "1",
        HERMESPASS_E2E_AUTH_SECRET: e2eAuthSecret,
      },
    },
  ];
  const children: ChildProcess[] = [];
  const snapshots = new Map<string, Buffer>();

  const cleanup = async () => {
    const stopResults = await Promise.allSettled(children.reverse().map(stopServer));
    const restoreResults = await Promise.allSettled(
      [...snapshots].map(([filePath, contents]) => writeFile(filePath, contents)),
    );
    const authStateResults = await Promise.allSettled([rm(e2eAuthStatePath, { force: true })]);
    const failure = [...stopResults, ...restoreResults, ...authStateResults].find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) throw failure.reason;
  };

  try {
    await Promise.all(
      specs.map(async (spec) => {
        if (await isAvailable(spec.url)) {
          if (process.env["CI"]) {
            throw new Error(`${spec.url} is already in use`);
          }
          console.log(`Reusing existing ${spec.name} parity server at ${spec.url}`);
          return;
        }

        if (spec.snapshotPath) {
          snapshots.set(spec.snapshotPath, await readFile(spec.snapshotPath));
        }
        const child = spawn(process.execPath, [spec.script], {
          cwd: projectDirectory,
          env: { ...process.env, ...spec.env },
          stdio: ["ignore", "inherit", "inherit"],
          windowsHide: true,
        });
        children.push(child);
        await waitUntilAvailable(spec, child);
      }),
    );
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      console.error("Parity server cleanup failed after setup error", cleanupError);
    }
    throw error;
  }

  return cleanup;
}
