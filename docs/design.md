# bmo-note

The note unit keeps the platform's editable notes: a person opens the console, writes a note,
closes the tab, and finds it again. Each note is one BlockSuite document, the editor of AFFiNE;
the unit stores the document's bytes and its own metadata, and shows the notes through a console
bundle under its sidebar entry. `docs/api.md` states the boundary and `docs/affine.md` what was
studied of AFFiNE and under which licence.

## Where the idea came from, and what was not taken

- The unit answers the same need AFFiNE serves — rich documents a person owns — but it does not run
  AFFiNE's application or its server. AFFiNE's server is a NestJS + Prisma + GraphQL + Socket.IO stack
  on PostgreSQL and Redis whose source stands under the Enterprise Edition licence; the Community
  Edition path cannot be vendored or derived for a BMO unit. What is borrowed instead is the *editor*,
  the MIT BlockSuite tree this repository forks, and the CE *mechanism* of storing whole Yjs documents
  as binary state.
- The platform pattern the unit follows is bmo-calendar: a service answering a loopback port, a console
  plugin bundle built as its own project, its own settings file under the data root, its own user unit,
  its own data directory, and its own `testbed.toml`.

## What a note is

- A note is one BlockSuite document: a `Store` (a Yjs document with the AFFiNE block schema) holding a
  root block, a note container and text blocks. The unit treats the document as opaque bytes: the
  client serialises it with `Y.encodeStateAsUpdate` and loads it back with `Y.applyUpdate`; the service
  never parses blocks, only stores the byte blob with its metadata.
- Metadata the service does read: an id, a title, a version, creation and change moments, a deleted
  mark, and the byte size. The title is written by the client on each save: the document's own title
  where it stands, else the first line of its content, so the list answers titles without opening the
  bytes.
- The document's own format belongs to BlockSuite. An upgrade of the editor may read documents the old
  one wrote (the schema carries its versions); the unit adds no format of its own.

## Who owns a note

- Every note belongs to one console account, keyed by the `Owner-Key` the console sets on relayed
  calls. An account reads and writes only its own notes; a service-token call names the account it
  acts for with an `owner` query. Notes are not shared between accounts, and there is no organization
  realm, no roles beyond the manifest's member floor, and no share page; each is a follow-up row, not
  a withheld v1 feature.

## Editing and saving

- The editor mounts in the browser only: the console bundle creates an empty document, edits it and
  autosaves it to the service. There is no realtime collaboration: one writer at a time per note is
  the v1 truth. A concurrent writer is refused, not merged:
  - each save names the version it was made from; a stored version past that answers `version-conflict`
    with the current metadata, and the screen offers the reader a reload;
  - autosave is debounced on the document's update events, and an unsaved state is marked on the screen.
- The full current state is stored on each save, replacing the previous bytes. Incremental
  update logs, the shape AFFiNE's server keeps, are not copied: a note this small does not earn them,
  and whole-state saves keep the service's one table and one version number honest.

## Storage

- One SQLite file under the unit's data directory holds two tables: each note's owner, id, title, doc
  bytes, version, timestamps, and deleted mark, and each attachment's note, id, type and bytes. An
  attachment is an image only: the editor uploads one to its note's blob route before an image block
  stands, and reads it back through the same route, so no block ever stands on bytes the service does
  not hold. The document itself never carries image bytes; the cap on one stored document leaves the
  document's own text and structure.
- A purge takes the note and its blobs together. A save that drops an image leaves its bytes standing
  until the note goes: the store collects no garbage of its own.
- A deletion moves the note to a trash list; a restore moves it back; a purge deletes the row and is
  open for a trashed note only. Nothing else deletes a note.
- A stored document is capped at a setting (`[notes] max_doc_bytes`); a save past the cap is refused
  `too-large` and the editor keeps its unsaved state on screen.

## Events

- The service publishes `note.saved`, `note.trashed`, `note.restored` and `note.purged`, each naming
  its note and its owner, kept in the same in-memory ring every platform service keeps and answered
  over the common stream route. The console bundle subscribes through the console and refreshes the
  open list. A restart loses the ring, as every unit's does.

## The AI talk panel

