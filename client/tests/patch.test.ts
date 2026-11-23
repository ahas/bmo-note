import { describe, expect, test } from "bun:test";

import { planPatch, planWhole } from "../app/domain/patch";

// The context-anchored patch (`docs/design.md`, 「The talk panel」): the talk's changed runs land
// where the note moved them, and a run the reader changed meanwhile stops the whole plan.

describe("planPatch", () => {
  test("a changed line lands where it stood", () => {
    expect(planPatch(["a", "b", "c"], ["a", "B", "c"], ["a", "b", "c"])).toEqual({ ok: true, ops: [{ at: 1, del: 1, insert: ["B"] }] });
  });

  test("a line the reader added elsewhere is left alone", () => {
    const plan = planPatch(["a", "b", "c"], ["a", "B", "c"], ["z", "a", "b", "c"]);

    expect(plan).toEqual({ ok: true, ops: [{ at: 2, del: 1, insert: ["B"] }] });
  });

  test("a line the reader added after the run does not stop it", () => {
    expect(planPatch(["a", "b"], ["A", "b"], ["a", "x", "b"])).toEqual({ ok: true, ops: [{ at: 0, del: 1, insert: ["A"] }] });
  });

  test("a line the reader added before the run does not stop it", () => {
    expect(planPatch(["a", "b"], ["A", "b"], ["x", "a", "b"])).toEqual({ ok: true, ops: [{ at: 1, del: 1, insert: ["A"] }] });
  });

  test("a line the reader changed inside the run stops the plan", () => {
    expect(planPatch(["a", "b", "c"], ["a", "B", "c"], ["a", "q", "c"])).toEqual({ ok: false, why: "owner" });
  });

  test("a context the note no longer carries stops the plan", () => {
    expect(planPatch(["a", "b", "c"], ["a", "B", "c"], ["q", "w", "e"])).toEqual({ ok: false, why: "anchor" });
  });

  test("an added line lands between the lines around it", () => {
    expect(planPatch(["a", "b"], ["a", "x", "b"], ["a", "b"])).toEqual({ ok: true, ops: [{ at: 1, del: 0, insert: ["x"] }] });
  });

  test("a removed line takes only itself", () => {
    expect(planPatch(["a", "b", "c"], ["a", "c"], ["a", "b", "c"])).toEqual({ ok: true, ops: [{ at: 1, del: 1, insert: [] }] });
  });

  test("an image or a table is never swallowed", () => {
    expect(planPatch(["a", "[[image]]", "b"], ["a", "b"], ["a", "[[image]]", "b"])).toEqual({ ok: false, why: "opaque" });
    expect(planPatch(["a", "[[table]]", "b"], ["a", "b"], ["a", "[[table]]", "b"])).toEqual({ ok: false, why: "opaque" });
  });

  test("an answer that changes nothing plans nothing", () => {
    expect(planPatch(["a", "b"], ["a", "b"], ["x", "a", "b"])).toEqual({ ok: true, ops: [] });
  });
});

describe("planWhole", () => {
  test("a body with no opaque lines places nothing and blocks nothing", () => {
    expect(planWhole(["a", "b"], ["A", "b", "c"])).toEqual({ places: [] });
  });

  test("an image standing between changed lines keeps its place in the new body", () => {
    expect(planWhole(["a", "[[image]]", "b"], ["A", "[[image]]", "B"])).toEqual({ places: [{ at: 1, into: 1, depth: 0 }] });
  });

  test("two images and a table pair by kind and order, wherever the answer moves the words", () => {
    const base = ["[[image]]", "a", "[[table]]", "[[image]]"];
    const next = ["[[image]]", "[[table]]", "[[image]]", "A"];

    expect(planWhole(base, next)).toEqual({
      places: [
        { at: 0, into: 0, depth: 0 },
        { at: 2, into: 1, depth: 0 },
        { at: 3, into: 2, depth: 0 }
      ]
    });
  });

  test("an answer that drops an image places nothing", () => {
    expect(planWhole(["a", "[[image]]", "b"], ["A", "B"])).toEqual({ ok: false });
  });

  test("an answer that draws an image the note does not hold places nothing", () => {
    expect(planWhole(["a"], ["a", "[[image]]"])).toEqual({ ok: false });
  });

  test("an answer that moves an image to a deeper place than the note holds it places nothing", () => {
    expect(planWhole(["  [[image]]"], ["[[image]]"])).toEqual({ ok: false });
  });

  test("a table answering an image line places nothing", () => {
    expect(planWhole(["[[image]]"], ["[[table]]"])).toEqual({ ok: false });
  });
});
