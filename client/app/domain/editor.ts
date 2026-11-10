// The view extensions the editor mounts with: the fork's own page view, held to one mode, with the
// services the preset asks the host for answered by the screen (docs/design.md, 「The console
// surface」). What the preset expects from its app shell, it gets here in the smallest shape.

import { getInternalViewExtensions } from "@blocksuite/affine/extensions/view";
import { ViewExtensionManager } from "@blocksuite/affine/ext-loader";
import {
  ActionPlacement,
  CommunityCanvasTextFonts,
  DocModeProvider,
  FileSizeLimitProvider,
  FontConfigExtension,
  NotificationProvider,
  ToolbarModuleExtension
} from "@blocksuite/affine/shared/services";
import { BlockFlavourIdentifier } from "@blocksuite/affine/std";
import { svg } from "lit";
import { Subscription } from "rxjs";

import type { Container } from "@blocksuite/affine/global/di";
import type { NotificationService } from "@blocksuite/affine/shared/services";
import type { ExtensionType } from "@blocksuite/affine/store";

/// The cap an image may carry, mirroring the store's own (`settings.toml`, `[notes] max_blob_bytes`).
/// The service refuses past its line whoever named what; this one only keeps the editor from
/// uploading a file it already knows the store will send back.
const MAX_BLOB_BYTES = 8 * 1024 * 1024;

/** What the editor can ask the screen to say: a line, and a question with an answer; and what the
 * selection toolbar's Ask AI key opens, under the word it wears. */
export interface EditorNotice {
  toast: (message: string) => void;
  confirm: (title: string) => Promise<boolean>;
  ask: () => void;
  askLabel: string;
}

// The sparkle the Ask AI key wears, drawn as the format bar's own icon set draws it.
const ASK_ICON = svg`<svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="m19 9l-1.25-2.75L15 5l2.75-1.25L19 1l1.25 2.75L23 5l-2.75 1.25L19 9Zm0 14l-1.25-2.75L15 19l2.75-1.25L19 15l1.25 2.75L23 19l-2.75 1.25L19 23ZM9 20l-2.5-5.5L1 12l5.5-2.5L9 4l2.5 5.5L17 12l-5.5 2.5L9 20Zm0-4.85L10 13l2.15-1L10 11L9 8.85L8 11l-2.15 1L8 13l1 2.15ZM9 12Z"/></svg>`;

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

  return [
    ...(manager.get("page") as ExtensionType[]),
    FontConfigExtension(CommunityCanvasTextFonts),
    // Ask AI leads the toolbar the editor floats over a text selection (`docs/design.md`, 「Ask AI」).
    ToolbarModuleExtension({
      id: BlockFlavourIdentifier("custom:affine:note"),
      config: {
        actions: [
          {
            id: "A.ask",
            placement: ActionPlacement.Start,
            score: -1,
            label: notice.askLabel,
            showLabel: true,
            icon: ASK_ICON,
            run: () => notice.ask()
          }
        ]
      }
    }),
    {
      setup: (di: Container) => {
        di.override(DocModeProvider, () => mode);
        di.override(NotificationProvider, () => messages);
        di.override(FileSizeLimitProvider, () => ({ maxFileSize: MAX_BLOB_BYTES }));
      }
    }
  ];
}
