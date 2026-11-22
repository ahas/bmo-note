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
  mark, the byte size and an icon. The title is written by the client on each save: the document's own
  title where it stands, else the first line of its content, so the list answers titles without opening
  the bytes. The icon is one emoji the reader picked, or none; it stands beside the document, not in it.
- **The note's plain text is the client's to supply.** The service cannot read the document, so the
  client reads the text out of it — the editor's own reading of its blocks, one line a block, the marks
  the talk protocol wears taken off — and hands it with each save. The service keeps it beside the
  document for search alone and answers it to nobody. A document saved without its text stands
  unindexed until one comes; the screen supplies it quietly for a note saved before the text was asked
  for, as the navigator lists it or the reader opens it, through a route that writes the text for the
  stored version and moves nothing else.
- The document's own format belongs to BlockSuite. An upgrade of the editor may read documents the old
  one wrote (the schema carries its versions); the unit adds no format of its own.

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
  - `read` opens the note and its images, read only.
  - `edit` opens the saves and the image uploads as well, through the same versioned door the owner's
    edits go through, so a member's save and the owner's are refused, not merged, when one is made from
    behind the other.
  - Neither opens the trash, the purge, a restore or the sharing itself: the owner alone grants, changes
    and takes back a share and makes or ends the link.
- **A shared note opens only while it lives.** A note in the trash opens to its owner alone; its link
  and its members stand with it and open it again on a restore. A purge takes them with the note.
- **Everyone else is refused as a stranger:** a signed-in reader the note is not shared with, a member
  whose share was taken back, and a link that ended or never stood each find no note there, the same
  answer as for a note that does not stand, so a refusal tells nothing of what another account holds.
- **The service does not ask who a member is.** It calls no unit, so it keeps whatever account key the
  owner shares with; the console's people directory is what offers only the company's people, and a
  key nobody signs in with opens the note to nobody.

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
- The note's history is the fork's own: the document's store is put through its load lifecycle when
  the note opens, which is the only thing that readies the history extension — a store standing
  unloaded answers `canUndo` false forever, and the editor's own `Mod-z` binding guards on that and
  does nothing.
- The screen answers the history keys, wherever on it the focus stands: `Ctrl+Z` (`⌘Z`) undoes and
  `Ctrl+Shift+Z` (`⌘⇧Z`) or `Ctrl+Y` redoes. The fork binds the same keys too, but only while its
  own event flow is active, which misses the change the reader most wants back — a talk apply, a
  bar action — while focus rests off the editor body; the screen's route answers everywhere, catches
  the key on the way down before the editor sees it, yields it to a plain text field the reader is
  typing into (the talk's and the ask's own inputs keep their undo), and stands down while the
  keyboard is composing.
- What the undo takes back is the change as the reader made it: one keystroke run, one bar action,
  one insert, and each change the talk applies — an anchored patch, a whole-body rewrite, a rename —
  land as one transaction, so one press undoes one change. An undone change rides the document's
  update events like any other, so autosave, the page head's title and the navigator all follow it.

## Storage

- One SQLite file under the unit's data directory holds the unit's tables: each note's owner, id, title,
  doc bytes, version, timestamps, deleted mark and icon; each attachment's note, id, type and bytes; each
  share link's token, note, moment made and end; each member share's note, member key, permission and
  moment shared; each note's search text — its title and the plain text the client supplied, with
  whether that text stands for the stored document — and the full-text index over it; each account's
  pins, the note and the moment pinned; and each account's record of the notes it opened, the latest
  moment each. A note is named by its owner and its id together, since ids are each account's own. An
  attachment is an image only: the editor uploads one to its note's blob route before an image block
  stands, and reads it back through the same route, so no block ever stands on bytes the service does
  not hold. The document itself never carries image bytes; the cap on one stored document leaves the
  document's own text and structure.
