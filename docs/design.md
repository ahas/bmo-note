# bmo-note

The note unit keeps the platform's editable notes: a person opens the console, writes a note,
closes the tab, and finds it again. Each note is one rich-text document of Nuxt UI's editor, a
TipTap editor over ProseMirror; the unit stores the document with its own metadata, reads it for
search, links and comments, and shows the notes through a console bundle under its sidebar entry.
`docs/api.md` states the boundary.

## What the unit stands on

- The editor is Nuxt UI's (`UEditor` and its menus), the component library every console screen is
  built from, over TipTap and ProseMirror, all MIT. The unit runs no other product's application or
  server and carries no other product's source.
- The platform pattern the unit follows is bmo-calendar: a service answering a loopback port, a console
  plugin bundle built as its own project, its own settings file under the data root, its own user unit,
  its own data directory, and its own `testbed.toml`.

## What a note is

- **A note is one TipTap document,** stored as its ProseMirror JSON: a `doc` node holding one `title`
  node first and the note's blocks after it. The title node holds plain words, no marks; the blocks
  are the editor's schema:
  - paragraphs, headings of levels 1 to 6, quotes, code blocks with their language, dividers and hard
    line breaks;
  - bulleted and numbered lists and to-do lists, each item holding blocks and lists nested under it;
  - tables of rows of header and body cells, each cell holding blocks;
  - images, each naming the stored image it shows by its blob id, never by an address;
  - inline marks: bold, italic, underline, strike, code, a link to an address, and the comment mark
    (「Comments」);
  - the note link, an inline node naming another note (「Note links」).
- **The format is JSON rather than the editor's collaborative Yjs state, because one writer at a time is
  the truth** (「Editing and saving」): every save carries the whole document under the version it was made
  from, so nothing needs a merge, and the service must read the document — for its search text, its links
  and the places its comments stand — which a JSON tree gives it with a plain parser and a Yjs state does
  not. A move to concurrent editing would put the Yjs state beside the JSON, never in its place.
- **The service reads the document; the client alone writes it.** On every save the service walks the
  tree and derives three things from it, never asking the client for any: the title, the plain text and
  the note links (「Storage」). The title is the title node's words, else the first line of words the
  blocks hold, cut to 300 characters; the plain text is every block's words, one line a block, a table's
  cells and a note link's title among them. The service never edits a document a writer sent, except to
  name a copy (「Storage」) and to take the comment marks off what a share link opens (「Sharing on the
  screens」).
- Metadata beside the document: an id, the title, a version, creation and change moments, a deleted mark,
  the document's size in bytes and an icon. The icon is one emoji the reader picked, or none; it stands
  beside the document, not in it.
- **A document the earlier editor wrote is converted once.** A note stored by the BlockSuite editor the
  unit used before is converted to this format by the unit's migration, run once at the deployment that
  brought this editor; its former bytes are kept beside it (「Storage」). The service answers health not
  ready while any stored document is not this format, so a release never serves a store the migration
  has not reached.

## Who owns a note, and who it is shared with

- **Every note belongs to one console account,** keyed by the `Owner-Key` the console sets on relayed
  calls; a service-token call names the account it acts for with an `owner` query. The owner reads,
  writes, trashes, restores and purges the note, and alone decides who else it opens to.
- **The owner shares a note two ways,** both from bmo-ui's one share dialog (bmo-ui
  `docs/console-bundles.md`, sharing and share pages):
  - by a link: one live link per note, made for a span the owner picks or for good, which opens the
    note read only to whoever holds it, with no sign-in, on the note's share page;
  - with members: people of the owner's company, the accounts standing anywhere under the top-level
    organization unit the owner's own unit belongs to, as the console's people directory finds them.
    Each member is kept by the account key with a permission.
- **A member's permission is `read` or `edit`, and a member is given `read`.**
  - `read` opens the note, its images, its backlinks and its comments, read only.
  - `edit` opens the saves and the image uploads as well, through the same versioned door the owner's
    edits go through, so a member's save and the owner's are refused, not merged, when one is made from
    behind the other; and it opens commenting (「Comments」).
  - Neither opens the trash, the purge, a restore or the sharing itself: the owner alone grants, changes
    and takes back a share and makes or ends the link.
- **A shared note opens only while it lives.** A note in the trash opens to its owner alone; its link
  and its members stand with it and open it again on a restore. A purge takes them with the note.
- **Everyone else is refused as a stranger:** a signed-in reader the note is not shared with, a member
  whose share was taken back, and a link that ended or never stood each find no note there, the same
  answer as for a note that does not stand, so a refusal tells nothing of what another account holds.
- **The service does not ask who a member is.** It calls no unit about its members, so it keeps whatever
  account key the owner shares with; the console's people directory is what offers only the company's people,
  and a key nobody signs in with opens the note to nobody.

## Editing and saving

