// The console's screen mode, carried to the editor (`docs/design.md`, 「The console surface」). The
// bundle's chrome draws from the console's tokens and needs nothing; the vendored editor reads its
// colours by a `data-theme` attribute of the document element — its theme service watches the
// attribute and the vendored stylesheet states both modes under it — so the bundle mirrors the
// console's mode there and the document switches as the console's own screens do.

import { watch } from "vue";
import { useDarkScheme } from "bmo-ui/app/domain/scheme";

/** State the console's screen mode on the document element for the calling component's lifetime. It
 * stands at once, before the editor mounts, and follows every switch the console makes after. */
export function followScreenMode(): void {
  const dark = useDarkScheme();

  watch(dark, (isDark) => {
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
  }, { immediate: true });
}
