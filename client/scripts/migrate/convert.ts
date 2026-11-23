// The migration's conversion (`docs/design.md`, 「What a note is」): one note's BlockSuite snapshot, as the
// editor's own transformer reads it out of the stored Yjs bytes, written as the TipTap document the note
// editor now keeps. Text, headings, lists, to-dos, quotes, code, tables, images, links and dividers carry
// over whole; a block of a kind the note editor has no node for keeps its words as paragraphs, and every
// such step is named in the conversion's notes so the run's report says what changed shape.
//
// The snapshot is plain JSON, so this module reads it without any of the editor's code.

/** One block of a BlockSuite snapshot: its flavour, its props and its children. */
export interface SnapshotBlock {
  id?: string;
  flavour: string;
  props?: Record<string, unknown>;
  children?: SnapshotBlock[];
}

/** A TipTap JSON node. */
export interface Node {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  marks?: Mark[];
  text?: string;
}

interface Mark {
  type: string;
  attrs?: Record<string, unknown>;
}

/** One op of a BlockSuite text's delta. */
interface DeltaOp {
  insert?: unknown;
  attributes?: Record<string, unknown>;
}

/** The conversion of one note: its document, and what changed shape on the way. */
export interface Converted {
  doc: Node;
  notes: string[];
}

/** What the conversion needs of the note beyond its snapshot: whose it is, for a link to another note. */
export interface Context {
  owner: string;
}

/** The text a BlockSuite text prop holds, as its delta. */
function deltaOf(value: unknown): DeltaOp[] {
  const holder = value as { delta?: unknown } | null | undefined;

  return Array.isArray(holder?.delta) ? (holder.delta as DeltaOp[]) : [];
}

/** The plain words of a delta. */
export function deltaWords(value: unknown): string {
  return deltaOf(value)
    .map((op) => (typeof op.insert === "string" ? op.insert : ""))
    .join("");
}

const KEPT_MARKS: Record<string, string> = { bold: "bold", italic: "italic", underline: "underline", strike: "strike", code: "code" };

/** A delta as inline nodes: its words with their marks, a line break inside as a hard break, a link to a
 * page as a note link, and the attributes no mark carries named in the notes. */
function inline(value: unknown, context: Context, notes: Set<string>, words = true): Node[] {
  const nodes: Node[] = [];

  for (const op of deltaOf(value)) {
    if (typeof op.insert !== "string" || op.insert === "") continue;

    const attributes = op.attributes ?? {};
    const marks: Mark[] = [];
    let mention: Node | null = null;

    for (const [name, given] of Object.entries(attributes)) {
      if (given === null || given === undefined || given === false) continue;

      if (KEPT_MARKS[name] !== undefined) marks.push({ type: KEPT_MARKS[name] });
      else if (name === "link" && typeof given === "string") marks.push({ type: "link", attrs: { href: given } });
      else if (name === "reference" && typeof (given as { pageId?: unknown }).pageId === "string") {
        mention = { type: "mention", attrs: { id: (given as { pageId: string }).pageId, owner: context.owner, label: op.insert.trim() } };
      } else if (name === "latex" && typeof given === "string") marks.push({ type: "code" });
      else notes.add(`inline ${name} dropped`);
    }

    if (mention !== null) {
      nodes.push(mention);
      continue;
    }

    const parts = words ? op.insert.split("\n") : [op.insert];

    parts.forEach((part, at) => {
      if (at > 0) nodes.push({ type: "hardBreak" });
      if (part !== "") nodes.push(marks.length > 0 ? { type: "text", text: part, marks } : { type: "text", text: part });
    });
  }

  return nodes;
}

function paragraph(content: Node[]): Node {
  return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };
}

function textParagraph(words: string): Node {
  return paragraph(words === "" ? [] : [{ type: "text", text: words }]);
}

const LIST_OF: Record<string, string> = { bulleted: "bulletList", numbered: "orderedList", todo: "taskList", toggle: "bulletList" };

/** Converts one note's snapshot root, an `affine:page` block. */
export function convertSnapshot(root: SnapshotBlock, context: Context): Converted {
  const notes = new Set<string>();
  const title = deltaWords(root.props?.title).replace(/\s+/gu, " ").trim();
  const blocks: Node[] = [];

  for (const child of root.children ?? []) {
    if (child.flavour === "affine:surface") continue;

    if (child.flavour === "affine:note") blocks.push(...convertBlocks(child.children ?? [], context, notes));
    else blocks.push(...convertBlocks([child], context, notes));
  }

  const content: Node[] = [title === "" ? { type: "title" } : { type: "title", content: [{ type: "text", text: title }] }, ...blocks];

  // A note holds at least one block for the caret.
  if (blocks.length === 0) content.push({ type: "paragraph" });

  return { doc: { type: "doc", content }, notes: [...notes].sort() };
}

