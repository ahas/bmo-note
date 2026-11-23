import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

import ko from "../../i18n/ko.json";
import { FIXTURE, seeded } from "./fixture";
import { stoodUp } from "./stack";

import type { Browser, Locator, Page } from "playwright-core";
import type { Stack } from "./stack";

// The notes screen drawn by a real browser at a desktop's width and a phone's, in both schemes
// (docs/design.md, 「The console surface」, 「Search」): the navigator with every section and the trash at its
// foot, a note open under its bar, the empty note region, the search dialog before typing, with results and
// with none, the more menu, a note in the trash under its band, and the phone's drawer. Each state is kept as
// a picture for a person to read. The keys of the format bar are the library's small button, centred, their
// hover on their own shape; the talk key stays in sight while the keys scroll on a phone; no state scrolls
// the page sideways on a phone. The screen is the dev host's, relaying to a throwaway note service, its notes
// written through the relay. Skipped where the browser build is not on the machine.

const ready = existsSync(chromium.executablePath());

// How long the stack is given to build and stand, and a test to run; the first page the dev host serves
// builds the editor's sources, so the first screen is given the longest to stand.
const STACK_MS = 900_000;
const TEST_MS = 600_000;
const STANDING_MS = 300_000;

// Where the pictures of each state are kept, named `<width>-<scheme>-<state>.png`.
const SHOTS = process.env.BMO_NOTE_SHOTS ?? "/tmp/note-renewal-shots";

// An open note's address.
const NOTE_PATH = /\/note\/[^/?]+/;

// Transitions are taken out, so a colour read is the one the state settles on and a picture its final frame.
const STILL = "*, *::before, *::after { transition: none !important; animation-duration: 0s !important; }";

// The cookies the dev host reads: the console's screen mode, the language and the reader.
const SCHEME_COOKIE = "nuxt-color-mode";
const LOCALE_COOKIE = "bmo-dev-locale";
const READER_COOKIE = "bmo-dev-reader";

// The library's small button: an icon-only one is a 28-pixel square, one carrying a word stands on the
// caption line and is 32 pixels tall.
const SMALL_PX = 28;
const SMALL_WORDED_PX = 32;
// The least room a key keeps above and below it inside its row.
const ROOM_PX = 2;

// The screens are read in Korean, as the dev host's language cookie asks.
const WORDS = ko.note;

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

interface Measured {
  name: string;
  box: Box;
  row: Box;
  worded: boolean;
  iconOnly: boolean;
}

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

  mkdirSync(SHOTS, { recursive: true });
  stack = await stoodUp();
  browser = await chromium.launch();
  await settledAndSeeded();
}, STACK_MS);

afterAll(async () => {
  await browser?.close();
  await stack?.down();
}, STACK_MS);

// A page at a width, in a scheme, in Korean, on the screen at `path`, standing once its bar does.
async function opened(width: Width, scheme: Scheme, path: string): Promise<Page> {
  const host = stack!.host;
  const context = await browser.newContext({ viewport: { width: width.width, height: width.height }, colorScheme: scheme, isMobile: width.narrow, hasTouch: width.narrow });
  // A loaded machine, a deployment's gate among them, may take longer than the driver's own default over any
  // step, so every step is given the time a page is given to stand.
  context.setDefaultTimeout(STANDING_MS);

  await context.addCookies([
    { name: SCHEME_COOKIE, value: scheme, url: host },
    { name: LOCALE_COOKIE, value: "ko", url: host }
  ]);

  const page = await context.newPage();

  await page.goto(`${host}${path}`);
  await page.locator("[data-note-bar]").first().waitFor({ timeout: STANDING_MS });
  await page.addStyleTag({ content: STILL });

  return page;
}

// The picture of a state, once what it draws has come to rest.
async function shot(page: Page, width: Width, scheme: Scheme, state: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1_000);
  await page.screenshot({ path: `${SHOTS}/${width.width}-${scheme}-${state}.png` });
}

// The page never scrolls sideways.
async function noSidewaysScroll(page: Page): Promise<void> {
  const room = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));

  expect(room.scroll).toBeLessThanOrEqual(room.client);
}

