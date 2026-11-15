import NoteScreen from "../app/pages/note/[[noteId]].vue";
import NoteShare from "../app/pages/note/share/[token].vue";

import "./screens.css";

import type { ConsoleBundleModule } from "bmo-ui/shared/console-manifest";

// The console bundle's module (bmo-ui's `docs/console-bundles.md`): the notes screen under the console's
// title bar, one route for `/note` and `/note/<id>` whose screen stays standing while the address changes
// (one key for every address it answers), and the share page a link opens, standing alone with no frame of
// the console's around it. The editor's own UI strings stand in BlockSuite; every word of the bundle's is a
// key under `note.` in its words (`docs/api.md`, 「Console」).
const bundle: ConsoleBundleModule = {
  routes: [
    { path: "/note/share/:token", name: "note-share", component: NoteShare, meta: { layout: false } },
    { path: "/note/:noteId?", name: "note", component: NoteScreen, meta: { key: "note", consoleTitleBar: true } }
  ]
};

export default bundle;
