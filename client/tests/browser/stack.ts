import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChildProcess } from "node:child_process";
import type { AddressInfo } from "node:net";

// The screens as a person checks them by hand, stood up for a browser test: a throwaway note service built
// from this checkout, on a settings folder and a store of its own under a scratch folder, a stand-in receiver
// answering the talk and Ask AI, and the bundle's dev host relaying to both as the console would. The service
// and the host each run as the head of a process group of its own, so taking the stack down ends everything
// either started; the scratch folder goes with it.

const CLIENT = new URL("../../", import.meta.url).pathname;
const REPOSITORY = new URL("../../../", import.meta.url).pathname;

// The credentials the throwaway service is given: the relay presents the console's, the health call the
// service's own.
const SERVICE_TOKEN = "browser-test-service";
const CONSOLE_TOKEN = "browser-test-console";

// How long a process is given to answer once started, and how often it is asked meanwhile. The dev host builds
// the editor's sources as its first page is asked for, which takes the longest.
const SERVICE_ANSWERS_MS = 30_000;
const HOST_ANSWERS_MS = 300_000;
const ASK_EVERY_MS = 250;

// The most of a process's own output a failure quotes.
const QUOTED_CHARS = 4_000;

/** The stack standing: the dev host's address, what the stand-in receiver was asked, and the way to take
 * everything down. */
export interface Stack {
  host: string;
  asked: ReceiverAsk[];
  down(): Promise<void>;
}

/** One talk the stand-in receiver was asked: its topic's kind and fields, and what the reader said. */
export interface ReceiverAsk {
  kind: string;
  fields: Record<string, string>;
  said: string;
}

/** The words the stand-in receiver answers an ask over a passage with: one line, in a fenced block. */
export const RECEIVER_LINE = "Answered by the stand-in receiver";

/** The stand-in receiver (`docs/design.md`, 「The AI talk panel」, 「Ask AI」): every talk is answered at once
 * with one fenced block — an ask over a passage with the one line above, a talk about the note with the note's
 * own lines and that line after them. */
function standInReceiver(asked: ReceiverAsk[]): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      if (request.method !== "POST" || !new URL(request.url).pathname.endsWith("/talks")) return Response.json({ code: "no-route", error: "none" }, { status: 404 });

      const body = (await request.json()) as { topic?: { kind?: string; fields?: Record<string, string> }; said?: string };
      const kind = body.topic?.kind ?? "";
      const fields = body.topic?.fields ?? {};

      asked.push({ kind, fields, said: body.said ?? "" });

      const lines = kind === "note-passage" ? [RECEIVER_LINE] : [...(fields.lines ?? "").split("\n"), RECEIVER_LINE];

      return Response.json({ answer: ["```", ...lines, "```"].join("\n") });
    }
  });
}

// A process of the stack, its output kept for a failure to quote.
interface Running {
  child: ChildProcess;
  said: () => string;
  ended: () => boolean;
}

// The service's binary, built from this checkout by Cargo, which says where it put it. Cargo's progress goes
// to the test's own error stream, so a long first build is not taken for a silent one.
function serviceBinary(): string {
  const built = Bun.spawnSync([process.env.CARGO ?? "cargo", "build", "--bin", "bmo-note", "--message-format", "json"], {
    cwd: REPOSITORY,
    stdout: "pipe",
    stderr: "inherit"
  });

  if (built.exitCode !== 0) throw new Error("the note service did not build");

  for (const line of built.stdout.toString().split("\n")) {
    if (!line.startsWith("{")) continue;

    const message = JSON.parse(line) as { reason?: string; target?: { name?: string }; executable?: string | null };

    if (message.reason === "compiler-artifact" && message.target?.name === "bmo-note" && message.executable) return message.executable;
  }

  throw new Error("Cargo named no bmo-note executable");
}

// A loopback port nothing holds at the moment it is asked.
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;

      server.close(() => resolve(port));
    });
  });
}

