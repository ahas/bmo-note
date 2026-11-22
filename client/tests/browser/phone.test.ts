import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";

import { chromium } from "playwright-core";

import ko from "../../i18n/ko.json";
import { FIXTURE, seeded } from "./fixture";
import { stoodUp } from "./stack";

import type { Browser, BrowserContextOptions, Locator, Page } from "playwright-core";
import type { Stack } from "./stack";

// On a phone the format bar is the one bar (docs/design.md, 「The console surface」). Under a phone's own user
// agent the fork lays a keyboard bar of its own over the on-screen keyboard; the bundle never mounts it, so the
// format bar above the document is the one row of marks and kinds. This file drives the editor as a phone names
// itself, at 360 pixels wide, by a finger, in Korean: while a line is written the format bar stands with all its
// keys, the fork's keyboard bar stands nowhere in the page and its floating format menu stands down; each mark
// the bar carries lands on the words chosen and each kind its select offers turns the line; and the kinds the
// bar does not carry — the further headings, the divider, the callout, the equation — stand in the slash menu,
// typed on the phone's own keyboard, whose panel and further headings both stand inside the screen, where a
// further heading chosen turns the line. A line held in the gutter raises the block's toolbar where the fork
// lays it for a phone, at the screen's foot and inside it, holding Ask AI and the block's three keys and no
// mark or kind. Pictures of the phone writing and of a block chosen are kept for a
// person to read. Skipped where the browser build is not on the machine.

const ready = existsSync(chromium.executablePath());

// How long the stack is given to build and stand, a test to run, and a state to come about; the first page
// the dev host serves builds the editor's sources, so the first editor is given the longest to stand.
const STACK_MS = 900_000;
const TEST_MS = 600_000;
const STANDING_MS = 300_000;
const SETTLING_MS = 60_000;
// How long a finger is held: past the half second the platform's one hold reads, with room for the page to answer.
const HOLD_MS = 800;

const SHOTS = process.env.BMO_NOTE_SHOTS ?? "/tmp/note-renewal-shots";

// The cookie the dev host reads for the language: the format bar's choices are found by their Korean names.
const LOCALE_COOKIE = "bmo-dev-locale";
const WORDS = ko.note;

// A phone as it names itself to the page, which is what the fork reads to lay out its phone's chrome.
const PHONE_AGENT = "Mozilla/5.0 (Linux; Android 14; SM-S931N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const PHONE = { width: 360, height: 780 };
const NOTE = FIXTURE.notes[0]!;

// The note's top-level blocks.
const BLOCKS = "affine-note > .affine-note-block-container > .affine-block-children-container > [data-block-id]";
// The fork's keyboard bar: the widget the page view would mount, and the bar it would lay over the keyboard.
const KEYBOARD_BAR = "affine-keyboard-toolbar-widget, affine-keyboard-toolbar";
const SLASH = ".slash-menu-item";
// The list a select of the console's library opens.
const CHOICES = '[data-slot="content"][data-side]:has([role="listbox"])';

// The marks the format bar carries, by the fork's own ids, which are the attributes a marked run of words holds.
const MARKS = ["bold", "italic", "underline", "strike", "code"] as const;

// The kinds the format bar's select offers, by its own words, and what each makes of a line.
const KINDS = [
  { label: WORDS.kind.h1, flavour: "affine:paragraph", type: "h1" },
  { label: WORDS.kind.h2, flavour: "affine:paragraph", type: "h2" },
  { label: WORDS.kind.h3, flavour: "affine:paragraph", type: "h3" },
  { label: WORDS.kind.bulleted, flavour: "affine:list", type: "bulleted" },
  { label: WORDS.kind.numbered, flavour: "affine:list", type: "numbered" },
  { label: WORDS.kind.todo, flavour: "affine:list", type: "todo" },
  { label: WORDS.kind.quote, flavour: "affine:paragraph", type: "quote" },
  { label: WORDS.kind.text, flavour: "affine:paragraph", type: "text" },
  { label: WORDS.kind.code, flavour: "affine:code", type: null }
];

// The kinds the fork's keyboard bar offered beyond the format bar's, by the class the slash menu gives each item.
const SLASH_KINDS = ["divider", "callout", "equation"];

let stack: Stack | null = null;
let browser: Browser;

