import { describe, expect, test } from "bun:test";

import { historyDirectionOf } from "../app/domain/history";

// The note's undo road (`docs/design.md`, 「Editing and saving」): the chords the screen answers.

const key = (over: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean }> = {}) => ({
  key: "z",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over
});

describe("historyDirectionOf", () => {
  test("the bare history chords, on either modifier", () => {
    expect(historyDirectionOf(key({ ctrlKey: true }))).toBe("undo");
    expect(historyDirectionOf(key({ metaKey: true }))).toBe("undo");
    expect(historyDirectionOf(key({ ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(historyDirectionOf(key({ metaKey: true, shiftKey: true }))).toBe("redo");
  });

  test("the shifted letter arrives as its own capital", () => {
    // A real shifted key reads `Z`, not `z`.
    expect(historyDirectionOf(key({ key: "Z", ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(historyDirectionOf(key({ key: "Z", metaKey: true, shiftKey: true }))).toBe("redo");
  });

  test("Ctrl+Y redoes where the window speaks it, the Mac's road is Shift+Cmd+Z", () => {
    expect(historyDirectionOf(key({ key: "y", ctrlKey: true }))).toBe("redo");
    expect(historyDirectionOf(key({ key: "Y", ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(historyDirectionOf(key({ key: "y", metaKey: true }))).toBeNull();
  });

  test("no chord without the modifier, none beside it, none under the composing keyboard", () => {
    expect(historyDirectionOf(key())).toBeNull();
    expect(historyDirectionOf(key({ key: "x", ctrlKey: true }))).toBeNull();
    expect(historyDirectionOf(key({ ctrlKey: true, altKey: true }))).toBeNull();
    expect(historyDirectionOf(key({ metaKey: true, altKey: true }))).toBeNull();
    expect(historyDirectionOf(key({ ctrlKey: true, isComposing: true }))).toBeNull();
  });
});
