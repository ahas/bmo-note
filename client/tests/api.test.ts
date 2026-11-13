import { describe, expect, test } from "bun:test";
import { ofetch } from "ofetch";

import { createNoteApi, Refusal } from "../app/domain/api";

// A stand-in of the note service's routes the screens call (`docs/api.md`, 「Notes」): a map of notes
// with the version guard, the trash and the pages, served on the loopback for the length of a test.

interface Held {
  id: string;
  title: string;
  doc: string;
  version: number;
  createdAt: number;
  changedAt: number;
  deletedAt: number | null;
}

function meta(held: Held) {
  return { id: held.id, title: held.title, version: held.version, createdAt: held.createdAt, changedAt: held.changedAt, size: held.doc.length, deletedAt: held.deletedAt };
}

describe("the note api", () => {
  const notes = new Map<string, Held>();
  let refuse: { status: number; code: string; note?: unknown } | null = null;

  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const method = request.method;
      const path = url.pathname;

      if (refuse !== null) {
        const body = JSON.stringify({ code: refuse.code, error: refuse.code, note: refuse.note });

        return new Response(body, { status: refuse.status, headers: { "content-type": "application/json" } });
      }

      const read = async (): Promise<Record<string, unknown>> => (await request.json()) as Record<string, unknown>;

      if (method === "GET" && path === "/notes") {
        const deleted = url.searchParams.get("deleted") === "true";
        const items = [...notes.values()].filter((held) => (held.deletedAt !== null) === deleted).sort((a, b) => b.changedAt - a.changedAt || (a.id < b.id ? 1 : -1));
        const limit = Number(url.searchParams.get("limit") ?? "50");
        const after = url.searchParams.get("after");
        const from = after === null ? 0 : items.findIndex((held) => `${held.changedAt}:${held.id}` === after) + 1;

        return Response.json({ items: items.slice(from, from + limit).map(meta), more: from + limit < items.length });
      }

      if (method === "POST" && path === "/notes") {
        return read().then((body) => {
          const id = String(body.id ?? `made-${notes.size}`);
          const standing = notes.get(id);

          if (standing !== undefined) return Response.json(meta(standing), { status: 200 });

          const made: Held = { id, title: String(body.title ?? ""), doc: String(body.doc), version: 1, createdAt: 1, changedAt: notes.size + 1, deletedAt: null };

          notes.set(id, made);

          return Response.json(meta(made), { status: 201 });
        });
      }

      const one = /^\/notes\/([^/]+)$/.exec(path);

      if (one !== null) {
        const held = notes.get(one[1]!);

        if (method === "GET") {
          if (held === undefined || held.deletedAt !== null) return Response.json({ code: "not-found", error: "gone" }, { status: 404 });

          return Response.json({ ...meta(held), doc: held.doc });
        }

        if (method === "PATCH") {
          return read().then((body) => {
            if (held === undefined) return Response.json({ code: "not-found", error: "gone" }, { status: 404 });

            if (body.restore === true && held.deletedAt !== null) {
              held.deletedAt = null;

              return Response.json(meta(held));
            }

            if (held.deletedAt !== null) return Response.json({ code: "trashed", error: "trashed" }, { status: 422 });

            if (Number(body.version) < held.version) return Response.json({ code: "version-conflict", error: "behind", note: meta(held) }, { status: 409 });

            if (typeof body.title === "string") held.title = body.title;
            if (typeof body.doc === "string") held.doc = body.doc;
            held.version += 1;
            held.changedAt = notes.size + 100;

            return Response.json(meta(held));
          });
        }

        if (method === "DELETE") {
          if (held === undefined) return Response.json({ code: "not-found", error: "gone" }, { status: 404 });

          if (url.searchParams.get("purge") === "true") {
            if (held.deletedAt === null) return Response.json({ code: "not-trashed", error: "live" }, { status: 422 });

            notes.delete(held.id);

            return new Response(null, { status: 204 });
          }

          held.deletedAt = 9;

          return new Response(null, { status: 204 });
        }
      }

      return Response.json({ code: "no-route", error: "none" }, { status: 404 });
    }
  });

  const api = createNoteApi(<T>(path: string, options?: { method?: string; body?: unknown; query?: Record<string, string | undefined> }) =>
    ofetch<T>(`${server.url.origin}${path}${options?.query ? queryString(options.query) : ""}`, {
      method: options?.method,
      body: options?.body as never,
      headers: { "Owner-Key": "1", "Owner-Role": "member" }
    })
  );

  function queryString(query: Record<string, string | undefined>): string {
    const pairs = Object.entries(query).filter(([, value]) => value !== undefined);

    return pairs.length === 0 ? "" : `?${new URLSearchParams(pairs as [string, string][]).toString()}`;
  }

  test("makes a note once and finds it again idempotently", async () => {
    const made = await api.create({ id: "a1", title: "Groceries", doc: "eA==" });

    expect(made.version).toBe(1);

    const again = await api.create({ id: "a1", title: "Else", doc: "eQ==" });

    expect(again.title).toBe("Groceries");
  });

  test("reads, lists and pages by changed order", async () => {
    await api.create({ id: "b2", title: "Second", doc: "eA==" });

    const page = await api.list("live");

    expect(page.items.map((row) => row.id)).toEqual(["b2", "a1"], "newest changed first");

    const note = await api.read({ id: "b2" });

    expect(note.doc).toBe("eA==");
  });

  test("saves forward and refuses a save from behind", async () => {
    await expect(api.save({ id: "a1" }, { version: 1, title: "Market run", doc: "eQ==" })).resolves.toMatchObject({ version: 2, title: "Market run" });

    const failure = await api.save({ id: "a1" }, { version: 1, doc: "eq==" }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Refusal);
    expect((failure as Refusal).status).toBe(409);
    expect((failure as Refusal).code).toBe("version-conflict");
    expect((failure as Refusal).note?.version).toBe(2);
  });

  test("trashes, restores and purges through the trash", async () => {
    await api.trash("a1");

    const trash = await api.list("trash");

    expect(trash.items.map((row) => row.id)).toEqual(["a1"]);

    await expect(api.read({ id: "a1" })).rejects.toBeInstanceOf(Refusal);
    await expect(api.save({ id: "a1" }, { version: 2, doc: "Zw==" })).rejects.toMatchObject({ code: "trashed" });

    await api.save({ id: "a1" }, { version: 2, restore: true });
    await api.trash("a1");
    await expect(api.purge("a1")).resolves.toBeUndefined();
    expect((await api.read({ id: "a1" }).catch((error: unknown) => error)).constructor).toBe(Refusal);
  });

  test("answers a refusal with its code", async () => {
    refuse = { status: 413, code: "too-large" };

    const failure = await api.save({ id: "b2" }, { version: 2, doc: "eA==" }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Refusal);
    expect((failure as Refusal).code).toBe("too-large");

    refuse = null;
  });
});
