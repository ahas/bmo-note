import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

import ko from "../../i18n/ko.json";
import { FIXTURE, seeded } from "./fixture";
import { stoodUp } from "./stack";

import type { Browser, Locator, Page } from "playwright-core";
import type { Stack } from "./stack";

// Every block of a note has its handle and its toolbar (docs/design.md, 「Every block has its handle and its
// toolbar」), at a desktop's width and a phone's: a block of every kind the editor's menus make stands in a note,
// and each one's handle stands in view beside it, its press selecting the block whole under a toolbar whose way to
// delete stands whole inside the screen at either width: where the editor's room holds the fork's bar over a line of
// words that bar stands, and where it does not the block's three keys stand in its place. A table's handle is pressed while the caret stands in one
// of its cells, and the table's own toolbar keys, named in Korean, stand on top; that toolbar duplicates and deletes
// the table, and Delete and Backspace each remove a table selected whole. The handle follows the pointer, so those
// widths are driven with one. The same phone's width read by a finger holds 「On a phone a held finger in the
// gutter chooses a block whole」 and the toolbar's hold to the screen: a finger held in the gutter beside a line of
// words chooses it whole under a toolbar that holds inside the screen carrying the block's three keys, which delete
// the line; a table so chosen is duplicated and deleted by those same keys; and a finger that slides, a press shorter
// than the hold and a hold on the words choose no block. Pictures of the handle, the toolbars and the phone's choice
// are kept for a person to read. Skipped where the browser build is not on the machine.

const ready = existsSync(chromium.executablePath());

// How long the stack is given to build and stand, a test to run, and a state to come about; the first page
// the dev host serves builds the editor's sources, so the first editor is given the longest to stand.
const STACK_MS = 900_000;
const TEST_MS = 600_000;
const STANDING_MS = 300_000;
const SETTLING_MS = 60_000;
// How long a finger is held in a test: past the half second the platform's one hold reads, with room for
// the page to answer.
const HOLD_MS = 800;
// The least room a finger has to hold in beside the document's column: the width a phone gives a touch.
const GUTTER_MIN_PX = 40;

const SHOTS = process.env.BMO_NOTE_SHOTS ?? "/tmp/note-renewal-shots";

// The cookie the dev host reads for the language: the format bar's keys are found by their Korean names.
const LOCALE_COOKIE = "bmo-dev-locale";
const WORDS = ko.note;
// What the pack answers for the fork's own word, which is the name the key wears once the editor is drawn in Korean.
const MORE_MENU = WORDS.editor.words["More menu"];

// The note's top-level blocks, and the editor's last line, where a table or a database is written.
const BLOCKS = "affine-note > .affine-note-block-container > .affine-block-children-container > [data-block-id]";
const LAST_LINE = "affine-note > .affine-note-block-container > .affine-block-children-container > affine-paragraph";
const TOOLBAR = "affine-toolbar-widget editor-toolbar[data-open]";

const WIDTHS = [
  { name: "a desktop's width", width: 1280, height: 800, note: FIXTURE.notes[0]!, finger: false, roomy: true },
  { name: "a phone's width", width: 360, height: 780, note: FIXTURE.notes[1]!, finger: false, roomy: false }
];

// The same phone's width read by a finger rather than a pointer: the navigator stays away, and the note
// region owns the screen.
const PHONE = { name: "a phone", width: 360, height: 780, note: FIXTURE.notes[2]!, finger: true };

type Width = (typeof WIDTHS)[number];

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Where a finger stands on the screen.
interface Point {
  x: number;
  y: number;
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
    const page = await opened(WIDTHS[0]!, "/note");

    await page.locator("[data-navigator-list]").waitFor({ timeout: STANDING_MS });
    if (pass === 1) await seeded(page, [...WIDTHS, PHONE].map((width) => width.note));
    await page.context().close();
  }
}, STACK_MS);

afterAll(async () => {
  await browser?.close();
  await stack?.down();
}, STACK_MS);