- A purge takes the note with its blobs, its link, its member shares, its search text, every account's
  pin of it and every account's record of opening it. A save that drops an image leaves its bytes
  standing until the note goes: the store collects no garbage of its own.
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
  table lacks it (read from the table's own column list), and every note without a search row is given
  one holding its title and no text — all in one transaction, so a store from before any of it opens
  whole and a store already upgraded opens unchanged, however often it is opened.
- A deletion moves the note to a trash list; a restore moves it back; a purge deletes the row and is
  open for a trashed note only. Nothing else deletes a note.
- A stored document is capped at a setting (`[notes] max_doc_bytes`); a save past the cap is refused
  `too-large` and the editor keeps its unsaved state on screen.

## Events

- The service publishes `note.saved`, `note.trashed`, `note.restored` and `note.purged`, each naming
  its note and its owner, and `note.shared` and `note.unshared`, naming the member too, kept in the
  same in-memory ring every platform service keeps and answered over the common stream route.
- An event reaches the note's owner and the members the note is shared with as it is published; a
  share's own two events reach its owner and that member. The console bundle subscribes through the
  console and reads the navigator again, so a note shared with a reader appears in their shared section
  without a reload. A restart loses the ring, as every unit's does.

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
  whole current body as a line list. The supervisor answers with that same line list edited — one
  fenced block holding the whole new text, in the protocol the panel's own heading states. To rename
  the note, its answer puts the new title on the fenced block's first line under a `[[title]]` mark,
  above the lines; the title rides the same document and the same versioned save as a body change
  does, and a rename with no body change is an answer that changes no line. The mark is stripped
  before the lines reach the patch, and a paragraph whose own words open with it wears the protocol's
  escape, so no note line ever reads as a rename. The note never stands rewritten by a partial
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
  drags stands whole while there is room for it and comes back when a wider row returns. Its key stands at the
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

- The bundle keeps bmo-ui's console plugin contract (bmo-ui `docs/console-bundles.md`). Within it the
  note asks for the member role and an owner key on every call the screens make, and names one other
  service under `calls`, the receiver, which the AI talk panel speaks through; the bundle calls nothing
  else beside its own service, and reads the console's people directory for the share dialog's members.
  `docs/api.md`, 「Console」, names the rest of what the note chooses.
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
  icon, large, over the title the editor draws large as the document's own. A note with no icon shows
  a key to add one there while the pointer is over the head or the keyboard's focus is in it; the icon key opens a
  popover of a small set of emoji and a key that removes the icon. A reader who cannot write the note sees the icon and
  nothing to press. There is no cover.
- **Full width** releases the editor's column to the region's width, for that note in that browser.
- **The note is saved as the editor writes it** (「Editing and saving」): a moment after each edit, and at
  once on Ctrl+S (⌘S) wherever the focus stands on the screen, in place of the browser's own save, each
  save carrying the note's plain text. Where a reader must act (a refused save, a conflict) a band above
  the document says so, with the key that acts on it. Choosing another note or leaving the screen with a
  change unsent sends it first, and asks before throwing it away where it cannot land.
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
  document itself caps unless the note stands at full width.
- The editor stands under a format bar of the bundle's own: inline marks, the kind of the block under the caret
  chosen from bmo-ui's one select among text, three headings, three lists, quote and code, an image upload and a
  table insert, each driving the vendored editor's own command chain,
  so the bar, the hotkeys and the slash menu all ride one mechanism. The bar and the editor stand as
  one column filling the note region; the bar spans that column, but its controls stand in one gathered,
  centred row of their own width, never spread edge to edge. The talk key stands apart at its trailing
  edge, since it acts on the whole note rather than the selection. Where the bar is wider than the
  screen, as on a phone, the talk key holds to the bar's end and the format keys scroll sideways before
  it, so it stands in sight at every width. Every key in the bar is the library's small button at its own
  size, an icon-only key its small square, centred in the row with its hover and press filling its own
  shape, never a cell stretched to the row's height. Slash commands stay a shortcut, never
  the way in. The image key opens a file input of the bundle's own: it carries the native hidden
  attribute, and the bundle's stylesheet holds it hidden with an `!important` rule. The selection toolbar,
  the drag handle and the floating format menu are the fork's own and stand as it drew them, but for four
  things. On a touch screen the floating format menu stands down: it is wider than a phone, it doubles the
  bar, and the phone lays its own selection menu over the words; the bar does its work there. The selection
  toolbar over a block chosen whole stands on a touch screen all the same, since a chosen block is what a
  phone holds to act on (below). Every block chosen whole, by the handle or by a held finger, raises the
  selection toolbar (below). And the toolbar never stands wider than the screen it is drawn on (below).
- **Every block has its handle and its toolbar.** The drag handle stands beside whichever top-level block
  the pointer is over, whatever its kind; pressing it selects that block whole, and the selection toolbar
  rises over it with what the block offers, its copy, duplicate and delete among them. Delete or Backspace
  removes a block selected whole. The fork raises that toolbar only for a block whose kind declares a
  toolbar of its own, or for text, lists, code and images; a table, a divider, an equation and a database
  declare none, so the bundle declares for each of them a toolbar holding copy, duplicate and delete, the
  three the other blocks carry in their more menu, standing as keys of their own since the block offers
  nothing else. These keys wear the format bar's icon set, each with a tooltip naming it in the console's
  language from the bundle's pack, and the line the copy key says comes from the pack as well. A kind the
  fork adds later that declares no toolbar is one more entry in that declaration. The fork's own keys,
  menus and lines answer to the console's language through the seam named below.
- The press on the handle lands inside the editable page, so the browser lays a caret in the nearest line
  as well, which the editor would read a moment later as a text selection over the block; the bundle drops
  that caret as the press is let go, so the block stays selected whole however briefly or long the press
  was held. A drag from the handle goes down as the browser has it.
- The editor's column keeps a gutter for the handle, but a heading over a section or a list holding others
  stands its handle a toggle's width further out; so the editor's viewport, which clips what stands outside
  it, keeps a leading room of its own, 16 pixels, and the head over the document moves with it, so that
  handle stands in view where the column meets the editor's edge, on a phone or at full width.
- **On a phone a held finger in the gutter chooses a block whole.** The handle follows a pointer, which a
  touch screen has none of, so a phone reaches a block the way its note rows are reached: with a held finger.
  The room left of the document's column, where a pointer's handle stands, is where the finger holds, and
  bmo-ui's one hold (bmo-ui's `docs/components.md`, 「A held finger」) reads it: the top-level block standing
  at that height is chosen whole and its toolbar rises over it, the same choice and the same toolbar a press
  on the handle makes. A short press in the gutter is left to the fork's own reading of a press on the blank
  room beside the column, which chooses a block that holds no words and hands a line of words its caret; the
  hold is what chooses a line of words whole. A finger that slides past the hold's own distance, a scroll
  that starts under it, a second finger or a press shorter than the hold makes no choice of this
  interaction's, and the click the lifted finger lands is turned away, since the editor would otherwise stand
  its own reading of the blank room in place of what the hold chose. The hold never reaches the words: a
  field's words keep the hold to the phone's own choosing of them, and the block under them is chosen from
  the gutter beside it.
