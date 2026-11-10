// The context-anchored patch of the AI talk (`docs/design.md`, 「The AI talk panel」). The base lines
// are what the talk was asked over, the next lines what the supervisor returned, and the current
// lines what the note holds now — the reader may have gone on typing while the supervisor thought.
// The agent's edits are taken from the base→next diff and applied to the current lines, each run
// anchored by the unchanged lines around it and located where the note moved them. An edit whose
// anchor the note no longer carries, one that lands on lines the reader changed meanwhile, or one
// that would swallow an image or a table fails the whole plan: the note is patched as a piece or
// not at all.

import { opaqueLine } from "./text";

/** One replacement of the current lines: `del` lines at `at` give way to `insert`. */
export interface Op {
  at: number;
  del: number;
  insert: string[];
}

export type Plan = { ok: true; ops: Op[] } | { ok: false; why: Why };

/** Why a plan came apart, as the panel names it. */
export type Why = "anchor" | "owner" | "opaque" | "big";

/** How many unchanged lines a run leans on, and how far an anchor is chased from where it stands. */
const CONTEXT = 2;
const WINDOW = 400;
const MAX_SIDE = 3000;

/** One changed run of the base: lines [from,to) give way to `insert`. */
interface Run {
  from: number;
  to: number;
  insert: string[];
}

/** The plan of the talk's edit, over the three readings of the note. */
export function planPatch(base: string[], next: string[], current: string[]): Plan {
  // What every reading shares at the front and the end needs no diff and no anchor.
  let from = 0;

  while (from < base.length && from < next.length && base[from] === next[from]) from += 1;

  let baseTo = base.length;
  let nextTo = next.length;

  while (baseTo > from && nextTo > from && base[baseTo - 1] === next[nextTo - 1]) {
    baseTo -= 1;
    nextTo -= 1;
  }

  if (baseTo - from > MAX_SIDE || nextTo - from > MAX_SIDE) return { ok: false, why: "big" };

  const runs = runsOf(base.slice(from, baseTo), next.slice(from, nextTo), from);

  if (runs.length === 0) return { ok: true, ops: [] };

  const ops: Op[] = [];
  let shift = 0;

  for (const run of runs) {
    const removed = base.slice(run.from, run.to);
    const before = base.slice(Math.max(0, run.from - CONTEXT), run.from);
    const after = base.slice(run.to, Math.min(base.length, run.to + CONTEXT));

    if (removed.some(opaqueLine) || run.insert.some(opaqueLine)) return { ok: false, why: "opaque" };

    const wanted = run.from + shift;
    const place = anchorAt(current, removed, before, after, wanted);

    if (place === null) return { ok: false, why: "anchor" };
    if (place === "changed") return { ok: false, why: "owner" };

    ops.push({ at: place, del: removed.length, insert: run.insert });
    shift += run.insert.length - removed.length;
  }

  return { ok: true, ops };
}

/** The changed runs of one middle, from the base→next line diff. */
function runsOf(left: string[], right: string[], offset: number): Run[] {
  const kept = common(left, right);

  const runs: Run[] = [];
  let at = 0;
  let to = 0;

  while (at < left.length || to < right.length) {
    while (at < left.length && kept.left.has(at)) {
      at += 1;
      to += 1;
    }

    const from = at;
    const insert: string[] = [];

    while (at < left.length && !kept.left.has(at)) at += 1;
    while (to < right.length && !kept.right.has(to)) {
      insert.push(right[to] as string);
      to += 1;
    }

    if (at > from || insert.length > 0) runs.push({ from: from + offset, to: at + offset, insert });
  }

  return runs;
}

/** Which lines of each side stand common, by longest common subsequence. */
function common(left: string[], right: string[]): { left: Set<number>; right: Set<number> } {
  const keptLeft = new Set<number>();
  const keptRight = new Set<number>();

  const rows = left.length;
  const columns = right.length;
  const stride = columns + 1;
  const table = new Int32Array((rows + 1) * stride);

  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      table[row * stride + column] =
        left[row] === right[column] ? (table[(row + 1) * stride + column + 1] ?? 0) + 1 : Math.max(table[(row + 1) * stride + column] ?? 0, table[row * stride + column + 1] ?? 0);
    }
  }

  let row = 0;
  let column = 0;

  while (row < rows && column < columns) {
    if (left[row] === right[column]) {
      keptLeft.add(row);
      keptRight.add(column);
      row += 1;
      column += 1;
    } else if ((table[(row + 1) * stride + column] ?? 0) >= (table[row * stride + column + 1] ?? 0)) row += 1;
    else column += 1;
  }

  return { left: keptLeft, right: keptRight };
}

/**
 * Where the run stands in the current lines, `changed` where its frame stands but its own lines do not,
 * or null where neither does. The run's own lines are read first: the owner may have added lines on
 * either side of it, and it still lands where those lines stand. Only where the run itself is gone is
 * the frame around it read, and a frame whose middle differs is the owner's own hand.
 */
function anchorAt(current: string[], removed: string[], before: string[], after: string[], wanted: number): number | "changed" | null {
  if (before.length === 0 && after.length === 0 && removed.length === 0) return wanted <= current.length ? wanted : null;

  // The run itself, where its own lines and the lines before it still stand. The after lines decide
  // only which such place is preferred, not whether the run is there: the owner may have added a line
  // between the run and what followed it.
  let strong: number | null = null;
  let strongGap = Number.POSITIVE_INFINITY;
  let strongTie = false;
  let weak: number | null = null;
  let weakGap = Number.POSITIVE_INFINITY;
  let weakTie = false;

  const runLow = Math.max(before.length, wanted - WINDOW);
  const runHigh = Math.min(current.length - removed.length, wanted + WINDOW);

  for (let at = runLow; at <= runHigh; at += 1) {
    if (!sameLines(current, at - before.length, before)) continue;
    if (!sameLines(current, at, removed)) continue;

    const gap = Math.abs(at - wanted);

    if (sameLines(current, at + removed.length, after)) {
      if (gap < strongGap) {
        strong = at;
        strongGap = gap;
        strongTie = false;
      } else if (gap === strongGap) strongTie = true;
    } else if (removed.length > 0) {
      if (gap < weakGap) {
        weak = at;
        weakGap = gap;
        weakTie = false;
      } else if (gap === weakGap) weakTie = true;
    }
  }

  if (strong !== null) return strongTie ? null : strong;
  if (removed.length === 0) return null;
  if (weak !== null) return weakTie ? null : weak;

  // The run's own lines stand nowhere: where the frame around them still stands, the reader changed
  // the middle of the run; where the frame is gone too, there is nothing to anchor on.
  let framed: number | null = null;
  let frameGap = Number.POSITIVE_INFINITY;
  let framedTie = false;

  const frameLow = Math.max(before.length, wanted - WINDOW);
  const frameHigh = Math.min(current.length - removed.length - after.length, wanted + WINDOW);

  for (let at = frameLow; at <= frameHigh; at += 1) {
    if (!sameLines(current, at - before.length, before)) continue;
    if (!sameLines(current, at + removed.length, after)) continue;

    const gap = Math.abs(at - wanted);

    if (gap < frameGap) {
      framed = at;
      frameGap = gap;
      framedTie = false;
    } else if (gap === frameGap) {
      framedTie = true;
    }
  }

  if (framed === null || framedTie) return null;

  return "changed";
}

function sameLines(lines: string[], at: number, run: string[]): boolean {
  if (at < 0 || at + run.length > lines.length) return false;

  return run.every((line, offset) => lines[at + offset] === line);
}
