import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.env.HERMESPASS_LEGACY_DIR ?? process.cwd());
process.chdir(root);

const port = Number(process.env.HERMESPASS_SERVER_PORT ?? "3100");
const host = "127.0.0.1";
const requireFromLegacy = createRequire(path.join(root, "package.json"));
const viteEntry = requireFromLegacy.resolve("vite");
const { createServer } = await import(pathToFileURL(viteEntry).href);
const server = await createServer({
  root,
  configFile: path.join(root, "vite.config.ts"),
  server: {
    host,
    port,
    strictPort: true,
    watch: { ignored: ["**/.worktrees/**"] },
  },
});

await server.listen();
server.printUrls();

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close();
  process.exit(0);
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
