import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

import ko from "../../i18n/ko.json";
import { docOf, FIXTURE, seeded } from "./fixture";
import { RECEIVER_LINE, stoodUp } from "./stack";

import type { Browser, Locator, Page } from "playwright-core";
import type { Stack } from "./stack";

// What a person does with the note editor (docs/design.md, 「The console surface」, 「Note links」, 「Comments」,
// 「Ask AI」), in Korean, at a desktop's width by a pointer and at a phone's by a finger, read from what the browser
// draws: a title and lines written past the scroll's foot with the caret kept in sight, saved and read back; a line
// turned into a heading from the bar and a word made bold, each key standing pressed; the selection toolbar
// standing whole inside the screen; a note link put in with `[[`, pressed to open the linked note, and the
// backlink listed there; a comment laid on words, answered, resolved and reopened, its tint following; and Ask AI
// over a line against the stand-in receiver, its result inserted below the line. A picture of each is kept.
// Skipped where the browser build is not on the machine.

const ready = existsSync(chromium.executablePath());

const STACK_MS = 900_000;
const TEST_MS = 600_000;
const STANDING_MS = 300_000;

const SHOTS = process.env.BMO_NOTE_SHOTS ?? "/tmp/note-renewal-shots";
const LOCALE_COOKIE = "bmo-dev-locale";
const STILL = "*, *::before, *::after { transition: none !important; animation-duration: 0s !important; }";

const WORDS = ko.note;

// The note every link is laid to: the fixture's budget note, found by a run of its title.
const TARGET = FIXTURE.notes[1]!;
const TARGET_TERM = FIXTURE.words.search;

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

  // The dev host builds the screen's sources and finds the packages they import the first time a note asks for
  // them, reloading the page as it does; two passes over an open note let that settle before the notes are made.
  for (let pass = 0; pass < 2; pass += 1) {
    const page = await opened(WIDTHS[0], "/note");

    await page.locator("[data-navigator-list]").waitFor({ state: "attached", timeout: STANDING_MS });
    if (pass === 1) await seeded(page, [TARGET]);
    await page.context().close();
  }

  const warm = await opened(WIDTHS[0], `/note/${TARGET.id}`);

  await warm.locator("[data-note-editor] .ProseMirror").waitFor({ timeout: STANDING_MS });
  await warm.waitForTimeout(3_000);
  await warm.context().close();
}, STACK_MS);

afterAll(async () => {
  await browser?.close();
  await stack?.down();
}, STACK_MS);

async function opened(width: Width, path: string): Promise<Page> {
  const host = stack!.host;
  const context = await browser.newContext({ viewport: { width: width.width, height: width.height }, hasTouch: width.touch, isMobile: width.touch });

  context.setDefaultTimeout(STANDING_MS);
  await context.addCookies([{ name: LOCALE_COOKIE, value: "ko", url: host }]);

  const page = await context.newPage();

  await page.goto(`${host}${path}`);
  await page.addStyleTag({ content: STILL });

  return page;
}

