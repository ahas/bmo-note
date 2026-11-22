import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

import ko from "../../i18n/ko.json";
import { FIXTURE, seeded } from "./fixture";
import { stoodUp } from "./stack";

import type { Browser, Page } from "playwright-core";
import type { Stack } from "./stack";

// The editor's own words follow the console's language (docs/design.md, 「The editor's own words follow the
// console's language」). The fork names the words of its own chrome in English inside its sources and ships no
// translation, so the bundle answers them through the seam the fork carries, from its pack. This file reads that
// chrome in a real browser at a desktop's width, in Korean: the names the keys of the toolbar over a run of words
// wear and the words the menus they hold carry, the kinds the menu that changes a block's kind offers, the slash
// menu standing on an empty line with its group titles, its item names and the line under each and what a reader
// typing there is left with, the hint the lines carry for an empty one, and a code block's keys with the hint its
// caption waits under. It also holds a pointer over the keys of that toolbar and over the items of the slash menu
// and reads the rooms that rise for them, where the fork's words stand only inside a template. Every word read is
// the pack's word for that thing, read out of the pack by the file itself, never written as letters in the file,
// and nothing standing in that chrome is left in the fork's English beside the product names the console's wording
// guide keeps in their own. The English a room still holds is what the pack answers with nothing — the sample data
// and the dates a card pictures, a file's name, a formula, code — and the file names it card by card. Skipped
// where the browser build is not on the machine.

const ready = existsSync(chromium.executablePath());

const STACK_MS = 900_000;
const TEST_MS = 600_000;
const STANDING_MS = 300_000;
const SETTLING_MS = 60_000;

const SHOTS = process.env.BMO_NOTE_SHOTS ?? "/tmp/note-renewal-shots";

// The cookie the dev host reads for the language: the editor's words are read as the pack's Korean.
const LOCALE_COOKIE = "bmo-dev-locale";
const WORDS = ko.note;
// What the pack answers for each word the fork says.
const SAID = WORDS.editor.words;

const PARAGRAPH = "affine-paragraph";
const TOOLBAR = "affine-toolbar-widget editor-toolbar[data-open]";
// A menu a press opens is drawn in a portal of its own, beside the document rather than under the key that
// asked for it, and a menu that stands closed keeps its parts in the document: only what stands drawn is read.
const GATHERED = "editor-menu-action";
const SLASH = ".slash-menu-item";
const SLASH_GROUPS = ".slash-menu-group-name";
const HINT = ".affine-paragraph-placeholder";
const CODE = "affine-code";
const CODE_BAR = "editor-toolbar.code-toolbar-container";
const CAPTION = "textarea.block-caption-editor";

// The words that stand in English wherever the console's wording guide keeps a product, a format or a
// protocol name: none of them a word the fork owed the reader.
const ENGLISH_KEPT = ["AI", "PDF", "URL", "HTML", "Markdown", "KaTeX", "Figma", "GitHub", "Youtube", "YouTube", "Loom", "Spotify", "Miro", "bilibili", "Excalidraw", "Notion", "Airtable", "Tarot", "Google", "LaTeX"];

// A card the slash menu holds for a pointer's hover, named by the words the fork says for it. The fork's words
// are the keys because the room holds them inside a template, where the seam can only ask what a card says one
// line at a time: `caption` is the word the card wears, `says` the lines the pack answers it, and `keeps` the
// English the card only pictures — the sample data or the date of a document drawn there, a file's name, a
// formula, a piece of code laid in the editor's code face, which the seam leaves exactly as the fork drew it.
interface Card {
  item: string;
  caption: string;
  says: string[];
  keeps: string[];
}

