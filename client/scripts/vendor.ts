// The build's copy of the editor: the fork's vendored BlockSuite tree, copied into this project so
// bun install links every @blocksuite package of it as a workspace of its own and the bundle builds
// them from their own source (docs/affine.md, 「The client's build path to the vendored editor」). The
// copy is never tracked; `bun run vendor` renews it from the working tree.

import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const client = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(dirname(client), "blocksuite");
const target = join(client, "blocksuite");

// The three roots the bundle builds: the framework layer, the AFFiNE preset, and the editor container.
const roots = ["framework", "affine", "integration-test"];

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });

for (const root of roots) {
  await cp(join(source, root), join(target, root), {
    recursive: true,
    filter: (from) => !from.includes(`${source}/${root}/node_modules`) && !from.includes("/__tests__/")
  });
}

// The build reads a tsconfig per transformed file. Every package tsconfig of the copy is rewritten to
// extend the copy root's own: the fork's chain reaches project references and type roots the copy does
// not carry. The options are the transform-relevant ones of the fork's root config; typechecking the
// bundle stays Nuxt's own (`bun run typecheck`).
const TRANSFORM = {
  compilerOptions: {
    target: "ES2024",
    useDefineForClassFields: false,
    experimentalDecorators: false,
    strict: true,
    jsx: "preserve"
  }
};

await writeFile(join(target, "tsconfig.json"), `${JSON.stringify(TRANSFORM, null, 2)}\n`);

for (const found of (await readdir(target, { recursive: true }) as unknown as string[]).filter((file) => file.endsWith("tsconfig.json"))) {
  if (found === "tsconfig.json") continue;

  const path = join(target, found);
  const text = await readFile(path, "utf8");
  const depth = found.split("/").length - 1;
  const shared = `${"../".repeat(depth + 1)}tsconfig.json`;
  const comments = text.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  await writeFile(path, JSON.stringify({ ...JSON.parse(comments), extends: shared }, null, 2));
}

// The workspace list: every package of the copy, named outright, so `bun install` links all of them
// (the glob forms bun reads do not reach the nesting the fork's tree has).
const manifestPath = join(client, "package.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { workspaces?: string[] };
const packages: string[] = [];

for (const found of (await readdir(target, { recursive: true }) as unknown as string[]).filter((file) => file.endsWith("package.json"))) {
  const named = JSON.parse(await readFile(join(target, found), "utf8")) as { name?: string };

  if (named.name?.startsWith("@blocksuite")) packages.push(`blocksuite/${found.replace(/\/package\.json$/, "")}`);
}

manifest.workspaces = packages.sort();
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// The build's transform is oxc, and this version reads `override accessor` as plain JavaScript syntax.
// `override` is a type-level modifier alone: the copy drops it from accessor fields, which changes no
// runtime behaviour and leaves the fork's own tree untouched.
for (const found of (await readdir(target, { recursive: true }) as unknown as string[]).filter((file) => file.endsWith(".ts"))) {
  const path = join(target, found);
  const text = await readFile(path, "utf8");

  if (text.includes("override accessor")) await writeFile(path, text.replaceAll("override accessor", "accessor"));
}

console.log(`vendored ${roots.join(", ")} from ${source}: ${packages.length} workspace packages`);
