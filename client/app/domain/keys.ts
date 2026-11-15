// The notes screen's own keys (`docs/design.md`, 「The console surface」), read off a key press on its way
// down, before the editor sees it: Ctrl+K or Ctrl+P (⌘ on a Mac) opens the search, Ctrl+\ folds the
// navigator, Ctrl+L copies the open note's link. Ctrl+K is the editor's link key while the typing stands
// in a field or the document, so there it is left to them; the others answer wherever the focus stands.

/** What a key press asks of the screen, or null where it asks nothing of it. */
export type ScreenKey = "search" | "navigator" | "link";

/** The keys each ask is named by in a tooltip, as the library's key marks write them. */
export const SCREEN_KBDS: Record<ScreenKey, string[]> = {
  search: ["meta", "k"],
  navigator: ["meta", "\\"],
  link: ["meta", "l"]
};

/** Whether the typing stands in a field or an editable run of the document. */
export function typingIn(target: EventTarget | null): boolean {
  const element = target as { closest?: (selector: string) => unknown; tagName?: string } | null;

  if (element === null || typeof element.closest !== "function") return false;

  return element.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']") !== null;
}

/** What a key press asks of the screen. */
export function screenKeyOf(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing">, typing: boolean): ScreenKey | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.isComposing) return null;

  switch (event.key.toLowerCase()) {
    case "p":
      return "search";
    case "k":
      return typing ? null : "search";
    case "\\":
      return "navigator";
    case "l":
      return "link";
    default:
      return null;
  }
}
