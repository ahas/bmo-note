// The phone's way onto a block (`docs/design.md`, 「On a phone a held finger in the gutter chooses a block
// whole」). The drag handle follows a pointer, which a touch screen has none of; the room left of the
// document's column, where that handle stands for a pointer, is where a finger holds instead, and the
// block standing at the hold's height is chosen whole — the same choice a press on the handle makes, so
// the same toolbar rises over it. The words are never touched here: a field's words keep the phone's own
// reading of a held finger, which is how they get chosen at all.

import { BlockSelection } from "@blocksuite/affine/std";

import type { BlockStdScope } from "@blocksuite/affine/std";

/** Where a finger stands on the screen. */
export interface GutterPoint {
  x: number;
  y: number;
}

// The note's own column of top-level blocks: its leading edge ends the gutter, and its children are the
// blocks a hold can choose.
const COLUMN = "affine-note > .affine-note-block-container > .affine-block-children-container";

/** The id of the block a point in the gutter stands beside: the one whose height the point falls on, or
 * the nearest one where it falls in the room between two. Null where the point stands over the column's
 * words, outside the document, or beside no block at all. */
export function gutterBlock(std: BlockStdScope, at: GutterPoint): string | null {
  const column = std.host.querySelector(COLUMN);
  const box = column?.getBoundingClientRect();

  if (column === null || box === undefined) return null;

  // Left of the column is the gutter; the screen's own left edge bounds it, and the column's top and
  // bottom bound what a hold beside it can reach.
  if (at.x >= box.left || at.x < 0 || at.y < box.top || at.y > box.bottom) return null;

  let nearest: string | null = null;
  let least = Number.POSITIVE_INFINITY;

  for (const one of column.children) {
    const blockId = one instanceof HTMLElement ? one.dataset.blockId : undefined;

    if (blockId === undefined) continue;

    const line = one.getBoundingClientRect();
    const gap = line.top > at.y ? line.top - at.y : at.y > line.bottom ? at.y - line.bottom : 0;

    if (gap < least) {
      least = gap;
      nearest = blockId;
    }
  }

  return nearest;
}

// How long after a hold the rest of its press is still turned away: the lift lands within a few frames,
// and nothing after that belongs to the hold.
const TURNED_AWAY_MS = 800;
// How far from where it landed the lift of a held finger may be and still be the same press: the
// distance the platform's own hold allows a finger to slide.
const PRESS_SLOP_PX = 10;

/** The press a hold answered with: the room its finger is answered in, and where it landed. */
export interface HeldPress {
  surface: HTMLElement;
  at: GutterPoint;
}

/** Stands `blockId` chosen whole in the editor, leaving no caret in its words, and spends the press that
 * held it. */
export function chooseWhole(std: BlockStdScope, blockId: string, press: HeldPress): void {
  std.selection.set([std.selection.create(BlockSelection, { blockId })]);
  std.host.ownerDocument.getSelection()?.removeAllRanges();

  // The rest of the press would be read beside the column as the editor's own doing with a blank room —
  // a caret handed to the nearest line of words, or the choice of a block that holds none — and either
  // would stand in place of what the finger chose. Only the press that held is turned away: the next tap,
  // wherever it lands, is its own, and the toolbar's keys must answer it.
  const turn = (event: Event): void => {
    const at = event as PointerEvent;

    if (Math.hypot(at.clientX - press.at.x, at.clientY - press.at.y) > PRESS_SLOP_PX) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    letGo();
  };

  const letGo = (): void => {
    clearTimeout(standing);
    press.surface.removeEventListener("pointerup", turn, true);
    press.surface.removeEventListener("click", turn, true);
  };

  const standing = setTimeout(letGo, TURNED_AWAY_MS);

  press.surface.addEventListener("pointerup", turn, true);
  press.surface.addEventListener("click", turn, true);
}
