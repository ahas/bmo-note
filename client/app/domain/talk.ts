// The talk about one note (`docs/design.md`, 「The talk panel」): each turn one ask of the note service's Agent
// over the whole note, answered by the note assistant under the reader's own account. The screen keeps the turns
// of such a talk and names the talk, so the service carries each next turn into the session the last one answered
// on; every turn is still handed with the turns before it, for a turn whose session cannot go on. What comes back
// is either words alone, which change nothing, or one fenced block holding the whole edited note, which the patch
// applies a changed run at a time.

import { Refusal } from "./api";

import type { AgentAsk } from "./api";

/** One turn as the receiver reads it: whose it is and what it said. */
export interface TalkTurn {
  owner: boolean;
  text: string;
}

/** What one turn of a note's talk asks. */
export interface NoteTalk {
  /** The note as the talk asks over it: one line per block (`domain/text`). */
  lines: string[];
  /** The turns said before this one. */
  turns: TalkTurn[];
  said: string;
  /** The talk this turn is a round of, named as the talk began. */
  talk: string;
}

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

/** The Agent as the screen asks it: one ask, answered by its words or null where it said nothing. */
export type AgentCall = (ask: AgentAsk) => Promise<string | null>;

/** One turn of the note's talk: the whole note, what the reader says now and the turns before it. */
export function askNote(agent: AgentCall, talk: NoteTalk): Promise<string | null> {
  return agent({ mode: "note", lines: talk.lines, instruction: talk.said, turns: talk.turns, talk: talk.talk });
}

/** The pack's key for why an ask came back with no answer: no agent to ask, or none that answered. */
export function unansweredKey(error: unknown): string {
  return error instanceof Refusal && error.code === "no-agent" ? "note.talk.unanswered_agent" : "note.talk.unanswered";
}