const CARDS: Card[] = [
  {
    item: "Text",
    caption: "Text",
    says: ["In a decentralized system, we can have a kaleidoscopic", "complexity to our data.", "Any user may have a different perspective on what data they", "either have, choose to share, or accept.", "For example, one user’s edits to a document might be on", "their laptop on an airplane; when the plane lands and the", "computer reconnects, those changes are distributed to", "other users.", "Other users might choose to accept all, some, or none of", "those changes to their version of the document."],
    keeps: []
  },
  {
    // The same lines again, where the card cuts them narrower.
    item: "Divider",
    caption: "Divider",
    says: ["In a decentralized system, we can have a", "kaleidoscopic complexity to our data.", "Any user may have a different perspective", "on what data they either have, choose to", "share, or accept.", "For example, one user’s edits to a", "document might be on their laptop on an", "airplane; when the plane lands and the", "computer reconnects, those changes are", "distributed to other users.", "Other users might choose to accept all,", "some, or none of those changes to their", "version of the document."],
    keeps: []
  },
  {
    item: "Bulleted List",
    caption: "Bulleted List",
    says: ["Here's an example of a bulleted list.", "You can list your plans such as this"],
    keeps: []
  },
  {
    item: "Numbered List",
    caption: "Numbered List",
    says: ["Here's an example of a numbered list.", "You can list your plans such as this"],
    keeps: []
  },
  {
    item: "To-do List",
    caption: "To-do List",
    says: ["Here is an example of todo list.", "Make a list for building preview."],
    keeps: []
  },
  {
    item: "Callout",
    caption: "Callout",
    says: ["Highlight important notes.", "A storyboard is a visual representation of a story, typically presented in the form of sequential", "panels. Each panel features illustrations or images accompanied by notes describing key", "scenes or shots, including details of action and dialogue."],
    keeps: []
  },
  {
    item: "Table",
    caption: "Table",
    says: ["Insert editable tabular data.", "Country", "Ranking", "Weekly Overtime (Hrs)"],
    keeps: ["China", "Japan", "USA", "🥇 First", "🥈 Second", "🥉 Third"]
  },
  {
    item: "Table View",
    caption: "Table View",
    says: ["Display items in a table format.", "Untitled Table", "Title", "Status", "Todo", "In Progress", "Done"],
    keeps: ["Task 1", "Task 2", "Task 3"]
  },
  {
    item: "Kanban View",
    caption: "Kanban View",
    says: ["Visualize data in a dashboard.", "Untitled Kanban", "Ungroups", "In Progress", "Done"],
    keeps: ["Task 1", "Task 4", "Task 5"]
  },
  {
    item: "Image",
    caption: "Photo",
    says: ["Insert a photo."],
    keeps: []
  },
  {
    item: "Attachment",
    caption: "Attachment",
    says: ["Attach a file."],
    keeps: ["Rickroll.mp3"]
  },
  {
    item: "Frame",
    caption: "Frame",
    says: ["Create a blank frame in Edgeless", "Frame"],
    keeps: []
  },
  {
    item: "Mind Map",
    caption: "Mind Map",
    says: ["Create a mind map in Edgeless", "Mind Map", "Edgeless"],
    keeps: []
  },
  {
    item: "Inline Equation",
    caption: "Inline Equation",
    says: ["Energy. Mass. Light. In a single equation,"],
    keeps: ["E=mc^2"]
  },
  {
    item: "Code Block",
    caption: "Code Block",
    says: [],
    keeps: ["struct", "var", "some", "body:", "ContentView", "View", "Text", "helloTo", '"Hello', 'helloTo)!"', '"World"', "@State"]
  },
  {
    item: "Today",
    caption: "Today",
    says: ["Insert today’s date"],
    keeps: ["Wed 3 Aug, 2022"]
  },
  {
    // A card that cuts its line around the day it names: the seam answers each piece, the picture's own date stands.
    item: "Tomorrow",
    caption: "Tomorrow",
    says: ["Insert", "tomorrow’s", "date"],
    keeps: ["Wed 3 Aug, 2022"]
  },
  {
    item: "Now",
    caption: "Now",
    says: ["Insert", "now", "date", "and time."],
    keeps: ["11:45:14 Wed 3 Aug, 2022"]
  }
];

interface Drawn {
  /** The words the chrome holds as text. */
  texts: string[];
  /** The words the chrome names itself by: an accessible name, a native hint, a field's placeholder. */
  names: string[];
}

let stack: Stack | null = null;
let browser: Browser;

beforeAll(async () => {
  if (!ready) return;

  mkdirSync(SHOTS, { recursive: true });
  stack = await stoodUp();
  browser = await chromium.launch();

  // The dev host builds the editor's sources the first time a note asks for them, reloading the page as it
  // finds what they import; two passes over an open note let that settle before the notes are written.
  for (let pass = 0; pass < 2; pass += 1) {
    const page = await opened("/note");

    await page.locator("[data-navigator-list]").waitFor({ timeout: STANDING_MS });
    if (pass === 1) await seeded(page, [FIXTURE.notes[0]!]);
    await page.context().close();
  }
}, STACK_MS);