- An open note offers a panel in which the reader talks with the supervisor of his account about that
  one note. The panel is the note screen's own; the talk rides the receiver's one-turn road
  (`POST /talks`), which the console relays because the bundle's manifest names the receiver under
  `calls`. The receiver keeps no turns of such a talk, so the panel holds the conversation and hands
  each turn with the turns before it, as the console's own talk panels do.
- The panel is named for the talk alone, with no subtitle under its name. Docked, it stands at a
  width the reader drags at its leading edge or steps with the arrow keys, between its bounds, and the
  width is kept in that browser. The reader writes in the console's chat prompt.
- The talk is scoped to the open note: the topic names the note by id and title and carries the note's
  whole current body as a line list; the title stands in the topic beside it and no line changes it.
  The supervisor answers with that same line list edited — one fenced block holding the whole new
  text, in the protocol the panel's own heading states. The note never stands rewritten by a partial
  answer: where the fenced text is missing the panel shows the answer as words and changes nothing.
- The unit's service sees no AI route. The service keeps the document opaque (its standing rule), and
  the supervisor never touches its bytes: a returned text reaches the note through the open editor's
  own save, at the same versioned door every edit goes through. This is the chosen shape of "the
  supervisor edits the note through the unit's API": the supervisor's words enter the note through the
  unit's save route, and the one party that can write BlockSuite bytes stands on the client.
- A change lands as a patch, never a dump: the panel diffs the returned lines against the base lines
  the talk was asked over and applies the changed ranges to the current document, each range anchored
  by the untouched lines around it. The runs are written into the open editor's document as they come,
  so the screen shows them without a reload and the editor's own autosave carries them through the
  versioned save. The path to the screen is the editor's own document, not the event stream, since
  the client is the one party that writes BlockSuite bytes.
- An owner's edit elsewhere stands untouched through it; a range the anchoring cannot find, or one
  that would swallow a table or an image, fails the whole patch, and the panel says so in one line.
  The reader may then retry, or apply the text outright from the panel's own replace action, which
  says plainly that it overwrites what stands under it. That fallback writes plain lines alone: a
  note holding an image or a table is not rewritten outright, since no line brings either back.
- The panel is docked beside the note on a wide viewport — a column of its own, parted from the
  document by one line — so the note keeps its width and the reader may go on writing while the
  answer comes; below that width it rises from the bottom edge as a drawer. Its key stands at the
  format bar's trailing edge, and the panel closes by its own close key. A turn whose panel is closed still stands, and its change
  lands in the note. The talk is kept in the screen's memory alone: leaving the note drops it, the
  record of the talk is the note's own saved states.

## Ask AI

- Ask AI acts on a passage: the blocks the selection covers, the block under the caret where nothing
  is selected, or the whole note where the editor holds neither. It is reached from the selection toolbar the editor
  floats over a selection and from the format bar's own AI key, both opening the one menu under the
  passage.
- The menu offers set actions in groups — edit (improve the writing, fix spelling, fix grammar, make
  it longer, make it shorter, a plainer or a more formal tone), translate (Korean, English, Japanese),
  and write from it (continue writing, summarize, explain, an outline, brainstorm ideas) — and a line
  in which the reader asks in his own words. Each set action is a rule the bundle states in English;
  the menu shows it in the reader's language.
- The ask rides the same receiver road as the talk panel, as a one-turn talk whose topic carries the
  note's id and title, the action's rule and the passage in the note's line grammar. The answer is
  one fenced block in that grammar; an answer with none is shown as words and offers nothing to place.
- The result stands under the passage before anything changes. The reader replaces the passage with
  it, inserts it below the passage, asks again, asks a further change in his own words, or discards
  it. A placed result enters the document through the same run writer the talk's patch uses, so the
  editor's own autosave carries it. A passage holding an image or a table is never replaced, since no
  line brings either back; its result can still be inserted below.
- The ask's turns are held while the result stands and dropped when it is placed or discarded; the
  service sees no AI route, as for the talk panel.

## The console surface