// The dev host builds the screen's sources and finds the packages they import the first time a screen asks
// for them, reloading the page as it does. One pass over the screen and an open note lets that happen; then
// the fixture's notes are written: the reader's own, one another account shares with them, one in their
// trash, one in a folder of theirs, two bookmarked, and one opened so the search has something it was opened
// before typing.
async function settledAndSeeded(): Promise<void> {
  const once = WIDTHS[0]!;
  const host = stack!.host;

  for (let pass = 0; pass < 2; pass += 1) {
    const page = await opened(once, "light", "/note");

    await page.locator("[data-navigator-list]").waitFor({ timeout: STANDING_MS });
    await page.waitForTimeout(3_000);
    await page.context().close();
  }

  const page = await opened(once, "light", "/note");
  const context = page.context();

  await page.locator("[data-navigator-list]").waitFor({ timeout: STANDING_MS });
  await seeded(page, FIXTURE.notes);
  await seeded(page, [FIXTURE.trashed]);
  await context.addCookies([{ name: READER_COOKIE, value: "2", url: host }]);
  await seeded(page, [FIXTURE.sharedByOther]);
  await page.evaluate(async (id) => {
    await fetch(`/proxy/note/notes/${id}/members`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ users: ["1"], permission: "edit" }) });
  }, FIXTURE.sharedByOther.id);
  await context.clearCookies({ name: READER_COOKIE });
  await page.evaluate(
    async ({ trashed, marks, read, folder, filed }) => {
      const json = { "content-type": "application/json" };

      await fetch(`/proxy/note/notes/${trashed}`, { method: "DELETE" });

      for (const mark of marks) await fetch("/proxy/note/bookmarks", { method: "POST", headers: json, body: JSON.stringify({ kind: "note", noteId: mark }) });

      for (const one of read) await fetch(`/proxy/note/notes/${one}?opened=true`);

      await fetch("/proxy/note/folders", { method: "POST", headers: json, body: JSON.stringify({ id: "screens-folder", name: folder }) });
      await fetch(`/proxy/note/notes/${filed}/folder`, { method: "PUT", headers: json, body: JSON.stringify({ folder: "screens-folder" }) });
    },
    {
      trashed: FIXTURE.trashed.id,
      marks: [FIXTURE.notes[2]!.id, FIXTURE.notes[0]!.id],
      read: [FIXTURE.notes[1]!.id, FIXTURE.notes[0]!.id],
      folder: FIXTURE.words.folder,
      filed: FIXTURE.notes[3]!.id
    }
  );
  await context.close();

  // The screen's states once each, so the icons and the chunks they ask for stand before any picture.
  for (const path of [`/note/${FIXTURE.notes[0]!.id}`, "/note?search=", `/note/${FIXTURE.trashed.id}?trash=1`]) {
    const warm = await opened(once, "light", path);

    await warm.waitForTimeout(3_000);
    await warm.context().close();
  }
}

