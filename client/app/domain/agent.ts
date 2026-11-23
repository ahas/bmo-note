// The Agent (`docs/design.md`, 「Agent」): a passage of the note — the blocks a selection covers, or the block
// under the caret — handed to the note assistant with one rule, through the note service's Agent route the talk
// panel rides too. The answer is the result in the note's line grammar, which the screen shows under the passage
// before the reader places it.

import { fencedAnswer } from "./talk";

import type { AgentCall, TalkTurn } from "./talk";

/** The groups the menu lays the set actions in, in its order. */
export type AskGroup = "edit" | "translate" | "write";

/** One set action: its id (the menu's word is `note.agent.action.<id>`), its icon and the rule it states. */
export interface AskAction {
  id: string;
  group: AskGroup;
  icon: string;
  rule: string;
}

export const ASK_GROUPS: AskGroup[] = ["edit", "translate", "write"];

export const ASK_ACTIONS: AskAction[] = [
  { id: "improve", group: "edit", icon: "i-material-symbols-auto-fix-high", rule: "Improve the writing: clearer, tighter and more natural, with the meaning and the language unchanged." },
  { id: "spelling", group: "edit", icon: "i-material-symbols-spellcheck", rule: "Fix the spelling and the spacing alone; change nothing else." },
  { id: "grammar", group: "edit", icon: "i-material-symbols-rule", rule: "Fix the grammar and the punctuation alone; change nothing else." },
  { id: "longer", group: "edit", icon: "i-material-symbols-expand", rule: "Make the passage longer, adding detail that follows from what it already says." },
  { id: "shorter", group: "edit", icon: "i-material-symbols-compress", rule: "Make the passage shorter, keeping every point it makes." },
  { id: "plain", group: "edit", icon: "i-material-symbols-sentiment-satisfied-outline", rule: "Rewrite the passage in a plain, friendly tone." },
  { id: "formal", group: "edit", icon: "i-material-symbols-business-center-outline", rule: "Rewrite the passage in a formal, professional tone." },
  { id: "korean", group: "translate", icon: "i-material-symbols-translate", rule: "Translate the passage into Korean." },
  { id: "english", group: "translate", icon: "i-material-symbols-translate", rule: "Translate the passage into English." },
  { id: "japanese", group: "translate", icon: "i-material-symbols-translate", rule: "Translate the passage into Japanese." },
  { id: "continue", group: "write", icon: "i-material-symbols-edit-note-outline", rule: "Write what comes next after the passage, in its language and voice. The result is the new text alone, without the passage." },
  { id: "summarize", group: "write", icon: "i-material-symbols-summarize-outline", rule: "Summarize the passage in its language, as a few bulleted items." },
  { id: "explain", group: "write", icon: "i-material-symbols-help-outline", rule: "Explain the passage in its language for a reader who meets it for the first time." },
  { id: "outline", group: "write", icon: "i-material-symbols-format-list-bulleted", rule: "Write an outline of the passage in its language, as headings and bulleted items." },
  { id: "brainstorm", group: "write", icon: "i-material-symbols-lightbulb-outline", rule: "Brainstorm ideas that grow from the passage, in its language, as bulleted items." }
];

/** One ask: the passage and what is done to it. */
export interface PassageAsk {
  /** The passage as lines in the note's grammar (`domain/text`). */
  passage: string[];
  instruction: string;
  /** The earlier rounds over the same passage. */
  turns: TalkTurn[];
}

/** What came back: the result as lines where it carries a fenced block, and the answer's words always. */
export interface AskAnswer {
  lines: string[] | null;
  words: string;
}

/** One round of the Agent over a passage; null where it said nothing. */
export async function askPassage(agent: AgentCall, ask: PassageAsk): Promise<AskAnswer | null> {
  const words = await agent({ mode: "passage", lines: ask.passage, instruction: ask.instruction, turns: ask.turns });

  return words === null ? null : { lines: fencedAnswer(words), words };
}
