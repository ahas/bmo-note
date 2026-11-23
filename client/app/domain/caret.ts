// Keeping the caret in sight as words are written (docs/design.md, 「Editing and saving」). The editor's own
// scrolling measures the caret against its viewport, which is as tall as the document, while the scroll a
// reader sees is the host's around it; so this screen moves the host itself.

/** The room kept between the caret and the scroll's edge, in pixels. */
export const CARET_ROOM = 24;

/** The top and bottom of a box on the screen. */
export interface Span {
  top: number;
  bottom: number;
}

/**
 * How far the scroll moves so the caret stands inside it with the room kept: down where the caret stands past its
 * foot, up where it stands above its head, none where it is in sight. A caret taller than the scroll keeps its top.
 */
export function caretScroll(caret: Span, scroll: Span, room: number = CARET_ROOM): number {
  const height = scroll.bottom - scroll.top;
  const top = caret.top - room;
  const bottom = caret.bottom + room;

  if (caret.bottom - caret.top + 2 * room >= height) return top - scroll.top;
  if (bottom > scroll.bottom) return bottom - scroll.bottom;
  if (top < scroll.top) return top - scroll.top;

  return 0;
}

/** Where the caret stands on the screen: the selection's collapsed range, or the line holding it where the range
 * draws nothing, as on an empty new line. None where no selection stands inside `within`. */
export function caretSpan(within: HTMLElement): Span | null {
  const selection = document.getSelection();

  if (selection === null || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);

  if (!within.contains(range.endContainer)) return null;

  const drawn = [...range.getClientRects()].at(-1);

  if (drawn !== undefined && drawn.height > 0) return { top: drawn.top, bottom: drawn.bottom };

  const node = range.endContainer;
  const element = node instanceof Element ? node : node.parentElement;
  const box = element?.getBoundingClientRect();

  return box === undefined || box.height === 0 ? null : { top: box.top, bottom: box.bottom };
}

/** Moves `scroll` so the caret stands in sight, once the editor has drawn what was just written. */
export function keepCaretInSight(scroll: HTMLElement): void {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const caret = caretSpan(scroll);

      if (caret === null) return;

      const box = scroll.getBoundingClientRect();
      const moved = caretScroll(caret, { top: box.top, bottom: box.bottom });

      if (moved !== 0) scroll.scrollTop += moved;
    })
  );
}
