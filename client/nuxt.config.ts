// The note console bundle as a layer: the 노트 screen, its components and the modules they stand on,
// on top of bmo-ui. A console extends it as it extends bmo-ui and attaches it by its declaration,
// `console-bundle.json` (bmo-ui's `docs/console-bundles.md`).
export default defineNuxtConfig({
  extends: ["bmo-ui"],
  compatibilityDate: "2025-09-01",
  devtools: { enabled: false }
});
