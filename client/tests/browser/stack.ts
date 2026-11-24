import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChildProcess } from "node:child_process";
import type { AddressInfo } from "node:net";

// The screens as a person checks them by hand, stood up for a browser test: a throwaway note service built
// from this checkout, on a settings folder and a store of its own under a scratch folder, naming a stand-in agency
// whose agent answers the talk and the Agent, and the bundle's dev host relaying to the service as the console
// would. The service
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

/** The stack standing: the dev host's address, what the stand-in agency's agent was asked, and the way to take
 * everything down. */
export interface Stack {
  host: string;
  asked: AgentAsked[];
  down(): Promise<void>;
}

/** One turn the stand-in agency's agent was asked: the instructions its session opened on, the agent's session it
 * continued where its start named one, and the text, the instruction and the earlier rounds its prompt handed. */
export interface AgentAsked {
  instructions: string;
  continues: string | null;
  handed: string[];
  lines: string;
  instruction: string;
  rounds: { by: string; text: string }[];
}

/** The words the stand-in agent answers an ask over a passage with: one line, in a fenced block. */
export const AGENT_LINE = "Answered by the stand-in agent";

/** The stand-in agency (`docs/api.md`, 「Agent」): the note-assistant role's one agent, a slot let in at once, a
 * session per slot, and every turn answered at once with one fenced block — an ask over a passage with the one line
 * above, an ask over the whole note with the note's own lines and that line after them — and the agent's own
 * session it answered on, a turn continuing one reading the note as that session last wrote it where it is handed
 * no lines. */
function standInAgency(asked: AgentAsked[]): ReturnType<typeof Bun.serve> {
  const sessions = new Map<string, { instructions: string; continues: string | null }>();
  const written = new Map<string, string[]>();
  let made = 0;

  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const body = request.method === "GET" || request.method === "DELETE" ? {} : ((await request.json()) as Record<string, unknown>);

      if (request.method === "GET" && path === "/role-agents") {
        return Response.json({ items: [{ name: "note-assistant-01", role: "note-assistant", ownerAccount: null, enabled: true, provider: "claude-code", model: "stand-in" }] });
      }
      if (request.method === "POST" && path === "/role-agents") return Response.json(body, { status: 201 });
      if (request.method === "POST" && path === "/slot-requests") {
        const asker = typeof body.askedBy === "string" ? body.askedBy : "";

        made += 1;

        return Response.json({ token: `slot-${made}`, state: "active", account: asker.startsWith("u") ? asker.slice(1) : null }, { status: 201 });
      }
      if (request.method === "PATCH" && path.startsWith("/slot-requests/")) return Response.json({ state: "active" });
      if (request.method === "DELETE" && path === "/slot-requests") return Response.json({ cancelled: 0, released: 1, reservations: 0, sessionsEnded: [] });
      if (request.method === "POST" && path === "/sessions") {
        const id = `note-assistant@run:${made}`;

        sessions.set(id, { instructions: String(body.systemPrompt ?? ""), continues: typeof body.continues === "string" ? body.continues : null });

        return Response.json({ id }, { status: 201 });
      }

      const turn = /^\/sessions\/([^/]+)\/turns$/.exec(path);

      if (request.method === "POST" && turn !== null) {
        const session = sessions.get(decodeURIComponent(turn[1]!)) ?? { instructions: "", continues: null };
        const { instructions, continues } = session;
        const prompt = JSON.parse(String(body.prompt ?? "{}")) as Record<string, unknown> & { lines?: string; instruction?: string; rounds?: { by: string; text: string }[] };
        const harness = continues ?? `harness-${made}`;
        const read = prompt.lines === undefined ? (written.get(harness) ?? []) : prompt.lines.split("\n");

        asked.push({ instructions, continues, handed: Object.keys(prompt).sort(), lines: prompt.lines ?? "", instruction: prompt.instruction ?? "", rounds: prompt.rounds ?? [] });

        const whole = instructions.includes("The lines are the whole note");
        const lines = whole ? [...read, AGENT_LINE] : [AGENT_LINE];

        written.set(harness, lines);

        return Response.json({ outcome: "answered", answer: ["```", ...lines, "```"].join("\n"), harnessSession: harness });
      }

      return Response.json({ code: "no-route", error: "none" }, { status: 404 });
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
  const asked: AgentAsked[] = [];
  let stopAgency = (): void => {};

  mkdirSync(settings, { recursive: true });
  mkdirSync(join(data, "note"), { recursive: true });

  const down = async (): Promise<void> => {
    for (const one of [...running].reverse()) await ended(one);
    stopAgency();
    rmSync(scratch, { recursive: true, force: true });
  };

  try {
    const servicePort = await freePort();
    // The service asks a stand-in agency in this process, so no ask reaches an agency that is running.
    const agency = standInAgency(asked);
    const agencyToken = join(scratch, "agency.token");

    stopAgency = () => void agency.stop(true);
    writeFileSync(agencyToken, "browser-test-agency\n");

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
      BMO_NOTE_CONSOLE__FOLDER: join(scratch, "no-bundle"),
      BMO_NOTE_AGENT__ADDRESS: `http://127.0.0.1:${agency.port}`,
      BMO_NOTE_AGENT__TOKEN_FILE: agencyToken
    });

    running.push(note);
    await answering(note, "the note service", `${service}/health`, SERVICE_ANSWERS_MS, { authorization: `Bearer ${SERVICE_TOKEN}` });

    const devHost = started(["bun", "x", "nuxt", "dev", "--host", "127.0.0.1", "--port", String(hostPort)], join(CLIENT, "dev-app"), {
      BMO_DEV_NOTE_ADDRESS: service,
      BMO_DEV_NOTE_TOKEN: CONSOLE_TOKEN,
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