beforeAll(async () => {
  if (!ready) return;

  mkdirSync(SHOTS, { recursive: true });
  stack = await stoodUp();
  browser = await chromium.launch();

  // The dev host builds the editor's sources the first time a note asks for them, reloading the page as it
  // finds what they import; two passes over an open note let that settle before the note is written.
  // The navigator stands in a closed drawer on a phone, so the passes are made at a desktop's width.
  for (let pass = 0; pass < 2; pass += 1) {
    const page = await opened("/note", { viewport: { width: 1280, height: 800 } });

    await page.locator("[data-navigator-list]").waitFor({ state: "attached", timeout: STANDING_MS });
    if (pass === 1) await seeded(page, [NOTE]);
    await page.context().close();
  }
}, STACK_MS);

afterAll(async () => {
  await browser?.close();
  await stack?.down();
}, STACK_MS);

// A page at a phone's width under a phone's own agent, read by a finger, in Korean, on the screen at `path`.
async function phoneOpened(path: string): Promise<Page> {
  return opened(path, { viewport: PHONE, hasTouch: true, isMobile: true, userAgent: PHONE_AGENT });
}

// A page in Korean on the screen at `path`, in a browser shaped as `shape` says.
async function opened(path: string, shape: BrowserContextOptions): Promise<Page> {
  const context = await browser.newContext(shape);

  context.setDefaultTimeout(STANDING_MS);
  await context.addCookies([{ name: LOCALE_COOKIE, value: "ko", url: stack!.host }]);

  const page = await context.newPage();

  await page.goto(`${stack!.host}${path}`);

  return page;
}

// The note open on the phone, with `lines` more lines of words after its own.
async function noteWith(lines: string[]): Promise<Page> {
  const page = await phoneOpened(`/note/${NOTE.id}`);

  await page.locator(BLOCKS).first().waitFor({ timeout: STANDING_MS });
  await page.evaluate((words) => {
    const host = document.querySelector("editor-host") as unknown as { std: { store: any } };
    const store = host.std.store;
    const note = store.root.children.find((child: { flavour: string }) => child.flavour === "affine:note");
    const Text = note.children[0].text.constructor;

    for (const one of words) store.addBlock("affine:paragraph", { text: new Text(one) }, note.id);
  }, lines);

  return page;
}

// The id of the top-level block holding `words`, as the store reads it now.
async function lineOf(page: Page, words: string): Promise<string> {
  return page.evaluate((wanted) => {
    const host = document.querySelector("editor-host") as unknown as { std: { store: any } };
    const note = host.std.store.root.children.find((child: { flavour: string }) => child.flavour === "affine:note");

    return note.children.find((child: any) => child.text?.toString() === wanted).id as string;
  }, words);
}

// A finger's tap on the words of the block holding `words`, laying the caret there; answers the block's id.
async function tapWords(page: Page, words: string): Promise<string> {
  const id = await lineOf(page, words);

  await page.locator(`[data-block-id="${id}"]`).first().tap();
  await page.waitForFunction(
    (one) =>
      (document.querySelector("editor-host") as unknown as { std: { selection: { value: { type: string; from?: { blockId: string } }[] } } }).std.selection.value.some(
        (chosen) => chosen.type === "text" && chosen.from?.blockId === one
      ),
    id,
    { timeout: SETTLING_MS }
  );

  return id;
}

// The format bar's row of keys above the document.
function formatBar(page: Page): Locator {
  return page.locator("[data-bar-row]").first();
}

// Whether `holds` comes to answer true within the settling time.
async function comesAbout<T>(page: Page, holds: (arg: T) => boolean, arg: T): Promise<boolean> {
  return page
    .waitForFunction(holds, arg, { timeout: SETTLING_MS })
    .then(() => true)
    .catch(() => false);
}

