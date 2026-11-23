import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

import ko from "../../i18n/ko.json";
import { docOf, FIXTURE } from "./fixture";
import { stoodUp } from "./stack";

import type { Browser, Locator, Page } from "playwright-core";
import type { Stack } from "./stack";

// What a person does with folders and bookmarks (docs/design.md, 「Folders」, 「Bookmarks」, 「The console
// surface」), in Korean, at a desktop's width by a pointer and at a phone's by a finger, read from what the browser
// draws: a folder made from the own section's head and named in its row, one made inside it from its menu, both
// standing in the tree and folding; a note moved into a folder by dragging its row under a pointer and by the
// row's move to under a finger, standing there after a reload; a folder renamed in its row; the search finding a
// note inside a folder; a folder deleted after its question, its notes standing at the top again; a folder, a note
// and a line bookmarked, standing in the bookmarks section; the line's bookmark bringing its line into sight,
// marked, and saying it was deleted once the line is gone; and a member, shown the shared note, seeing no folder
// of the owner's. A picture of each is kept. Skipped where the browser build is not on the machine.

const ready = existsSync(chromium.executablePath());

const STACK_MS = 900_000;
const TEST_MS = 600_000;
const STANDING_MS = 300_000;

const SHOTS = process.env.BMO_NOTE_SHOTS ?? "/tmp/note-renewal-shots";
const LOCALE_COOKIE = "bmo-dev-locale";
const READER_COOKIE = "bmo-dev-reader";
const STILL = "*, *::before, *::after { transition: none !important; animation-duration: 0s !important; }";

const WORDS = ko.note;

const WIDTHS = [
  { name: "a desktop's width by a pointer", width: 1280, height: 800, touch: false },
  { name: "a phone's width by a finger", width: 360, height: 780, touch: true }
] as const;

type Width = (typeof WIDTHS)[number];

let stack: Stack | null = null;
let browser: Browser;

beforeAll(async () => {
  if (!ready) return;

  mkdirSync(SHOTS, { recursive: true });
  stack = await stoodUp();
  browser = await chromium.launch();

  // The dev host builds the screen's sources the first time a screen asks for them, reloading the page as it does;
  // two passes over the screen and an open note let that settle.
  for (let pass = 0; pass < 2; pass += 1) {
    const page = await opened(WIDTHS[0], "/note");

    await page.locator("[data-navigator-list]").waitFor({ state: "attached", timeout: STANDING_MS });
    if (pass === 1) await made(page, "warm", "Warm", ["One line"]);
    await page.context().close();
  }

  const warm = await opened(WIDTHS[0], "/note/warm");

  await warm.locator("[data-note-editor] .ProseMirror").waitFor({ timeout: STANDING_MS });
  await warm.waitForTimeout(3_000);
  await warm.context().close();
}, STACK_MS);

afterAll(async () => {
  await browser?.close();
  await stack?.down();
}, STACK_MS);

async function opened(width: Width, path: string, reader?: string): Promise<Page> {
  const host = stack!.host;
  const context = await browser.newContext({ viewport: { width: width.width, height: width.height }, hasTouch: width.touch, isMobile: width.touch });

  context.setDefaultTimeout(STANDING_MS);
  await context.addCookies([{ name: LOCALE_COOKIE, value: "ko", url: host }, ...(reader === undefined ? [] : [{ name: READER_COOKIE, value: reader, url: host }])]);

  const page = await context.newPage();

  await page.goto(`${host}${path}`);
  await page.locator("[data-note-bar]").first().waitFor({ timeout: STANDING_MS });
  await page.addStyleTag({ content: STILL });

  return page;
}

