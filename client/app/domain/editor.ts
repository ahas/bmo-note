// The view extensions the editor mounts with: the fork's own page view, held to one mode, with the
// services the preset asks the host for answered by the screen (docs/design.md, 「The console
// surface」). What the preset expects from its app shell, it gets here in the smallest shape.

import { toast } from "@blocksuite/affine/components/toast";
import { getInternalViewExtensions } from "@blocksuite/affine/extensions/view";
import { ViewExtensionManager } from "@blocksuite/affine/ext-loader";
import { DatabaseBlockSchema, DividerBlockSchema, LatexBlockSchema, TableBlockSchema } from "@blocksuite/affine/model";
import {
  copySelectedModelsCommand,
  deleteSelectedModelsCommand,
  draftSelectedModelsCommand,
  duplicateSelectedModelsCommand,
  getSelectedModelsCommand
} from "@blocksuite/affine/shared/commands";
import {
  ActionPlacement,
  CommunityCanvasTextFonts,
  DocModeProvider,
  FileSizeLimitProvider,
  FontConfigExtension,
  NotificationProvider,
  ToolbarModuleExtension
} from "@blocksuite/affine/shared/services";
import { BlockFlavourIdentifier, LifeCycleWatcher } from "@blocksuite/affine/std";
import { svg } from "lit";
import { Subscription } from "rxjs";

import type { Container } from "@blocksuite/affine/global/di";
import type { NotificationService, ToolbarAction } from "@blocksuite/affine/shared/services";
import type { ExtensionType } from "@blocksuite/affine/store";

/// The cap an image may carry, mirroring the store's own (`settings.toml`, `[notes] max_blob_bytes`).
/// The service refuses past its line whoever named what; this one only keeps the editor from
/// uploading a file it already knows the store will send back.
const MAX_BLOB_BYTES = 8 * 1024 * 1024;

/** What the editor can ask the screen to say: a line, and a question with an answer; and what the
 * selection toolbar's Ask AI key opens, under the word it wears, or none where the note stands read
 * only and the key does not stand. */
export interface EditorNotice {
  toast: (message: string) => void;
  confirm: (title: string) => Promise<boolean>;
  ask: (() => void) | null;
  askLabel: string;
}

// The sparkle the Ask AI key wears, drawn as the format bar's own icon set draws it.
const ASK_ICON = svg`<svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="m19 9l-1.25-2.75L15 5l2.75-1.25L19 1l1.25 2.75L23 5l-2.75 1.25L19 9Zm0 14l-1.25-2.75L15 19l2.75-1.25L19 15l1.25 2.75L23 19l-2.75 1.25L19 23ZM9 20l-2.5-5.5L1 12l5.5-2.5L9 4l2.5 5.5L17 12l-5.5 2.5L9 20Zm0-4.85L10 13l2.15-1L10 11L9 8.85L8 11l-2.15 1L8 13l1 2.15ZM9 12Z"/></svg>`;

// The keys of a block selected whole that declares no toolbar of its own, drawn as the format bar's own icon
// set draws them.
const COPY_ICON = svg`<svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M9 18q-.825 0-1.412-.587T7 16V4q0-.825.588-1.412T9 2h9q.825 0 1.413.588T20 4v12q0 .825-.587 1.413T18 18zm0-2h9V4H9zm-4 6q-.825 0-1.412-.587T3 20V6h2v14h11v2zm4-6V4z"/></svg>`;
const DUPLICATE_ICON = svg`<svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M13 14h2v-3h3V9h-3V6h-2v3h-3v2h3zm-5 4q-.825 0-1.412-.587T6 16V4q0-.825.588-1.412T8 2h12q.825 0 1.413.588T22 4v12q0 .825-.587 1.413T20 18zm0-2h12V4H8zm-4 6q-.825 0-1.412-.587T2 20V6h2v14h14v2zM8 4v12z"/></svg>`;
const DELETE_ICON = svg`<svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M7 21q-.825 0-1.412-.587T5 19V6H4V4h5V3h6v1h5v2h-1v13q0 .825-.587 1.413T17 21zM17 6H7v13h10zM9 17h2V8H9zm4 0h2V8h-2zM7 6v13z"/></svg>`;

/// The block kinds the fork raises no selection toolbar for once the drag handle selects them whole: each
/// declares no toolbar of its own and is not one the fork's note toolbar covers (`docs/design.md`, 「Every
/// block has its handle and its toolbar」).
const KINDS_WITHOUT_TOOLBAR = [TableBlockSchema, DividerBlockSchema, LatexBlockSchema, DatabaseBlockSchema].map((schema) => schema.model.flavour);