- The selection toolbar stands on a touch screen where a block stands chosen whole, though the floating
  format menu stands down there: the screen carries a mark while its editor holds a block chosen whole,
  and the bundle's rule hides the fork's toolbar widget only where no mark stands.
- **The selection toolbar never stands wider than the screen.** Over a text block the fork's bar is 663
  pixels wide, wider than a phone, and its more menu and the delete in it stand past the edge. Where the
  editor's own room has no place for it — under a finger as with a pointer in a narrow window — the bundle
  folds the fork's keys of a text block away and stands the block's three of the bundle's own, the same
  copy, duplicate and delete the other kinds carry, since the marks and the kinds those folded keys reach
  for are the format bar's work at every width. A bar that stays wide is kept to the screen as well: it
  lives in the shadow room of the fork's own widget, which no rule of the bundle reaches, so the bundle lays
  a sheet of its own in that room, and past the width a screen leaves it a bar wraps its keys into further
  centred rows rather than stand past the edge. Either way the bar keeps its place over the block it acts
  on.
- **The screens' browser test holds them to these rows.** It builds the note service from the checkout,
  starts it on a settings folder and a store of its own, starts the bundle's dev host relaying to it as
  the console would, writes a few notes of realistic Korean titles and text through the relay, and drives
  the screen in a real browser at 1,280 and 360 pixels wide, in the light and the dark scheme: the
  navigator with every section and the trash at its foot; a note open, its bar holding the state at its
  leading end and the star, the share key and the more key at its trailing end; the empty note region;
  the search dialog before typing, with results whose matches are marked and with none; the more menu;
  a note in the trash under its band; and, on a phone, the navigator risen in its drawer. On a wide screen
  the create button closes the navigator's head, a grey icon whose tooltip names a new note and its key,
  and the key makes a note; every key of the format bar is the library's small button, an icon-only one
  its small square, centred with room above and below it and its hover on its own shape; the talk key
  stays in sight while the keys scroll on a phone; a missing note keeps the bar with the navigator's key;
  and no screen scrolls sideways on a phone. It keeps a picture of each state, and runs in the suite's
  browser lane, apart from the client's own check, skipped where the browser build is not on the machine.
  The handle's browser test stands on the same stack and holds 「Every block has its handle and its
  toolbar」 at both widths with a pointer: a note holding a block of every kind the editor's menus make,
  each block's handle in view beside it and its press selecting it whole under a toolbar that stands whole
  inside the screen at either width, its way to delete among its keys there — the fork's own more menu at a
  desktop's width, the bundle's three keys once the room folds them; a table's handle pressed while the
  caret stands in one of its cells, the
  table's copy, duplicate and delete keys, named in Korean, on top of what they stand over; the toolbar's duplicate and
  delete, and Delete and Backspace, each acting on a table selected whole; and a picture of the table's
  handle and its toolbar. The same width read by a finger holds 「On a phone a held finger in the gutter
  chooses a block whole」: a finger held in the gutter beside a line of words chooses it whole under a
  toolbar that stands inside the screen and reaches delete, a table so chosen is duplicated and deleted by
  its own three keys, the fold that leaves a line of words with those same three keys at a phone's width
  and the delete among them taking the line away, and a finger that slides, a press shorter than the hold
  and a hold on the words choosing nothing; the touch sequence is laid down as a real finger lays it. A
  picture of the phone's choice is kept with the rest.