function formatBar(page: Page): Locator {
  return page.getByRole("toolbar", { name: WORDS.label.toolbar });
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
async function hoverStaysOnKey(page: Page, row: Locator, key: Locator, name: string): Promise<void> {
  const rest = await painted(row, key);

  await page.mouse.move(rest.x, rest.y);

  const hovered = await painted(row, key);

  await page.mouse.move(0, 0);

  expect([name, hovered.own !== rest.own]).toEqual([name, true]);
  expect([name, hovered.cell, hovered.row]).toEqual([name, rest.cell, rest.row]);
}

function centred(measured: Measured[]): void {
  for (const one of measured) {
    const above = one.box.top - one.row.top;
    const below = one.row.bottom - one.box.bottom;

    expect([one.name, above >= ROOM_PX, below >= ROOM_PX]).toEqual([one.name, true, true]);
    expect([one.name, Math.abs(above - below) <= 1]).toEqual([one.name, true]);
  }
}

function small(measured: Measured[]): void {
  for (const one of measured) {
    expect([one.name, one.box.height]).toEqual([one.name, one.worded ? SMALL_WORDED_PX : SMALL_PX]);
    if (one.iconOnly) expect([one.name, one.box.width]).toEqual([one.name, SMALL_PX]);
  }
}

// A note of the fixture open, its document drawn.
async function noteOpened(width: Width, scheme: Scheme, path = `/note/${FIXTURE.notes[0]!.id}`): Promise<Page> {
  const page = await opened(width, scheme, path);

  await page.locator("[data-note-head]").waitFor({ timeout: STANDING_MS });
  await page.locator("[data-note-editor] [contenteditable]").first().waitFor({ timeout: STANDING_MS });

  return page;
}

// The navigator, standing in its drawer on a phone.
async function navigatorShown(page: Page, width: Width): Promise<Locator> {
  if (width.narrow) await page.locator("[data-navigator-key]").first().click();

  const navigator = page.locator("[data-navigator]:visible");

  await navigator.locator("[data-navigator-list] li").first().waitFor({ timeout: STANDING_MS });

  return navigator;
}

describe.skipIf(!ready).each(WIDTHS.flatMap((width) => SCHEMES.map((scheme) => ({ width, scheme }))))("the notes screen at $width.name, $scheme", ({ width, scheme }) => {
  test(
    "the navigator holds the bookmarks, the reader's own notes with their folders first, the shared ones, and the trash at its foot",
    async () => {
      const page = await opened(width, scheme, "/note");

      expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(scheme === "dark");

      const navigator = await navigatorShown(page, width);
      const sections = await navigator.locator("section").evaluateAll((all) => all.map((one) => one.getAttribute("aria-label")));

      expect(sections).toEqual([WORDS.section.bookmarks, WORDS.section.mine, WORDS.section.shared]);
      expect(await navigator.locator("[data-navigator-foot]").textContent()).toContain(WORDS.section.trash);

      // The own section's folder stands before its notes, and unfolds onto the note standing in it.
      const mine = navigator.locator("[data-mine]");
      const folder = mine.locator("[data-folder=screens-folder] button[aria-expanded]");

      expect(await mine.locator("[data-section-room] > *").first().getAttribute("data-folders")).not.toBeNull();
      await folder.click();
      await mine.locator(`[data-folders] [data-note$="/${FIXTURE.notes[3]!.id}"]`).waitFor({ timeout: STANDING_MS });
      expect(await mine.locator(`[data-folders] ~ ul [data-note$="/${FIXTURE.notes[3]!.id}"]`).count()).toBe(0);

      // Every row is one line: its icon and its title.
      const heights = await navigator.locator("[data-navigator-list] li a").evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));

      expect(new Set(heights)).toEqual(new Set([32]));
      await noSidewaysScroll(page);
      await shot(page, width, scheme, width.narrow ? "drawer" : "navigator");
      await page.context().close();
    },
    TEST_MS
  );

  test(
    "with no note chosen the note region stands empty but for its line and its keys",
    async () => {
      const page = await opened(width, scheme, "/note");

      await page.locator("[data-note-empty]").waitFor({ timeout: STANDING_MS });

      if (width.narrow) {
        // The screen's main create floats at the phone's bottom right.
        const create = page.getByRole("button", { name: WORDS.action.new, exact: true }).or(page.locator("[data-screen-foot] button")).last();

        expect(await create.evaluate((button) => button.closest("[data-screen-foot]") !== null)).toBe(true);
      }

      await noSidewaysScroll(page);
      await shot(page, width, scheme, "empty");
      await page.context().close();
    },
    TEST_MS
  );

  test(
    "a note open: its bar holds its state at the leading end and the bookmark, share and more keys at the trailing end",
    async () => {
      const page = await noteOpened(width, scheme);
      const bar = page.locator("[data-note-bar]");

      for (const mark of ["[data-note-state]", "[data-note-bookmark]", "[data-note-share]", "[data-note-more]"]) expect(await bar.locator(mark).count()).toBe(1);

      const state = (await bar.locator("[data-note-state]").boundingBox())!;
      const more = (await bar.locator("[data-note-more]").boundingBox())!;

      expect(state.x).toBeLessThan(more.x);
      // The page head's icon stands over the title, in the editor's column.
      expect(await page.locator("[data-note-head]").textContent()).toContain(FIXTURE.notes[0]!.icon);
      await noSidewaysScroll(page);
      await shot(page, width, scheme, "note");
      await page.context().close();
    },
    TEST_MS
  );

  test(
    "every key of the format bar is the small button, centred, its hover on its own shape, the talk key in sight",
    async () => {
      const page = await noteOpened(width, scheme);
      const bar = formatBar(page);

      // With the caret in the document the keys that change it stand enabled.
      await page.locator("[data-note-editor] [contenteditable=true]").last().click();
      await page.locator("[data-bar=bold]:not([disabled])").first().waitFor({ timeout: STANDING_MS });

      const measured = await keys(bar);

      expect(measured.at(-1)?.name).toBe(WORDS.action.talk);
      small(measured);
      centred(measured);

      if (!width.narrow) {
        for (const name of [WORDS.agent.key, WORDS.action.talk]) await hoverStaysOnKey(page, bar, bar.getByRole("button", { name, exact: true }), name);
      }

      const room = await bar.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));

      expect(room.scroll > room.client).toBe(width.narrow);

      const talkInSight = await bar.evaluate((element, talk) => {
        element.scrollLeft = element.scrollWidth;

        const view = element.getBoundingClientRect();
        const key = [...element.querySelectorAll("button")].find((one) => (one.textContent ?? "").trim() === talk);
        const box = key?.getBoundingClientRect();

        return box !== undefined && box.left >= view.left - 0.5 && box.right <= view.right + 0.5;
      }, WORDS.action.talk);

      expect(talkInSight).toBe(true);
      await page.context().close();
    },
    TEST_MS
  );

  test(
    "the more menu offers the link, the copy, full width, the trash and what the note holds",
    async () => {
      const page = await noteOpened(width, scheme);

      await page.locator("[data-note-more]").click();

      const menu = page.getByRole("menu");

      await menu.waitFor({ timeout: STANDING_MS });

      const text = (await menu.textContent()) ?? "";

      for (const word of [WORDS.action.copy_link, WORDS.action.duplicate, WORDS.action.full_width, WORDS.action.trash]) expect(text).toContain(word);

      await noSidewaysScroll(page);
      await shot(page, width, scheme, "menu");
      await page.context().close();
    },
    TEST_MS
  );

  test(
    "the search dialog lists what was opened before typing, marks what it finds, and says when it finds nothing",
    async () => {
      const page = await opened(width, scheme, "/note?search=");
      const dialog = page.locator("[data-note-search]");

      await dialog.locator("[role=option]").first().waitFor({ timeout: STANDING_MS });
      expect(await dialog.locator("[role=option]").count()).toBeGreaterThan(0);
      await noSidewaysScroll(page);
      await shot(page, width, scheme, "search-recent");

      await dialog.locator("input").fill(FIXTURE.words.search);
      await dialog.locator("mark").first().waitFor({ timeout: STANDING_MS });
      expect(page.url()).toContain(`search=${encodeURIComponent(FIXTURE.words.search)}`);
      expect(await dialog.locator("[role=option]").count()).toBeGreaterThanOrEqual(2);
      await shot(page, width, scheme, "search-results");

      await dialog.locator("input").fill(FIXTURE.words.none);
      await dialog.locator("[role=option]").first().waitFor({ state: "detached", timeout: STANDING_MS });
      await page.waitForTimeout(600);
      expect(await dialog.locator("[role=option]").count()).toBe(0);
      await shot(page, width, scheme, "search-none");

      // Escape closes it, and the address carries the search no more.
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached", timeout: STANDING_MS });
      expect(page.url()).not.toContain("search=");
      await page.context().close();
    },
    TEST_MS
  );

  test(
    "a note in the trash opens read only under its band, holding restore and delete for good",
    async () => {
      const page = await noteOpened(width, scheme, `/note/${FIXTURE.trashed.id}?trash=1`);
      const band = page.locator("[data-trash-band]");

      await band.waitFor({ timeout: STANDING_MS });
      expect(await band.getByRole("button").allTextContents()).toEqual([WORDS.action.restore, WORDS.action.purge]);
      expect(await page.locator("[data-note-bookmark], [data-note-share]").count()).toBe(0);
      await noSidewaysScroll(page);
      await shot(page, width, scheme, "trashed");
      await page.context().close();
    },
    TEST_MS
  );

  test(
    "a missing note keeps the bar with the navigator's key where one stands",
    async () => {
      const page = await opened(width, scheme, "/note/no-such-note");

      await page.getByText(WORDS.status.missing).waitFor({ timeout: STANDING_MS });
      expect(await page.locator("[data-note-bar] [data-navigator-key]").count()).toBe(width.narrow ? 1 : 0);
      await page.context().close();
    },
    TEST_MS
  );
});

