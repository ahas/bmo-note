import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { consoleManifest } from "bmo-ui/shared/console-manifest";

import { PACKS, keysOf, word } from "./words";

// The bundle as a console finds it: its declaration, the words every key the screens ask for, in both
// locales, under the bundle's namespace, and no Korean anywhere in the code.

const root = new URL("..", import.meta.url).pathname;

function files(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);

    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const sources = [...files(join(root, "app")), ...files(join(root, "shared")), ...files(join(root, "console"))].filter((path) => /\.(ts|vue)$/.test(path));

describe("the declaration", () => {
  const declared = JSON.parse(readFileSync(join(root, "console-bundle.json"), "utf8")) as Record<string, unknown>;

  test("names the bundle, its screen and its stream", () => {
    expect(declared).toMatchObject({ name: "note", title: "note.title", screenPath: "/note", serviceName: "note", events: true });
  });

  test("reads as a manifest by the contract, its title a word of the bundle", () => {
    const { languagePack: _pack, ...declaration } = declared;
    const manifest = consoleManifest({ ...declaration, bundle: "/console/bundle.js", words: "/console/words", role: "member", ownerKey: true });

    expect(manifest.name).toBe("note");
    expect(manifest.apiPrefix).toBe("/");
    expect(word(PACKS.ko, manifest.title)).toBeString();
  });
});

describe("the words", () => {
  test("both locales hold the same keys, all under the bundle's namespace", () => {
    expect(keysOf(PACKS.en).sort()).toEqual(keysOf(PACKS.ko).sort());
    expect(keysOf(PACKS.ko).every((key) => key.startsWith("note."))).toBe(true);
  });

  test("every key the screens ask for is held", () => {
    const asked = new Set(sources.flatMap((path) => [...readFileSync(path, "utf8").matchAll(/["'`](note\.(?:view|action|label|empty|status|question|error)\.[a-z_]+)["'`]/g)].map((match) => match[1]!)));

    expect(asked.size).toBeGreaterThan(20);

    // The lines a refused save names by code are built at the moment of the refusal, not written whole.
    for (const code of ["bad-doc", "too-large"]) asked.add(`note.error.${code}`);

    const missing = [...asked].filter((key) => word(PACKS.ko, key) === undefined || word(PACKS.en, key) === undefined);

    expect(missing).toEqual([]);
  });
});

describe("the code", () => {
  test("holds no Korean outside the words", () => {
    const hangul = /[\p{Script=Hangul}]/u;

    for (const path of [...sources, ...files(join(root, "tests")).filter((file) => !file.endsWith("words.ts"))]) {
      expect(hangul.test(readFileSync(path, "utf8")), path).toBe(false);
    }
  });
});
