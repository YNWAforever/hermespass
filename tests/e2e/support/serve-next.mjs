import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import next from "next";

const root = path.resolve(process.env.HERMESPASS_NEXT_DIR ?? process.cwd());
const port = Number(process.env.HERMESPASS_SERVER_PORT ?? "3101");
const host = "127.0.0.1";

if (process.env.HERMESPASS_SKIP_NEXT_BUILD !== "1") {
  const nextCli = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const result = spawnSync(process.execPath, [nextCli, "build"], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const app = next({ dev: false, dir: root, hostname: host, port });
await app.prepare();
const handle = app.getRequestHandler();
const server = createServer((request, response) => handle(request, response));

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, host, () => resolve());
});
console.log(`Next parity server ready at http://${host}:${port}`);

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await new Promise((resolve) => server.close(() => resolve()));
  await app.close();
  process.exit(0);
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