afterAll(async () => {
  await browser?.close();
  await stack?.down();
}, STACK_MS);

describe.skipIf(!ready)("the editor's own words", () => {
  test(
    "the keys over a run of words, the menu gathered under one of them and the colour menu another opens are the pack's words",
    async () => {
      const page = await note(FIXTURE.notes[0]!.id);

      // A line of words is taken whole by a triple press, and the toolbar rises over it.
      await page.locator(PARAGRAPH).first().click({ clickCount: 3 });
      await page.locator(TOOLBAR).waitFor({ state: "visible", timeout: SETTLING_MS });

      const bar = await drawn(page, "affine-toolbar-widget");
      const marks = [WORDS.mark.bold, WORDS.mark.italic, WORDS.mark.underline, WORDS.mark.strike, WORDS.mark.code];

      expect({ marks: marks.filter((one) => bar.names.includes(one)) }).toEqual({ marks });
      expect(bar.names).toContain(SAID["More"]);
      expect(bar.names).toContain(SAID["Conversions"]);
      expect(bar.names).toContain(SAID["Align"]);
      expect(bar.names).toContain(SAID["Highlight"]);
      expect(nothingEnglish(bar)).toEqual([]);

      await page.locator(`${TOOLBAR} editor-icon-button[aria-label="${SAID["More"]}"]`).click();
      await standing(page, GATHERED, WORDS.block.delete);

      const gathered = await drawn(page, drawnRoot(GATHERED));
      const acts = [WORDS.block.copy, WORDS.block.duplicate, WORDS.block.delete];

      expect({ acts: acts.filter((one) => gathered.texts.includes(one) || gathered.names.includes(one)) }).toEqual({ acts });
      expect(nothingEnglish(gathered)).toEqual([]);

      // The colour menu a key opens holds its headings and its colours in the bar itself, whether the menu
      // stands open or not, so they are read where they are held rather than by pressing a key over a bar
      // that moves with the selection.
      const colours = [SAID["Color"], SAID["Background"], SAID["default color"], SAID["default background"], SAID["red"], SAID["grey"]];

      expect({ held: colours.filter((one) => bar.texts.includes(one) || bar.names.includes(one)) }).toEqual({ held: colours });
      await page.context().close();
    },
    TEST_MS
  );

  test(
    "the menu that changes a block's kind names every kind it offers",
    async () => {
      const page = await note(FIXTURE.notes[0]!.id);

      await page.locator(PARAGRAPH).first().click({ clickCount: 3 });
      await page.locator(TOOLBAR).waitFor({ state: "visible", timeout: SETTLING_MS });
      await page.locator(`${TOOLBAR} editor-icon-button[aria-label="${SAID["Conversions"]}"]`).click();
      await standing(page, GATHERED, WORDS.kind.h1);

      const offered = await drawn(page, drawnRoot(GATHERED));
      const kinds = [WORDS.kind.text, WORDS.kind.h1, WORDS.kind.bulleted, WORDS.kind.numbered, WORDS.kind.quote, WORDS.kind.code];

      expect({ kinds: kinds.filter((one) => offered.texts.includes(one)) }).toEqual({ kinds });
      expect(nothingEnglish(offered)).toEqual([]);

      await picture(page, "words-turn-into");
      await page.context().close();
    },
    TEST_MS
  );

  test(
    "the slash menu names its groups, its items and the line under each, and the hint its lines carry",
    async () => {
      const page = await note(FIXTURE.notes[0]!.id);

      // The hint the lines carry for an empty one is the fork's own line, answered by the pack.
      await intoEmptyLine(page);
      const hints = await page.locator(HINT).evaluateAll((found: Element[]) => found.map((one) => (one.textContent ?? "").trim()));

      expect(hints.length).toBeGreaterThan(0);
      expect(hints).toContain(SAID["Type '/' for commands"]);
      expect(nothingEnglish({ texts: hints, names: [] })).toEqual([]);

      await page.keyboard.type("/");
      await standing(page, SLASH_GROUPS, SAID["Basic"]);

      const menu = await together(page, [`${SLASH}:visible`, `${SLASH_GROUPS}:visible`]);
      const groups = [SAID["Basic"], SAID["Content & Media"], SAID["Date"], SAID["Database"], SAID["Actions"], SAID["Style"], SAID["Edgeless Element"]];

      expect({ groups: groups.filter((one) => menu.texts.includes(one)) }).toEqual({ groups });
      const items = [WORDS.kind.text, WORDS.kind.h1, WORDS.kind.bulleted, WORDS.action.table, WORDS.action.image, SAID["Callout"], SAID["Today"]];

      expect({ items: items.filter((one) => menu.texts.includes(one)) }).toEqual({ items });
      // The line under an item is a sentence of the fork's, answered as every other word is.
      expect(menu.texts).toContain(SAID["Insert an image."]);
      expect(nothingEnglish(menu)).toEqual([]);

      await picture(page, "words-slash-menu");
      await page.keyboard.press("Escape");
      await page.context().close();
    },
    TEST_MS
  );

  test(
    "what a reader types into the slash menu leaves the item the pack has named",
    async () => {
      const page = await note(FIXTURE.notes[0]!.id);

      await intoEmptyLine(page);
      await page.keyboard.type("/Bulleted");
      await drawnTo(page, SLASH);

      // The item the query leaves standing, named as the menu draws it.
      expect(await named(page, SLASH)).toEqual([WORDS.kind.bulleted]);

      await page.keyboard.press("Escape");
      await page.context().close();
    },
    TEST_MS
  );

  test(
    "a code block's keys, the menu under them and the hint its caption waits under are the pack's words",
    async () => {
      const page = await note(FIXTURE.notes[0]!.id);

      await inCodeBlock(page);

      const bar = await drawn(page, CODE_BAR);
      const keys = [SAID["Copy code"], SAID["Caption"], SAID["Collapse code"]];

      expect({ keys: keys.filter((one) => bar.names.includes(one)) }).toEqual({ keys });
      expect(nothingEnglish(bar)).toEqual([]);

      await page.locator(`${CODE_BAR} editor-icon-button[aria-label="${SAID["Caption"]}"]`).click();

      const caption = page.locator(CAPTION).last();

      await caption.waitFor({ state: "visible", timeout: SETTLING_MS });
      expect(await caption.getAttribute("placeholder")).toBe(SAID["Write a caption"]);

      await picture(page, "words-code-block");
      await page.context().close();
    },
    TEST_MS
  );

  test(
    "the rooms a pointer's hover brings up say the pack's words, and picture only what the pack leaves in the fork's English",
    async () => {
      const page = await note(FIXTURE.notes[0]!.id);

      // A key's room holds the one word the pack gave the key.
      await page.locator(PARAGRAPH).first().click({ clickCount: 3 });
      await page.locator(TOOLBAR).waitFor({ state: "visible", timeout: SETTLING_MS });

      for (const key of ["Bold", "Conversions", "Create Table", "More"]) {
        const room = await hovered(page, `${TOOLBAR} editor-icon-button[aria-label="${SAID[key]}"]`, SAID[key]);

        expect({ key, room }).toEqual({ key, room: [SAID[key]] });
      }

      // A card's room holds the words the pack answers for the lines it says, and pictures the rest.
      await intoEmptyLine(page);
      await page.keyboard.type("/");
      await standing(page, SLASH_GROUPS, SAID["Basic"]);

      const items = await named(page, SLASH);

      for (const card of CARDS) {
        const index = items.indexOf(SAID[card.item]);

        expect(index).toBeGreaterThanOrEqual(0);

        const room = await hovered(page, `${SLASH} >> nth=${index}`, SAID[card.caption]);
        const answered = [SAID[card.caption], ...card.says.map((one) => SAID[one])];
        const kept = card.keeps;
        const left = room.filter((one) => /[A-Za-z]{2,}/.test(one) && !ENGLISH_KEPT.some((held) => one.includes(held)) && !kept.includes(one));

        expect({ card: card.item, answered: answered.filter((one) => room.includes(one)) }).toEqual({ card: card.item, answered });
        expect({ card: card.item, pictured: kept.filter((one) => room.includes(one)) }).toEqual({ card: card.item, pictured: kept });
        expect({ card: card.item, english: left }).toEqual({ card: card.item, english: [] });
      }

      await picture(page, "words-hover-rooms");
      await page.context().close();
    },
    TEST_MS
  );

});

