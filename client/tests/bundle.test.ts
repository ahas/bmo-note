import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { parse } from "vue/compiler-sfc";

import { EDITOR_WORDS, PACKS, keysOf, word } from "./words";

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

  test("the editor's own words answer in the reader's language from a table outside the pack", () => {
    const answered: Record<string, string> = EDITOR_WORDS.ko;
    const hangul = /[\p{Script=Hangul}]/u;

    // The words the fork says are the keys, so a word added to the fork is a word the table leaves
    // standing rather than one it hides; English, the fork's own language, has no table to answer from.
    expect(Object.keys(answered).length).toBeGreaterThan(80);

    for (const [said, korean] of Object.entries(answered)) {
      expect(hangul.test(korean), said).toBe(true);
    }

    // The console's own bar and the editor's keys name one thing with one word.
    const marks = { bold: "Bold", italic: "Italic", underline: "Underline", strike: "Strikethrough", code: "Code" } as const;
    const kinds = { text: "Text", h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", bulleted: "Bulleted List", numbered: "Numbered List", todo: "To-do List", quote: "Quote", code: "Code Block" } as const;

    for (const [key, said] of Object.entries(marks)) expect(answered[said], said).toBe(PACKS.ko.note.mark[key as keyof typeof PACKS.ko.note.mark]);
    for (const [key, said] of Object.entries(kinds)) expect(answered[said], said).toBe(PACKS.ko.note.kind[key as keyof typeof PACKS.ko.note.kind]);
  });

  test("every key the screens ask for is held", () => {
    // The bar's own names: the marks and kinds reach the packs through template heads, written whole here.
    const asked = new Set(sources.flatMap((path) => [...readFileSync(path, "utf8").matchAll(/["'`](note\.(?:section|sort|search|action|label|mark|kind|talk|empty|status|question|error)\.[a-z_0-9]+)["'`]/g)].map((match) => match[1]!)));

    for (const mark of ["bold", "italic", "underline", "strike", "code"]) asked.add(`note.mark.${mark}`);
    for (const kind of ["text", "h1", "h2", "h3", "bulleted", "numbered", "todo", "quote", "code"]) asked.add(`note.kind.${kind}`);

    expect(asked.size).toBeGreaterThan(20);

    // The lines a refused save names by code are built at the moment of the refusal, not written whole.
    for (const code of ["bad-doc", "too-large"]) asked.add(`note.error.${code}`);

    const missing = [...asked].filter((key) => word(PACKS.ko, key) === undefined || word(PACKS.en, key) === undefined);

    expect(missing).toEqual([]);
  });
});

describe("the messages", () => {
  test("every line reaches the console's one message pill, never a toaster or the editor's own box", () => {
    // The console stands the library's toaster down, so a line told through it is lost; the fork's toast
    // helper is the editor's road, which hands its lines to the service the screen provides.
    const roads = /@nuxt\/ui\/composables\/useToast|\buseToast\(|@blocksuite\/affine\/components\/toast|\bwindow\.(?:alert|confirm|prompt)\(/;
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

  test("the bundle's stylesheet holds a hidden file input against the editor's element rule", () => {
    // The editor lays an unlayered `input { display: flex }` rule when its module runs, which the
    // attribute alone loses to; only the bundle's own `!important` rule keeps the input out of the page.
    const css = readFileSync(join(root, "console/screens.css"), "utf8");

    expect(css).toMatch(/input\[type="file"\]\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
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

  test("the talk key closes the format bar, and no way back stands in it", () => {
    const bar = within(templateOf("app/components/NoteToolbar.vue"), "ToolBar")[0]!;
    const editor = within(region, "NoteEditor")[0]!;

    expect(within(bar.children[0]!, "slot").map((slot) => slot.attributes.get("name"))).toEqual(["start"]);
    expect(slotOf(editor, "barStart")).toBeUndefined();
    expect(within(slotOf(editor, "barEnd")!, "UButton")).toHaveLength(1);
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