/** A note of the reader's own made through the relay. */
async function made(page: Page, id: string, title: string, lines: string[]): Promise<void> {
  await page.evaluate(
    async ({ id, doc }) => {
      const answer = await fetch("/proxy/note/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, doc }) });

      if (!answer.ok) throw new Error(`the note was not made: ${answer.status}`);
    },
    { id, doc: docOf(title, lines) }
  );
}

/** Presses as the width's hand does: a finger's tap, a pointer's click. */
async function press(width: Width, target: Locator): Promise<void> {
  if (width.touch) await target.tap();
  else await target.click();
}

/** The navigator, standing in its drawer on a phone. */
async function navigatorShown(page: Page, width: Width): Promise<Locator> {
  if (width.touch) await press(width, page.locator("[data-navigator-key]").first());

  const navigator = page.locator("[data-navigator]:visible");

  await navigator.locator("[data-navigator-list] [data-mine]").waitFor({ timeout: STANDING_MS });

  return navigator;
}

function folderRow(navigator: Locator, id: string): Locator {
  return navigator.locator(`[data-folder="${id}"]`).first();
}

/** A folder row's own press, which folds and unfolds it, apart from its menu key. */
function folderToggle(navigator: Locator, id: string): Locator {
  return folderRow(navigator, id).locator(":scope > button[aria-expanded]");
}

function noteRow(scope: Locator, id: string): Locator {
  return scope.locator(`[data-note$="/${id}"]`).first();
}

/** Opens a row's menu from its `…` key and chooses an item, walking into a submenu where one is named. */
async function fromMenu(width: Width, row: Locator, path: string[]): Promise<void> {
  const page = row.page();

  await row.hover().catch(() => undefined);
  await press(width, row.getByRole("button", { name: WORDS.action.more }).last());

  for (const [step, name] of path.entries()) {
    // An item's name is its words and, under a pointer, the key named beside it.
    const item = page.getByRole(step === path.length - 1 && path.length > 1 ? "menuitemcheckbox" : "menuitem", { name: new RegExp(`^${name}( |$)`) }).last();

    try {
      await item.waitFor({ timeout: 30_000 });
    } catch (why) {
      await page.screenshot({ path: `${SHOTS}/folders-${width.width}-no-menu-item.png` });
      throw why;
    }

    await press(width, item);
  }
}

/** The folder ids the reader's folders stand at, by name. */
async function folderIds(page: Page): Promise<Record<string, string>> {
  return page.evaluate(async () => {
    const answer = await fetch("/proxy/note/folders");
    const page = (await answer.json()) as { items: { id: string; name: string }[] };

    return Object.fromEntries(page.items.map((folder) => [folder.name, folder.id]));
  });
}

/** Names the folder whose row stands open for its name. */
async function named(page: Page, name: string): Promise<void> {
  const field = page.locator("[data-folder-name] input, input[data-folder-name]").first();

  try {
    await field.waitFor({ timeout: 30_000 });
  } catch (why) {
    await page.screenshot({ path: `${SHOTS}/folders-${page.viewportSize()?.width}-no-name-field.png` });
    throw why;
  }

  await field.fill(name);
  await field.press("Enter");
}

async function shot(page: Page, width: Width, state: string): Promise<void> {
  await page.evaluate(() => globalThis.document.fonts.ready);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/folders-${width.width}-${state}.png` });
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const room = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));

  expect(room.scroll).toBeLessThanOrEqual(room.client);
}

describe.skipIf(!ready).each(WIDTHS)("folders and bookmarks at $name", (width) => {
  const outer = `${FIXTURE.words.folder} ${width.width}`;
  const inner = `${FIXTURE.words.inner} ${width.width}`;
  const renamed = `${outer} 2`;
  const filed = `filed-${width.width}`;
  const lined = `lined-${width.width}`;

  test(
    "folders are made, nested, named, folded, hold the notes moved into them and give them back when deleted",
    async () => {
      const page = await opened(width, "/note");

      await made(page, filed, `${FIXTURE.notes[0]!.title} ${width.width}`, ["First line", "Second line"]);
      await page.reload();
      await page.addStyleTag({ content: STILL });

      let navigator = await navigatorShown(page, width);

      // A folder made from the own section's head, named in its row.
      await press(width, navigator.locator("[data-new-folder]").first());
      await named(page, outer);
      await navigator.getByRole("button", { name: outer }).first().waitFor({ timeout: STANDING_MS });

      let ids = await folderIds(page);
      const outerId = ids[outer]!;

      expect(outerId).toBeDefined();

      // One made inside it from its menu, standing one step further in under it, unfolded.
      await fromMenu(width, folderRow(navigator, outerId), [WORDS.action.new_folder]);
      await named(page, inner);
      ids = await folderIds(page);

      const innerId = ids[inner]!;
      const outerBox = (await folderToggle(navigator, outerId).boundingBox())!;
      const innerName = (await folderRow(navigator, innerId).getByText(inner).boundingBox())!;
      const outerName = (await folderRow(navigator, outerId).getByText(outer).boundingBox())!;

      expect(innerName.y).toBeGreaterThan(outerBox.y);
      expect(innerName.x - outerName.x).toBe(16);
      expect(await folderToggle(navigator, outerId).getAttribute("aria-expanded")).toBe("true");
      await shot(page, width, "tree");

      // The note moved into the inner folder: dragged under a pointer, by its menu's move to under a finger.
      const row = noteRow(navigator.locator("[data-mine]"), filed);

      if (width.touch) {
        await fromMenu(width, row, [WORDS.action.move_to, inner]);
      } else {
        await row.dragTo(folderToggle(navigator, innerId));
      }

      await page.getByText(WORDS.status.moved).first().waitFor({ timeout: STANDING_MS });
      expect(await page.evaluate(async (id) => ((await (await fetch(`/proxy/note/notes/${id}`)).json()) as { folder: string | null }).folder, filed)).toBe(innerId);

      // It stands there after a reload, once its folders are unfolded, and no more at the top.
      await page.reload();
      await page.addStyleTag({ content: STILL });
      navigator = await navigatorShown(page, width);

      const innerRow = folderRow(navigator, innerId);

      await innerRow.waitFor({ timeout: STANDING_MS });

      // A pointer's drop may land as a press on the row it ends over too; the folder is unfolded to read it.
      if ((await folderToggle(navigator, innerId).getAttribute("aria-expanded")) === "false") await press(width, folderToggle(navigator, innerId));

      await noteRow(innerRow.locator("xpath=.."), filed).waitFor({ timeout: STANDING_MS });
      expect(await navigator.locator(`[data-mine] [data-section-room] > ul:not([data-folders]) [data-note$="/${filed}"]`).count()).toBe(0);

      // Folded, the folder hides what it holds.
      await press(width, folderToggle(navigator, innerId));
      expect(await noteRow(navigator, filed).count()).toBe(0);
      await press(width, folderToggle(navigator, innerId));
      await noteRow(navigator, filed).waitFor({ timeout: STANDING_MS });

      // Renamed in its row.
      await fromMenu(width, folderRow(navigator, outerId), [WORDS.action.rename]);
      await named(page, renamed);
      await navigator.getByRole("button", { name: renamed }).first().waitFor({ timeout: STANDING_MS });
      await noSidewaysScroll(page);
      await shot(page, width, "moved");

      // The search reads every folder.
      await press(width, page.locator("[data-search-entry]:visible").first());

      const search = page.locator("[data-note-search]");

      await search.locator("input").fill(`${width.width}`);
      await search.locator("[role=option]").filter({ hasText: FIXTURE.notes[0]!.title }).first().waitFor({ timeout: STANDING_MS });
      await page.keyboard.press("Escape");
      await search.waitFor({ state: "detached", timeout: STANDING_MS });

      // The outer folder deleted after its question: the inner one and the note move up to the top.
      navigator = await navigatorShown(page, width);
      await fromMenu(width, folderRow(navigator, outerId), [WORDS.action.delete]);

      const question = page.getByRole("alertdialog").or(page.getByRole("dialog")).last();

      await question.getByText(WORDS.question.delete_folder_effect).waitFor({ timeout: STANDING_MS });
      await press(width, question.getByRole("button", { name: WORDS.action.delete, exact: true }));
      await page.getByText(WORDS.status.folder_deleted).first().waitFor({ timeout: STANDING_MS });
      await folderRow(navigator, outerId).waitFor({ state: "detached", timeout: STANDING_MS });
      ids = await folderIds(page);
      expect([ids[renamed], ids[inner]]).toEqual([undefined, innerId]);

      // Deleting the inner folder too leaves the note at the top of the own notes.
      await fromMenu(width, folderRow(navigator, innerId), [WORDS.action.delete]);
      await press(width, page.getByRole("alertdialog").or(page.getByRole("dialog")).last().getByRole("button", { name: WORDS.action.delete, exact: true }));
      await page.getByText(WORDS.status.folder_deleted).first().waitFor({ timeout: STANDING_MS });
      await navigator.locator(`[data-mine] [data-section-room] > ul:not([data-folders]) [data-note$="/${filed}"]`).waitFor({ timeout: STANDING_MS });
      await page.context().close();
    },
    TEST_MS
  );

  test(
    "a folder, a note and a line are bookmarked; the line's bookmark brings it into sight and says when it is gone",
    async () => {
      const page = await opened(width, "/note");

      await made(page, lined, `Lines ${width.width}`, ["Keep this line", "Bookmark this line", "Last line"]);
      await page.evaluate(async (name) => {
        await fetch("/proxy/note/folders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: `marked-${name}`, name }) });
      }, `${width.width}`);
      await page.goto(`${stack!.host}/note/${lined}`);
      await page.locator("[data-note-editor] .ProseMirror").waitFor({ timeout: STANDING_MS });
      await page.addStyleTag({ content: STILL });

      // The note bookmarked from its bar, the key standing pressed.
      await press(width, page.locator("[data-note-bookmark]"));
      await page.locator("[data-note-bookmark][aria-pressed=true]").waitFor({ timeout: STANDING_MS });

      // The line under the caret bookmarked from the more menu.
      const line = page.locator("[data-note-editor] .ProseMirror p", { hasText: "Bookmark this line" });

      await press(width, line);
      await press(width, page.locator("[data-note-more]"));
      await press(width, page.getByRole("menuitem", { name: WORDS.action.bookmark_line }));

      // The folder bookmarked from its menu.
      const navigator = await navigatorShown(page, width);

      await fromMenu(width, folderRow(navigator, `marked-${width.width}`), [WORDS.action.bookmark]);

      // The three stand in the order they were made, after any the other width's run left.
      const marks = navigator.locator("[data-bookmarks] [data-bookmark]");

      await navigator.locator("[data-bookmarks] [data-bookmark=folder]").filter({ hasText: `${width.width}` }).waitFor({ timeout: STANDING_MS });

      const kinds = await marks.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-bookmark")));

      expect(kinds.slice(-3)).toEqual(["note", "line", "folder"]);
      expect(await marks.nth(kinds.length - 2).textContent()).toContain("Bookmark this line");
      await shot(page, width, "bookmarks");

      // The line's bookmark, from another note, opens its note with the line in sight and marked.
      await page.goto(`${stack!.host}/note/warm`);
      await page.locator("[data-note-editor] .ProseMirror").waitFor({ timeout: STANDING_MS });
      await page.addStyleTag({ content: STILL });

      let shown = await navigatorShown(page, width);

      await press(width, shown.locator("[data-bookmark=line] a").last());
      await page.waitForURL(new RegExp(`/note/${lined}`));

      const marked = page.locator("[data-note-editor] .note-line-shown");

      await marked.waitFor({ timeout: STANDING_MS });
      expect(await marked.textContent()).toBe("Bookmark this line");

      const box = (await marked.boundingBox())!;
      const view = (await page.locator("[data-note-editor]").boundingBox())!;

      expect(box.y).toBeGreaterThanOrEqual(view.y);
      expect(box.y + box.height).toBeLessThanOrEqual(view.y + view.height);

      // The line deleted: its bookmark says so in its row and on the pill.
      const target = page.locator("[data-note-editor] .ProseMirror p", { hasText: "Bookmark this line" });

      await press(width, target);
      await page.keyboard.press("End");
      await page.keyboard.press("Shift+Home");
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Backspace");

      try {
        await page.locator("[data-note-editor] .ProseMirror p", { hasText: "Bookmark this line" }).waitFor({ state: "detached", timeout: 30_000 });
      } catch (why) {
        const where = await page.evaluate(() => ({ active: document.activeElement?.outerHTML.slice(0, 200), editable: document.querySelector("[data-note-editor] .ProseMirror")?.getAttribute("contenteditable") }));

        await page.screenshot({ path: `${SHOTS}/folders-${width.width}-line-kept.png` });
        throw new Error(`${String(why)} ${JSON.stringify(where)}`);
      }

      // Once the note is saved, the service no longer finds the line's block in it.
      let stored = { anchored: [true], doc: "" };

      for (let tries = 0; tries < 60 && stored.anchored[0] !== false; tries += 1) {
        await page.waitForTimeout(1_000);
        stored = await page.evaluate(async (id) => {
          const marks = (await (await fetch("/proxy/note/bookmarks")).json()) as { items: { kind: string; anchored: boolean; note: { id: string } | null }[] };
          const note = (await (await fetch(`/proxy/note/notes/${id}`)).json()) as { doc: unknown };

          return { anchored: marks.items.filter((one) => one.kind === "line" && one.note?.id === id).map((one) => one.anchored), doc: JSON.stringify(note.doc) };
        }, lined);
      }

      expect(stored.anchored, stored.doc).toEqual([false]);

      shown = await navigatorShown(page, width);

      const gone = shown.locator("[data-bookmark=line]").last().locator(".line-through");

      await gone.waitFor({ timeout: STANDING_MS });
      await press(width, shown.locator("[data-bookmark=line] a").last());
      await page.getByText(WORDS.status.line_gone).first().waitFor({ timeout: STANDING_MS });
      await noSidewaysScroll(page);
      await shot(page, width, "line-gone");
      await page.context().close();
    },
    TEST_MS
  );

  test(
    "a member shown a note standing in the owner's folder finds it in their shared section and sees no folder of the owner's",
    async () => {
      const owner = await opened(width, "/note");
      const id = `kept-${width.width}`;
      const folder = `private-${width.width}`;

      await made(owner, id, `Shared ${width.width}`, ["Words"]);
      await owner.evaluate(
        async ({ id, folder }) => {
          const json = { "content-type": "application/json" };

          await fetch("/proxy/note/folders", { method: "POST", headers: json, body: JSON.stringify({ id: folder, name: folder }) });
          await fetch(`/proxy/note/notes/${id}/folder`, { method: "PUT", headers: json, body: JSON.stringify({ folder }) });
          await fetch(`/proxy/note/notes/${id}/members`, { method: "POST", headers: json, body: JSON.stringify({ users: ["2"], permission: "read" }) });
        },
        { id, folder }
      );
      await owner.context().close();

      const member = await opened(width, "/note", "2");
      const navigator = await navigatorShown(member, width);
      const shared = navigator.locator("section").filter({ has: member.getByRole("button", { name: WORDS.section.shared }) });

      await noteRow(shared, id).waitFor({ timeout: STANDING_MS });
      expect(await navigator.locator(`[data-folder="${folder}"]`).count()).toBe(0);
      expect(await navigator.getByText(folder, { exact: true }).count()).toBe(0);
      await shot(member, width, "member");
      await member.context().close();
    },
    TEST_MS
  );
});
