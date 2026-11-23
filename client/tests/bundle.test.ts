import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { parse } from "vue/compiler-sfc";

import { INSERTS, KINDS, MARKS } from "../app/domain/format";
import { PACKS, keysOf, word } from "./words";

// The bundle as a console finds it: the words every key the screens ask for, in both
// locales, under the bundle's namespace, the rows its screens stand their keys in, and no Korean anywhere in
// the code.

const root = new URL("..", import.meta.url).pathname;

function files(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);

    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const sources = [...files(join(root, "app")), ...files(join(root, "shared")), ...files(join(root, "console"))].filter((path) => /\.(ts|vue)$/.test(path));

describe("the words", () => {
  test("both locales hold the same keys, all under the bundle's namespace", () => {
    expect(keysOf(PACKS.en).sort()).toEqual(keysOf(PACKS.ko).sort());
    expect(keysOf(PACKS.ko).every((key) => key.startsWith("note."))).toBe(true);
  });

  test("the editor's own words are the pack's, one word for one thing wherever it is named", () => {
    // The kinds and the marks the bar, the slash menu and the drag handle's menu name, and what the slash menu
    // puts in, each answered in both packs.
    for (const kind of KINDS) expect(word(PACKS.ko, `note.kind.${kind.id}`), kind.id).toBeDefined();
    for (const mark of MARKS) expect(word(PACKS.ko, `note.mark.${mark.id}`), mark.id).toBeDefined();
    for (const insert of INSERTS) expect(word(PACKS.ko, `note.insert.${insert.id}`), insert.id).toBeDefined();

    // A table is named by the bar's word wherever the bundle's own lines speak of one.
    const table = PACKS.ko.note.action.table;
    const namesTable = /\btables?\b|\btabular\b/i;

    for (const key of keysOf(PACKS.en)) if (namesTable.test(word(PACKS.en, key)!)) expect(word(PACKS.ko, key), key).toContain(table);
  });

  test("no word holds a bare @ or |, which the translator reads as a linked message and a plural", () => {
    for (const pack of [PACKS.en, PACKS.ko]) {
      for (const key of keysOf(pack)) {
        const said = word(pack, key)!.replace(/\{'[^']*'\}/gu, "");

        expect(said.includes("@"), key).toBe(false);
        if (!key.endsWith("_count")) expect(said.includes("|"), key).toBe(false);
      }
    }
  });

  test("every key the screens ask for is held", () => {
    // The bar's own names: the marks and kinds reach the packs through template heads, written whole here.
    const asked = new Set(sources.flatMap((path) => [...readFileSync(path, "utf8").matchAll(/["'`](note\.(?:section|sort|search|action|label|mark|kind|talk|empty|status|question|error|comment|link|editor|slash|insert|block|ask|share)\.[a-z_0-9]+)["'`]/g)].map((match) => match[1]!)));

    for (const mark of MARKS) asked.add(`note.mark.${mark.id}`);
    for (const kind of KINDS) asked.add(`note.kind.${kind.id}`);
    for (const insert of INSERTS) asked.add(`note.insert.${insert.id}`);

    expect(asked.size).toBeGreaterThan(20);

    // The lines a refused save names by code are built at the moment of the refusal, not written whole.
    for (const code of ["bad-doc", "too-large"]) asked.add(`note.error.${code}`);

    const missing = [...asked].filter((key) => word(PACKS.ko, key) === undefined || word(PACKS.en, key) === undefined);

    expect(missing).toEqual([]);
  });
});

describe("the messages", () => {
  test("every line reaches the console's one message pill, never a toaster or the editor's own box", () => {
    // The console stands the library's toaster down, so a line told through it is lost.
    const roads = /@nuxt\/ui\/composables\/useToast|\buseToast\(|\bwindow\.(?:alert|confirm|prompt)\(/;
    const second = sources.filter((path) => roads.test(readFileSync(path, "utf8")));

    expect(second).toEqual([]);
  });
});

describe("the inputs", () => {
  test("every input a note screen draws is hidden by the native attribute", () => {
    const drawn = sources
      .filter((path) => path.endsWith(".vue"))
      .flatMap((path) => [...readFileSync(path, "utf8").matchAll(/<input\b[^>]*>/g)].map((match) => ({ path, tag: match[0] })));

    expect(drawn.length).toBeGreaterThan(0);

    for (const { path, tag } of drawn) expect(tag, path).toContain("hidden");
  });
});

// A screen's template as the Vue compiler reads it, walked as elements: a tag, its static attributes, the
// name of the slot a `<template>` fills, and the elements under it.
type Element = { tag: string; attributes: Map<string, string>; slot: string | null; children: Element[] };

type RawNode = {
  type: number;
  tag?: string;
  props?: { type: number; name: string; value?: { content: string }; arg?: { content?: string } }[];
  children?: RawNode[];
};

const ELEMENT_NODE = 1;
const ATTRIBUTE_PROP = 6;
const DIRECTIVE_PROP = 7;

function elementOf(node: RawNode): Element {
  const props = node.props ?? [];
  const attributes = new Map(props.filter((prop) => prop.type === ATTRIBUTE_PROP).map((prop) => [prop.name, prop.value?.content ?? ""]));
  const slot = props.find((prop) => prop.type === DIRECTIVE_PROP && prop.name === "slot")?.arg?.content ?? null;
  const children = (node.children ?? []).filter((child) => child.type === ELEMENT_NODE).map(elementOf);

  return { tag: node.tag ?? "", attributes, slot, children };
}

function templateOf(path: string): Element {
  const ast = parse(readFileSync(join(root, path), "utf8")).descriptor.template?.ast;

  if (ast === undefined || ast === null) throw new Error(`${path} holds no template`);

  return elementOf(ast as unknown as RawNode);
}

function within(element: Element, tag: string): Element[] {
  return element.children.flatMap((child) => [...(child.tag === tag ? [child] : []), ...within(child, tag)]);
}

function slotOf(element: Element, name: string): Element | undefined {
  return element.children.find((child) => child.tag === "template" && child.slot === name);
}

describe("the screens' rows", () => {
  const screen = templateOf("app/pages/note/[[noteId]].vue");
  const region = templateOf("app/components/NoteOpen.vue");

  test("no screen lays anything into the console's title bar", () => {
    for (const path of sources) {
      const text = readFileSync(path, "utf8");

      expect(/screenActions|screenLead/.test(text), path).toBe(false);
    }

    // A screen draws into an element of its own alone: no teleport names a place by a fixed selector.
    for (const path of sources.filter((file) => file.endsWith(".vue"))) {
      for (const teleport of within(templateOf(path.slice(root.length)), "Teleport")) expect(teleport.attributes.has("to"), path).toBe(false);
    }
  });

  test("the screen's own bar holds the screen's name and no key", () => {
    const bars = within(screen, "div").filter((element) => element.attributes.has("data-screen-bar"));

    expect(bars).toHaveLength(1);
    expect(within(bars[0]!, "UButton")).toEqual([]);
    expect(within(bars[0]!, "h1")).toHaveLength(1);
  });

  test("the comments key and the talk key close the format bar, and no way back stands in it", () => {
    const bar = within(templateOf("app/components/NoteToolbar.vue"), "ToolBar")[0]!;
    const editor = within(region, "NoteEditor")[0]!;
    const keys = within(slotOf(editor, "barEnd")!, "UButton");

    expect(within(bar.children[0]!, "slot").map((slot) => slot.attributes.get("name"))).toEqual(["start"]);
    expect(slotOf(editor, "barStart")).toBeUndefined();
    expect(keys.map((key) => [...key.attributes.keys()].find((name) => name.endsWith("-key")))).toEqual(["data-comments-key", "data-talk-key"]);
  });

  test("every key in the format bar is the library's small button at its own size", () => {
    const groups = [within(within(templateOf("app/components/NoteToolbar.vue"), "ToolBar")[0]!, "UButton"), within(slotOf(within(region, "NoteEditor")[0]!, "barEnd")!, "UButton")];

    for (const group of groups) expect(group.length).toBeGreaterThan(0);

    for (const key of groups.flat()) {
      expect(key.attributes.get("size")).toBe("sm");
      expect(key.attributes.get("class") ?? "").not.toMatch(/(^|\s)(\S+:)?(h|w|size|min-w|min-h|p|px|py)-/);
    }
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
