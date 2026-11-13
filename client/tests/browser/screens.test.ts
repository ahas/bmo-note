import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";

import { chromium } from "playwright-core";

import en from "../../i18n/en.json";
import { stoodUp } from "./stack";

import type { Browser, Locator, Page } from "playwright-core";
import type { Stack } from "./stack";

// The note screens' rows, drawn by a real browser at a desktop's width and a phone's, in both schemes
// (docs/design.md, 「The console surface」): the list names itself with nothing beside the name; on a desktop its
// own row under it holds the view switch and the layer's create button at its trailing end, a grey icon naming
// a new note and its key, and on a phone the row holds the view switch alone while the create button floats at
// the bottom right with the list's last row clear of it; the open note's format bar
// holds the way back at its leading end and the talk key at its trailing end, and on a phone both stay in
// sight while the keys between them scroll. Every key in either row stands centred with room above and below
// it, its hover filling its own shape and never its cell or the row; every key in the format bar is the
// library's small button, an icon-only one its small square. The screens are the dev host's, relaying to a
// throwaway note service. Skipped where the browser build is not on the machine.

const ready = existsSync(chromium.executablePath());

// How long the stack is given to build and stand, and a test to run; the first page the dev host serves
// builds the editor's sources, so the first screen is given the longest to stand.
const STACK_MS = 900_000;
const TEST_MS = 600_000;
const STANDING_MS = 300_000;

// An open note's address, and how many presses of the create button a reloading dev host may lose.
const NOTE_PATH = /\/note\/[^/]+$/;
const MOST_PRESSES = 3;

// Transitions are taken out, so a colour read is the one the state settles on.
const STILL = "*, *::before, *::after { transition: none !important; }";

// The cookie the console's screen mode is kept in (bmo-ui's shared screen mode).
const SCHEME_COOKIE = "nuxt-color-mode";

// The library's small button: an icon-only one is a 28-pixel square, one carrying a word stands on the
// caption line and is 32 pixels tall.
const SMALL_PX = 28;
const SMALL_WORDED_PX = 32;
// The least room a key keeps above and below it inside its row.
const ROOM_PX = 2;

// The create button floating on a phone: the library's largest icon button, its gap from the screen's right
// and bottom edges, and the key that presses it.
const FLOATING_PX = 40;
const FLOATING_GAP_PX = 16;
const CREATE_KEY = "n";

// Notes of the test's own, enough to make the list scroll on a phone, written straight through the relay with
// a document of one byte the service holds as opaque; the ids keep a second write of them a no-op.
const FILLERS = 16;
const FILLER_DOC = "AA==";

const WORDS = en.note;

const WIDTHS = [
  { name: "a desktop's width", width: 1280, height: 800, narrow: false },
  { name: "a phone's width", width: 360, height: 780, narrow: true }
];
const SCHEMES = ["light", "dark"] as const;

type Width = (typeof WIDTHS)[number];
type Scheme = (typeof SCHEMES)[number];

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

// One key of a row: its name, where it stands, the row it stands in, whether it says a word and whether it is
// a mark alone.
interface Measured {
  name: string;
  box: Box;
  row: Box;
  worded: boolean;
  iconOnly: boolean;
}

// What a key, its cell and its row paint, and the key's middle.
interface Painted {
  own: string;
  cell: string;
  row: string;
  x: number;
  y: number;
}

let stack: Stack | null = null;
let browser: Browser;

beforeAll(async () => {
  if (!ready) return;

  stack = await stoodUp();
  browser = await chromium.launch();
  await settled();
}, STACK_MS);

afterAll(async () => {
  await browser?.close();
  await stack?.down();
}, STACK_MS);

// A page at a width, in a scheme, on one of the dev host's screens.
async function opened(width: Width, scheme: Scheme, path: string): Promise<Page> {
  const host = stack!.host;
  const context = await browser.newContext({ viewport: { width: width.width, height: width.height }, colorScheme: scheme });

  await context.addCookies([{ name: SCHEME_COOKIE, value: scheme, url: host }]);

  const page = await context.newPage();

  await page.goto(`${host}${path}`);
  await page.addStyleTag({ content: STILL });

  return page;
}

// The list, standing once its create button does.
async function listOpened(width: Width, scheme: Scheme): Promise<Page> {
  const page = await opened(width, scheme, "/note");

  await newNoteKey(page).waitFor({ timeout: STANDING_MS });

  return page;
}

