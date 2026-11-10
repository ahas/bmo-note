// The decorated and accessor-bearing files of the build's copy, transpiled in place: the bundle's own
// transform leaves standard decorators standing as written, and no browser reads them or the
// `accessor` keyword today; the transform's one lowering is the legacy experimental form, which the
// fork's hand-written standard decorators (Peekable, the gfx surface ones) do not answer to. So every
// such source file is transpiled with the TypeScript API — the compiler the fork itself declares its
// decorators to — in standard mode at an ES2021 target, helpers inlined and imports untouched,
// between `bun run vendor` and the bundle build (docs/affine.md, 「The client's build path to the
// vendored editor」). The tree must be installed first: this step is the compiler.

import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const client = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(client, "blocksuite");

const ts = (await import("typescript")).default ?? (await import("typescript"));

// What really carries a decorator is decided by the compiler's own parser, never by text alone: a
// text scan reads the `@media` lines of the editor's CSS template literals as decorators too.
const holdsDecorators = (source: ts.SourceFile): boolean => {
  let found = false;

  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.canHaveDecorators(node) && (ts.getDecorators(node) ?? []).length > 0) {
      found = true;
      return;
    }

    node.forEachChild(visit);
  };

  visit(source);

  return found;
};

// The text scan only points at candidates (it also reads the `@media` lines of the editor's CSS and
// the word `accessor` in other company), and the parser decides; the whole tree is never parsed,
// which is what keeps the process small. An `accessor` field needs the transpile even where no
// decorator stands — the keyword is what no browser reads, decorators included.
const candidate = /(^|\n)[ \t]*@[A-Za-z_$]|\baccessor\s+[A-Za-z_$]/;

// The tree is walked by hand, never by a recursive listing: the installed copy's packages reach each
// other through symlinked `node_modules` links, and a listing that follows them folds the tree onto
// itself until the process drowns. Plain directories only, dot-folders skipped.
const sources: string[] = [];
const walk = async (root: string, prefix = ""): Promise<void> => {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const name = prefix === "" ? entry.name : `${prefix}/${entry.name}`;

    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await walk(join(root, entry.name), name);
      continue;
    }
    if (/\.tsx?$/.test(entry.name)) sources.push(name);
  }
};

await walk(target);
sources.sort();

const transpiled: string[] = [];

for (const found of sources) {
  const path = join(target, found);
  const text = await readFile(path, "utf8");
  if (!candidate.test(text)) continue;

  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, found.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (!holdsDecorators(source) && !/\baccessor\s+[A-Za-z_$][\w$]*\s*[=;(:]/.test(text)) continue;

  const { outputText } = ts.transpileModule(text, {
    compilerOptions: {
      // Below ES2022 on purpose: the `accessor` keyword rides with the decorators proposal and no
      // browser parses it yet, so the transpile lowers it to a plain get/set pair beside the
      // decorators themselves.
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.ESNext,
      useDefineForClassFields: false,
      experimentalDecorators: false,
      isolatedModules: true
    },
    fileName: path
  });

  // Nothing decorated may survive: a raw decorator or a standing `accessor` reaching the bundle is a
  // syntax error to every browser, and this pass exists so none ever stands.
  if (/\baccessor\s+[A-Za-z_$][\w$]*\s*[=;(:]/.test(outputText) || holdsDecorators(ts.createSourceFile(path, outputText, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS))) {
    throw new Error(`a decorator survived the transpile: ${found}`);
  }

  await writeFile(path, outputText);
  transpiled.push(found);
}

console.log(`decorated files transpiled: ${transpiled.length}`);
