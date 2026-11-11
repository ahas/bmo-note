// The talk about one note (`docs/design.md`, 「The AI talk panel」): the receiver's one-turn road, taken
// through the console's relay because the bundle's manifest names the receiver under `calls`. The
// receiver keeps no turn of such a talk, so the screen holds the conversation and hands every turn with
// the turns before it. What comes back is either words alone, which change nothing, or one fenced block
// holding the whole edited note, which the patch applies a changed run at a time.

import { relayCall } from "bmo-ui/app/domain/relay";

/** One turn as the receiver reads it: whose it is and what it said. */
export interface TalkTurn {
  owner: boolean;
  text: string;
}

/** What one turn of a note's talk asks. */
export interface NoteTalk {
  noteId: string;
  title: string;
  /** The note as the talk asks over it: one line per block (`domain/text`). */
  lines: string[];
  /** The turns said before this one. */
  turns: TalkTurn[];
  said: string;
}

/** The paragraph the turn opens on: the note's line grammar is this screen's own protocol. */
export const TALK_HEADING = [
  "You edit one note for its owner. The note stands in the fields below: noteId, title and lines.",
  "Each line is one block. A plain paragraph is bare text. #, ## and ### head a section. - is a",
  "bulleted item, 1. a numbered one, - [ ] and - [x] to-do items, > a quote, and ```<tab>text a code",
  "block. [[divider]], [[image]] and [[table]] name blocks that stand as they are. A deeper block",
  "carries two spaces per level.",
  "Answer with the whole edited note in one fenced code block and nothing outside it. Change only what",
  "the owner asks for, and keep every line the request does not change.",
  "To rename the note, put [[title]] and the new title on the first line of your block, above the",
  "lines; it carries no indent and is the title alone, not a line of the note. Where the title stands,",
  "write no such line."
].join("\n");

/** The answer's fenced block as lines, or null where the answer carries none — then nothing changes. */
export function fencedAnswer(answer: string): string[] | null {
  const lines = answer.replace(/\r\n?/gu, "\n").split("\n");
  const opening = lines.findIndex((line) => line.trimStart().startsWith("```"));

  if (opening < 0) return null;

  const body: string[] = [];

  for (let at = opening + 1; at < lines.length; at += 1) {
    const line = lines[at] ?? "";

    if (line.trim() === "```") return body;

    body.push(line);
  }

  // An opening fence with no closing one is an answer still being cut off; it changes nothing.
  return null;
}

/// The mark a renamed note's answer wears its new title under, on the block's first line.
const TITLE_MARK = "[[title]]";

/** The answer's lines and the title it renames the note to, where its first line carries one. */
export interface NoteAnswer {
  /** The note's lines, the title line taken off where it stood. */
  lines: string[];
  /** The new title, trimmed, where the answer names one. */
  title: string | null;
}

/**
 * The fenced block as an answer: its lines, and the title where its first line is `[[title]]` followed
 * by the new title. The mark ends a line, so a title runs to the line's end; a line that escapes to
 * the mark (a paragraph whose words start with it) reads as the paragraph it is.
 */
export function noteAnswer(answer: string): NoteAnswer | null {
  const lines = fencedAnswer(answer);

  if (lines === null) return null;

  const first = lines[0] ?? "";

  if (!first.startsWith(`${TITLE_MARK} `)) return { lines, title: null };

  const titled = first.slice(TITLE_MARK.length + 1).trim();

  // A title line with no title on it renames nothing, and its mark is still off the note's lines.
  return { lines: lines.slice(1), title: titled === "" ? null : titled };
}

/**
 * One turn of the note's talk, answered by the supervisor of the owner's account. What came back as
 * words answers; a turn that came back with nothing reads as null, so the screen says so and keeps the
 * note as it stands.
 */
export async function askNote(talk: NoteTalk): Promise<string | null> {
  const topic = {
    kind: "note",
    key: talk.noteId,
    heading: TALK_HEADING,
    fields: {
      noteId: talk.noteId,
      title: talk.title,
      lines: talk.lines.join("\n")
    }
  };

  const answered = await relayCall<{ answer?: string | null }>("receiver", "/talks", {
    method: "POST",
    body: { topic, turns: talk.turns, said: talk.said }
  });
  const words = answered.answer?.trim() ?? "";

  return words === "" ? null : words;
}
