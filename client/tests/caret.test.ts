import { describe, expect, test } from "bun:test";

import { CARET_ROOM, caretScroll } from "../app/domain/caret";

// The caret kept in sight as words are written (docs/design.md, 「Editing and saving」): the scroll moves down for a
// caret past its foot, up for one above its head, and not at all for one in sight, the room kept either way.
describe("the scroll a caret asks for", () => {
  const scroll = { top: 100, bottom: 700 };

  test("is none while the caret stands in sight", () => {
    expect(caretScroll({ top: 300, bottom: 320 }, scroll)).toBe(0);
  });

  test("moves down for a caret a new line carried past the foot, keeping the room under it", () => {
    expect(caretScroll({ top: 690, bottom: 712 }, scroll)).toBe(712 + CARET_ROOM - 700);
  });

  test("moves up for a caret above the head, keeping the room over it", () => {
    expect(caretScroll({ top: 80, bottom: 100 }, scroll)).toBe(80 - CARET_ROOM - 100);
  });

  test("keeps the top of a caret taller than the scroll", () => {
    expect(caretScroll({ top: 650, bottom: 1400 }, scroll)).toBe(650 - CARET_ROOM - 100);
  });
});