const manager = new ViewExtensionManager(getInternalViewExtensions());

/** The page-mode view extensions, with the host services the preset reads overridden. */
export function pageExtensions(notice: EditorNotice): ExtensionType[] {
  const mode: DocModeProvider = {
    getPrimaryMode: () => "page",
    onPrimaryModeChange: () => new Subscription(),
    getEditorMode: () => "page",
    setEditorMode: () => {},
    setPrimaryMode: () => {},
    togglePrimaryMode: () => "page"
  };
  const messages: NotificationService = {
    toast: (message) => notice.toast(String(message ?? "")),
    confirm: async (options) => notice.confirm(String(options.title ?? "")),
    prompt: async () => null,
    notify: (options) => notice.toast(String(options.title ?? "")),
    notifyWithUndoAction: (options) => notice.toast(String(options.title ?? ""))
  };

  const ask = notice.ask;

  return [
    ...(manager.get("page") as ExtensionType[]),
    FontConfigExtension(CommunityCanvasTextFonts),
    // Ask AI leads the toolbar the editor floats over a text selection (`docs/design.md`, 「Ask AI」).
    ...(ask === null ? [] : [askModule(notice.askLabel, ask)]),
    ...KINDS_WITHOUT_TOOLBAR.map(blockModule),
    HandlePressKeepsBlock,
    {
      setup: (di: Container) => {
        di.override(DocModeProvider, () => mode);
        di.override(NotificationProvider, () => messages);
        di.override(FileSizeLimitProvider, () => ({ maxFileSize: MAX_BLOB_BYTES }));
      }
    }
  ];
}

/** The selection toolbar's Ask AI key, wearing `label` and opening `ask`. */
function askModule(label: string, ask: () => void): ExtensionType {
  return ToolbarModuleExtension({
    id: BlockFlavourIdentifier("custom:affine:note"),
    config: {
      actions: [
        {
          id: "A.ask",
          placement: ActionPlacement.Start,
          score: -1,
          label,
          showLabel: true,
          icon: ASK_ICON,
          run: () => ask()
        }
      ]
    }
  });
}

// The blocks a toolbar key acts on: those selected whole, each counted once with what it holds.
const SELECTED_WHOLE = { types: ["block" as const], mode: "highest" as const };

/** The keys of a block selected whole that declares no toolbar of its own: copy, duplicate and delete, the
 * three every other block carries in its more menu, run through the same commands. */
const BLOCK_ACTIONS: ToolbarAction[] = [
  {
    id: "a.copy",
    tooltip: "Copy",
    icon: COPY_ICON,
    run: ({ chain, host }) => {
      const [copied] = chain.pipe(getSelectedModelsCommand, SELECTED_WHOLE).pipe(draftSelectedModelsCommand).pipe(copySelectedModelsCommand).run();

      if (copied) toast(host, "Copied to clipboard");
    }
  },
  {
    id: "b.duplicate",
    tooltip: "Duplicate",
    icon: DUPLICATE_ICON,
    run: ({ chain, store }) => {
      store.captureSync();
      chain.pipe(getSelectedModelsCommand, SELECTED_WHOLE).pipe(duplicateSelectedModelsCommand).run();
    }
  },
  {
    id: "c.delete",
    tooltip: "Delete",
    icon: DELETE_ICON,
    run: ({ chain }) => {
      chain.pipe(getSelectedModelsCommand, SELECTED_WHOLE).pipe(deleteSelectedModelsCommand).run();
    }
  }
];

/** The toolbar of a block of `flavour` selected whole. */
function blockModule(flavour: string): ExtensionType {
  return ToolbarModuleExtension({
    id: BlockFlavourIdentifier(flavour),
    config: { actions: BLOCK_ACTIONS }
  });
}

/** A press on the drag handle selects its block whole, but the press lands inside the editable page, so the
 * browser also lays a caret in the nearest line; the editor turns that caret into a text selection a moment
 * later, over the block. The caret is dropped as the press is let go, before the editor reads it, so the block
 * stays selected whole however long the press was held (`docs/design.md`, 「Every block has its handle and its
 * toolbar」). A drag from the handle is not touched: its press goes down as the browser has it. */
class HandlePressKeepsBlock extends LifeCycleWatcher {
  static override readonly key = "note-handle-press-keeps-block";

  override mounted(): void {
    const host = this.std.host;

    host.disposables.addFromEvent(
      host,
      "pointerup",
      (event: PointerEvent) => {
        const onHandle = event.composedPath().some((target) => target instanceof Element && target.localName === "affine-drag-handle-widget");

        if (onHandle) host.ownerDocument.getSelection()?.removeAllRanges();
      },
      { capture: true }
    );
  }
}