describe.skipIf(!ready)("the notes screen's keys", () => {
  test(
    "the create button closes the navigator's head, names a new note and its key, and the key makes a note",
    async () => {
      const width = WIDTHS[0]!;
      const page = await opened(width, "light", "/note");
      const create = page.locator("[data-navigator-head]").getByRole("button", { name: WORDS.action.new, exact: true });

      await create.waitFor({ timeout: STANDING_MS });

      const head = (await page.locator("[data-navigator-head]").boundingBox())!;
      const note = (await page.locator("[data-note-bar]").boundingBox())!;

      // The two regions' head lines are one line.
      expect(Math.abs(head.y + head.height - (note.y + note.height))).toBeLessThanOrEqual(0.5);
      expect(await create.evaluate((button) => getComputedStyle(button).backgroundColor)).toBe("rgba(0, 0, 0, 0)");

      await create.hover();

      const tip = page.locator("[data-slot=content]").filter({ hasText: WORDS.action.new });

      await tip.locator("[data-slot=kbds]").waitFor({ timeout: STANDING_MS });
      await page.mouse.move(0, 0);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("n");
      await page.waitForURL(NOTE_PATH, { timeout: STANDING_MS });

      // Ctrl+\ folds the navigator and brings the unfold key to the note's bar.
      await page.locator("[data-note-bar] [data-note-state]").waitFor({ timeout: STANDING_MS });
      await page.locator("[data-note-bar]").click({ position: { x: 600, y: 10 } });
      await page.keyboard.press("Control+Backslash");
      await page.locator("[data-note-bar] [data-navigator-key]").waitFor({ timeout: STANDING_MS });
      await page.context().close();
    },
    TEST_MS
  );
});

