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
  "the owner asks for, and keep every line the request does not change."
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