- **A browser file of its own holds 「The editor's own words follow the console's language」 on the real
  screen.** The console reads Korean: it selects a run of words and reads the keys of the toolbar that rises
  over them, their tooltips and the entries of the menu gathered under the last one; it calls the slash menu
  and reads its group titles and item names; it reads the hint an empty line holds, a caption's hint and the
  line a copy of a block says. It holds a pointer over a toolbar key and over the items of the slash menu and
  reads the rooms that rise for them, so a word held only in a hover room is read where a reader sees it.
  Every line left standing in those rooms in the fork's English is a line the pack answers with nothing: a
  file's name or a person's, a formula, a piece of code, a date, or a product's own name, each one named in
  the file.
  Every other word it reads is the pack's word for that thing, read out of the pack by the file itself,
  never written as letters in the file, and no word of that chrome is left standing in the fork's English.
- **The editor's styles stay in the editor.** The vendored editor lays its stylesheets on the page as plain
  style elements, unlayered, which beat every layered rule of the console; and a few of its rules name nothing
  of the editor's own — a bare `input`, a `.truncate` — so once a note is opened they would reach every screen
  of the console for the life of the tab: inputs losing their room so an icon stands over the words, a cut line
  lifted off its row. So from the moment the editor is first set up, the bundle reads each stylesheet the
  editor lays and holds every rule whose selector names no element, class or attribute of the editor's own to
  the editor's host. Rules that name the editor's own, and the page-wide ones (`:root`, `html`, `body`), which
  carry the editor's variables, stand as laid.
- An image an editor inserts is held on the service before its block stands: the editor's blob store
  is the note's own blob routes, so uploads and read-backs cross the console's relay like every other
  call, and a note reads back its images wherever it is opened.