// The create button: in the list's row on a desktop, floating over the screen on a phone.
function newNoteKey(page: Page): Locator {
  return page.getByRole("button", { name: WORDS.action.new, exact: true });
}

function formatBar(page: Page): Locator {
  return page.getByRole("toolbar", { name: WORDS.label.toolbar });
}

// Presses the list's create button until the note it makes opens. While the dev host is still finding the
// packages the screens import it reloads the page, and a press it reloads under is lost with the page; the
// list then stands again and the key is pressed again, a few times at most.
async function noteMade(page: Page): Promise<void> {
  for (let press = 1; press <= MOST_PRESSES; press += 1) {
    const opened = page.waitForURL(NOTE_PATH, { timeout: STANDING_MS }).then(() => "opened" as const);
    const reloaded = page.waitForEvent("load", { timeout: STANDING_MS }).then(() => "reloaded" as const);

    await newNoteKey(page).click();

    if ((await Promise.race([opened, reloaded])) === "opened") return;

    await newNoteKey(page).waitFor({ timeout: STANDING_MS });
  }

  throw new Error(`the list reloaded under each of ${MOST_PRESSES} presses of its create button`);
}

// A note of the test's own, made through the list's create button and opened, with the caret in its document
// so the keys that change it stand enabled.
async function noteOpened(width: Width, scheme: Scheme): Promise<Page> {
  const page = await listOpened(width, scheme);

  await noteMade(page);
  await page.locator("[data-bar=ask]:not([disabled])").waitFor({ timeout: STANDING_MS });
  await page.locator("[data-note-editor] [contenteditable=true]").last().click();
  await page.locator("[data-bar=bold]:not([disabled])").waitFor({ timeout: STANDING_MS });

  return page;
}

// A note that is not there, standing once the screen says so: the bar it reads under, which holds the way
// back too, has given way to the missing note's own row.
async function missingOpened(width: Width, scheme: Scheme): Promise<Page> {
  const page = await opened(width, scheme, "/note/no-such-note");

  await page.getByText(WORDS.status.missing).waitFor({ timeout: STANDING_MS });

  return page;
}

// The dev host builds the screens' sources and finds the packages they import the first time a screen asks
// for them, reloading the page as it does, which would swallow a key pressed meanwhile. One pass over both
// screens, each waited for until it stands however often the page reloads, lets that happen before anything
// is measured.
async function settled(): Promise<void> {
  const once = WIDTHS[0]!;

  await (await missingOpened(once, "light")).context().close();
  await (await noteOpened(once, "light")).context().close();
}

// Every key showing in a row, each against that row.
async function keys(row: Locator): Promise<Measured[]> {
  return row.evaluate((element) => {
    const boxOf = (one: Element): Box => {
      const { top, bottom, left, right, width, height } = one.getBoundingClientRect();

      return { top, bottom, left, right, width, height };
    };

    return [...element.querySelectorAll("button")]
      .filter((button) => button.getBoundingClientRect().width > 0)
      .map((button) => ({
        name: button.getAttribute("aria-label") ?? (button.textContent ?? "").trim(),
        box: boxOf(button),
        row: boxOf(element),
        worded: (button.textContent ?? "").trim() !== "",
        iconOnly: (button.textContent ?? "").trim() === "" && button.querySelectorAll("[data-slot$=Icon], .iconify").length === 1
      }));
  });
}

// What a key, its cell and its row paint, read off the page, the key brought to the middle of a row that
// scrolls so neither of the row's held ends stands over it.
async function painted(row: Locator, key: Locator): Promise<Painted> {
  const rowElement = await row.elementHandle();

  return key.evaluate((button, rowOf) => {
    button.scrollIntoView({ block: "nearest", inline: "center" });

    const { left, top, width, height } = button.getBoundingClientRect();

    return {
      own: getComputedStyle(button).backgroundColor,
      cell: getComputedStyle(button.parentElement!).backgroundColor,
      row: getComputedStyle(rowOf as Element).backgroundColor,
      x: left + width / 2,
      y: top + height / 2
    };
  }, rowElement);
}

// A pointer on the key paints the key's own shape and leaves its cell and its row as they stood.
async function hoverStaysOnKey(page: Page, row: Locator, key: Locator, name: string, paints: boolean): Promise<void> {
  const rest = await painted(row, key);

  await page.mouse.move(rest.x, rest.y);

  const hovered = await painted(row, key);

  await page.mouse.move(0, 0);

  if (paints) expect([name, hovered.own !== rest.own]).toEqual([name, true]);
  expect([name, hovered.cell, hovered.row]).toEqual([name, rest.cell, rest.row]);
}

