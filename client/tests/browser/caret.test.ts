import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";

import { chromium } from "playwright-core";

import { FIXTURE, seeded } from "./fixture";
import { stoodUp } from "./stack";

import type { Browser, Page } from "playwright-core";
import type { Stack } from "./stack";

// The caret stays in sight as words are written (docs/design.md, 「Editing and saving」): in a short window, a note
// written line after line by the keyboard's own Enter keeps the line being written inside the scroll a reader sees,
// with no scroll of the reader's own, on a desktop's width and on a phone's. What is read is where the browser draws
// the caret against the scroll's box. Skipped where the browser build is not on the machine.

const ready = existsSync(chromium.executablePath());

const STACK_MS = 900_000;
const TEST_MS = 600_000;
const STANDING_MS = 300_000;

const NOTE = FIXTURE.notes[0]!;
const BLOCKS = "affine-note > .affine-note-block-container > .affine-block-children-container > [data-block-id]";

let stack: Stack | null = null;
let browser: Browser;

beforeAll(async () => {
  if (!ready) return;

  stack = await stoodUp();
  browser = await chromium.launch();

  // The dev host builds the editor's sources the first time a note asks for them; two passes let that settle.
  for (let pass = 0; pass < 2; pass += 1) {
    const page = await opened({ width: 1280, height: 800 }, "/note");

    await page.locator("[data-navigator-list]").waitFor({ state: "attached", timeout: STANDING_MS });
    if (pass === 1) await seeded(page, [NOTE]);
    await page.context().close();
  }
}, STACK_MS);

afterAll(async () => {
  await browser?.close();
  await stack?.down();
}, STACK_MS);

async function opened(viewport: { width: number; height: number }, path: string, touch = false): Promise<Page> {
  const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });

  context.setDefaultTimeout(STANDING_MS);

  const page = await context.newPage();

  await page.goto(`${stack!.host}${path}`);

  return page;
}

// Where the caret stands against the note's scroll: the gap under its foot and over its head, in pixels; negative
// where it stands outside.
async function caretRoom(page: Page): Promise<{ below: number; above: number }> {
  return page.evaluate(() => {
    const scroll = document.querySelector("[data-note-editor]") as HTMLElement;
    const range = document.getSelection()!.getRangeAt(0);
    const drawn = [...range.getClientRects()].at(-1);
    const node = range.endContainer;
    const caret = drawn && drawn.height > 0 ? drawn : (node instanceof Element ? node : node.parentElement)!.getBoundingClientRect();
    const box = scroll.getBoundingClientRect();

    return { below: box.bottom - caret.bottom, above: caret.top - box.top };
  });
}

describe.skipIf(!ready)("a note written past the scroll's foot", () => {
  for (const [name, viewport, touch] of [
    ["a desktop's width", { width: 1280, height: 520 }, false],
    ["a phone's width", { width: 360, height: 640 }, true]
  ] as const) {
    test(
      `keeps the line being written in sight at ${name}, with no scroll of the reader's own`,
      async () => {
        const page = await opened(viewport, `/note/${NOTE.id}`, touch);
        const last = page.locator(BLOCKS).last();

        await last.waitFor({ timeout: STANDING_MS });
        await last.click();
        await page.keyboard.press("End");

        for (let line = 0; line < 40; line += 1) {
          await page.keyboard.press("Enter");
          await page.keyboard.type(`line ${line}`);
        }

        await page.waitForTimeout(300);

        const room = await caretRoom(page);

        expect(room.below).toBeGreaterThanOrEqual(0);
        expect(room.above).toBeGreaterThanOrEqual(0);
        await page.context().close();
      },
      TEST_MS
    );
  }
});