/** A run of sibling blocks, each list run gathered into one list node. */
function convertBlocks(blocks: SnapshotBlock[], context: Context, notes: Set<string>): Node[] {
  const out: Node[] = [];
  let at = 0;

  while (at < blocks.length) {
    const block = blocks[at]!;

    if (block.flavour === "affine:list") {
      const kind = String(block.props?.type ?? "bulleted");
      const run: SnapshotBlock[] = [];

      while (at < blocks.length && blocks[at]!.flavour === "affine:list" && listKey(blocks[at]!) === listKey(block)) {
        run.push(blocks[at]!);
        at += 1;
      }

      out.push(listNode(kind, run, context, notes));
      continue;
    }

    out.push(...convertBlock(block, context, notes));
    at += 1;
  }

  return out;
}

function listKey(block: SnapshotBlock): string {
  return LIST_OF[String(block.props?.type ?? "bulleted")] ?? "bulletList";
}

function listNode(kind: string, run: SnapshotBlock[], context: Context, notes: Set<string>): Node {
  const type = LIST_OF[kind] ?? "bulletList";

  if (kind === "toggle") notes.add("toggle list kept as a bulleted list");

  const items = run.map((item): Node => {
    const content = [paragraph(inline(item.props?.text, context, notes)), ...convertBlocks(item.children ?? [], context, notes)];

    return type === "taskList" ? { type: "taskItem", attrs: { checked: item.props?.checked === true }, content } : { type: "listItem", content };
  });

  if (type === "orderedList") {
    const order = run[0]?.props?.order;

    return { type, attrs: { start: typeof order === "number" && order > 0 ? order : 1 }, content: items };
  }

  return { type, content: items };
}

/** One block that is not a list item, with what stood nested under it after it. */
function convertBlock(block: SnapshotBlock, context: Context, notes: Set<string>): Node[] {
  const props = block.props ?? {};
  const nested = (): Node[] => convertBlocks(block.children ?? [], context, notes);

  switch (block.flavour) {
    case "affine:paragraph": {
      const kind = String(props.type ?? "text");
      const content = inline(props.text, context, notes);
      const heading = /^h([1-6])$/u.exec(kind);

      if (heading !== null) return [{ type: "heading", attrs: { level: Number(heading[1]) }, content: content.length > 0 ? content : undefined }, ...nested()].map(clean);
      if (kind === "quote") return [{ type: "blockquote", content: [paragraph(content), ...nested()] }];

      return [paragraph(content), ...nested()];
    }

    case "affine:code":
      return [
        clean({ type: "codeBlock", attrs: { language: typeof props.language === "string" && props.language !== "" ? props.language : null }, content: textOf(deltaWords(props.text)) })
      ];

    case "affine:divider":
      return [{ type: "horizontalRule" }];

    case "affine:image": {
      const caption = typeof props.caption === "string" ? props.caption : "";
      const image: Node = { type: "image", attrs: { blob: String(props.sourceId ?? ""), alt: caption === "" ? null : caption } };

      if (typeof props.sourceId !== "string" || props.sourceId === "") notes.add("image with no stored file kept as nothing");

      return [...(typeof props.sourceId === "string" && props.sourceId !== "" ? [image] : []), ...(caption === "" ? [] : [textParagraph(caption)])];
    }

    case "affine:table":
      return [tableNode(props, context, notes)];

    case "affine:database":
      return databaseNodes(block, context, notes);

    case "affine:callout": {
      const own = inline(props.text, context, notes);
      const inside = [...(own.length > 0 ? [paragraph(own)] : []), ...nested()];

      notes.add("callout kept as a quote");

      return [{ type: "blockquote", content: inside.length > 0 ? inside : [{ type: "paragraph" }] }];
    }

    case "affine:latex":
      notes.add("equation kept as a code block");

      return [clean({ type: "codeBlock", attrs: { language: "latex" }, content: textOf(String(props.latex ?? "")) })];

    case "affine:bookmark":
    case "affine:embed-youtube":
    case "affine:embed-figma":
    case "affine:embed-github":
    case "affine:embed-loom":
    case "affine:embed-iframe": {
      const url = typeof props.url === "string" ? props.url : "";
      const label = typeof props.title === "string" && props.title !== "" ? props.title : url;

      notes.add(`${block.flavour.replace("affine:", "")} kept as a link`);

      return url === "" ? [] : [paragraph([{ type: "text", text: label, marks: [{ type: "link", attrs: { href: url } }] }])];
    }

    case "affine:embed-linked-doc":
    case "affine:embed-synced-doc": {
      const pageId = typeof props.pageId === "string" ? props.pageId : "";

      notes.add(`${block.flavour.replace("affine:", "")} kept as a note link`);

      return pageId === "" ? [] : [paragraph([{ type: "mention", attrs: { id: pageId, owner: context.owner, label: typeof props.title === "string" ? props.title : "" } }])];
    }

    case "affine:attachment": {
      notes.add("attachment kept as its name");

      return [textParagraph(typeof props.name === "string" ? props.name : "")];
    }

    default: {
      // A kind with no node of the editor's: its words, every text prop it holds, as paragraphs.
      const words = Object.values(props)
        .map(deltaWords)
        .filter((line) => line !== "");

      notes.add(`${block.flavour} kept as its words`);

      return [...words.map(textParagraph), ...nested()];
    }
  }
}