// A page at a width, in Korean, on the screen at `path`: read by a mouse, or by a finger where the width
// is held by one.
async function opened(width: Width | typeof PHONE, path: string): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: width.width, height: width.height },
    hasTouch: width.finger,
    isMobile: width.finger
  });
  // A loaded machine, a deployment's gate among them, may take longer than the driver's own default over any
  // step, so every step is given the time a page is given to stand.
  context.setDefaultTimeout(STANDING_MS);

  await context.addCookies([{ name: LOCALE_COOKIE, value: "ko", url: stack!.host }]);

  const page = await context.newPage();

  await page.goto(`${stack!.host}${path}`);

  return page;
}

// The width's note open, holding a block of every kind after its own lines: headings and lists that hold
// others, so their handles stand a toggle's width further out, the text kinds, the cards, a database through
// the slash menu and a table through the format bar's key.
async function noteOfEveryKind(width: Width): Promise<Page> {
  const page = await opened(width, `/note/${width.note.id}`);

  await page.locator(LAST_LINE).first().waitFor({ timeout: STANDING_MS });
  await page.evaluate(() => {
    const host = document.querySelector("editor-host") as unknown as { std: { store: any } };
    const store = host.std.store;
    const note = store.root.children.find((child: { flavour: string }) => child.flavour === "affine:note");
    const add = (flavour: string, props: Record<string, unknown> = {}, parent: string = note.id): string => store.addBlock(flavour, props, parent);
    // The document's own text type, read off a line the note already holds.
    const Text = note.children[0].text.constructor;
    const line = (words: string) => ({ text: new Text(words) });

    add("affine:paragraph", { type: "h1", ...line("Plan") });
    add("affine:paragraph", line("Under the heading"));
    add("affine:paragraph", { type: "quote", ...line("Quote") });
    add("affine:list", { type: "bulleted", ...line("Parent") });
    add("affine:list", { type: "bulleted", ...line("Child") }, note.children[note.children.length - 1].id);
    add("affine:list", { type: "numbered", ...line("First") });
    add("affine:list", { type: "todo", ...line("To do") });
    add("affine:code", line("let a = 1;"));
    add("affine:divider");
    add("affine:paragraph", { type: "h2", ...line("Cards") });
    add("affine:paragraph", {}, add("affine:callout"));
    add("affine:latex", { latex: "x^2" });
    add("affine:image");
    add("affine:attachment", { name: "plan.txt", size: 1, type: "text/plain" });
    add("affine:bookmark", { url: `${location.origin}/` });
    add("affine:paragraph");
  });

  await page.locator(LAST_LINE).last().click();
  await page.keyboard.type("/kanban");
  await page.keyboard.press("Enter");
  await page.locator("affine-database").first().waitFor({ timeout: SETTLING_MS });
  await withTable(page);

  return page;
}

// One more table, written through the format bar's key after the editor's last line.
async function withTable(page: Page): Promise<void> {
  const tables = await page.locator("affine-table").count();

  await page.locator(LAST_LINE).last().click();
  await page.getByRole("button", { name: WORDS.action.table }).first().click();
  await tablesStanding(page, tables + 1);
}

// Waits for the note to hold `count` top-level blocks.
async function blocksStanding(page: Page, count: number): Promise<void> {
  await page.waitForFunction(({ selector, wanted }) => document.querySelectorAll(selector).length === wanted, { selector: BLOCKS, wanted: count }, { timeout: SETTLING_MS });
}

// Waits for the note to hold `count` tables.
async function tablesStanding(page: Page, count: number): Promise<void> {
  await page.waitForFunction((wanted) => document.querySelectorAll("affine-table").length === wanted, count, { timeout: SETTLING_MS });
}

// No block and no caret held, so a press starts from nothing chosen.
async function nothingChosen(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.querySelector("editor-host") as unknown as { std: { selection: { clear(): void } } }).std.selection.clear();
    document.getSelection()?.removeAllRanges();
  });
}

