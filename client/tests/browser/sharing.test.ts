import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";

import { chromium } from "playwright-core";

import en from "../../i18n/en.json";
import { stoodUp } from "./stack";

import type { Browser, Page } from "playwright-core";
import type { Stack } from "./stack";

// A note shared through the share dialog, driven in a real browser (docs/design.md, 「Sharing on the
// screens」): the owner makes a link that opens the note read only on its share page and ends it, and shares
// the note with a member the people directory finds; the member opens it read only from the navigator's shared section, a
// reader it is not shared with finds no note, and once the member is taken off they find none either. The
// screens are the dev host's, relaying to a throwaway note service as the reader its cookie names. Skipped
// where the browser build is not on the machine.

const ready = existsSync(chromium.executablePath());

// How long the stack is given to build and stand, the test to run, and a screen to stand; the first page the
// dev host serves builds the editor's sources.
const STACK_MS = 900_000;
const TEST_MS = 900_000;
const STANDING_MS = 300_000;

// The dev host's reader cookie, and the made-up accounts its people directory holds.
const READER_COOKIE = "bmo-dev-reader";
const OWNER = "1";
const MEMBER = "2";
const STRANGER = "3";

// How many presses of the new-note key a reloading dev host may lose.
const MOST_PRESSES = 3;

// The line the owner writes, which every reader of the note finds.
const LINE = "Shared plan line";

// The dev host speaks the bundle's words alone; the dialog's own stand as their keys there.
const CREATE_LINK = "common.action.create_link";
const UNSHARE = "common.action.unshare";

const WORDS = en.note;

let stack: Stack | null = null;
let browser: Browser;

beforeAll(async () => {
  if (!ready) return;

  stack = await stoodUp();
  browser = await chromium.launch();
}, STACK_MS);

afterAll(async () => {
  await browser?.close();
  await stack?.down();
}, STACK_MS);

// A page of the dev host at `path`, presenting `reader` to the service.
async function asReader(reader: string, path: string): Promise<Page> {
  const host = stack!.host;
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // A loaded machine, a deployment's gate among them, may take longer than the driver's own default over any
  // step, so every step is given the time a page is given to stand.
  context.setDefaultTimeout(STANDING_MS);

  await context.addCookies([{ name: READER_COOKIE, value: reader, url: host }]);

  const page = await context.newPage();

  await page.goto(`${host}${path}`);

  return page;
}

function newNoteKey(page: Page) {
  return page.locator("[data-navigator-head]").getByRole("button", { name: WORDS.action.new });
}

// Presses the navigator's new-note key until the note it makes opens, a few times at most, since a dev host still
// finding the packages the screens import reloads the page under a press. Answers the note's id.
async function noteMade(page: Page): Promise<string> {
  for (let press = 1; press <= MOST_PRESSES; press += 1) {
    await newNoteKey(page).waitFor({ timeout: STANDING_MS });

    const opened = page.waitForURL(/\/note\/[^/?]+$/, { timeout: STANDING_MS }).then(() => "opened" as const);
    const reloaded = page.waitForEvent("load", { timeout: STANDING_MS }).then(() => "reloaded" as const);

    await newNoteKey(page).click();

    if ((await Promise.race([opened, reloaded])) === "opened") return decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)!);
  }

  throw new Error(`the screen reloaded under each of ${MOST_PRESSES} presses of its new-note key`);
}

// Whether the open document takes no edit: no block of it stands editable.
async function editable(page: Page): Promise<number> {
  return page.locator("[data-note-editor] [contenteditable=true]").count();
}

describe.skipIf(!ready)("a note shared through the share dialog", () => {
  test(
    "opens to its link and its member as shared, and to nobody once the share ends",
    async () => {
      // The owner writes a note and waits for it to be saved.
      const owner = await asReader(OWNER, "/note");
      const id = await noteMade(owner);

      await owner.locator("[data-bar=bold]").waitFor({ timeout: STANDING_MS });
      await owner.locator("[data-note-editor] [contenteditable=true]").last().click();

      const saved = owner.waitForResponse((response) => response.request().method() === "PATCH" && response.ok(), { timeout: STANDING_MS });

      await owner.keyboard.type(LINE);
      await saved;

      // The share key opens the dialog; a link is made and its address read.
      await owner.getByRole("button", { name: WORDS.action.share, exact: true }).click();

      const dialog = owner.getByRole("dialog");

      await dialog.getByRole("button", { name: CREATE_LINK }).click();

      const address = dialog.locator("input[readonly]");

      await address.waitFor({ timeout: STANDING_MS });

      const link = await address.inputValue();

      expect(link).toContain("/note/share/");

      // The share page opens the note read only, with no format bar, whoever holds the link.
      const holder = await asReader(STRANGER, new URL(link).pathname);

      await holder.locator("[data-note-editor]").getByText(LINE).waitFor({ timeout: STANDING_MS });
      expect(await holder.getByRole("toolbar", { name: WORDS.label.toolbar }).count()).toBe(0);
      expect(await editable(holder)).toBe(0);

      // A member is found in the people directory and the note shared with them, read only.
      await dialog.locator("[data-member-search] input, input[data-member-search]").first().fill("member");
      await owner.getByRole("option", { name: /Member Tester/ }).click();
      await dialog.locator("[data-member-share]").click();
      await dialog.locator(`[data-member="${MEMBER}"]`).getByText("Member Tester").waitFor({ timeout: STANDING_MS });

      // The member finds it in the navigator's shared section, opens it, and reads it read only, named by
      // who shared it.
      const member = await asReader(MEMBER, "/note");

      await member.locator(`section[aria-label="${WORDS.section.shared}"] li a`).first().click();
      await member.waitForURL(new RegExp(`/note/${id}\\?owner=${OWNER}$`), { timeout: STANDING_MS });
      await member.locator("[data-note-editor]").getByText(LINE).waitFor({ timeout: STANDING_MS });
      await member.getByText(WORDS.label.read_only).waitFor({ timeout: STANDING_MS });
      await member.locator("[data-note-state]").getByText(/Owner Tester/).waitFor({ timeout: STANDING_MS });
      expect(await editable(member)).toBe(0);
      expect(await member.getByRole("button", { name: WORDS.action.share, exact: true }).count()).toBe(0);
      expect(await member.getByRole("button", { name: WORDS.action.talk, exact: true }).count()).toBe(0);
      expect(await member.locator("[data-bar=agent]").count()).toBe(0);
      // With no AI key the bar's keys open on a key, not on the line that parted it from them.
      expect(await member.locator("[data-bar-row] > :first-child").getAttribute("aria-hidden")).toBeNull();

      // A reader the note is not shared with finds no note at the same address.
      const stranger = await asReader(STRANGER, `/note/${id}?owner=${OWNER}`);

      await stranger.getByText(WORDS.status.missing).waitFor({ timeout: STANDING_MS });

      // The owner takes the member off and ends the link: neither opens the note any more.
      await dialog.locator(`[data-member="${MEMBER}"] [data-member-remove]`).click();
      await dialog.locator("[data-no-members]").waitFor({ timeout: STANDING_MS });
      await dialog.getByRole("button", { name: UNSHARE }).last().click();
      await dialog.getByRole("button", { name: CREATE_LINK }).waitFor({ timeout: STANDING_MS });

      await member.reload();
      await member.getByText(WORDS.status.missing).waitFor({ timeout: STANDING_MS });
      await holder.reload();
      await holder.getByText(WORDS.share.missing).waitFor({ timeout: STANDING_MS });

      for (const page of [owner, holder, member, stranger]) await page.context().close();
    },
    TEST_MS
  );
});