/** A code block's or a cell's words as one text node, none where empty. */
function textOf(words: string): Node[] | undefined {
  return words === "" ? undefined : [{ type: "text", text: words }];
}

/** A node with its empty content left out, as TipTap writes an empty block. */
function clean(node: Node): Node {
  if (node.content === undefined || node.content.length === 0) {
    const { content: _content, ...rest } = node;

    return rest;
  }

  return node;
}

interface Ordered {
  order?: unknown;
}

function byOrder<T extends Ordered>(entries: Record<string, T> | undefined): Array<[string, T]> {
  return Object.entries(entries ?? {}).sort(([, left], [, right]) => String(left.order ?? "").localeCompare(String(right.order ?? "")));
}

function cell(content: Node[]): Node {
  return { type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [paragraph(content)] };
}

/** A BlockSuite table: its rows and columns in their fractional order, each cell's words in place. */
function tableNode(props: Record<string, unknown>, context: Context, notes: Set<string>): Node {
  const rows = byOrder(props.rows as Record<string, Ordered> | undefined);
  const columns = byOrder(props.columns as Record<string, Ordered> | undefined);
  const cells = (props.cells ?? {}) as Record<string, { text?: unknown }>;

  if (rows.length === 0 || columns.length === 0) return { type: "table", content: [{ type: "tableRow", content: [cell([])] }] };

  return {
    type: "table",
    content: rows.map(([rowId]) => ({
      type: "tableRow",
      content: columns.map(([columnId]) => cell(inline(cells[`${rowId}:${columnId}`]?.text, context, notes)))
    }))
  };
}

/** A database's words as a table: its title as a paragraph, its columns' names as the head row, and each row's
 * title and cells as words; an empty database leaves nothing. */
function databaseNodes(block: SnapshotBlock, context: Context, notes: Set<string>): Node[] {
  const props = block.props ?? {};
  const columns = Array.isArray(props.columns) ? (props.columns as Array<{ id?: string; name?: string; data?: { options?: Array<{ id?: string; value?: string }> } }>) : [];
  const values = (props.cells ?? {}) as Record<string, Record<string, { value?: unknown }>>;
  const rows = block.children ?? [];
  const title = deltaWords(props.title);
  const out: Node[] = [];

  if (rows.length === 0 && columns.length === 0) {
    notes.add("empty database left out");

    return title === "" ? [] : [textParagraph(title)];
  }

  notes.add("database kept as a table");

  if (title !== "") out.push(textParagraph(title));

  const valueWords = (column: (typeof columns)[number], value: unknown): string => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const option = column.data?.options?.find((one) => one.id === value);

      return option?.value ?? String(value);
    }
    if (Array.isArray(value)) return value.map((one) => valueWords(column, one)).join(", ");

    return deltaWords(value);
  };

  const head = { type: "tableRow", content: [cell([]), ...columns.filter((column) => column.name !== undefined).map((column) => cell(column.name ? [{ type: "text", text: column.name }] : []))] };
  const body = rows.map((row) => ({
    type: "tableRow",
    content: [
      cell(inline(row.props?.text, context, notes)),
      ...columns
        .filter((column) => column.name !== undefined)
        .map((column) => {
          const words = valueWords(column, values[row.id ?? ""]?.[column.id ?? ""]?.value);

          return cell(words === "" ? [] : [{ type: "text", text: words }]);
        })
    ]
  }));

  out.push({ type: "table", content: [head, ...body] });

  return out;
}

/** The words of a snapshot, every text the note's blocks hold in their order, for the run's comparison. */
export function snapshotWords(root: SnapshotBlock): string {
  const parts: string[] = [];
  const walk = (block: SnapshotBlock): void => {
    const props = block.props ?? {};

    for (const [name, value] of Object.entries(props)) {
      if (name === "cells" && block.flavour === "affine:table") {
        const rows = byOrder(props.rows as Record<string, Ordered> | undefined);
        const columns = byOrder(props.columns as Record<string, Ordered> | undefined);
        const cells = value as Record<string, { text?: unknown }>;

        for (const [rowId] of rows) for (const [columnId] of columns) parts.push(deltaWords(cells[`${rowId}:${columnId}`]?.text));
      } else parts.push(deltaWords(value));
    }

    if (block.flavour === "affine:image" && typeof props.caption === "string") parts.push(props.caption);

    for (const child of block.children ?? []) walk(child);
  };

  walk(root);

  return parts.join("");
}

/** The words of a TipTap document, in order: what the comparison reads it by. */
export function documentWords(node: Node): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "mention") return String(node.attrs?.label ?? "");

  return (node.content ?? []).map(documentWords).join("");
}

/** Words as the comparison reads them: every white space taken out, since the two editors part lines differently. */
export function comparable(words: string): string {
  return words.replace(/\s+/gu, "");
}