// The block's handle once the pointer stands over the block: where it stands, and the host's leading edge.
async function handleOf(page: Page, id: string, at: (box: Box) => { x: number; y: number }): Promise<{ grabber: Box; hostLeft: number }> {
  await page.evaluate((one) => document.querySelector(`[data-block-id="${one}"]`)!.scrollIntoView({ block: "center" }), id);

  const box = await page.evaluate((one) => {
    const { left, top, width, height } = document.querySelector(`[data-block-id="${one}"]`)!.getBoundingClientRect();

    return { left, top, width, height };
  }, id);
  const point = at(box);

  await page.mouse.move(point.x, 2);
  await page.mouse.move(point.x, point.y, { steps: 4 });

  const found = await page.waitForFunction(
    (one) => {
      const widget = document.querySelector("affine-drag-handle-widget") as (Element & { anchorBlockId: { peek(): string | null } }) | null;
      const grabber = widget?.shadowRoot?.querySelector(".affine-drag-handle-grabber") ?? widget?.querySelector(".affine-drag-handle-grabber");

      if (widget?.anchorBlockId.peek() !== one || !grabber) return null;

      const { left, top, width, height } = grabber.getBoundingClientRect();

      if (width === 0) return null;

      return { grabber: { left, top, width, height }, hostLeft: document.querySelector("[data-note-editor]")!.getBoundingClientRect().left };
    },
    id,
    { timeout: SETTLING_MS }
  ).catch((error: Error) => {
    throw new Error(`no handle beside the block: ${error.message}`);
  });

  return (await found.jsonValue())!;
}

// The id of the note's last top-level block of a kind, taken from the column so a block nested inside a
// table is never mistaken for one.
async function lastTopLevel(page: Page, tag: string): Promise<string> {
  const ids = await page.evaluate(
    ({ selector, kind }) =>
      [...document.querySelectorAll(selector)]
        .filter((one) => one.tagName.toLowerCase() === kind)
        .map((one) => one.getAttribute("data-block-id")!),
    { selector: BLOCKS, kind: tag }
  );

  return ids[ids.length - 1]!;
}

// Presses the block's handle, as a person does once the pointer rests on it, and waits for the block to stand
// selected whole under its toolbar; where it does not, says what stands chosen instead.
async function pressHandle(page: Page, id: string, at: (box: Box) => { x: number; y: number }): Promise<{ grabber: Box; hostLeft: number }> {
  const handle = await handleOf(page, id, at);

  await page.mouse.move(handle.grabber.left + handle.grabber.width / 2, handle.grabber.top + handle.grabber.height / 2, { steps: 3 });
  await page
    .waitForFunction(() => (document.querySelector("affine-drag-handle-widget") as unknown as { isDragHandleHovered: boolean }).isDragHandleHovered, null, { timeout: SETTLING_MS })
    .catch(async (error: Error) => {
      const under = await page.evaluate(({ x, y }) => {
        let found: Element | null = document.elementFromPoint(x, y);

        while (found?.shadowRoot?.elementFromPoint(x, y) && found.shadowRoot.elementFromPoint(x, y) !== found) found = found.shadowRoot.elementFromPoint(x, y);

        return `${found?.tagName}.${String(found?.className ?? "").slice(0, 60)}`;
      }, { x: handle.grabber.left + handle.grabber.width / 2, y: handle.grabber.top + handle.grabber.height / 2 });

      throw new Error(`the pointer never rested on the handle at ${JSON.stringify(handle)}, over ${under}: ${error.message}`);
    });
  await page.mouse.down();
  await page.mouse.up();

  const chosen = await page
    .waitForFunction(
      (one) => {
        const value = (document.querySelector("editor-host") as unknown as { std: { selection: { value: { type: string; blockId?: string }[] } } }).std.selection.value;

        return value.length === 1 && value[0]!.type === "block" && value[0]!.blockId === one;
      },
      id,
      { timeout: SETTLING_MS }
    )
    .then(() => null)
    .catch(() =>
      page.evaluate(() => {
        const widget = document.querySelector("affine-drag-handle-widget") as unknown as { anchorBlockId: { peek(): string | null } };
        const value = (document.querySelector("editor-host") as unknown as { std: { selection: { value: { type: string; blockId?: string }[] } } }).std.selection.value;

        return { anchor: widget.anchorBlockId.peek(), chosen: value.map((one) => `${one.type}:${one.blockId ?? ""}`) };
      })
    );

  expect({ pressed: id, chosen }).toEqual({ pressed: id, chosen: null });
  await page.locator(TOOLBAR).waitFor({ timeout: SETTLING_MS });

  return handle;
}

