// The bundle's packages installed as its lockfile states them, in the hoisted layout `bunfig.toml` names. A tree
// installed before in Bun's isolated layout keeps its store under `node_modules/.bun` and links into it at the top,
// and an install in the hoisted layout over such a tree leaves those links standing beside the packages it hoists,
// so the editor's modules would load from two copies at once. Such a tree is taken away whole before the install,
// with the dev host's dependency cache built over it, so every install stands on the lockfile alone.

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const client = join(fileURLToPath(import.meta.url), "../..");
const modules = join(client, "node_modules");

if (existsSync(join(modules, ".bun"))) {
  console.error("install: the packages stand in an isolated layout; they are installed again from the lockfile");
  rmSync(modules, { recursive: true, force: true });
  rmSync(join(client, "dev-app", "node_modules", ".cache"), { recursive: true, force: true });
}

const run = Bun.spawnSync(["bun", "install", "--frozen-lockfile"], { cwd: client, stdout: "inherit", stderr: "inherit" });

process.exit(run.exitCode ?? 1);