// Each key stands inside its row with room above and below it, centred.
function centred(measured: Measured[]): void {
  for (const one of measured) {
    const above = one.box.top - one.row.top;
    const below = one.row.bottom - one.box.bottom;

    expect([one.name, above >= ROOM_PX, below >= ROOM_PX]).toEqual([one.name, true, true]);
    expect([one.name, Math.abs(above - below) <= 1]).toEqual([one.name, true]);
  }
}

// Each key is the library's small button: a word on the caption line, a mark alone its small square.
function small(measured: Measured[]): void {
  for (const one of measured) {
    expect([one.name, one.box.height]).toEqual([one.name, one.worded ? SMALL_WORDED_PX : SMALL_PX]);
    if (one.iconOnly) expect([one.name, one.box.width]).toEqual([one.name, SMALL_PX]);
  }
}

// Whether the way back and the talk key both stand whole inside the bar's own box.
async function endsInSight(bar: Locator): Promise<{ back: boolean; talk: boolean }> {
  return bar.evaluate((element, talkName) => {
    const view = element.getBoundingClientRect();
    const whole = (one: Element | undefined): boolean => {
      if (one === undefined) return false;

      const { left, right } = one.getBoundingClientRect();

      return left >= view.left - 0.5 && right <= view.right + 0.5;
    };
    const buttons = [...element.querySelectorAll("button")];

    return {
      back: whole(element.querySelector("[data-bar=back]") ?? undefined),
      talk: whole(buttons.find((one) => (one.textContent ?? "").trim() === talkName))
    };
  }, WORDS.action.talk);
}

