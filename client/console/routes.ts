import NoteIndex from "../app/pages/note/index.vue";
import NotePage from "../app/pages/note/[noteId].vue";

import "@toeverything/theme/style.css";
import "./screens.css";

import type { ConsoleBundleModule } from "bmo-ui/shared/console-manifest";

// The console bundle's module (bmo-ui's `docs/console-bundles.md`): the notes list and one note open,
// under the console's title bar. The editor's own UI strings stand in BlockSuite; every word of the
// bundle's is a key under `note.` in its words (`docs/api.md`, 「Console」).
const bundle: ConsoleBundleModule = {
  routes: [
    { path: "/note", name: "note", component: NoteIndex, meta: { consoleTitleBar: true } },
    {
      path: "/note/:noteId",
      name: "note-editor",
      component: NotePage,
      meta: { key: (route: { params: { noteId?: string } }) => `note-${String(route.params.noteId)}`, consoleTitleBar: true }
    }
  ]
};

export default bundle;
