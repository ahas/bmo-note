// The line protocol of the talk (`docs/design.md`, 「The talk panel」): the note as the
// supervisor sees it and answers it — one line per block, in the order they stand. This is the
// unit's own answer grammar, not markdown at large: what a line may start with is exactly the set
// below, and one line always stands for one block, so the patch can map every line back to its
// block without a parser of a general format.
//
//   <text>                 a plain paragraph
//   # text … ###### text   the six headings
//   - text                 a bulleted list item
//   1. text                a numbered list item (the run numbers itself when read back)
//   - [ ] text / - [x]     a to-do item, open or done
//   > text                 a quote
//   ```<lang>\t<text>      a code block, its lines joined as the text below
//   [[divider]]            a divider, standing as it stands
//   [[image]]              an image, opaque: no patch deletes its line
//   [[table]]              a table, opaque likewise
//   [[title]] <text>       on an answer's first line only: the note's new title, never a block
//
// A line holds no raw newline or tab; a text payload escapes `\` as `\\`, a newline as `\n`, a
// tab as `\t`, and any space standing first or last as `\ ` — so the line reads whole and the
// words come back unchanged. A deeper block (a list item under one) wears two spaces per depth
// before its mark.

/** The kinds a line carries, matching the blocks the editor writes. */
export type RowKind =
  | "text"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "bulleted"
  | "numbered"
  | "todo"
  | "todo-done"
  | "quote"
  | "code"
  | "divider"
  | "image"
  | "table";

/** One block as a row: its kind, its text (empty for the marks that carry none) and its depth. */
export interface Row {
  kind: RowKind;
  text: string;
  indent: number;
}

/** Whether a patch leaves the row's block standing where it is: the rows no patch may move. */
export function opaqueRow(row: Row): boolean {
  return row.kind === "image" || row.kind === "table";
}

/** Whether a line names an opaque block, read from the line alone (the patch guards whole spans). A
 * line whose own words merely end with a mark reads as the line it is, as `rowOf` reads it. */
export function opaqueLine(line: string): boolean {
  return rowOf(line).kind === "image" || rowOf(line).kind === "table";
}

const MARKS: Array<[RowKind, string]> = [
  ["h1", "# "],
  ["h2", "## "],
  ["h3", "### "],
  ["h4", "#### "],
  ["h5", "##### "],
  ["h6", "###### "],
  ["todo-done", "- [x] "],
  ["todo", "- [ ] "],
  ["bulleted", "- "],
  ["quote", "> "]
];

/** The one line a row wears. */
export function lineOf(row: Row): string {
  const indent = "  ".repeat(Math.max(0, row.indent));

  if (row.kind === "divider") return `${indent}[[divider]]`;
  if (row.kind === "image") return `${indent}[[image]]`;
  if (row.kind === "table") return `${indent}[[table]]`;

  if (row.kind === "code") return `${indent}\`\`\`\t${escapeText(row.text)}`;
  if (row.kind === "numbered") return `${indent}1. ${escapeText(row.text)}`;

  const mark = MARKS.find(([kind]) => kind === row.kind)?.[1] ?? "";
  const text = escapeText(row.text);

  // A plain paragraph whose words begin like a mark wears a backslash, so it reads back as the
  // paragraph it was and never as the block its words happen to spell.
  return mark === "" ? `${indent}${markEscape(text)}` : `${indent}${mark}${text}`;
}

/** The row a line wears; anything unmarked reads as a plain paragraph. */
export function rowOf(line: string): Row {
  const indent = Math.floor((line.length - line.trimStart().length) / 2);
  const body = line.trimStart();

  if (body === "[[divider]]") return { kind: "divider", text: "", indent };
  if (body === "[[image]]") return { kind: "image", text: "", indent };
  if (body === "[[table]]") return { kind: "table", text: "", indent };

  if (body.startsWith("```")) {
    const [, text = ""] = splitOnce(body.slice(3), "\t");

    return { kind: "code", text: unescapeText(text), indent };
  }

  for (const [kind, mark] of MARKS) {
    if (body.startsWith(mark)) return { kind, text: unescapeText(body.slice(mark.length)), indent };
  }

  if (/^\d+\.\s/.test(body)) {
    const [, text = ""] = splitOnce(body, ". ");

    return { kind: "numbered", text: unescapeText(text), indent };
  }

  return { kind: "text", text: unescapeText(body), indent };
}

/** The note as the talk sends it: one line per row. */
export function linesOf(rows: Row[]): string[] {
  return rows.map(lineOf);
}

/** The answer's text as rows: every line reads, blank or all, into one block. */
export function rowsOf(lines: string[]): Row[] {
  return lines.map(rowOf);
}

/** Whether a plain paragraph's words would read as a mark, so a backslash must stand before them. */
function readsAsMark(body: string): boolean {
  // `[[title]]` leads the talk's answer when it renames the note, so a paragraph whose words open with
  // it wears a backslash too and never reads as that rename.
  if (body === "[[divider]]" || body === "[[image]]" || body === "[[table]]" || body === "[[title]]" || body.startsWith("[[title]] ")) return true;

  return /^#{1,6} /u.test(body) || body.startsWith("- ") || body.startsWith("> ") || body.startsWith("```") || /^\d+\.\s/u.test(body);
}

function markEscape(body: string): string {
  return readsAsMark(body) ? `\\${body}` : body;
}

/** The whole text of a row's block, as the editor holds it: a code block keeps its newlines. */
function escapeText(text: string): string {
  let escaped = text.replace(/\\/gu, "\\\\").replace(/\n/gu, "\\n").replace(/\t/gu, "\\t");

  if (/^ /.test(escaped)) escaped = `\\ ${escaped.slice(1)}`;
  if (/ $/.test(escaped)) escaped = `${escaped.slice(0, -1)}\\ `;

  return escaped;
}

function unescapeText(text: string): string {
  let out = "";

  for (let at = 0; at < text.length; at += 1) {
    const ch = text[at] ?? "";

    if (ch !== "\\" || at + 1 >= text.length) {
      out += ch;
      continue;
    }

    const next = text[at + 1];

    if (next === "\\") out += "\\";
    else if (next === "n") out += "\n";
    else if (next === "t") out += "\t";
    else if (next === " ") out += " ";
    // Any other escaped character is the paragraph's own first mark, written with a backslash so it
    // never reads as that mark.
    else out += next;

    at += 1;
  }

  return out;
}

function splitOnce(text: string, sep: string): [string, string] {
  const at = text.indexOf(sep);

  return at < 0 ? [text, ""] : [text.slice(0, at), text.slice(at + sep.length)];
}