// The toolbar's way to delete the block chosen whole: a key of the bundle's own, named in Korean, or the
// fork's more menu, which carries the delete inside it. Where that way stands is the reading — a key cut
// off by the screen's edge is out of reach whatever it draws.
async function reachesDelete(page: Page, across: number): Promise<string> {
  const own = page.locator(`${TOOLBAR} editor-icon-button[aria-label="${WORDS.block.delete}"]`);

  if ((await own.count()) > 0) return standsInside(own.first(), across);

  return standsInside(page.locator(`${TOOLBAR} editor-menu-button[aria-label="${MORE_MENU}"]`).first(), across);
}

// Where a key stands across the screen, read in the page: `inside` where its whole box fits a screen
// `across` pixels wide, and the box that failed, or the blank where it draws nothing. The bar is the
// fork's own and stands behind a shadow room of its own, which is why the page is asked.
async function standsInside(key: Locator, across: number): Promise<string> {
  const stood = await key.evaluate((one, width) => {
    const line = one.getBoundingClientRect();

    if (line.width === 0) return null;

    return line.left >= 0 && line.right <= width ? "inside" : `${Math.round(line.left)}..${Math.round(line.right)} past ${String(width)}`;
  }, across);

  return stood ?? "nothing drawn";
}

// Whether each named key of the open toolbar is what a press at its centre lands on, once the toolbar has come
// fully into view.
async function keysOnTop(page: Page, labels: string[]): Promise<Record<string, boolean>> {
  await page.waitForFunction(
    (selector) => {
      const bar = document.querySelector("affine-toolbar-widget")?.shadowRoot?.querySelector(selector) ?? document.querySelector(selector);

      return !!bar && getComputedStyle(bar).opacity === "1";
    },
    "editor-toolbar[data-open]",
    { timeout: SETTLING_MS }
  );

  return page.evaluate((names) => {
    const deepest = (x: number, y: number): Element | null => {
      let found = document.elementFromPoint(x, y);

      while (found?.shadowRoot) {
        const inner = found.shadowRoot.elementFromPoint(x, y);

        if (!inner || inner === found) break;
        found = inner;
      }

      return found;
    };
    const bar = document.querySelector("affine-toolbar-widget")?.shadowRoot?.querySelector("editor-toolbar[data-open]");
    const result: Record<string, boolean> = {};

    for (const name of names) {
      const key = bar?.querySelector(`editor-icon-button[aria-label="${name}"]`);
      const box = key?.getBoundingClientRect();
      const hit = box ? deepest(box.left + box.width / 2, box.top + box.height / 2) : null;

      result[name] = !!key && !!hit && (key === hit || key.contains(hit) || !!key.shadowRoot?.contains(hit));
    }

    return result;
  }, labels);
}