- The editor mounts in the browser only: the console bundle opens the stored document in it, or an
  empty one for a new note, and autosaves it to the service. There is no realtime collaboration: one
  writer at a time per note is the truth. A concurrent writer is refused, not merged:
  - each save names the version it was made from; a stored version past that answers `version-conflict`
    with the current metadata, and the screen offers the reader a reload;
  - autosave is debounced on the editor's document changes, and an unsaved state is marked on the screen.
- The whole document is stored on each save, replacing the previous one: a note this small earns no
  log of steps, and whole-document saves keep the service's one table and one version number honest.
- **The caret stays in sight as words are written.** The note's scroll is the editor's own scroll parent, and
  the editor scrolls the caret into it as a key moves or writes it, keeping a margin of room around it, so a
  new line written past the foot of the scroll, a deleted one or an arrow key that carries the caret past
  either edge moves the scroll until the caret stands inside it.
- The note's history is the editor's own: each change is a step of its undo history, and the history
  starts with the document as it was opened.
- The screen answers the history keys, wherever on it the focus stands: `Ctrl+Z` (`⌘Z`) undoes and
  `Ctrl+Shift+Z` (`⌘⇧Z`) or `Ctrl+Y` redoes. The editor binds the same keys while it holds the focus;
  the screen's route answers everywhere else too — after a talk apply or a bar action, with the focus
  resting off the editor's body — catches the key on the way down, yields it to a plain text field the
  reader is typing into (the talk's, the ask's and the comments' own inputs keep their undo), and stands
  down while the keyboard is composing.
- What the undo takes back is the change as the reader made it: one keystroke run, one bar action, one
  insert, and each change the talk applies — an anchored patch, a whole-body rewrite, a rename — lands
  as one transaction, so one press undoes one change. An undone change is a document change like any
  other, so autosave, the page head's title and the navigator all follow it.

## Storage

- One SQLite file under the unit's data directory holds the unit's tables: each note's owner, id, title,
  document, version, timestamps, deleted mark and icon; each image's note, id, type and bytes; each share
  link's token, note, moment made and end; each member share's note, member key, permission and moment
  shared; each note's search text — its title and the plain text derived from its document — and the
  full-text index over it; each note's links, the notes its document links to; each note's comment
  threads and the comments in them; each account's pins, the note and the moment pinned; each account's
  record of the notes it opened, the latest moment each; and each converted note's former document. A note
  is named by its owner and its id together, since ids are each account's own.
- **An image is held before its block stands.** The editor uploads a picked or pasted image to its note's
  blob route, under an id it makes, and stands the image block on that id once the service holds the
  bytes; the block is drawn from the same route, so no block ever stands on bytes the service does not
  hold. The document itself never carries image bytes; the cap on one stored document leaves the
  document's own text and structure.
- **What the document says is derived on every write of it:** its title, its search text and its links
  are written in the same transaction as the document, so none of them ever stands for another version.
  A copy is made from a note the caller reads: its document with the copy's title written into its title
  node and the comment marks taken off (a copy carries no threads), its images, its icon, its search text
  and its links.
- A purge takes the note with its images, its link, its member shares, its search text, its links, its
  threads and comments, its former document, every account's pin of it and every account's record of
  opening it. A save that drops an image leaves its bytes standing until the note goes: the store
  collects no garbage of its own. A link another note holds to a purged note stands in that note's
  document and opens onto the note's absence.
- **Pins and what was opened are the reader's, not the note's.** Each is kept by the account that made
  it, so a member pins and opens a note shared with them as the owner does their own, and nobody reads
  another's. They are answered only for what the account reads at the moment of the read — a share
  taken back or a note trashed drops out without its row being touched — and the record of what was
  opened keeps each account's latest hundred.
- **The search index.** The search text stands in a table of its own, one row a note keyed by an integer
  of its own that SQLite never renumbers, and an FTS5 table indexes its title and text under the trigram
  tokenizer, kept in step with the rows by the table's own triggers. A search joins the index back to
  the notes by owner and id, and the access clause is laid on the notes, so the index decides only what
  matches, never who may read it (`docs/api.md`, 「Search」).
- **The store upgrades itself in place as it opens.** There is no migration ladder: every table, index
  and trigger is made where it does not stand, each column a later version added is added where the
  table lacks it (read from the table's own column list), and every note whose derived rows do not
  stand for its document — a note the migration converted, or one written before the rows were kept —
  has its title, search text and links derived again, all in one transaction, so a store from before
  any of it opens whole and a store already upgraded opens unchanged, however often it is opened. A
  document that is not of this format is left as it stands and holds the health not ready (「What a
  note is」).
- **The former documents.** The migration keeps each converted note's BlockSuite bytes in a table of their
  own, beside the note, with the moment it converted it; nothing reads them, a purge takes them with the
  note, and they stand until the owner confirms the conversion, when a later release drops the table.
- A deletion moves the note to a trash list; a restore moves it back; a purge deletes the row and is
  open for a trashed note only. Nothing else deletes a note.
- A stored document is capped at a setting (`[notes] max_doc_bytes`); a save past the cap is refused
  `too-large` and the editor keeps its unsaved state on screen.

## Events

- The service publishes `note.saved`, `note.trashed`, `note.restored` and `note.purged`, each naming
  its note and its owner, `note.shared` and `note.unshared`, naming the member too, and
  `note.commented`, naming the thread, kept in the same in-memory ring every platform service keeps and
  answered over the common stream route.
- An event reaches the note's owner and the members the note is shared with as it is published; a
  share's own two events reach its owner and that member. The console bundle subscribes through the
  console and reads the navigator again, so a note shared with a reader appears in their shared section
  without a reload, and an open note reads its threads again on `note.commented`. A
  restart loses the ring, as every unit's does.

## The talk panel

- An open note offers a panel in which the reader talks about that one note with the note assistant of his own
  account, the same agent the Agent asks (「Agent」). The panel is the note screen's own; each turn is one ask of
  the note service's Agent route over the whole note (`docs/api.md`, 「Agent」). Nothing keeps the turns of such a
  talk, so the panel holds the conversation and hands each turn with the turns before it.
- The panel is named for the talk alone, with no subtitle under its name. Docked, it stands at a
  width the reader drags at its leading edge or steps with the arrow keys, between its bounds, and the
  width is kept in that browser. The reader writes in the console's chat prompt.
- **The talk reads the note as rows,** in the note's line grammar, the screen's own protocol: one line a block
  — a list item, a to-do item and each paragraph of a quote counting as one — in the order they stand, a
  deeper block two spaces further in, its kind told by the mark the line opens with (headings of every level,
  bulleted, numbered and to-do items, quotes, code with its language), and a divider, an image and a table
  each named by a line of its own that stands for the block whole. The topic names the note by id and title
  and carries the whole body as that line list. The supervisor answers with that same line list edited — one
  fenced block holding the whole new text, in the protocol the panel's own heading states, which the note
  service hands the agent as its instructions. To rename the note, its answer puts the new title on the fenced
  block's first line under a `[[title]]` mark, above the lines; the title is written into the document's title
  node, so it rides the same save as a body change does, and a rename with no body change is an answer that
  changes no line. The mark is stripped before the lines reach the patch, and a paragraph whose own words open
  with it wears the protocol's escape, so no note line ever reads as a rename. The note never stands rewritten
  by a partial answer: where the fenced text is missing the panel shows the answer as words and changes
  nothing.
- The agent's words enter the note through the open editor and its versioned save, the door every edit goes
  through: the service hands the agent the lines and hands its answer back, and never writes a note from it.
- A change lands as a patch, never a dump: the panel diffs the returned lines against the base lines
  the talk was asked over and applies the changed ranges to the current document, each range anchored
  by the untouched lines around it. A block whose line the patch leaves untouched stands as it stood, its
  marks, its note links and its comment marks with it; a block the patch writes is written from its line,
  as plain words in its kind. The runs are written into the open editor's document as they come, so the
  screen shows them without a reload and the autosave carries them through the versioned save.
- An owner's edit elsewhere stands untouched through it; a range the anchoring cannot find, or one
  that would swallow a table or an image, fails the whole patch, and the panel says so in one line.
  The reader may then retry, or apply the text outright from the panel's own replace action, which
  says plainly that it overwrites what stands under it. That fallback rewrites the whole body from the
  answer and keeps the note's images and tables: each marker line of the answer is paired with the
  block of the same kind the note holds at the same depth, by their order of standing, and every
  paired block is moved whole into the place its line draws. An answer that dropped a marker, drew one
  the note does not hold, or moved one deeper than the note holds it is not applied at all; the panel
  names the kinds it could not place and the note stands as it was.
- The panel is docked beside the note on a wide viewport — a column of its own, parted from the
  document by one line, standing in the row the note fills rather than over it — so the note keeps its
  width and the reader may go on writing while the answer comes; below that width it rises from the
  bottom edge as a drawer. It never covers the note at either end of its width: its bounds are clamped
  by the row it stands in, so the note keeps a readable column while the row can give one, and below
  that the panel holds the narrowest column a chat line and its input read in. The width the reader
  drags stands whole while there is room for it and comes back when a wider row returns. Its key stands
  at the format bar's trailing edge, and the panel closes by its own close key. A turn whose panel is closed
  still stands, and its change lands in the note. The talk is kept in the screen's memory alone: leaving the
  note drops it, the record of the talk is the note's own saved states.

## Agent

- **The Agent acts on a passage:** the blocks the selection covers, the block under the caret where nothing is
  selected, or the whole note where the editor holds neither. It is reached from the selection toolbar the
  editor floats over a selection and from the format bar's own Agent key, both opening the one menu under the
  passage — the shape of Nuxt UI's editor AI pattern, a menu of set actions and a line of one's own words over
  the words chosen. Its keys and its menu are named Agent in every language.
- The menu offers set actions in groups — edit (improve the writing, fix spelling, fix grammar, make it longer,
  make it shorter, a plainer or a more formal tone), translate (Korean, English, Japanese), and write from it
  (continue writing, summarize, explain, an outline, brainstorm ideas) — and a line in which the reader asks in
  his own words. Each set action is a rule the bundle states in English; the menu shows it in the reader's
  language.
- **The note assistant answers.** An ask goes to the note service's Agent route (`docs/api.md`, 「Agent」) with
  the passage in the note's line grammar, the rule or the reader's words and the rounds before it; the service
  asks an agent of agency's `note-assistant` role under the reader's own account — his own BMO's account for a
  member, the deployment's for the platform administrator — on a session that opens on the service's own
  instructions and holds no tool, so the agent reads the passage it is handed and no other note. The role's
  road is the deployment's default answerer's (agency's `docs/agent-roles.md`, 「The note-assistant role」).
  The answer is one fenced block in the line grammar; an answer with none is shown as words and offers nothing
  to place.
- The result stands under the passage before anything changes. The reader replaces the passage with it,
  inserts it below the passage, asks again, asks a further change in his own words, or discards it. A placed
  result enters the document as one transaction through the same row writer the talk's patch uses, so the
  autosave carries it and one undo takes it back. A passage holding an image or a table is never replaced,
  since no line brings either back; its result can still be inserted below.
- The ask's rounds are held while the result stands and dropped when it is placed or discarded. An ask that
  finds no agency named, or whose agent came back with nothing, says so in one line under the passage with the
  key that asks again.

## Note links

- **A note links another with `[[` or `@`.** Typed where words are written, either opens a menu of the
  reader's notes under the caret: the notes most recently opened while nothing follows the mark, and the
  notes whose title holds what is typed after it, as the service's search finds them across the reader's
  own notes and those shared with them, the open note itself left out. Arrow keys walk the menu, Enter or
  a press puts the chosen note in place of what was typed, and Escape leaves the words as typed.
- **A link is an inline node of the document** naming the linked note by its id and its owner's key, with
  the title it bore when it was linked, drawn as that title in the link tone with the note mark before it.
  Pressing it opens the linked note in the note region, one step of the history as choosing a note in the
  navigator is; Ctrl- or ⌘-pressing it opens the note in a new tab. A linked note the reader cannot read,
  or one gone, opens onto the region's missing state. A link shows the title its note bore when it was
  linked; it is put in again from the menu to show a later one.
- **Backlinks.** Under the open note's document stands the list of the notes linking to it, each its icon
  and title, pressed to open it as a navigator row is: only notes the reader reads live are listed, so a
  backlink never tells of a note the reader cannot open. The service keeps each note's links as it saves
  the note (「Storage」), so the list is one read. A note nobody links to lists nothing and the list's
  head does not stand.

## Comments

- **A comment is laid on words.** The reader chooses a run of words and presses the comment key of the
  selection toolbar; the lines of the note part under the line holding the words — under a table where the
  words stand in its cell — and a new thread's field stands in the space between them, in the flow of the
  document, the words chosen wearing the chosen tint. The thread is made when its first comment is sent: the
  service makes the thread first, under an id the screen chose, and the screen then lays the comment mark
  carrying that id over the words, which the autosave stores with the document. The mark is the anchor: it
  follows the words as the note is edited around them.
- **A thread** holds the words it was laid on as they read then, its comments oldest first — each its
  author, its words and its moment — and whether it is resolved, by whom and when. Replies go under the
  thread's last comment. Resolving puts the thread away and reopening brings it back, its comments
  untouched.
- **Who comments.** The owner and members holding `edit` start threads, reply, resolve and reopen; a member
  holding `read` reads the threads and the marks and writes none of them; a share link opens neither. An
  author deletes his own comment and the owner deletes any; a thread whose comments are all deleted goes
  with its last, and the owner or the thread's author deletes a thread whole, which takes its mark out of
  the document.
- **A thread opens in the note, under its words.** Pressing an open thread's marked words parts the lines
  under them as a new thread's field does, and the thread stands in the gap: one box, its head on one line —
  the word for comments, resolve or reopen, the delete of the thread where the reader may make it, and the
  close key — then its comments with their authors' names as the people directory answers them, each with its
  delete where the reader may make it, then the reply field with its send key. The box keeps the console's
  tight spacing and no margin beyond the one line of room that parts it from the lines around it. The words of
  the thread standing open wear the chosen tint, resolved or not. The close key, Escape and the back gesture
  put the gap away and the lines close back; a field never sent goes with it. One gap stands at a time:
  opening another thread, or a new field, closes the one standing.
- **The comments key** stands on the format bar's trailing edge with the count of open threads and opens a
  short list of the note's threads: the open ones in the order their words stand, then the ones whose words
  were deleted from the note under a line saying so, then the resolved ones under their own head with their
  count, each its quoted words on one line and how many comments it holds. Choosing one opens it in the note:
  under its words, resolved or not, and at the note's end for one whose words were deleted, which shows its
  quoted words under a line saying so. There is no comments panel.
- **The marks answer the threads.** Words under an open thread's mark wear the comment tint; a resolved
  thread's words wear none, and are reached from the comments list.
- The screen reads the threads when the note opens and again on each `note.commented` event of the note, so a
  member's reply reaches an open thread without a reload.

## The console surface

- The bundle keeps bmo-ui's console plugin contract (bmo-ui `docs/console-bundles.md`). Within it the
  note asks for the member role and an owner key on every call the screens make, and names no other service
  under `calls`: the bundle calls its own service alone, the talk panel and the Agent among it, and reads the
  console's people directory for the share dialog's members and the comments' authors. `docs/api.md`, 「Console」, names the rest of what the note chooses.
- **The bundle builds its editor into itself.** The console shares Nuxt UI's components with every bundle,
  each resolved to the console's own copy, but the editor's components carry the TipTap and ProseMirror
  modules with them, and the editor's own extensions — the title node, the comment mark, the note link,
  the table — must stand on the very ProseMirror copy the editor runs: a second copy of its model breaks
  every node one copy hands the other. So the bundle takes Nuxt UI's editor components, the editor and
  its suggestion, mention and drag-handle menus, from the copy of the library it installs, builds them
  with its own TipTap and ProseMirror into its module, and lets every other component they draw — a
  button, an icon — resolve to the console's shared copy as any bundle's does.
- **The bundle's packages stand hoisted, one copy of each,** as its lockfile resolves them, the layout its Bun
  configuration names. A tree installed earlier in Bun's isolated layout keeps a store of its own beside the
  packages, and an install over it would leave its links standing beside the hoisted copies, so the editor
  would load ProseMirror twice; the bundle's install takes such a tree away whole, with the dev host's
  dependency cache built over it, before installing from the lockfile, and the check, the build and the
  testbed's setup all install through it.
- Two screens stand under `/note`: the notes screen, and the share page a link opens
  (`/note/share/<token>`).
- **The notes screen is one screen of two regions:** a navigator of the reader's notes beside the open
  note. It answers `/note`, with no note chosen, and `/note/<id>` — `/note/<id>?owner=<key>` for a note
  another account shared, `/note/<id>?trash=1` for the reader's own note in the trash — as one route
  whose screen stays standing while the address changes. Choosing a note changes the note region and
  the address, one step of the browser's history, and the navigator stands where it was: its scroll, its
  folded sections and the rows it has read. Back steps through the notes chosen.
- **On a wide screen the two regions stand side by side behind the component library's splitter,** its
  handle the layer's one-pixel line with a wide grab room drawn over the regions' edges. The reader drags
  the navigator between 200 and 480 pixels, 260 at first, and folds it away whole; both are kept in that
  browser. Ctrl+\ (⌘\) folds and unfolds it, and so do the fold key at its head's trailing end and, while
  it is folded, the key that leads the note region's bar. Each region scrolls on its own.
- **On a phone the note region owns the screen.** The navigator rises from the bottom edge as a drawer
  from one key at the leading end of the note region's bar, and choosing a note there closes it.
- **The navigator, top to bottom:**
  - Its head, a row the height of the note region's bar, their bottom lines one line: the search entry,
    a field-shaped key showing the search mark, the word for search and its key (Ctrl+K, ⌘K), which opens the
    search dialog; then the layer's one create button, a grey icon naming a new note and its key, `n`
    (on a phone, inside the drawer, it is the head's contained add); then the fold key on a wide screen.
  - One scrolling list of sections, each headed by its name, which folds and unfolds the section: the favourites,
    standing only while the reader has pinned something, in pin order; the reader's own notes; and the notes shared with the reader. The two
    last carry a sort key at their head's trailing end, bmo-ui's one select (bmo-ui's `docs/components.md`,
    「Choosing a value」) of last edited (the default), title and created, each kept in that browser with whether each section is folded.
  - A row is the note's icon — its emoji, or the note mark where it has none — and its title, on one
    line, cut with the shared tooltip where it does not fit; an untitled note says the pack's word for untitled in the dimmed
    tone. The open note's row stands chosen. A row is pressed to open its note; Ctrl- or ⌘-pressing it
    opens it in a new tab. Its actions stand in one menu: a `…` key at the row's trailing end, shown while
    the pointer is on the row or the keyboard's focus is in it and always under a finger, and the same menu
    on a right press and a held finger. The menu offers adding to or taking from the favourites, share (the owner's
    alone), copy link, duplicate and move to the trash (the owner's alone).
  - A section reads thirty rows at first and the next thirty as its end comes into sight, a skeleton of
    rows standing at its end while they come. The first read of each section reserves its rows with a
    skeleton of the row's shape; an empty section is one line; a section whose read failed says so in one
    line with the key that tries again.
  - Its foot, outside the scroll: the trash, which opens a popover from the key holding the reader's
    trashed notes, newest changed first, each with the day it went to the trash, and a field that filters
    them through the layer's list search. A row there opens the note in the note region.
- **The note region with no note chosen** stands empty but for one line of guidance, the search mark
  above it, and the keys that act there: the search key and the create key. On a phone the create button
  floats at the screen's bottom right there, the screen's main create, and the drawer key leads the bar.
- **The open note's bar** is the row under the console's title bar, 48 pixels tall, its bottom line one
  with the navigator's head. At its leading end stands the key that brings the navigator — the drawer key
  on a phone, the unfold key while it is folded on a wide screen — and then the note's state as one key:
  whose note it is where it is shared (the name the people directory answers), when it was last edited,
  and the save state with that state's own icon and tone, the one place the save state stands. That key
  opens the note's properties in a popover: owner, made, last edited, words and size. At its trailing
  end stand three icon keys, each named in its tooltip: the pin star (adding to and taking from the favourites), the
  share key, the owner's alone, which opens bmo-ui's share dialog, and the more key, a menu of copy link
  (Ctrl+L, ⌘L), duplicate, full width as a checked choice, move to the trash (the owner's alone), and, last, a line
  of what the note holds — its words and its size. The title is not on the bar: the bar is the status and
  the actions, and the title heads the page under it.
- **The page head** stands at the top of the document's own scroll, in the editor's column: the note's
  icon, large, over the title the editor draws large as the document's own title node, its placeholder
  the pack's word for untitled. Enter in the title moves the caret to the first block. A note with no
  icon shows a key to add one there while the pointer is over the head or the keyboard's focus is in it;
  the icon key opens a popover of a small set of emoji and a key that removes the icon. A reader who
  cannot write the note sees the icon and nothing to press. There is no cover.
- **Full width** releases the editor's column to the region's width, for that note in that browser.
- **The note is saved as the editor writes it** (「Editing and saving」): a moment after each edit, and at
  once on Ctrl+S (⌘S) wherever the focus stands on the screen, in place of the browser's own save. Where a
  reader must act (a refused save, a conflict) a band above the document says so, with the key that acts on
  it. Choosing another note or leaving the screen with a change unsent sends it first, and asks before
  throwing it away where it cannot land.
- **A note in the trash** opens read only under one band that says so, holding restore and delete for good; delete for good
  asks first in the shared question dialog, naming that it cannot be taken back. Moving a note to the trash asks
  nothing, since it is taken back, and the message pill that says it was moved offers restore.
- **A missing note** — never made, purged, or a share taken back — keeps the bar with the navigator's
  key and says so in one line; a note whose read failed says so with the key that tries again.
- The screen draws nothing into the console's title bar, which names the screen. Where the console draws
  no bar, the screen draws its own, holding the screen's name alone.
- **The keys of the screen:** Ctrl+K or Ctrl+P (⌘K, ⌘P) opens the search, Ctrl+K only where no field or
  the document holds the typing, since the editor keeps it for a link; Ctrl+\ (⌘\) folds the navigator;
  Ctrl+L (⌘L) copies the open note's link; `n` makes a note (the create button's own); Ctrl+S (⌘S) saves.
  Each control a key presses names it in its tooltip.
- **The navigator follows the service's events** (「Events」): a note saved, trashed, restored, purged,
  shared or unshared reads the sections again in place, with no skeleton, and the open note's row with
  them.
- The notes screen fills the console's content area, with no cap of its own: the navigator is a list
  reaching its region's edges, and the note region releases its width to the editor, whose column the
  screen caps at a reading width unless the note stands at full width.
- **The format bar.** The editor stands under a format bar of the bundle's own: the Agent leading it; the kind
  of the block under the caret chosen from bmo-ui's one select among text, three headings, three lists,
  quote and code; the inline marks bold, italic, underline, strike and code; an image upload and a table
  insert. Each drives the editor's own commands, so the bar, the keys and the slash menu all ride one
  mechanism, and each mark and kind stands pressed while the caret's words wear it. The bar and the editor
  stand as one column filling the note region; the bar spans that column, but its controls stand in one
  gathered, centred row of their own width, never spread edge to edge. The keys that act on the whole note
  stand apart at its trailing edge — the comments key with its count and the talk key. Where the bar is
  wider than the screen, as on a phone, those keys hold to the bar's end and the format keys scroll
  sideways before them, so they stand in sight at every width. Every key in the bar is the library's small
  button at its own size, an icon-only key its small square, centred in the row with its hover and press
  filling its own shape, never a cell stretched to the row's height. The image key opens a file input of
  the bundle's own, held hidden.
- **The selection toolbar** floats over words chosen: the Agent, the comment key, the link key, and the marks
  bold, italic, underline, strike and code, each a small key named in its tooltip. The link key opens a
  field for the address under the bar, which Enter lays on the words and an empty field takes off. The
  toolbar stands whole inside the screen at every width, wrapping its keys into a second row where the
  screen is narrower than one, and it stands on a phone as under a pointer, above the words chosen. It
  stands only over words a reader may write; over a note held to read only no toolbar rises.
- **The slash menu** is Nuxt UI's suggestion menu: `/` typed at a line's start or after a space opens
  the kinds a line can take — text, the six headings, the three lists, quote, code, divider, table and
  image — filtered by the words typed after it, each named in the console's language. It stands inside
  the screen at every width.
- **Every block has its handle** under a pointer: Nuxt UI's drag handle stands beside whichever block the
  pointer is over. Dragging it moves the block; pressing it opens the block's menu — turn into, duplicate,
  copy and delete — each named in the console's language. A touch screen has no pointer to raise the
  handle, so a phone reaches the same through the format bar, the slash menu and the phone's own choosing
  of words.
- **An image** is put in from the bar's image key, the slash menu, or by pasting or dropping a picture on
  the document: the bytes go to the note's blob route first and the block stands once they are held, a
  picture past the store's cap refused on the pill before any upload. An image reads its bytes through
  the route of the screen it stands on, the note's own or the share link's.
- **The editor's words are the bundle's own.** Every word the editor's chrome shows — the toolbar keys and
  their tooltips, the slash menu's items, the drag handle's menu, the placeholders, the link field, the
  notes menu — is a key of the bundle's pack, answered in the console's language like every other word of
  the bundle; the editor carries no words of its own.
- **The screen speaks on the console's message pill** (bmo-ui's island, `docs/components.md`, 「Messages」):
  a copy of a block, a link copied, an image that could not be added or was refused over the cap, an Agent
  result that could not be placed. A copy wears the success tone and a refusal or failure the error
  tone.
- The screen is read in the console's screen mode and keeps none of its own: the editor and every part of
  the bundle are drawn from the console's tokens, so they stand in the mode the console stands in.
- **The screens' browser test holds them to these rows.** It builds the note service from the checkout,
  starts it on a settings folder and a store of its own, naming a stand-in agency of its own whose agent answers
  every ask with a fenced block, starts the bundle's dev host relaying to it as the console would, writes a
  few notes of realistic Korean titles and text through the relay, and drives the screen in a real browser
  at 1,280 and 360 pixels wide, in the light and the dark scheme: the navigator with every section and the
  trash at its foot; a note open, its bar holding the state at its leading end and the star, the share key
  and the more key at its trailing end; the empty note region; the search dialog before typing, with results
  whose matches are marked and with none; the more menu; a note in the trash under its band; and, on a
  phone, the navigator risen in its drawer. On a wide screen the create button closes the navigator's head,
  a grey icon whose tooltip names a new note and its key, and the key makes a note; every key of the format
  bar is the library's small button, an icon-only one its small square, centred with room above and below
  it and its hover on its own shape; the note's keys at the bar's end stay in sight while the keys scroll on
  a phone; a missing note keeps the bar with the navigator's key; and no screen scrolls sideways on a phone.
  It keeps a picture of each state, and runs in the suite's browser lane, apart from the client's own check,
  skipped where the browser build is not on the machine.
- **The editor's browser test** stands on the same stack and holds, at 1,280 and 360 pixels wide, by a
  pointer and by a finger, in Korean, what a person does with the editor, reading what the browser draws:
  writing a title and lines past the scroll's foot, the caret kept in sight and the note saved and read back;
  a line turned into a heading from the bar and a word made bold, the bold key standing pressed; the
  selection toolbar standing whole inside the screen over chosen words; a note link put in with `[[`, the
  menu inside the screen, the link pressed opening the linked note and the backlink listed under it; a
  comment laid on words, its field and then its thread standing in the document under the commented line and
  above the next, answered, resolved and reopened in place with its words' tint following, closed with the lines
  closing back, and opened again from its marked words and from the comments list; and the Agent over a chosen
  line against the stand-in agency, its result shown under the passage and inserted below it. It keeps a
  picture of each.

## Sharing on the screens

- **The share key opens bmo-ui's share dialog,** on the owner's own note alone, from the open note's bar
  or a row's menu, titled by the note. The bundle hands the dialog its roads; the dialog calls nothing
  itself.
  - The link road is the note's link on the service: read, made for a span and ended there, and the
    page it opens is the share page under the console's own address. The spans offered are a day,
    a week, a month and for good, a week offered first.
  - The member road is handed only where the console offers its people directory: the search is the
    directory's, and who the note is shared with is read, shared, changed and taken back on the
    service, each member drawn by the name the directory answers for the key, or the key itself where
    it answers none. Found without the directory, the dialog shares by link alone.
- **A shared note opens as its permission allows.** Opened by a `read` member, the document stands
  read only: the format bar keeps its keys disabled, the talk key, the Agent, the selection toolbar, the
  share key and the icon key do not stand, nothing is saved, and the bar's state says the note is read
  only where it would tell the save state; a thread opens under its words to read. Opened by an `edit` member,
  the screen is the owner's but for the share key and moving the note to the trash. Either member pins,
  copies the link of and duplicates the note as their own.
- **The share page stands with no frame of the console's,** its own bar holding the note's title, and
  under it the document read only, its images read through the link, its comment marks taken off and its
  note links drawn as their titles alone, since the page opens no other note. A link that opens nothing
  stands as its own state, one line saying the note is not shared.
- **The sharing browser test holds the screens to this.** On the same throwaway service and dev host as
  the screens' test, it drives the share dialog in a real browser: the owner makes a link and the share
  page opens the note read only with no format bar; the owner finds a member in the people directory and
  shares the note; the member finds it in the navigator's shared section and opens it read only, with no
  share, talk or Agent key; a reader it is not shared with finds no note; and once the owner takes the
  member off, the member finds no note either. The dev host stands in for the console's people directory
  with a few made-up people, and a browser names the reader the relay presents by a cookie of the dev
  host's own, so one test acts as each of the three accounts.

## Search

- **Search is one dialog over the screen,** the component library's command palette in a modal, opened
  from the navigator's search entry, Ctrl+K and Ctrl+P (⌘K, ⌘P). It stays a centred modal on a phone.
  It belongs to the note screen: what it searches, sorts and filters is the note service's, so it is
  built in the bundle from the library's palette rather than in the shared layer.
- **Before anything is typed** it lists the notes the reader opened most recently, newest first.
- **While typing,** a moment after the typing stops, it asks the service's search (`docs/api.md`,
  「Search」) and lists what it answers: each row the note's icon, its title with the match marked, whose
  note it is where it is shared, when it was last edited, and under them one line of the text around the
  match, marked. The marks are the layer's list-search marking, handed the term the service found first.
  A search that finds nothing says so in one line.
- **Inside the dialog, under the list,** a sort select, bmo-ui's one select, of best match (the default), last edited
  and created, and a filter menu: titles only; the reader's own notes, the notes shared with them and the trash, the first two on at first; and a date of
  last edit: any, today, the last 7 days or the last 30 days. A phrase in double quotes is matched exactly.
- The arrow keys walk the rows and Enter opens one, as a press does; Ctrl- or ⌘-pressing a row opens it
  in a new tab and leaves the dialog standing. Opening a note closes the dialog.
- **The search lives in the address while the dialog stands,** under `search`, with `sort`, `in`, `title`
  and `since` beside it where they are not the defaults, so a search is linked whole. Opening the dialog
  is one step of the history, as choosing a note is, and the dialog takes no step of its own for the back
  gesture: back closes it by stepping back over that one, typing and filtering rewrite that step in place,
  and opening a note from it takes its place, so a search and the note it found are one step from where
  the reader stood.

## Present limits

- Notes do not nest, and there are no folders: every note stands in one list per view.
- A note has no cover picture and no version history.
- Rows are not dragged to reorder: the own and the shared sections sort by last edited, title or created, and
  the pins keep the order they were pinned in.
- Search reads titles and the words of the document; the words inside an image are not searched.
- A note link shows the title its note bore when it was linked.
- The talk and the Agent read and write a block's words, not its inline marks: a block they rewrite stands as
  plain words of its kind.

## Deployment shape

- The service answers its own loopback port (by convention `127.0.0.1:13129`), reads its own settings
  from the data root's `env/note.toml`, keeps its data under the data root's `note/`, and runs under
  its own user unit, marked `bot`, with the conventional layered settings (the repository's
  `settings.toml`, the deployment's files, then `BMO_NOTE_<TABLE>__<KEY>`).
- The unit serves no route to a person directly: the console is where people read and write notes, and
  the console reaches the service over the loopback with its own credential. It therefore takes no
  public name under the platform's domain, no DNS record and no proxy host. A note shared by link is
  read on its share page through the console's own name, the way drive, theater and artifact share,
  and the console relays the page's reads to the service with no sign-in.
- The Agent and the talk reach agency's control port at the address the settings name, with the token the
  data root's `env/` holds under the name they give (`docs/api.md`, 「Settings」); a deployment naming no
  agency has the Agent answer that no agent stands.