describe.skipIf(!ready)("the phone's one bar", () => {
  test(
    "while a line is written the format bar stands with its keys, and no keyboard bar or floating menu stands",
    async () => {
      const page = await noteWith([]);

      await tapWords(page, NOTE.text.split("\n")[0]!);
      // A beat for whatever the fork would lay over the keyboard once its editor is active.
      await page.waitForTimeout(500);

      const standing = await page.evaluate((bar) => {
        const toolbar = document.querySelector("affine-toolbar-widget");

        return {
          // The fork reads the agent as a phone's: its selection toolbar marks itself the phone's.
          phone: toolbar?.shadowRoot?.querySelector("editor-toolbar")?.getAttribute("data-mobile") ?? null,
          keyboardBar: document.querySelectorAll(bar).length,
          floatingMenu: toolbar !== null && toolbar.getClientRects().length > 0 && toolbar.shadowRoot?.querySelector("editor-toolbar[data-open]") !== null
        };
      }, KEYBOARD_BAR);

      expect(standing).toEqual({ phone: "true", keyboardBar: 0, floatingMenu: false });

      const keys = await formatBar(page)
        .locator("[data-bar]")
        .evaluateAll((all) => all.filter((key) => key.getClientRects().length > 0).map((key) => key.getAttribute("data-bar")));

      expect(keys).toEqual(["ask", "kind", ...MARKS, "image", "table"]);
      await page.screenshot({ path: `${SHOTS}/phone-agent-writing.png` });
      await page.context().close();
    },
    TEST_MS
  );

  test(
    "each mark the format bar carries lands on the words chosen",
    async () => {
      const lines = MARKS.map((mark) => `Words to mark ${mark}`);
      const page = await noteWith(lines);
      const missed: string[] = [];

      for (const [at, mark] of MARKS.entries()) {
        const id = await tapWords(page, lines[at]!);

        // The line's first word chosen, as a finger's own choosing of words leaves it.
        await page.evaluate((one) => {
          const line = document.querySelector(`[data-block-id="${one}"]`) as unknown as { inlineEditor: { setInlineRange(range: { index: number; length: number }): void } };

          line.inlineEditor.setInlineRange({ index: 0, length: 5 });
        }, id);
        await formatBar(page).locator(`[data-bar="${mark}"]`).tap();

        const landed = await comesAbout(
          page,
          ({ one, attribute }) => {
            const host = document.querySelector("editor-host") as unknown as { std: { store: any } };
            const delta = host.std.store.getBlock(one).model.text.toDelta() as { insert: string; attributes?: Record<string, unknown> }[];

            return delta[0]?.insert === "Words" && delta[0]?.attributes?.[attribute] === true;
          },
          { one: id, attribute: mark as string }
        );

        if (!landed) missed.push(mark);
      }

      expect(missed).toEqual([]);
      await page.context().close();
    },
    TEST_MS
  );

  test(
    "each kind the format bar's select offers turns the line, and the slash menu reaches the kinds it does not carry",
    async () => {
      const words = "A line to turn";
      const further = "Further";
      const page = await noteWith([words, further]);
      const missed: string[] = [];

      for (const kind of KINDS) {
        await tapWords(page, words);
        await formatBar(page).locator("[data-bar=kind]").tap();

        const list = page.locator(CHOICES);

        await list.getByRole("option", { name: kind.label, exact: true }).tap();
        await list.waitFor({ state: "detached", timeout: SETTLING_MS });

        const turned = await comesAbout(
          page,
          ({ wanted, flavour, type }) => {
            const host = document.querySelector("editor-host") as unknown as { std: { store: any } };
            const note = host.std.store.root.children.find((child: { flavour: string }) => child.flavour === "affine:note");
            const block = note.children.find((child: any) => child.text?.toString() === wanted);

            return block !== undefined && block.flavour === flavour && (type === null || block.props.type === type);
          },
          { wanted: words, flavour: kind.flavour, type: kind.type }
        );

        if (!turned) missed.push(kind.label);
      }

      expect(missed).toEqual([]);

      // The slash menu, typed on the phone's own keyboard at the end of a line of words.
      await tapWords(page, further);
      await page.keyboard.press("End");
      await page.keyboard.type(" /");
      await page.locator(SLASH).first().waitFor({ state: "attached", timeout: SETTLING_MS });

      const offered = await page.locator(SLASH).evaluateAll((all, kinds) => kinds.filter((kind) => all.some((item) => item.classList.contains(kind))), SLASH_KINDS);

      expect(offered).toEqual(SLASH_KINDS);

      expect(await panelsInside(page)).toEqual(["inside"]);
      const opener = page.locator(`${SLASH}.other-headings`).first();
      const pressed = (await opener.boundingBox())!;

      await opener.tap();
      await page.locator(`${SLASH}.heading-4 >> visible=true`).waitFor({ timeout: SETTLING_MS });
      expect(await panelsInside(page)).toEqual(["inside", "inside"]);

      // The further headings stand clear of the finger that opened them, which would otherwise choose one.
      const under = await page.locator(".slash-menu").evaluateAll(
        (all, at) =>
          all
            .filter((one) => one.getBoundingClientRect().width > 0)
            .slice(1)
            .some((one) => {
              const box = one.getBoundingClientRect();

              return at.x >= box.left && at.x <= box.right && at.y >= box.top && at.y <= box.bottom;
            }),
        { x: pressed.x + pressed.width / 2, y: pressed.y + pressed.height / 2 }
      );

      expect(under).toBe(false);
      await page.locator(`${SLASH}.heading-4 >> visible=true`).tap();

      const headed = await comesAbout(
        page,
        (wanted) => {
          const host = document.querySelector("editor-host") as unknown as { std: { store: any } };
          const note = host.std.store.root.children.find((child: { flavour: string }) => child.flavour === "affine:note");

          return note.children.some((child: any) => child.text?.toString().trim() === wanted && child.props.type === "h4");
        },
        further
      );

      expect(headed).toBe(true);
      await page.context().close();
    },
    TEST_MS
  );

  test(
    "a line held in the gutter raises Ask AI and the block's three keys at the screen's foot, inside it",
    async () => {
      const words = "A line to hold";
      const page = await noteWith([words]);
      const id = await lineOf(page, words);
      const beside = await page.evaluate((one) => {
        const line = document.querySelector(`[data-block-id="${one}"]`)!;

        line.scrollIntoView({ block: "center" });

        const box = line.getBoundingClientRect();
        const column = document.querySelector("affine-note > .affine-note-block-container > .affine-block-children-container")!.getBoundingClientRect();

        return { x: Math.round(column.left / 2), y: Math.round(box.top + Math.min(12, box.height / 2)) };
      }, id);

      await pressFinger(page, beside, HOLD_MS);

      const keys = [WORDS.ask.key, WORDS.block.copy, WORDS.block.duplicate, WORDS.block.delete];
      const standing = await comesAbout(
        page,
        ({ labels, height }) => {
          const bar = document.querySelector("affine-toolbar-widget")?.shadowRoot?.querySelector("editor-toolbar[data-open]");

          if (!bar || getComputedStyle(bar).opacity !== "1") return false;

          const box = bar.getBoundingClientRect();
          const named = [...bar.querySelectorAll("editor-icon-button")].filter((key) => key.getClientRects().length > 0).map((key) => key.getAttribute("aria-label"));

          return box.left >= 0 && box.right <= window.innerWidth && box.bottom <= height && box.bottom >= height - 64 && JSON.stringify(named) === JSON.stringify(labels);
        },
        { labels: keys, height: PHONE.height }
      );

      expect({ standing, keyboardBar: await page.locator(KEYBOARD_BAR).count() }).toEqual({ standing: true, keyboardBar: 0 });
      await page.screenshot({ path: `${SHOTS}/phone-agent-block-chosen.png` });
      await page.context().close();
    },
    TEST_MS
  );
});

// Where each slash menu panel drawn stands across the phone's screen, outermost first: `inside` where its whole
// box fits, else the box that failed. A sub menu is drawn in a portal of its own beside the first.
async function panelsInside(page: Page): Promise<string[]> {
  return page.locator(".slash-menu").evaluateAll((all, across) =>
    all
      .filter((one) => one.getClientRects().length > 0 && one.getBoundingClientRect().width > 0)
      .map((one) => {
        const box = one.getBoundingClientRect();

        return box.left >= 0 && box.right <= across ? "inside" : `${Math.round(box.left)}..${Math.round(box.right)} past ${String(across)}`;
      }),
    PHONE.width
  );
}

// One finger: down at `at`, held `heldMs`, and lifted, as a real finger lays a touch.
async function pressFinger(page: Page, at: { x: number; y: number }, heldMs: number): Promise<void> {
  const finger = await page.context().newCDPSession(page);

  await finger.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: at.x, y: at.y, id: 1 }] });
  await Bun.sleep(heldMs);
  await finger.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await finger.detach();
}