// A page of the console's own, in Korean, at a desktop's width: room enough for the editor's whole bar.
async function opened(path: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  // A loaded machine may take longer than the driver's own default over any step.
  context.setDefaultTimeout(STANDING_MS);
  // The editor copies through the platform's clipboard, which a browser hands out only when asked.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.addCookies([{ name: LOCALE_COOKIE, value: "ko", url: stack!.host }]);

  const page = await context.newPage();

  await page.goto(`${stack!.host}${path}`);

  return page;
}

// The note open, with its first line standing.
async function note(id: string): Promise<Page> {
  const page = await opened(`/note/${id}`);

  await page.locator(PARAGRAPH).first().waitFor({ timeout: STANDING_MS });

  return page;
}

// The caret stands in a new empty line at the note's end.
async function intoEmptyLine(page: Page): Promise<void> {
  await page.locator(PARAGRAPH).last().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.locator(PARAGRAPH).last().waitFor({ timeout: SETTLING_MS });
}

// The note holds a code block of its own and the caret stands in it, under the bar the editor raises.
async function inCodeBlock(page: Page): Promise<void> {
  const blocks = await page.locator(CODE).count();

  await page.evaluate(() => {
    const host = document.querySelector("editor-host") as unknown as { std: { store: any } };
    const store = host.std.store;
    const note = store.root.children.find((child: { flavour: string }) => child.flavour === "affine:note");
    const Text = note.children[0].text.constructor;

    store.addBlock("affine:code", { text: new Text("let a = 1;") }, note.id);
  });

  const block = page.locator(CODE).nth(blocks);

  await block.waitFor({ state: "visible", timeout: SETTLING_MS });
  await block.click();
  await page.locator(CODE_BAR).waitFor({ state: "visible", timeout: SETTLING_MS });
}