/** A fresh note of the reader's own holding `lines`, made through the relay, and the page standing on it. */
async function noteOpened(width: Width, id: string, title: string, lines: string[]): Promise<Page> {
  const page = await opened(width, "/note");

  await page.locator("[data-note-bar]").first().waitFor({ timeout: STANDING_MS });
  await page.evaluate(
    async ({ id, doc }) => {
      await fetch("/proxy/note/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, doc }) });
    },
    { id, doc: docOf(title, lines) }
  );
  await page.goto(`${stack!.host}/note/${id}`);
  await document(page).waitFor({ timeout: STANDING_MS });
  await page.addStyleTag({ content: STILL });

  return page;
}

function document(page: Page): Locator {
  return page.locator("[data-note-editor] .ProseMirror");
}

/** Presses as the width's hand does: a finger's tap, a pointer's click. */
async function press(width: Width, target: Locator): Promise<void> {
  if (width.touch) await target.tap();
  else await target.click();
}

/** Puts the caret at the end of a line by the width's hand. */
async function caretAtEnd(width: Width, line: Locator): Promise<void> {
  await press(width, line);
  await line.page().keyboard.press("End");
}

/** Chooses a line's words: the caret at its end, then the line taken by the keyboard. */
async function chooseLine(width: Width, line: Locator): Promise<void> {
  await caretAtEnd(width, line);
  await line.page().keyboard.press("Shift+Home");
}

/** Waits until the bar says the note is saved. */
async function saved(page: Page): Promise<void> {
  await page.locator("[data-note-state]").getByText(WORDS.label.saved, { exact: true }).waitFor({ timeout: STANDING_MS });
}

/** Whether a box stands whole inside the window. */
async function insideWindow(page: Page, target: Locator): Promise<boolean> {
  const box = (await target.boundingBox())!;
  const view = page.viewportSize()!;

  return box.x >= -0.5 && box.y >= -0.5 && box.x + box.width <= view.width + 0.5 && box.y + box.height <= view.height + 0.5;
}

async function shot(page: Page, width: Width, state: string): Promise<void> {
  await page.evaluate(() => globalThis.document.fonts.ready);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/editor-${width.width}-${state}.png` });
}

describe.skipIf(!ready).each(WIDTHS)("the note editor at $name", (width) => {
  test(
    "a title and lines written past the scroll's foot keep the caret in sight, and the note reads back as written",
    async () => {
      const id = `write-${width.width}`;
      const page = await noteOpened(width, id, "", [""]);
      const title = page.locator("h1[data-note-title]");

      await press(width, title);
      await page.keyboard.type("Weekly plan");
      await page.keyboard.press("Enter");

      const scroll = page.locator("[data-note-editor]");

      for (let line = 1; line <= 40; line += 1) {
        await page.keyboard.type(`Line ${line} of the plan`);

        // Every tenth line, the caret at the end of the words just written stands inside the note's scroll.
        if (line % 10 === 0) {
          const caret = await page.evaluate(() => {
            const range = globalThis.getSelection()?.getRangeAt(0);
            const box = range?.getBoundingClientRect();

            return box === undefined ? null : { top: box.top, bottom: box.bottom };
          });
          const view = (await scroll.boundingBox())!;

          expect(caret).not.toBeNull();
          expect(caret!.bottom).toBeLessThanOrEqual(view.y + view.height + 0.5);
          expect(caret!.top).toBeGreaterThanOrEqual(view.y - 0.5);
        }

        await page.keyboard.press("Enter");
      }

      await saved(page);
      await shot(page, width, "written");
      await page.reload();
      await document(page).waitFor({ timeout: STANDING_MS });
      expect(await title.textContent()).toBe("Weekly plan");
      expect(await document(page).getByText("Line 40 of the plan", { exact: true }).count()).toBe(1);
      await page.context().close();
    },
    TEST_MS
  );

  test(
    "the bar turns a line into a heading and makes a word bold, each key standing pressed, and the selection toolbar stands inside the screen",
    async () => {
      const page = await noteOpened(width, `format-${width.width}`, "Format", ["Heading words", "bold words here"]);
      const lines = document(page).locator("p");
      const bar = page.getByRole("toolbar", { name: WORDS.label.toolbar });

      await caretAtEnd(width, lines.first());
      await press(width, bar.locator("[data-bar=kind]"));
      await press(width, page.getByRole("option", { name: WORDS.kind.h2, exact: true }));
      await document(page).locator("h2", { hasText: "Heading words" }).waitFor({ timeout: STANDING_MS });

      const boldLine = document(page).locator("p", { hasText: "bold words here" });

      await chooseLine(width, boldLine);

      const selectionBar = page.locator("[data-selection-bar]");

      await selectionBar.waitFor({ timeout: STANDING_MS });
      expect(await insideWindow(page, selectionBar)).toBe(true);
      await shot(page, width, "selection-bar");

      await press(width, bar.locator("[data-bar=bold]"));
      await document(page).locator("strong", { hasText: "bold words here" }).waitFor({ timeout: STANDING_MS });
      expect(await bar.locator("[data-bar=bold]").getAttribute("aria-pressed")).toBe("true");
      await saved(page);
      await page.context().close();
    },
    TEST_MS
  );

  test(
    "a note link put in with [[ opens the linked note, which lists the note linking to it",
    async () => {
      const source = `links-${width.width}`;
      const page = await noteOpened(width, source, `Links ${width.width}`, ["See "]);

      await caretAtEnd(width, document(page).locator("p").first());
      await page.keyboard.type(`[[${TARGET_TERM}`);

      const option = page.getByRole("option", { name: new RegExp(TARGET.title) });

      await option.waitFor({ timeout: STANDING_MS });
      expect(await insideWindow(page, page.getByRole("listbox"))).toBe(true);
      await shot(page, width, "link-menu");
      await page.keyboard.press("Enter");

      const link = document(page).locator("a[data-note-link]");

      await link.waitFor({ timeout: STANDING_MS });
      expect(await link.textContent()).toContain(TARGET.title);
      await saved(page);

      await press(width, link);
      await page.waitForURL(new RegExp(`/note/${TARGET.id}$`), { timeout: STANDING_MS });

      const backlink = page.locator("[data-backlink]", { hasText: `Links ${width.width}` });

      await backlink.waitFor({ timeout: STANDING_MS });
      await shot(page, width, "backlinks");
      await press(width, backlink);
      await page.waitForURL(new RegExp(`/note/${source}$`), { timeout: STANDING_MS });
      await page.context().close();
    },
    TEST_MS
  );

  test(
    "a comment laid on words is answered, resolved and reopened, its words' tint following",
    async () => {
      const page = await noteOpened(width, `comments-${width.width}`, "Comments", ["The words to talk about", "Another line"]);
      const line = document(page).locator("p", { hasText: "The words to talk about" });

      await chooseLine(width, line);
      await press(width, page.locator("[data-selection=comment]"));

      const draft = page.locator("[data-comment-draft] textarea");

      await draft.waitFor({ timeout: STANDING_MS });
      await draft.fill("Is this the right word?");
      // On a phone Enter breaks the line, so the comment goes by its key at every width.
      await press(width, page.locator("[data-comment-draft] button[type=submit]"));

      const card = page.locator("[data-thread-card]").first();

      await card.waitFor({ timeout: STANDING_MS });
      await document(page).locator(".note-comment-open").first().waitFor({ timeout: STANDING_MS });
      expect(await page.locator("[data-comments-key]").textContent()).toContain("1");

      const reply = card.locator("textarea");

      await reply.fill("It is.");
      await press(width, card.locator("button[type=submit]"));
      await card.locator("[data-comment]").nth(1).waitFor({ timeout: STANDING_MS });
      await shot(page, width, "comment-thread");

      await press(width, card.locator("[data-thread-resolve]"));
      await page.locator("[data-resolved-fold]").waitFor({ timeout: STANDING_MS });
      expect(await document(page).locator(".note-comment-open").count()).toBe(0);

      await press(width, page.locator("[data-resolved-fold]"));
      await press(width, page.locator("[data-thread-reopen]"));
      await document(page).locator(".note-comment-open").first().waitFor({ timeout: STANDING_MS });
      await saved(page);

      // The mark stands in the stored document, so the thread reads as anchored.
      await page.reload();
      await document(page).locator(".note-comment-open").first().waitFor({ timeout: STANDING_MS });
      await page.context().close();
    },
    TEST_MS
  );

  test(
    "Ask AI over a line shows the stand-in receiver's answer under it and inserts it below",
    async () => {
      const page = await noteOpened(width, `ask-${width.width}`, "Ask", ["A line for the supervisor", "The line after"]);
      const line = document(page).locator("p", { hasText: "A line for the supervisor" });

      await chooseLine(width, line);
      await press(width, page.locator("[data-selection=ask]"));

      const field = page.getByPlaceholder(WORDS.ask.placeholder);

      await field.waitFor({ timeout: STANDING_MS });
      await field.fill("Say it again");
      await page.keyboard.press("Enter");
      await page.getByText(RECEIVER_LINE, { exact: true }).first().waitFor({ timeout: STANDING_MS });
      await shot(page, width, "ask-result");

      const asked = stack!.asked.at(-1)!;

      expect([asked.kind, asked.fields.passage, asked.said]).toEqual(["note-passage", "A line for the supervisor", "Say it again"]);

      await press(width, page.getByRole("button", { name: WORDS.ask.below, exact: true }));

      const texts = await document(page).locator("p").allTextContents();

      expect(texts.indexOf(RECEIVER_LINE)).toBe(texts.indexOf("A line for the supervisor") + 1);
      await saved(page);
      await page.context().close();
    },
    TEST_MS
  );
});
