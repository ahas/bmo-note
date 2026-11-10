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
  mark, and the byte size. The title is written by the client from the document's title block on each
  save, so the list answers titles without opening the bytes.
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

- One SQLite file under the unit's data directory holds one table: each note's owner, id, title, doc
  bytes, version, timestamps, and deleted mark. Attachments (images, files) are out of v1: pasting one
  into the editor is disabled so no block stands on bytes no service holds. A blob store is a row.
- A deletion moves the note to a trash list; a restore moves it back; a purge deletes the row and is
  open for a trashed note only. Nothing else deletes a note.
- A stored document is capped at a setting (`[notes] max_doc_bytes`); a save past the cap is refused
  `too-large` and the editor keeps its unsaved state on screen.

## Events

- The service publishes `note.saved`, `note.trashed`, `note.restored` and `note.purged`, each naming
  its note and its owner, kept in the same in-memory ring every platform service keeps and answered
  over the common stream route. The console bundle subscribes through the console and refreshes the
  open list. A restart loses the ring, as every unit's does.

## The console surface

- The bundle follows bmo-ui's console plugin contract: a manifest at `/console-manifest`, a built
  module and stylesheet at digested paths, and words at `/console/words`, guarded by the console's
  credential and the member role, with an owner key on every call the screens make.
- Two screens stand under `/note`: the list (title, moment, newest first, a new-note key, a trash
  view with restore and purge) and the editor (`/note/<id>`: the BlockSuite document, its title at
  the top, the autosave mark). The console's title bar names the editor and carries its actions.
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