// A part of the chrome the editor has drawn at all, wherever it drew it.
async function drawnTo(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().waitFor({ state: "attached", timeout: SETTLING_MS });
}

/** Where only the chrome standing drawn is read: a closed menu keeps its parts in the document. */
function drawnRoot(root: string): string {
  return `${root}:visible`;
}

// The chrome of `root` says `wanted` and stands drawn: the words of a row it holds directly, which the
// name an item draws in a room of its own is not.
async function standing(page: Page, root: string, wanted: string): Promise<void> {
  await page.locator(drawnRoot(root), { hasText: wanted }).first().waitFor({ timeout: SETTLING_MS });
}

// The room a hover brings up, read as a reader reads it: every line of words it holds, in the order it lays
// them. A room stands in a portal of its own beside the document, and an earlier key's room may still be
// fading, so the newest room that says the word the reader came for is the room read.
async function hovered(page: Page, selector: string, says: string): Promise<string[]> {
  // The pointer leaves whatever it stood over, so a room rises only where it is asked for.
  await page.mouse.move(0, 0);
  await page.locator(selector).first().hover({ timeout: SETTLING_MS });

  const room = await page.waitForFunction(
    (wanted: string) => {
      const standing: string[][] = [];

      for (const portal of Array.from(document.querySelectorAll("div.blocksuite-portal"))) {
        const root = portal.shadowRoot ?? portal;

        for (const room of Array.from(root.querySelectorAll('[role="tooltip"]'))) {
          const lines: string[] = [];

          const walk = (node: Node) => {
            for (const child of Array.from(node.childNodes)) {
              if (child.nodeType === Node.TEXT_NODE) {
                const line = (child.data ?? "").replace(/\s+/g, " ").trim();

                if (line !== "") {
                  lines.push(line);
                }
              } else if (child.nodeType === Node.ELEMENT_NODE && !["STYLE", "SCRIPT"].includes((child as Element).tagName.toUpperCase())) {
                walk(child);
              }
            }
          };

          walk(room);

          if (lines.includes(wanted)) {
            standing.push([...new Set(lines)]);
          }
        }
      }

      return standing.length > 0 ? standing[standing.length - 1] : undefined;
    },
    says,
    { timeout: SETTLING_MS }
  );

  const lines = await room.jsonValue();

  if (lines === undefined) {
    throw new Error(`no room rose that says ${says}`);
  }

  return lines;
}

