// The dev relay: /proxy/<service>/<path...> forwarded to the note service on its loopback port with
// the development credential and a fixed reader, the headers the console would set on every call.
// Nothing of a deployment's tokens stands here; the values come from the environment the host runs with.

const ADDRESS = process.env.BMO_DEV_NOTE_ADDRESS ?? "http://127.0.0.1:13199";
const TOKEN = process.env.BMO_DEV_NOTE_TOKEN ?? "";

export default defineEventHandler(async (event) => {
  const rest = event.path.replace(/^\/proxy\/[^/]+/, "");
  const response = await fetch(`${ADDRESS}${rest}`, {
    method: event.method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "owner-key": process.env.BMO_DEV_OWNER_KEY ?? "1",
      "owner-role": process.env.BMO_DEV_OWNER_ROLE ?? "member",
      ...(event.headers.get("content-type") ? { "content-type": String(event.headers.get("content-type")) } : {})
    },
    // The body rides through as the bytes the caller sent, as the console's relay does; reparsing it
    // here would rewrite what the service is asked to read.
    body: event.method === "GET" || event.method === "HEAD" ? undefined : (await readRawBody(event, false)) ?? undefined
  });

  const type = response.headers.get("content-type") ?? "application/json";

  // The event stream rides through open, as the console relays it.
  if (type.includes("text/event-stream")) {
    return new Response(response.body, { status: response.status, headers: { "content-type": type } });
  }

  const body = await response.arrayBuffer();

  return new Response(body, {
    status: response.status,
    headers: { "content-type": type }
  });
});
