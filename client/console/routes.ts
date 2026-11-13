import NoteIndex from "../app/pages/note/index.vue";
import NotePage from "../app/pages/note/[noteId].vue";
import NoteShare from "../app/pages/note/share/[token].vue";

import "./screens.css";

import type { ConsoleBundleModule } from "bmo-ui/shared/console-manifest";

// The console bundle's module (bmo-ui's `docs/console-bundles.md`): the notes list and one note open,
// under the console's title bar, and the share page a link opens, standing alone with no frame of the
// console's around it. The editor's own UI strings stand in BlockSuite; every word of the
// bundle's is a key under `note.` in its words (`docs/api.md`, 「Console」).
const bundle: ConsoleBundleModule = {
  routes: [
    { path: "/note", name: "note", component: NoteIndex, meta: { consoleTitleBar: true } },
    { path: "/note/share/:token", name: "note-share", component: NoteShare, meta: { layout: false } },
    {
      path: "/note/:noteId",
      name: "note-editor",
      component: NotePage,
      meta: { key: (route: { params: { noteId?: string } }) => `note-${String(route.params.noteId)}`, consoleTitleBar: true }
    }
  ]
};

export default bundle;