describe.skipIf(!ready).each(WIDTHS.flatMap((width) => SCHEMES.map((scheme) => ({ width, scheme }))))(
  "the note screens at $width.name, $scheme",
  ({ width, scheme }) => {
    test.skipIf(width.narrow)(
      "the list names itself alone, and its own row ends with the create button, a grey icon naming a new note and its key",
      async () => {
        const page = await listOpened(width, scheme);

        // The scheme asked for is the one drawn.
        expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(scheme === "dark");

        const title = page.getByRole("heading", { name: WORDS.title, exact: true });

        expect(await title.locator("button, a").count()).toBe(0);

        const newNote = newNoteKey(page);
        const row = page.locator("[data-list-row]");
        const measured = await keys(row);
        const end = measured.find((one) => one.name === WORDS.action.new)!;

        expect(measured.map((one) => one.name)).toEqual([WORDS.view.live, WORDS.view.shared, WORDS.view.trash, WORDS.action.new]);
        expect(Math.abs(end.row.right - end.box.right)).toBeLessThanOrEqual(1);
        expect([end.iconOnly, end.box.width]).toEqual([true, end.box.height]);
        centred(measured);

        // A grey icon: it paints nothing at rest, and its hover paints its own shape.
        expect(await newNote.evaluate((button) => getComputedStyle(button).backgroundColor)).toBe("rgba(0, 0, 0, 0)");

        for (const name of [WORDS.view.live, WORDS.view.shared, WORDS.view.trash]) {
          await hoverStaysOnKey(page, row, row.getByRole("tab", { name }), name, false);
        }

        await hoverStaysOnKey(page, row, newNote, WORDS.action.new, true);

        // Its tooltip names what it creates, then the key that presses it.
        await newNote.hover();

        const tip = page.locator("[data-slot=content]").filter({ hasText: WORDS.action.new });

        await tip.locator("[data-slot=kbds]").waitFor({ timeout: STANDING_MS });
        expect(((await tip.locator("[data-slot=kbds]").textContent()) ?? "").trim().toLowerCase()).toBe(CREATE_KEY);
        await page.mouse.move(0, 0);

        // The key makes a note, as a press does.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press(CREATE_KEY);
        await page.waitForURL(NOTE_PATH, { timeout: STANDING_MS });
        await page.context().close();
      },
      TEST_MS
    );

    test.skipIf(!width.narrow)(
      "the list's row holds the view switch alone, the create button floats at the bottom right, and the list's end stands clear of it",
      async () => {
        const page = await listOpened(width, scheme);

        expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(scheme === "dark");

        for (let filler = 0; filler < FILLERS; filler += 1) {
          const answer = await page.request.post(`${stack!.host}/proxy/note/notes`, {
            data: { id: `filler-${filler}`, title: `Filler ${filler}`, doc: FILLER_DOC }
          });

          expect(answer.ok()).toBe(true);
        }

        await page.reload();
        await page.addStyleTag({ content: STILL });
        await page.locator("li[data-note]").nth(FILLERS - 1).waitFor({ timeout: STANDING_MS });

        const row = page.locator("[data-list-row]");

        expect((await keys(row)).map((one) => one.name)).toEqual([WORDS.view.live, WORDS.view.shared, WORDS.view.trash]);

        // One button, outside the row, floating at the screen's foot: the library's largest icon button,
        // filled, its gap the same from the right and the bottom edge.
        const newNote = newNoteKey(page);

        expect(await newNote.count()).toBe(1);
        expect(await newNote.evaluate((button) => [button.closest("header") === null, button.closest("[data-screen-foot]") !== null])).toEqual([true, true]);

        const button = (await newNote.boundingBox())!;

        expect([button.width, button.height]).toEqual([FLOATING_PX, FLOATING_PX]);
        expect(Math.abs(width.width - FLOATING_GAP_PX - (button.x + button.width))).toBeLessThanOrEqual(1);
        expect(Math.abs(width.height - FLOATING_GAP_PX - (button.y + button.height))).toBeLessThanOrEqual(1);
        expect(await newNote.evaluate((one) => getComputedStyle(one).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");

        // The list scrolls, and scrolled to its end, what it ends with stands above the button.
        const list = await page.locator("li[data-note]").first().evaluate((one) => {
          const box = one.closest("main")!;

          box.scrollTop = box.scrollHeight;

          return { scrolls: box.scrollHeight > box.clientHeight, end: box.firstElementChild!.lastElementChild!.getBoundingClientRect().bottom };
        });

        expect(list.scrolls).toBe(true);
        expect(list.end).toBeLessThanOrEqual(button.y);
        await page.context().close();
      },
      TEST_MS
    );

    test(
      "every key of the format bar is the small button, centred, its hover on its own shape",
      async () => {
        const page = await noteOpened(width, scheme);
        const bar = formatBar(page);
        const measured = await keys(bar);

        // The bar was found whole: the way back first, the talk key last, the format keys between them.
        expect(measured[0]?.name).toBe(WORDS.action.back);
        expect(measured.at(-1)?.name).toBe(WORDS.action.talk);
        expect(measured.some((one) => one.name === WORDS.mark.bold)).toBe(true);
        expect(measured.some((one) => one.name === WORDS.ask.key)).toBe(true);

        small(measured);
        centred(measured);

        for (const name of [WORDS.action.back, WORDS.ask.key, WORDS.action.turn_into, WORDS.mark.bold, WORDS.action.image, WORDS.action.table]) {
          await hoverStaysOnKey(page, bar, bar.getByRole("button", { name, exact: true }), name, true);
        }

        await hoverStaysOnKey(page, bar, bar.getByRole("button", { name: WORDS.action.talk, exact: true }), WORDS.action.talk, true);
        await page.context().close();
      },
      TEST_MS
    );

    test(
      "the way back and the talk key stay in sight at the bar's two ends while the keys scroll",
      async () => {
        const page = await noteOpened(width, scheme);
        const bar = formatBar(page);
        const room = await bar.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));

        // A phone's bar is wider than the screen and scrolls; a desktop's fits.
        expect(room.scroll > room.client).toBe(width.narrow);
        expect(await endsInSight(bar)).toEqual({ back: true, talk: true });

        const scrolled = await bar.evaluate((element) => {
          element.scrollLeft = element.scrollWidth;

          return element.scrollLeft;
        });

        expect(scrolled > 0).toBe(width.narrow);
        expect(await endsInSight(bar)).toEqual({ back: true, talk: true });
        await page.context().close();
      },
      TEST_MS
    );

    test(
      "a note that is missing keeps the row with the way back alone, the small square",
      async () => {
        const page = await missingOpened(width, scheme);
        const bar = formatBar(page);
        const measured = await keys(bar);

        expect(measured.map((one) => one.name)).toEqual([WORDS.action.back]);
        small(measured);
        centred(measured);
        await page.context().close();
      },
      TEST_MS
    );
  }
);