function started(command: string[], cwd: string, env: Record<string, string>): Running {
  const child = spawn(command[0]!, command.slice(1), {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  let done = false;
  const keep = (chunk: Buffer): void => {
    output = `${output}${chunk.toString()}`.slice(-QUOTED_CHARS);
  };

  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  child.once("exit", () => {
    done = true;
  });

  return { child, said: () => output, ended: () => done };
}

// Waits until the address answers a success, for at most `within`; a process that ends first fails at once,
// quoting what it said.
async function answering(running: Running, name: string, url: string, within: number, headers: Record<string, string> = {}): Promise<void> {
  const deadline = Date.now() + within;

  for (;;) {
    if (running.ended()) throw new Error(`${name} ended before it answered:\n${running.said()}`);

    try {
      if ((await fetch(url, { headers })).ok) return;
    } catch {
      // Not listening yet.
    }

    if (Date.now() > deadline) throw new Error(`${name} did not answer ${url} within ${within} ms:\n${running.said()}`);

    await Bun.sleep(ASK_EVERY_MS);
  }
}

// Ends a process's whole group and waits for its head to be gone.
async function ended(running: Running): Promise<void> {
  const pid = running.child.pid;

  if (pid === undefined || running.ended()) return;

  const gone = new Promise<void>((resolve) => running.child.once("exit", () => resolve()));

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group is already gone.
  }

  await gone;
}

/** Builds and starts the throwaway service, then the dev host relaying to it, and waits until both answer. */
export async function stoodUp(): Promise<Stack> {
  const binary = serviceBinary();
  const scratch = mkdtempSync(join(tmpdir(), "bmo-note-browser-"));
  const settings = join(scratch, "settings");
  const data = join(scratch, "data");
  const running: Running[] = [];
  const asked: ReceiverAsk[] = [];
  let stopReceiver = (): void => {};

  mkdirSync(settings, { recursive: true });
  mkdirSync(join(data, "note"), { recursive: true });

  const down = async (): Promise<void> => {
    for (const one of [...running].reverse()) await ended(one);
    stopReceiver();
    rmSync(scratch, { recursive: true, force: true });
  };

  try {
    const servicePort = await freePort();
    // The talk panel's receiver is relayed too, to a stand-in in this process, so no call reaches a receiver
    // that is running.
    const receiver = standInReceiver(asked);

    stopReceiver = () => void receiver.stop(true);

    const hostPort = await freePort();
    const service = `http://127.0.0.1:${servicePort}`;
    const host = `http://127.0.0.1:${hostPort}`;

    const note = started([binary, "serve"], scratch, {
      BMO_NOTE_SETTINGS: settings,
      BMO_NOTE_SERVER__LISTEN: `127.0.0.1:${servicePort}`,
      BMO_NOTE_SERVER__TOKEN: SERVICE_TOKEN,
      BMO_NOTE_SERVER__DATA_ROOT: data,
      BMO_NOTE_STORE__PATH: join(data, "note", "note.db"),
      BMO_NOTE_CONSOLE__TOKEN: CONSOLE_TOKEN,
      BMO_NOTE_CONSOLE__FOLDER: join(scratch, "no-bundle")
    });

    running.push(note);
    await answering(note, "the note service", `${service}/health`, SERVICE_ANSWERS_MS, { authorization: `Bearer ${SERVICE_TOKEN}` });

    const devHost = started(["bun", "x", "nuxt", "dev", "--host", "127.0.0.1", "--port", String(hostPort)], join(CLIENT, "dev-app"), {
      BMO_DEV_NOTE_ADDRESS: service,
      BMO_DEV_NOTE_TOKEN: CONSOLE_TOKEN,
      BMO_DEV_RECEIVER_ADDRESS: `http://127.0.0.1:${receiver.port}`,
      BMO_DEV_RECEIVER_TOKEN: "",
      BMO_DEV_OWNER_KEY: "1",
      BMO_DEV_OWNER_ROLE: "member"
    });

    running.push(devHost);
    await answering(devHost, "the dev host", `${host}/note`, HOST_ANSWERS_MS);

    return { host, asked, down };
  } catch (why) {
    await down();
    throw why;
  }
}
