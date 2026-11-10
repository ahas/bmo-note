import { expect, test } from "bun:test";

import { heldSelector, heldSelectorList } from "../app/domain/contain";

// The editor's stylesheets held to the editor (`docs/design.md`, 「The console surface」): a rule naming nothing of
// the editor's own is bound under its host; one naming the editor's own, or the page, stands as laid.

test("a bare element or a shared class is bound under the editor's host", () => {
  expect(heldSelector("input")).toBe(":where([data-note-editor]) input");
  expect(heldSelector("input:focus")).toBe(":where([data-note-editor]) input:focus");
  expect(heldSelector("input::placeholder")).toBe(":where([data-note-editor]) input::placeholder");
  expect(heldSelector(".truncate")).toBe(":where([data-note-editor]) .truncate");
});

test("a selector naming the editor's own element, class or attribute stands as laid", () => {
  for (const selector of ["affine-image-fallback-card", ".affine-attachment-container", "affine-drop-indicator .line", ".blocksuite-portal", "edgeless-toolbar-button, .shapes", "[data-block-id] > .x", "data-view-component-button.border:hover"]) {
    expect(heldSelector(selector)).toBe(selector.trim());
  }
});

test("the page-wide rules, which carry the editor's variables, stand as laid", () => {
  for (const selector of [":root", "html", "html.dark", "body", ":host"]) expect(heldSelector(selector)).toBe(selector);
});

test("a list is held part by part, a comma inside a function kept with its part", () => {
  expect(heldSelectorList("input, .affine-x, :is(a, b)")).toBe(":where([data-note-editor]) input, .affine-x, :where([data-note-editor]) :is(a, b)");
  expect(heldSelectorList(heldSelectorList("input"))).toBe(":where([data-note-editor]) input");
});