// The picture of a state, once the fonts it draws in have come.
async function picture(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const nearTop = (box: Box) => ({ x: box.left + box.width / 2, y: box.top + Math.min(12, box.height / 2) });
const inCell = (box: Box) => ({ x: box.left + box.width * 0.3, y: box.top + box.height * 0.7 });

for (const width of WIDTHS) {
  describe.skipIf(!ready)(`the block handle at ${width.name}`, () => {
    let page: Page;

    beforeAll(async () => {
      page = await noteOfEveryKind(width);
    }, TEST_MS);

    afterAll(async () => {
      await page?.context().close();
    });

    test(
      "every block kind shows its handle inside the editor, and its press selects it whole under its toolbar",
      async () => {
        const blocks = await page.evaluate(
          (selector) =>
            [...document.querySelectorAll(selector)].map((element) => {
              const model = (element as unknown as { model: { flavour: string; props: { type?: string } } }).model;

              return { id: element.getAttribute("data-block-id")!, flavour: model.flavour, kind: [model.flavour, model.props.type].filter(Boolean).join(" ") };
            }),
          BLOCKS
        );
        const kinds = new Set(blocks.map((block) => block.flavour));

        expect([...kinds]).toEqual(
          expect.arrayContaining(["affine:paragraph", "affine:list", "affine:code", "affine:divider", "affine:callout", "affine:latex", "affine:image", "affine:attachment", "affine:bookmark", "affine:database", "affine:table"])
        );

        for (const block of blocks) {
          await nothingChosen(page);

          const reached = await (async () => {
            const { grabber, hostLeft } = await pressHandle(page, block.id, nearTop);

            return {
              inside: grabber.left >= Math.max(hostLeft, 0),
              bar: await standsInside(page.locator(TOOLBAR).first(), width.width),
              delete: await reachesDelete(page, width.width)
            };
          })().catch((error: Error) => ({ failed: error.message.split("\n")[0] }));

          expect({ block: block.kind, ...reached }).toEqual({ block: block.kind, inside: true, bar: "inside", delete: "inside" });
        }
      },
      TEST_MS
    );

    test(
      "the bar over a line of words folds the fork's keys only where the room has no place for them",
      async () => {
        const line = await lastTopLevel(page, "affine-paragraph");

        await nothingChosen(page);
        await pressHandle(page, line, nearTop);

        const own = (await page.locator(`${TOOLBAR} editor-icon-button[aria-label="${WORDS.block.delete}"]`).count()) > 0;
        const more = (await page.locator(`${TOOLBAR} editor-menu-button[aria-label="${MORE_MENU}"]`).count()) > 0;

        expect({ width: width.width, blockKeys: own, forkMenu: more }).toEqual({ width: width.width, blockKeys: !width.roomy, forkMenu: width.roomy });
      },
      TEST_MS
    );

    test(
      "a table's handle selects it whole while the caret stands in one of its cells",
      async () => {
        const table = page.locator("affine-table").first();
        const id = (await table.getAttribute("data-block-id"))!;

        await nothingChosen(page);
        await table.scrollIntoViewIfNeeded();
        await page.locator("affine-table affine-table-cell rich-text").first().click();
        await pressHandle(page, id, inCell);

        const keys = [WORDS.block.copy, WORDS.block.duplicate, WORDS.block.delete];

        expect(await keysOnTop(page, keys)).toEqual(Object.fromEntries(keys.map((key) => [key, true])));
        await picture(page, `${width.width}-table-toolbar`);
      },
      TEST_MS
    );

    test(
      "the table's toolbar duplicates and deletes it, and Delete and Backspace each remove it",
      async () => {
        const tables = () => page.locator("affine-table").count();
        const firstTable = async () => (await page.locator("affine-table").first().getAttribute("data-block-id"))!;
        const before = await tables();

        await nothingChosen(page);
        await pressHandle(page, await firstTable(), inCell);
        await page.locator(`${TOOLBAR} editor-icon-button[aria-label="${WORDS.block.duplicate}"]`).click();
        await tablesStanding(page, before + 1);

        await nothingChosen(page);
        await pressHandle(page, await firstTable(), inCell);
        await page.locator(`${TOOLBAR} editor-icon-button[aria-label="${WORDS.block.delete}"]`).click();
        await tablesStanding(page, before);

        for (const key of ["Delete", "Backspace"]) {
          await withTable(page);

          const standing = await tables();

          await nothingChosen(page);
          await pressHandle(page, await firstTable(), inCell);
          await page.keyboard.press(key);
          await tablesStanding(page, standing - 1);
        }

        await nothingChosen(page);

        const id = await firstTable();

        await handleOf(page, id, nearTop);
        await picture(page, `${width.width}-table-handle`);
      },
      TEST_MS
    );
  });
}

// A phone reads a block with a held finger in the gutter, since it has no pointer for the handle to
// follow (docs/design.md, 「On a phone a held finger in the gutter chooses a block whole」). The hold is
// the platform's own half second, so the touch sequence is laid down as a real finger lays it; the toolbar
// the choice raises is the same one a press on the handle raises, and it holds inside the screen at a
// phone's width, which is what its delete and its more menu are then reachable by. A picture of the choice
// is kept for a person to read.

describe.skipIf(!ready)("a block chosen by a held finger on a phone", () => {
  let page: Page;

  beforeAll(async () => {
    page = await phoneNote();
  }, TEST_MS);

  afterAll(async () => {
    await page?.context().close();
  });

  test(
    "a hold in the gutter chooses a line of words whole, under a toolbar that holds inside the screen",
    async () => {
      const id = await lastTopLevel(page, "affine-paragraph");

      await nothingChosen(page);
      await pressFinger(page, await gutterBeside(page, id), HOLD_MS);

      expect({ chosen: await standsChosen(page, id) }).toEqual({ chosen: null });

      const bar = page.locator(TOOLBAR).first();

      // The room the finger holds in, between the editor's edge and the document's column, keeps a
      // touch's own width; narrower and the hold becomes an aim.
      expect(await gutterRoom(page)).toBeGreaterThanOrEqual(GUTTER_MIN_PX);

      expect({ shown: await bar.isVisible(), bar: await standsInside(bar, PHONE.width), way: await reachesDelete(page, PHONE.width) }).toEqual({ shown: true, bar: "inside", way: "inside" });

      // In a room with no place for the fork's bar, a line of words carries the block's three keys of the
      // bundle's own, and the delete among them takes the line away.
      const keys = [WORDS.block.copy, WORDS.block.duplicate, WORDS.block.delete];

      expect(await keysOnTop(page, keys)).toEqual(Object.fromEntries(keys.map((key) => [key, true])));

      const standing = await page.locator(BLOCKS).count();

      // The picture is taken while the choice and its toolbar stand.
      await picture(page, "phone-held-block-toolbar");

      await page.locator(`${TOOLBAR} editor-icon-button[aria-label="${WORDS.block.delete}"]`).click();
      await blocksStanding(page, standing - 1);
    },
    TEST_MS
  );

  test(
    "a table held from the gutter is duplicated and deleted by its toolbar",
    async () => {
      const tables = () => page.locator("affine-table").count();
      const standing = await tables();
      const held = await lastTopLevel(page, "affine-table");

      await nothingChosen(page);
      await pressFinger(page, await gutterBeside(page, held), HOLD_MS);
      expect({ chosen: await standsChosen(page, held) }).toEqual({ chosen: null });

      const keys = [WORDS.block.copy, WORDS.block.duplicate, WORDS.block.delete];

      for (const key of keys) {
        expect({ key, onTop: (await keysOnTop(page, [key]))[key], inside: await standsInside(page.locator(`${TOOLBAR} editor-icon-button[aria-label="${key}"]`).first(), PHONE.width) }).toEqual({ key, onTop: true, inside: "inside" });
      }

      await picture(page, "phone-held-table-toolbar");

      await page.locator(`${TOOLBAR} editor-icon-button[aria-label="${WORDS.block.duplicate}"]`).click();
      await tablesStanding(page, standing + 1);

      await withTable(page);

      const before = await tables();
      const last = await lastTopLevel(page, "affine-table");

      await nothingChosen(page);
      await pressFinger(page, await gutterBeside(page, last), HOLD_MS);
      await standsChosen(page, last);
      await page.locator(`${TOOLBAR} editor-icon-button[aria-label="${WORDS.block.delete}"]`).click();
      await tablesStanding(page, before - 1);
    },
    TEST_MS
  );

  test(
    "a finger that slides, a press shorter than the hold and a hold on the words choose no block",
    async () => {
      const line = await lastTopLevel(page, "affine-paragraph");
      const beside = await gutterBeside(page, line);

      await nothingChosen(page);
      await pressFinger(page, beside, HOLD_MS, { x: beside.x, y: beside.y + 90 });
      expect({ after: await blocksChosen(page) }).toEqual({ after: [] });

      await nothingChosen(page);
      await pressFinger(page, await gutterBeside(page, line), 120);
      expect({ after: await blocksChosen(page) }).toEqual({ after: [] });

      await nothingChosen(page);
      await pressFinger(page, await wordsOf(page, line), HOLD_MS);
      expect({ after: await blocksChosen(page) }).toEqual({ after: [] });
    },
    TEST_MS
  );

  // The blocks the editor holds chosen whole, once the page has settled.
  async function blocksChosen(settling: Page): Promise<string[]> {
    await settling.waitForTimeout(400);

    return (await chosen(settling)).filter((line) => line.startsWith("block:"));
  }
});

// The note a phone is asked about: its fixture lines, one more line of words, a divider and a table.
async function phoneNote(): Promise<Page> {
  const page = await opened(PHONE, `/note/${PHONE.note.id}`);

  await page.locator(LAST_LINE).first().waitFor({ timeout: STANDING_MS });
  await page.evaluate(() => {
    const host = document.querySelector("editor-host") as unknown as { std: { store: any } };
    const store = host.std.store;
    const note = store.root.children.find((child: { flavour: string }) => child.flavour === "affine:note");
    const add = (flavour: string, props: Record<string, unknown> = {}): string => store.addBlock(flavour, props, note.id);
    const Text = note.children[0].text.constructor;

    add("affine:paragraph", { text: new Text("A line of words to choose") });
    add("affine:divider");
  });

  await withTable(page);

  return page;
}

// One finger: down at `at`, on to `moved` where it says so, and lifted after `heldMs`.
async function pressFinger(page: Page, at: Point, heldMs: number, moved?: Point): Promise<void> {
  const finger = await page.context().newCDPSession(page);
  const point = (where: Point) => [{ x: where.x, y: where.y, id: 1 }];

  await finger.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(at) });

  if (moved !== undefined) await finger.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(moved) });

  await Bun.sleep(heldMs);
  await finger.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await finger.detach();
}

