# The boundary API

Every route bmo-note answers, the events it publishes, and the calls it makes. The wire format is the
platform's (bmo-chat `docs/conventions.md`): camelCase keys, times in epoch milliseconds, ids as
strings, a failure a non-2xx status with `code` (kebab-case) and `error` (an English sentence), a list
`{items, more}` read with `after` and `limit`. A note document travels as a base64 string in the
`doc` field: the whole Yjs state of one BlockSuite document, opaque to this service
(`docs/design.md`, 「What a note is」).

## The control port

The service listens on the loopback at the address `env/note.toml` names (`[server] listen`, by
convention `127.0.0.1:13129`), under `Authorization: Bearer <token>` with the service token
(`[server] token`). The console reaches it with the console credential (`[console] token`) and the
headers the console sets on every relayed call: `Owner-Key`, the signed-in account's id, and
`Owner-Role`, `administrator` or `member`. A call with no credential or a wrong one is 401
`unauthorized`; a console call with no `Owner-Key` (or one longer than 200 characters), or with an
`Owner-Role` that is neither word, is 403 `forbidden`, the console's own reads of the manifest, the
words, the module and the stylesheet aside (「Console」). A service-token call names the account it
acts for with an `owner` query (or path-side query of the same name on the list).

## Health

| Method | Path | Does |
|---|---|---|
| GET | `/health` | `ready`, `reason` (null when ready), `version` |

The service is ready once its store is open. It calls no other unit; its screens speak to the receiver
directly through the console's relay, on the manifest's `calls` (below).

## Notes

| Method | Path | Does |
|---|---|---|
| GET | `/notes?deleted=&after=&limit=` | The caller's notes, newest changed first — `{items, more}`; `deleted=true` answers the trash |
| POST | `/notes` | Makes a note: `id?`, `title`, `doc` (base64) — 201, or 200 with the note as it stands where the id is already held (idempotent by id; stored bytes unchanged) |
| GET | `/notes/{noteId}` | One note with its document |
| PATCH | `/notes/{noteId}` | Saves: `version` (required), `title?`, `doc?`, `restore?` — 200, or 409 `version-conflict` answering the current metadata |
| DELETE | `/notes/{noteId}?purge=` | Moves the note to the trash, or, with `purge=true`, deletes it for good where it stands trashed, its stored images with it — 204 |
| PUT | `/notes/{noteId}/blobs/{blobId}` | Stores one image with the live note: the body is its bytes, `content-type` its image type — 204; an id already held keeps the bytes it was first given (a re-upload answers the same 204 whatever it carries) |
| GET | `/notes/{noteId}/blobs/{blobId}` | One stored image: its bytes with the type it was stored under, `cache-control: private, max-age=31536000, immutable`; 404 where none stands |

A note metadata is `id`, `title` (may be empty; the screen names an empty one by its own word),
`version` (a whole number from 1, held up on each save), `createdAt`, `changedAt`, `size` (stored doc
bytes), `deletedAt` (null while the note lives). A note read adds `doc`. A write's `id` is 1 to 64
letters, digits, `-` and `_`; one is made where none is given (lowercase hexadecimal). A `doc` that is
not base64 for at least one byte is 422 `bad-doc`; a `title` over 300 characters, a `version` below 1
or a body that is not one object is 400 `bad-request`; a decoded `doc` over `[notes] max_doc_bytes` is
413 `too-large`; a note the account does not hold live is 404 `not-found`; a `restore` or `doc` write
on a trashed note is 422 `trashed`; a `purge` of a live note is 422 `not-trashed`. A `PATCH` whose
`version` is below the stored one answers 409 `version-conflict`; one at or above it saves (a writer
who read ahead of the service loses nothing it did not already hold). `restore=true` with no `doc`
moves a trashed note back to life and writes nothing else; on a live note it changes nothing.

The blob routes stand under the note: a `PUT` needs the note live (a trashed note is 422 `trashed`, no
note 404), its `content-type` must name an image, its `blobId` must be a BlockSuite blob key (1 to
128 letters, digits, `-`, `_` and `=`), and its bytes must not pass `[notes] max_blob_bytes` (413
`too-large`). A
`GET` answers wherever the note stands, live or trashed, to its owner alone; a purge has taken the blobs.