// A select of the screen opened, the list it stands, and whether that list stands with a search field.
async function choicesOpened(page: Page, select: Locator): Promise<{ list: Locator; searches: boolean }> {
  await select.click();

  const list = page.locator('[data-slot="content"][data-side]:has([role="listbox"])');

  await list.waitFor({ timeout: STANDING_MS });

  return { list, searches: (await list.locator("input").count()) > 0 };
}

// The values the screen chooses from a list, each bmo-ui's one select (docs/design.md, 「The navigator」, 「Search」
// and 「The editor」): a section's sort and the search's sort, three each, open on no search, and the kind of the
// block under the caret, nine, opens on one; the value chosen is the one the select then stands on. Whether a list
// searches is the layer's own rule and its own tests; this holds the screen's lists to it.
describe.skipIf(!ready).each(WIDTHS)("the notes screen's selects at $name", (width) => {
  test(
    "a section's sort and the search's sort open their three on no search, and the sort chosen is the one standing",
    async () => {
      const page = await opened(width, "light", "/note");
      const navigator = await navigatorShown(page, width);
      const sort = navigator.locator(`section[aria-label="${WORDS.section.mine}"] button[aria-label="${WORDS.action.sort}"]`);

      let shown = await choicesOpened(page, sort);

      expect([await shown.list.getByRole("option").count(), shown.searches]).toEqual([3, false]);
      await shown.list.getByRole("option", { name: WORDS.sort.title, exact: true }).click();
      await shown.list.waitFor({ state: "detached", timeout: STANDING_MS });

      shown = await choicesOpened(page, sort);
      expect(await shown.list.getByRole("option", { name: WORDS.sort.title, exact: true }).getAttribute("aria-selected")).toBe("true");
      await page.keyboard.press("Escape");
      await page.context().close();

      const searching = await opened(width, "light", "/note?search=");
      const found = await choicesOpened(searching, searching.getByRole("dialog").locator(`button[aria-label="${WORDS.action.sort}"]`));

      expect([await found.list.getByRole("option").count(), found.searches]).toEqual([3, false]);
      await searching.context().close();
    },
    TEST_MS
  );

  test(
    "the block kind opens its nine on a search, and the kind found and chosen there is the block's",
    async () => {
      const page = await noteOpened(width, "light");

      await page.locator("[data-note-editor] .ProseMirror > p").last().click();

      const kind = formatBar(page).locator("[data-bar=kind]");
      let shown = await choicesOpened(page, kind);

      expect([await shown.list.getByRole("option").count(), shown.searches]).toEqual([9, true]);
      await shown.list.locator("input").fill(WORDS.kind.h2);
      await shown.list.getByRole("option", { name: WORDS.kind.h2, exact: true }).click();
      await shown.list.waitFor({ state: "detached", timeout: STANDING_MS });

      shown = await choicesOpened(page, kind);
      expect(await shown.list.getByRole("option", { name: WORDS.kind.h2, exact: true }).getAttribute("aria-selected")).toBe("true");
      await page.context().close();
    },
    TEST_MS
  );
});
