import { describe, expect, test } from "bun:test";

import { planPatch } from "../app/domain/patch";

// The context-anchored patch (`docs/design.md`, 「The AI talk panel」): the talk's changed runs land
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