// What the chrome of `root` says: the words it draws as text, and the names it wears. The chrome is read
// with the driver's own reach, which goes through the editor's drawing rooms; a page's own query does not.
async function drawn(page: Page, root: string): Promise<Drawn> {
  const read = (selector: string, attribute: string): Promise<string[]> =>
    page.locator(selector).evaluateAll((found: Element[], name: string) => found.map((one) => (one.getAttribute(name) ?? "").trim()).filter((one) => one !== ""), attribute);

  return {
    texts: [...(await own(page, root)), ...(await leaves(page, root))],
    names: [...new Set([...(await read(`${root} [aria-label]`, "aria-label")), ...(await read(`${root} [title]`, "title")), ...(await read(`${root} [placeholder]`, "placeholder"))])]
  };
}

// The words a part of the chrome says itself, with nothing further under it. A page function reads only
// what it carries, so the hover test below is written into each reader.
async function own(page: Page, root: string): Promise<string[]> {
  return page.locator(root).evaluateAll((found: Element[]) => {
    const standing = (one: Element): boolean => {
      let room: Node | null = one;

      while (room !== null) {
        if (room instanceof Element && room.tagName.toLowerCase() === "affine-tooltip") return false;
        const room2 = room.getRootNode();

        room = room.parentNode ?? (room2 instanceof ShadowRoot ? room2.host : null);
      }

      return true;
    };

    return [...new Set(found.filter((one) => one.children.length === 0 && standing(one)).map((one) => (one.textContent ?? "").trim()).filter((one) => one !== ""))];
  });
}

// The words of the smallest parts of the chrome: an element under `root` that holds no further element
// says its own words, and the marks a key's icon carries are no words at all.
async function leaves(page: Page, root: string): Promise<string[]> {
  return page.locator(`${root} *`).evaluateAll((found: Element[]) => {
    const standing = (one: Element): boolean => {
      let room: Node | null = one;

      while (room !== null) {
        if (room instanceof Element && room.tagName.toLowerCase() === "affine-tooltip") return false;
        const up = room.getRootNode();

        room = room.parentNode ?? (up instanceof ShadowRoot ? up.host : null);
      }

      return true;
    };

    return [
      ...new Set(
        found
          .filter((one) => one.children.length === 0 && standing(one) && !["STYLE", "SCRIPT", "LINK", "META"].includes(one.tagName.toUpperCase()) && one.closest("svg") === null)
          .map((one) => (one.textContent ?? "").trim())
          .filter((one) => one !== "")
      )
    ];
  });
}

// Whether a word stands only in the room a pointer's hover brings up.
function insideHover(one: Element): boolean {
  let room: Node | null = one;

  while (room !== null) {
    if (room instanceof Element && room.tagName.toLowerCase() === "affine-tooltip") return true;
    const root = room.getRootNode();

    room = room.parentNode ?? (root instanceof ShadowRoot ? root.host : null);
  }

  return false;
}

// The words of several parts of the chrome at once.
async function together(page: Page, roots: string[]): Promise<Drawn> {
  const read = await Promise.all(roots.map((one) => drawn(page, one)));

  return { texts: [...new Set(read.flatMap((one) => one.texts))], names: [...new Set(read.flatMap((one) => one.names))] };
}

// What the parts of the chrome under `root` are called, read out of the room each draws its name in.
async function named(page: Page, root: string): Promise<string[]> {
  return page.locator(root).evaluateAll((found: Element[]) => found.map((one) => (one.shadowRoot?.querySelector(".text")?.textContent ?? one.textContent ?? "").trim()).filter((one) => one !== ""));
}

/** The words of the editor's chrome that stand in the fork's English: none, beside the names kept. */
function nothingEnglish(words: Drawn): string[] {
  return [...words.texts, ...words.names].filter((one) => /[A-Za-z]{2,}/.test(one) && !ENGLISH_KEPT.some((kept) => one.includes(kept)));
}

async function picture(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