- **The editor's own words follow the console's language.** The fork names the words of its own chrome —
  the keys of the selection toolbar and their tooltips, the menus under them, the slash menu, the caption
  hint, the hint an empty line holds, and its lines of notice — as English inside its own sources, and
  ships neither a translation nor a hook to supply one. The fork therefore carries a seam of its own: one
  translator, installed by whoever mounts the editor and read at the points where a word of that chrome is
  drawn — the renderers of toolbar actions and of menu items, the buttons a menu row draws its words in,
  the slash menu's view, the panels the phone's keyboard bar opens, the line of notice, the caption editor,
  the hint an empty line holds and the menu that names a block's row or column. A word is answered by
  whatever the mounter says; a word nothing answers for stands exactly as the fork wrote it, so the seam
  cannot lose a word the fork adds later, and an answer never rewrites itself. Only what a person reads
  changes: the fork's own handles for lookups, its `data-testid` values and the `text` attribute its menu
  scrollers read, keep the words the fork wrote. What a reader types into the slash menu is matched against
  the words as shown as well as the words the fork wrote, so a reader who knows only a Korean name still
  finds the item. The bundle installs the
  translator as it mounts an editor and answers each word the fork says with the console's word for it,
  held in the bundle's pack under both locales, keyed by the English words themselves, following the
  console's wording guide as every other word the bundle writes does. What the bundle names for itself —
  the three keys over a block chosen whole, its format bar, its screens — was always the pack's.
  - **A hover room answers its words once it stands drawn.** The words of a room a pointer's hover brings
    up live inside a template, where markup and words stand together, so no word of one can be asked
    before the room is drawn. The room asks them, line by line, of the same seam at the moment its content
    is laid out for the reader, and a renderer asks only for a room that holds the editor's own chrome — a
    key's hint, the slash menu's card — so a room holding a reader's own words, a document's title among
    them, is never rewritten. A line is asked as it reads with its outer spacing cut away and is put back
    with that spacing kept, and a line nothing answers for stands exactly as the fork drew it. Which lines
    the pack answers is the bundle's to say: it answers what a card says to the reader — its lines of
    guidance, the names it carries, and the sample lines of the document a card pictures — and leaves what
    a card only shows as contents: a file's name or a person's, a value filling a cell of a sample table,
    the letters and numbers of a formula or of code, and a date.
- The screen is read in the console's screen mode and keeps none of its own. The bundle's chrome is
  drawn from the console's tokens, so it stands in the mode the console stands in as it is written;
  the vendored editor colours itself by a `data-theme` attribute of the document element instead —
  its theme service watches that attribute and its stylesheet states both modes under it — so the
  bundle mirrors the console's mode onto it and the document switches as the console's own screens
  do. Light is as the fork drew it.

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
  read only: the format bar keeps its keys disabled, the talk key, Ask AI, the share key and the icon key
  do not stand, nothing is saved, and the bar's state says the note is read only where it would tell the
  save state. Opened by an `edit` member, the screen is the owner's but for the share key and moving the
  note to the trash. Either member pins, copies the link of and duplicates the note as their own.
- **The share page stands with no frame of the console's,** its own bar holding the note's title, and
  under it the document read only, its images read through the link. A link that opens nothing stands
  as its own state, one line saying the note is not shared.
- **The sharing browser test holds the screens to this.** On the same throwaway service and dev host as
  the screens' test, it drives the share dialog in a real browser: the owner makes a link and the share
  page opens the note read only with no format bar; the owner finds a member in the people directory and
  shares the note; the member finds it in the navigator's shared section and opens it read only, with no
  share, talk or AI key; a reader it is not shared with finds no note; and once the owner takes the
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
- A note has no cover picture, no version history and no comments.
- Rows are not dragged to reorder: the own and the shared sections sort by last edited, title or created, and
  the pins keep the order they were pinned in.
- Search reads titles and the text of text blocks; the words inside an image are not searched, and a
  table's cells stand outside the text the client supplies.
- A member's own client supplies no text for a note it holds to read only, so a shared note saved before
  the text was asked for is found by its title until its owner or an editor opens it.

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
