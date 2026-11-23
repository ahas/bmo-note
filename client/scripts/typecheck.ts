// The bundle's typecheck: `nuxi typecheck` over the layer, with the verdict taken from the unit's own
// files alone; lines a dependency's own files report are counted here for the record and never decide
// the check.

import { join } from "node:path";
import { fileURLToPath } from "node:url";

const client = join(fileURLToPath(import.meta.url), "../..");

const run = Bun.spawnSync(["bun", "x", "nuxi", "typecheck"], { cwd: client, stdout: "pipe", stderr: "pipe" });
const output = `${run.stdout.toString()}${run.stderr.toString()}`;

// An error line names its file at the front, relative to the project: ours stand under these folders.
const OURS = /^(app|shared|console|scripts|tests)\//;
const FOREIGN = /^(node_modules|\.nuxt)\//;
const ERROR = /^(.+?)\((\d+),(\d+)\): error TS\d+:/;

const ours: string[] = [];
let foreign = 0;

for (const line of output.split("\n")) {
  const found = ERROR.exec(line);

  if (found === null) continue;

  if (OURS.test(found[1]!)) ours.push(line);
  else if (FOREIGN.test(found[1]!)) foreign += 1;
  else ours.push(line);
}

if (ours.length > 0) {
  console.error(ours.join("\n"));
}

if (foreign > 0) {
  console.log(`(dependencies reported ${foreign} lines of their own)`);
}

if (ours.length > 0) {
  process.exit(1);
}

// A typecheck that died without naming files (a module error) must not read as a pass.
if (run.exitCode !== 0 && !output.includes("error TS")) {
  console.error(output);
  process.exit(1);
}

console.log("the bundle's own files typecheck");
