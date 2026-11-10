// The format bar's reads and writes (`docs/design.md`, 「The console surface」). The bar is the bundle's
// own; every line it changes is changed through the fork's own commands — the ones the hotkeys, the
// selection toolbar and the slash menu ride: the image insert opens the fork's own picker, stands the
// block beside the written line and keeps its rule of bytes first, block after.

import { addSiblingImageBlocks } from "@blocksuite/affine/blocks/image";
import { insertTableBlockCommand } from "@blocksuite/affine/blocks/table";
import { updateBlockType } from "@blocksuite/affine/blocks/note";
import { getSelectedModelsCommand } from "@blocksuite/affine/shared/commands";
import { FORMAT_BLOCK_SUPPORT_FLAVOURS, FORMAT_TEXT_SUPPORT_FLAVOURS, textFormatConfigs } from "@blocksuite/affine/inlines/preset";
import { BlockSelection, TextSelection } from "@blocksuite/affine/std";

import type { TextFormatConfig } from "@blocksuite/affine/inlines/preset";
import type { BlockModel } from "@blocksuite/affine/store";
import type { BlockStdScope, Command } from "@blocksuite/affine/std";

export interface BarConversion {
  flavour: string;
  type?: string;
  icon: string;
}

/** The inline marks the bar carries, in the fork's own order. The link keeps its own affordance in
 * the selection toolbar and the hotkey: it opens a field for an address, not a toggle. */
export const barMarks: TextFormatConfig[] = textFormatConfigs.filter((config) => config.id !== "link");

/** The kinds the bar turns lines into, in its order. */
export const barConversions: BarConversion[] = [
  { flavour: "affine:paragraph", type: "text", icon: "i-material-symbols-text-fields" },
  { flavour: "affine:paragraph", type: "h1", icon: "i-material-symbols-format-h1" },
  { flavour: "affine:paragraph", type: "h2", icon: "i-material-symbols-format-h2" },
  { flavour: "affine:paragraph", type: "h3", icon: "i-material-symbols-format-h3" },
  { flavour: "affine:list", type: "bulleted", icon: "i-material-symbols-format-list-bulleted" },
  { flavour: "affine:list", type: "numbered", icon: "i-material-symbols-format-list-numbered" },
  { flavour: "affine:list", type: "todo", icon: "i-material-symbols-checklist" },
  { flavour: "affine:paragraph", type: "quote", icon: "i-material-symbols-format-quote" },
  { flavour: "affine:code", icon: "i-material-symbols-code" }
];

/** Whether the bar turns on now: the written line's kind is one the fork's own format support lists
 * carry. (The fork's `isFormatSupported` answers false for a multi-character text selection — it
 * reads single-element conversions only — so the bar reads the same support lists at the model.) */
export function conversionsSupported(std: BlockStdScope): boolean {
  const model = writtenModel(std);

  if (model === undefined) return false;

  return FORMAT_BLOCK_SUPPORT_FLAVOURS.includes(model.flavour) || FORMAT_TEXT_SUPPORT_FLAVOURS.includes(model.flavour);
}

/** The kind the written line stands in, as an index of the bar's kinds; -1 where none does. */
export function activeConversion(std: BlockStdScope): number {
  const model = writtenModel(std);

  if (model === undefined) return -1;

  const type = "type" in model.props ? String(model.props.type) : undefined;

  return barConversions.findIndex((conversion) => conversion.flavour === model.flavour && (conversion.type ?? undefined) === type);
}

/** The marks' active states, in the bar's order, read the fork's own way; none where nothing is written. */
export function activeMarks(std: BlockStdScope): boolean[] {
  return barMarks.map((config) => config.activeWhen(std.host));
}

/** Turns the written line into one kind: the selection where the fork reads one, the caret's line
 * otherwise, and the written line itself where a press on the bar left the selection behind. */
export function convert(std: BlockStdScope, conversion: BarConversion): void {
  const input = { flavour: conversion.flavour, ...(conversion.type === undefined ? {} : { props: { type: conversion.type } }) };

  if (std.command.chain().pipe(updateBlockType, input).run()[0]) return;

  const model = caretModel(std) ?? writtenModel(std);
  if (model === undefined) return;

  std.command
    .chain()
    .pipe(asSelected(model))
    .pipe(updateBlockType, input)
    .run();
}

/** A command that stands the one written model where the fork's selection commands read back none. */
function asSelected(model: BlockModel): Command<{ selectedModels?: BlockModel[] }, { selectedModels: BlockModel[] }> {
  return (_ctx: unknown, next: (output?: { selectedModels: BlockModel[] }) => void) => next({ selectedModels: [model] });
}

/** Images chosen on the bar, through the fork's own insert: bytes first, block after, at the line
 * the selection names or the one under the caret. The picker is the bar's own input, so the accept
 * line and the button's words stay the bundle's and the flow needs no user-activation-gated API. */
export async function insertImages(std: BlockStdScope, files: File[]): Promise<string[]> {
  const model = writtenModel(std);

  if (files.length === 0 || model === undefined) return [];

  return addSiblingImageBlocks(std, files, model, "after");
}

/** A table through the fork's own insert, at the same place. */
export function insertTable(std: BlockStdScope): boolean {
  const model = writtenModel(std);
  if (model === undefined) return false;

  return std.command
    .chain()
    .pipe(asSelected(model))
    .pipe(insertTableBlockCommand, { place: "after", removeEmptyLine: true })
    .run()[0];
}

/** The model the writer is at: a selected one where the fork reads any, else the block under the caret. */
export function writtenModel(std: BlockStdScope): BlockModel | undefined {
  const [ok, context] = std.command
    .chain()
    .pipe(getSelectedModelsCommand, { types: ["text", "block"], mode: "highest" })
    .run();

  if (ok && context.selectedModels.length > 0) return context.selectedModels[0];

  return caretModel(std);
}

/** The block the caret or the selection stands at. */
export function caretModel(std: BlockStdScope): BlockModel | undefined {
  const text = std.selection.find(TextSelection);
  if (text !== undefined) {
    const model = std.store.getBlock(text.from.blockId)?.model;

    return model === undefined ? undefined : (std.store.getParent(model) ?? model);
  }

  const block = std.selection.find(BlockSelection);
  if (block !== undefined) return std.store.getBlock(block.blockId)?.model;

  return undefined;
}
