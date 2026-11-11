import { describe, expect, test } from "bun:test";

import { asOneStep, historyDirectionOf, stepHistory } from "../app/domain/history";

// The note's undo road (`docs/design.md`, 「Editing and saving」): the chords the screen answers,
// the step that moves the history only where it can, and the one transaction a whole change lands
// in. The shapes below stand for the key events and the document the fork hands.

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

describe("stepHistory", () => {
  const history = (canUndo: boolean, canRedo: boolean) => {
    const moved: string[] = [];

    return {
      canUndo,
      canRedo,
      undo: () => moved.push("undo"),
      redo: () => moved.push("redo"),
      moved
    };
  };

  test("the step moves the history where it can and says so", () => {
    const open = history(true, false);

    expect(stepHistory(open, "undo")).toBe(true);
    expect(open.moved).toEqual(["undo"]);
    expect(stepHistory(open, "redo")).toBe(false);
    expect(open.moved).toEqual(["undo"]);
  });

  test("a history with nothing to take back stands still", () => {
    const fresh = history(false, true);

    expect(stepHistory(fresh, "undo")).toBe(false);
    expect(stepHistory(fresh, "redo")).toBe(true);
    expect(fresh.moved).toEqual(["redo"]);
  });
});

describe("asOneStep", () => {
  test("the work rides one transaction under the document's own origin", () => {
    const origins: unknown[] = [];
    const doc = {
      clientID: 77,
      transact: <T>(work: () => T, origin: unknown): T => {
        origins.push(origin);

        return work();
      }
    };

    const wrote = asOneStep(doc, () => {
      // Two writes, one step: the transaction is what groups them.
      origins.push("first");
      origins.push("second");

      return 3;
    });

    expect(origins).toEqual([77, "first", "second"]);
    expect(wrote).toBe(3);
  });

  test("what the work throws stands rethrown, so the panel can say the apply failed", () => {
    const doc = {
      clientID: 1,
      transact: <T>(work: () => T): T => work()
    };

    expect(() => asOneStep(doc, () => { throw new Error("the note holds no note container"); })).toThrow("the note holds no note container");
  });
});