- The bundle follows bmo-ui's console plugin contract: a manifest at `/console-manifest`, a built
  module and stylesheet at digested paths, and words at `/console/words`, guarded by the console's
  credential and the member role, with an owner key on every call the screens make. The manifest
  names one other service under `calls` — the receiver, which the AI talk panel speaks through — and
  the bundle calls nothing else beside its own service.
- Two screens stand under `/note`: the list and the editor (`/note/<id>`).
  - The list's head names the screen where the console draws no bar, and carries the view switch
    between the live notes and the trash and the key that makes a new note. Its rows stand newest
    changed first, each with the note's title on its own line and, under it, what the note holds —
    its stored size — and the moment it changed (the moment it went to the trash, in the trash
    view), with its actions at the trailing edge. The first fetch reserves the rows with a skeleton
    of their shape; an empty view and a read that failed stand as their own states, in one line with
    the key each offers; a re-read that failed keeps the rows that stand and says so above them.
  - The open note's head carries the way back to the list and the note's title where the bar has
    room for it, nothing else. It rides the console's title bar where the console
    offers one — its actions laid in the bar's own place — and stands as the screen's own head
    where it does not. The title is the document's own, as the editor holds it, cut to the bar with
    its whole value in a tooltip; a phone's narrow bar leaves it to the document's own title.
- The list stands in the console's content width — at most its `--ui-container` across, centred — as
  every console screen does, its rows reaching that width with only their own inner room. The open
  note is the screen that releases that width in its own panel: its page fills the console's content
  area, with no cap of its own.
- The editor stands under a format bar of the bundle's own: inline marks, block types, lists, quote
  and code, an image upload and a table insert, each driving the vendored editor's own command chain,
  so the bar, the hotkeys and the slash menu all ride one mechanism. The bar and the editor stand as
  one column filling the page; the bar spans that column, but its controls stand in one gathered,
  centred row of their own width, never spread edge to edge. The talk key stands apart at the bar's
  trailing edge, since it acts on the whole note rather than the selection. Slash commands stay a shortcut, never
  the way in. The image key opens a file input of the bundle's own: it carries the native hidden
  attribute, and the bundle's stylesheet holds it hidden with an `!important` rule the editor's
  injected `input` element rule cannot override. The selection toolbar, the drag handle and the
  floating format menu are the fork's own and stand as it drew them.
- The status line at the screen's foot tells what the document holds — its word count and its size —
  beside the save state, drawn with that state's own icon and tone; it is the one place the save state
  stands. The note saves itself a moment after each edit, and Ctrl+S (⌘S) saves at once, in place of the
  browser's own save, wherever the focus stands on the open note's screen. Where a reader must act (a
  refused save, a conflict) the banner above the document says so, with the key that acts on it.
- An image an editor inserts is held on the service before its block stands: the editor's blob store
  is the note's own blob routes, so uploads and read-backs cross the console's relay like every other
  call, and a note reads back its images wherever it is opened.
- The editor's own words come from BlockSuite and AFFiNE, which ship English UI strings; the bundle
  supplies no translation of them. Everything the bundle itself writes follows the console's wording
  guide in its own two locales.
- The screen is read in the console's screen mode and keeps none of its own. The bundle's chrome is
  drawn from the console's tokens, so it stands in the mode the console stands in as it is written;
  the vendored editor colours itself by a `data-theme` attribute of the document element instead —
  its theme service watches that attribute and its stylesheet states both modes under it — so the
  bundle mirrors the console's mode onto it and the document switches as the console's own screens
  do. Light is as the fork drew it.

## Deployment shape

- The service answers its own loopback port (by convention `127.0.0.1:13129`), reads its own settings
  from the data root's `env/note.toml`, keeps its data under the data root's `note/`, and runs under
  its own user unit, marked `bot`, with the conventional layered settings (the repository's
  `settings.toml`, the deployment's files, then `BMO_NOTE_<TABLE>__<KEY>`).
- The unit serves no route to a person directly: the console is where people read and write notes, and
  the console reaches the service over the loopback with its own credential. It therefore takes no
  public name under the platform's domain, no DNS record and no proxy host. If a note is ever shared
  to a reader without sign-in, that share page will need a public path through the console, the way
  drive, theater and artifact share through the console's own name, not a name of the note unit's.
