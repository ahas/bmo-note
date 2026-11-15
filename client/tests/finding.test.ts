import { describe, expect, test } from "bun:test";

import { askOf, asksAnything, emptyFinding, findingOf, markedTerm, queryOfFinding, sinceOf, withFinding } from "../app/domain/finding";
import { screenKeyOf } from "../app/domain/keys";
import { plainText } from "../app/domain/plain";

import type { FoundNote } from "../shared/types";

// The search as the address carries it (docs/design.md, 「Search」), the screen's own keys, and the plain
// text a save carries (docs/design.md, 「What a note is」).

describe("the search in the address", () => {
  test("stands only where the address names one, its defaults left out", () => {
    expect(findingOf({})).toBeNull();
    expect(findingOf({ search: "" })).toEqual(emptyFinding());
    expect(queryOfFinding({ ...emptyFinding(), words: "plan" })).toEqual({ search: "plan" });

    const full = { words: "plan", sort: "changed" as const, views: ["mine" as const, "trash" as const], titleOnly: true, span: "7d" as const };

    expect(queryOfFinding(full)).toEqual({ search: "plan", sort: "changed", in: "mine,trash", title: "1", since: "7d" });
    expect(findingOf(queryOfFinding(full))).toEqual(full);
  });

  test("is put in and taken out of a query beside the screen's own keys", () => {
    const query = { owner: "2", search: "old", sort: "created" };

    expect(withFinding(query, null)).toEqual({ owner: "2" });
    expect(withFinding(query, { ...emptyFinding(), words: "new" })).toEqual({ owner: "2", search: "new" });
  });

  test("asks the service from the span's start, and asks nothing of quotes alone", () => {
    const now = new Date(2026, 10, 16, 15, 30);

    expect(sinceOf("any", now)).toBeNull();
    expect(sinceOf("today", now)).toBe(new Date(2026, 10, 16).getTime());
    expect(sinceOf("7d", now)).toBe(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(askOf({ ...emptyFinding(), words: "  plan " }, now)).toEqual({ q: "plan", views: ["mine", "shared"], titleOnly: false, since: null, sort: "best", after: 0, limit: 20 });
    expect(asksAnything({ ...emptyFinding(), words: '""' })).toBe(false);
  });

  test("marks the first run the service found, in the text before the title", () => {
    const found = { title: "Weekly plan", titleHits: [[7, 11]], snippet: { text: "the plan stands", hits: [[4, 8]] } } as unknown as FoundNote;

    expect(markedTerm(found)).toBe("plan");
    expect(markedTerm({ ...found, snippet: null })).toBe("plan");
    expect(markedTerm({ ...found, snippet: null, titleHits: [] })).toBeNull();
  });
});

describe("the screen's keys", () => {
  const press = (key: string, over: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, isComposing: false, ...over });

  test("open the search, fold the navigator and copy the link, Ctrl+K left to a field or the document", () => {
    expect(screenKeyOf(press("k"), false)).toBe("search");
    expect(screenKeyOf(press("k"), true)).toBeNull();
    expect(screenKeyOf(press("p"), true)).toBe("search");
    expect(screenKeyOf(press("\\", { ctrlKey: false, metaKey: true }), true)).toBe("navigator");
    expect(screenKeyOf(press("l"), true)).toBe("link");
    expect(screenKeyOf(press("k", { ctrlKey: false }), false)).toBeNull();
    expect(screenKeyOf(press("k", { shiftKey: true }), false)).toBeNull();
    expect(screenKeyOf(press("p", { isComposing: true }), false)).toBeNull();
  });
});

describe("the plain text", () => {
  test("is each block's words, its line mark taken off, the wordless blocks dropped", () => {
    expect(plainText(["# Plan", "- milk", "[[image]]", "  1. two", "> quote", ""])).toBe("Plan\nmilk\ntwo\nquote");
  });
});