A service-token call on these routes answers for the `owner` it names; one naming none is 422
`no-owner`.

## Console

| Method | Path | Does |
|---|---|---|
| GET | `/console-manifest` | The bundle manifest (bmo-ui `docs/console-bundles.md`): `name` `note`, `title` `note.title`, `icon` `i-material-symbols-edit-note-outline`, `screenPath` `/note`, `serviceName` `note`, `apiPrefix` `/`, `role` `member`, `ownerKey` true, `events` true (the stream below), `websocket` false, `calls` naming the receiver alone (the AI talk panel's `POST /talks`, under the receiver's own terms), and `pushKinds`, `relays`, `shareReads` empty |
| GET | `/console/words` | The bundle's words, every locale |
| GET | `/console/{*file}` | The bundle's module and stylesheet, and every other file its build left |

The four take the console credential (or the service token) with no owner key and no role. They are
read from the bundle's built folder (`[console] folder`) once at start: the module `bundle.js`, the
stylesheet `bundle.css` and the words `words.json`, the module and the stylesheet answered at
`/console/bundle-<digest>.js` and `.css`, the digest the first sixteen hex digits of their bytes'
SHA-256, with `cache-control: private, max-age=31536000, immutable`. The editor's own body is one
module; what it pulls as it works — language packs, canvases, fonts its stylesheet names — stands as
further files of the same build, each answered under `/console/` by the name the build gave it (its
own content hash in it), on the same cache line; a name that walks outside the folder answers
`not-found`. A folder that does not hold the three named files leaves the four answered 404
`not-found`.

## Events the note service publishes

`GET /events` is a server-sent stream in the platform's shape (`after` or `Last-Event-ID`, `kinds`;
the same events as a page to `Accept: application/json`, with `after` and `limit`): `note.saved`,
`note.trashed`, `note.restored` and `note.purged`, each carrying `noteId` and `owner`. A console
reader is given its own account's events alone; the service token reads every one. The service keeps
the events since it started, at most the last 1000, numbered upward from its start's moment in
milliseconds times 1000; a resume from before them is 410 `gone`.

## Calls the note service makes

None. The unit holds its own truth in its own store and reaches no peer; the console reaches it, not
the other way round.

## Codes

Beside the common codes of bmo-chat's `docs/conventions.md` (`bad-request`, `unauthorized`, `forbidden`,
`no-route`, `not-found`, `gone`, `failed`), each answered as it stands there:

| Code | When |
|---|---|
| `too-large` | a document or an image past the stored byte cap (413) |
| `version-conflict` | a save made from behind the stored version (409, answering the current metadata) |
| `no-owner` | a service-token call naming no account (422) |
| `bad-doc` | a `doc` that is not base64 bytes (422) |
| `trashed` | a write on a note standing in the trash (422) |
| `not-trashed` | a purge of a note that does not stand in the trash (422) |

## Settings

The settings are read at start in layers, each overriding the one before: the defaults built into the
binary (the repository's `settings.toml`); then `settings.toml` and `settings.local.toml` in the
settings folder, the one `BMO_NOTE_SETTINGS` names, else the folder above the one holding the binary (a
deployment's root, where `settings.local.toml` links to the data root's `env/note.toml`); then
`BMO_NOTE_<TABLE>__<KEY>` in the environment.

| Table | Key | What it is |
|---|---|---|
| `server` | `listen` | where the service answers, `host:port` |
| `server` | `token` | the service token; an empty one lets no caller in |
| `server` | `data_root` | the data root; under it the store's folder stands where the store path is relative |
| `console` | `token` | the console credential; empty, the console reaches nothing |
| `console` | `folder` | the console bundle's built folder (`client/dist` where none is set; a relative one read from where the process starts) |
| `store` | `path` | the SQLite file; a relative one is read under the data root's `note/` folder |
| `notes` | `max_doc_bytes` | the cap on one stored document, in bytes |
