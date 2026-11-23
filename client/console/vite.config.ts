import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { defineConfig } from "vite";
import { consoleBundle } from "bmo-ui/bundle/console-bundle.js";

import type { Plugin } from "vite";

// The served bundle's build (bmo-ui's `docs/console-bundles.md`): the pages' routes as one browser
// module, the utility classes they use as one stylesheet, and the language pack as one words object,
// all written into `dist/`, which the service answers under its manifest. bmo-ui's bundle build leaves
// the libraries the bundle shares with its console unbundled and writes the layer it was built on beside
// the module; the editor is built in (`docs/design.md`, 「The console surface」).

const root = fileURLToPath(new URL("..", import.meta.url));

// The component library's runtime as the install holds it, by its real path: the files a built-in editor
// component imports are read from there.
const LIBRARY_RUNTIME = realpathSync(join(root, "node_modules/@nuxt/ui/dist/runtime"));

const EDITOR_COMPONENT = /^@nuxt\/ui\/components\/(Editor[A-Za-z]*)\.vue$/u;
const SIBLING_COMPONENT = /^\.\/([A-Z][A-Za-z]*)\.vue$/u;

/**
 * Nuxt UI's editor components built into the bundle (`docs/design.md`, 「The console surface」). The console
 * shares the component library, but the editor's components carry TipTap and ProseMirror with them, and the
 * note's own extensions must stand on the very ProseMirror copy the editor runs; so the editor and its menus
 * are taken from the installed library's own files and built here with the bundle's TipTap, ahead of the
 * bundle build's sharing. Every other component they draw — a button, an icon — stays the console's shared
 * copy, as any bundle's does.
 */
function editorBuiltIn(): Plugin {
  return {
    name: "note-editor-built-in",
    enforce: "pre",
    resolveId(source, importer) {
      const editor = EDITOR_COMPONENT.exec(source);

      if (editor !== null) return join(LIBRARY_RUNTIME, "components", `${editor[1]}.vue`);

      const sibling = SIBLING_COMPONENT.exec(source);

      if (sibling !== null && importer?.startsWith(join(LIBRARY_RUNTIME, "components")) && !sibling[1]!.startsWith("Editor")) {
        return { id: `@nuxt/ui/components/${sibling[1]}.vue`, external: true };
      }

      return null;
    }
  };
}

// The layer's components, by the name a page writes them under.
const LAYER_COMPONENTS = new Set(readdirSync(join(root, "node_modules/bmo-ui/app/components")).map((file) => basename(file, ".vue")));

/** A component of the component library, written `U<Name>`, at its own path in the library. */
function libraryComponent(name: string) {
  return /^U[A-Z]/.test(name) ? { name: "default", from: `@nuxt/ui/components/${name.slice(1)}.vue` } : undefined;
}

/** A component of the layer at its own path in the layer. */
function layerComponent(name: string) {
  return LAYER_COMPONENTS.has(name) ? { name: "default", from: `bmo-ui/app/components/${name}.vue` } : undefined;
}

/** The language pack, one file to a locale, read as one object keyed by the locale's code. */
function readWords(): Record<string, Record<string, unknown>> {
  const folder = join(root, "i18n");
  const locales = readdirSync(folder).filter((file) => file.endsWith(".json")).sort();
  return Object.fromEntries(locales.map((file) => [basename(file, ".json"), JSON.parse(readFileSync(join(folder, file), "utf8"))]));
}

const WORDS = readWords();

/** The language pack written into the bundle's folder as its words. */
function words(): Plugin {
  return {
    name: "note-words",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "words.json", source: JSON.stringify(WORDS) });
    }
  };
}

export default defineConfig({
  // A built-in editor component reads the app's configuration through Nuxt's own import, which the console's
  // shared copy of Nuxt's app answers.
  resolve: {
    alias: [
      { find: "#build/app.config", replacement: join(root, "console/app-config.ts") },
      { find: "#build", replacement: join(root, ".nuxt") },
      { find: "#imports", replacement: join(root, "console/imports.ts") }
    ]
  },
  plugins: [
    editorBuiltIn(),
    consoleBundle({ name: "note", words: WORDS }),
    AutoImport({
      imports: [
        "vue",
        { "nuxt/app": ["navigateTo", "useAppConfig", "useFetch", "useHead", "useRoute", "useRouter", "useRuntimeConfig"] }
      ],
      dts: false
    }),
    Components({ dirs: [join(root, "app/components")], resolvers: [libraryComponent, layerComponent], dts: false }),
    vue(),
    tailwindcss(),
    words()
  ],
  // The target is one every console browser speaks.
  oxc: {
    target: "chrome120"
  },
  build: {
    target: "chrome120",
    outDir: join(root, "dist"),
    emptyOutDir: true,
    lib: { entry: join(root, "console/routes.ts"), formats: ["es"], fileName: () => "bundle.js", cssFileName: "bundle" }
  }
});