// Where a finger holds in the gutter beside a block: the room left of the document's column, at the
// height of the block's first line.
async function gutterBeside(page: Page, id: string): Promise<Point> {
  await page.evaluate((one) => document.querySelector(`[data-block-id="${one}"]`)!.scrollIntoView({ block: "center" }), id);
  await page.waitForTimeout(300);

  return page.evaluate((one) => {
    const line = document.querySelector(`[data-block-id="${one}"]`)!.getBoundingClientRect();
    const column = document.querySelector("affine-note > .affine-note-block-container > .affine-block-children-container")!.getBoundingClientRect();

    return { x: Math.round(column.left / 2), y: Math.round(line.top + Math.min(12, line.height / 2)) };
  }, id as string);
}

// How wide the room beside the document's column is, between the editor's own edge and where its blocks
// begin: the band a finger holds in.
async function gutterRoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const room = document.querySelector("[data-note-editor]")!.getBoundingClientRect();
    const column = document.querySelector("affine-note > .affine-note-block-container > .affine-block-children-container")!.getBoundingClientRect();

    return Math.round(column.left - room.left);
  });
}

// Where a finger stands on a block's own words.
async function wordsOf(page: Page, id: string): Promise<Point> {
  const box = await page.evaluate((one) => {
    const line = document.querySelector(`[data-block-id="${one}"]`)!.getBoundingClientRect();

    return { left: line.left, top: line.top, height: line.height };
  }, id as string);

  return { x: Math.round(box.left + 30), y: Math.round(box.top + Math.min(12, box.height / 2)) };
}

// Waits until the editor holds `id` chosen whole, and answers null; where it holds anything else, that.
async function standsChosen(page: Page, id: string): Promise<string | null> {
  return page
    .waitForFunction(
      (one) => {
        const value = (document.querySelector("editor-host") as unknown as { std: { selection: { value: { type: string; blockId?: string }[] } } }).std.selection.value;

        return value.length === 1 && value[0]!.type === "block" && value[0]!.blockId === one;
      },
      id,
      { timeout: SETTLING_MS }
    )
    .then(() => null)
    .catch(() => chosen(page).then((lines) => lines.join(" ") || "nothing"));
}

// What the editor holds chosen, as `type:blockId` lines.
async function chosen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const value = (document.querySelector("editor-host") as unknown as { std: { selection: { value: { type: string; blockId?: string }[] } } }).std.selection.value;

    return value.map((one) => `${one.type}:${one.blockId ?? ""}`);
  });
}
