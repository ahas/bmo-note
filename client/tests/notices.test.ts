import { describe, expect, mock, test } from "bun:test";

import { translate } from "@blocksuite/affine/components/translate";

import koEditor from "../i18n/editor/ko.json";

import type { NoticeRoads } from "../app/domain/notices";

// The editor's lines of notice as the screen says them (docs/design.md, 「The editor speaks on the console's
// message pill」): each line fed to the notification service exactly as the fork builds it, with a sample
// figure where it carries one, and read off the pill as the table's Korean, the figure in its place and the
// line's own tone. The lines the screens' browser file raises on screen — the size refusal, a cell's and a
// row's copy, a phone's tap on a database — are read there.

// The build reads the editor's words folder whole; outside it, the bundle is handed the same table.
mock.module("../app/domain/word-tables", () => ({ TABLES: { ko: koEditor } }));

const { answerEditorWords } = await import("../app/domain/words");
const { editorMessages } = await import("../app/domain/notices");

const SAID: Record<string, string> = koEditor;
const HANGUL = /[\p{Script=Hangul}]/u;

type Told = Parameters<NoticeRoads["pill"]["say"]>[0];

/** The service the editor is given, and every line the pill was told. */
function pill(): { service: ReturnType<typeof editorMessages>["service"]; told: Told[] } {
  const told: Told[] = [];
  const { service } = editorMessages({
    pill: {
      say: (message) => {
        told.push(message);
      },
      settle: () => {}
    },
    ask: async () => true
  });

  return { service, told };
}

/** A table line with its marks filled, as the bundle fills it. */
function filled(line: string, figures: Record<string, string | number>): string {
  return line.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(figures, name) ? String(figures[name]) : whole));
}

const name = "report.pdf";
const one = 1;
const several = 3;

// Each line by the fork's own expression for it, the table line it answers to and the tone it is heard in.
const TOASTS = [
  { fork: `Failed to download ${name}!`, line: "Failed to download {name}!", figures: { name }, tone: "error" },
  { fork: `Successfully imported ${several} Doc${several > 1 ? "s" : ""}.`, line: "Successfully imported {n} Docs.", figures: { n: several }, tone: "success" },
  { fork: `Successfully imported ${one} Doc${one > 1 ? "s" : ""}.`, line: "Successfully imported {n} Doc.", figures: { n: one }, tone: "success" },
  { fork: `${several} row${several > 1 ? "s" : ""} copied to clipboard`, line: "{n} rows copied to clipboard", figures: { n: several }, tone: "success" },
  { fork: `${several} cell${several > 1 ? "s" : ""} copied to clipboard`, line: "{n} cells copied to clipboard", figures: { n: several }, tone: "success" },
  { fork: "Import failed, please try again", line: "Import failed, please try again", figures: {}, tone: "error" },
  { fork: "Failed to load calendar entries", line: "Failed to load calendar entries", figures: {}, tone: "error" }
] as const;

describe("the editor's lines on the pill", () => {
  answerEditorWords("ko");

  for (const { fork, line, figures, tone } of TOASTS) {
    test(`"${fork}" is said in the table's words with its figure in place, in the ${tone} tone`, () => {
      const { service, told } = pill();

      service.toast(fork);

      expect(told).toHaveLength(1);
      expect(told[0]!.title).toBe(filled(SAID[line]!, figures));
      expect(HANGUL.test(told[0]!.title as string)).toBe(true);
      for (const figure of Object.values(figures)) expect(told[0]!.title).toContain(String(figure));
      expect(told[0]!.tone).toBe(tone);
    });
  }

  test("a failed embed is said with its line under it in the table's words, in the fork's own tone", () => {
    const { service, told } = pill();

    service.notify({ title: "Error in embed iframe creation", message: "Please try again", accent: "error", onClose: () => {} });

    expect(told).toHaveLength(1);
    expect(told[0]!.title).toBe(SAID["Error in embed iframe creation"]);
    expect(told[0]!.description).toBe(SAID["Please try again"]);
    expect(told[0]!.tone).toBe("error");
  });

  test("a phone's database refusal is said in the table's words, in the fork's own tone", () => {
    // The fork asks the line of the seam inside the template it draws; the words that template draws are fed here.
    const line = "Mobile database editing is not supported yet. You can open it in experimental features, or edit it in desktop mode.";
    const { service, told } = pill();

    service.notify({ title: translate(line), accent: "warning" });

    expect(told).toHaveLength(1);
    expect(told[0]!.title).toBe(SAID[line]);
    expect(told[0]!.tone).toBe("warning");
  });

  test("a download under way is never said, whether the line names the file or carries no figure", () => {
    const { service, told } = pill();

    service.toast(`Downloading ${name}`);
    service.toast("Downloading image...");

    expect(told).toEqual([]);
  });

  test("a line with a figure the service does not know stands as the fork filled it, in the info tone", () => {
    const { service, told } = pill();
    const unknown = `${several} pages exported`;

    service.toast(unknown);

    expect(told[0]!.title).toBe(unknown);
    expect(told[0]!.tone).toBe("info");
  });
});
