// Builds the migration and runs it with the arguments given (`main.ts`). The editor's sources read only
// through the bundler's transform — Bun's own loader runs a class's field initialisers before the
// parameter properties they read, which the fork's dependency container trips on — so the migration is
// built for Bun the way the console bundle is built for the browser, into a scratch folder, and then run.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";
import { build } from "vite";

const client = fileURLToPath(new URL("../../", import.meta.url));
const out = mkdtempSync(join(tmpdir(), "bmo-note-migrate-"));

try {
  await build({
    root: client,
    configFile: false,
    logLevel: "warn",
    plugins: [vanillaExtractPlugin()],
    oxc: { target: "es2022" },
    ssr: { noExternal: true, external: ["bun:sqlite"] },
    build: {
      ssr: join(client, "scripts/migrate/main.ts"),
      outDir: out,
      emptyOutDir: true,
      target: "es2022",
      rollupOptions: { external: ["bun:sqlite"], output: { entryFileNames: "migrate.js" } }
    }
  });

  const ran = Bun.spawnSync(["bun", join(out, "migrate.js"), ...process.argv.slice(2)], { stdout: "inherit", stderr: "inherit" });

  process.exitCode = ran.exitCode ?? 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
