//! The Agent (`docs/api.md`, 「Agent」): an ask over a passage or the whole note, answered by an agent of the
//! note-assistant role under the reader's own account, through a stand-in agency in this process that records
//! every call it is made: the account's agent stood where it holds none, the slot asked under the reader's own
//! BMO, a session on the search line with the unit's instructions and no tool, one turn, and everything given back.

use std::sync::{Arc, Mutex};

use axum::Router;
use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use serde_json::{Value, json};

use crate::support::{Ran, Scratch, answered, held_port, settings};

const OWNER: &str = "7";
const EDITOR: &str = "8";
const READER: &str = "9";
const AGENCY_TOKEN: &str = "agency-token";
const ANSWER: &str = "```\nThe line, made better\n```";

/// One call the stand-in agency was made: its method, its path with its query, and its body.
#[derive(Clone, Debug)]
struct Made {
  method: String,
  path: String,
  body: Value,
}

/// What the stand-in agency holds: the calls it was made, the agents of the role, and the account its next slot
/// stands under where a test sets one apart from the asker's own.
#[derive(Default)]
struct Held {
  made: Vec<Made>,
  agents: Vec<Value>,
  account_of_slot: Option<Option<String>>,
}

type Shared = Arc<Mutex<Held>>;

async fn agency(State(held): State<Shared>, request: Request) -> Response {
  let method = request.method().to_string();
  let path = request.uri().path_and_query().map(|path| path.to_string()).unwrap_or_default();
  let authorized = request
    .headers()
    .get("authorization")
    .and_then(|value| value.to_str().ok())
    .is_some_and(|value| value == format!("Bearer {AGENCY_TOKEN}"));
  let bytes = axum::body::to_bytes(request.into_body(), usize::MAX).await.unwrap_or_default();
  let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
  if !authorized {
    return (StatusCode::UNAUTHORIZED, Json(json!({ "code": "unauthorized" }))).into_response();
  }
  let mut held = held.lock().unwrap();
  held.made.push(Made {
    method: method.clone(),
    path: path.clone(),
    body: body.clone(),
  });
  let answer = match (method.as_str(), path.split('?').next().unwrap_or_default()) {
    ("GET", "/role-agents") => json!({ "items": held.agents }),
    ("POST", "/role-agents") => {
      held.agents.push(body.clone());
      body
    }
    ("POST", "/slot-requests") => {
      let account = held.account_of_slot.clone().unwrap_or_else(|| {
        body["askedBy"].as_str().and_then(|asker| asker.strip_prefix('u')).map(str::to_owned)
      });
      json!({ "token": "slot-1", "state": "waiting", "account": account })
    }
    ("PATCH", "/slot-requests/slot-1") => json!({ "state": "active", "request": { "token": "slot-1" } }),
    ("DELETE", "/slot-requests") => {
      json!({ "cancelled": 0, "released": 1, "reservations": 0, "sessionsEnded": [] })
    }
    ("POST", "/sessions") => json!({ "id": "note-assistant@run:1" }),
    ("POST", "/sessions/note-assistant@run:1/turns") => json!({ "outcome": "answered", "answer": ANSWER }),
    _ => return (StatusCode::NOT_FOUND, Json(json!({ "code": "no-route" }))).into_response(),
  };
  Json(answer).into_response()
}

/// The stand-in agency, answering until the test ends, and its address.
async fn stand_in(held: Shared) -> String {
  let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("a port is free");
  let address = format!("http://{}", listener.local_addr().expect("an address"));
  let app = Router::new().fallback(agency).with_state(held);
  tokio::spawn(async move {
    let _ = axum::serve(listener, app).await;
  });
  address
}

/// The role's agent of no account, as agency's policy seeds it.
fn shared_agent() -> Value {
  json!({
    "name": "note-assistant-01",
    "role": "note-assistant",
    "ownerAccount": null,
    "provider": "claude-code",
    "model": "claude-opus-5-5",
    "effort": "medium",
    "thinking": "on",
    "enabled": true,
    "sessions": "fresh",
  })
}

/// The service with the stand-in agency named, the owner's note `n1` shared with an editor and a reader.
async fn ground(name: &str, agency_named: bool) -> (Scratch, Ran, Shared) {
  let scratch = Scratch::make(name);
  let held: Shared = Arc::new(Mutex::new(Held {
    agents: vec![shared_agent()],
    ..Held::default()
  }));
  let (listener, listen) = held_port().await;
  let mut own = settings(&scratch, listen);
  if agency_named {
    own.agent.address = stand_in(Arc::clone(&held)).await;
  }
  let token = scratch.join("agency.token");
  std::fs::write(&token, format!("{AGENCY_TOKEN}\n")).expect("the token is written");
  own.agent.token_file = token;
  let ran = Ran::start(own, listener).await;
  let doc = json!({ "type": "doc", "content": [
    { "type": "title", "content": [{ "type": "text", "text": "Plans" }] },
    { "type": "paragraph", "content": [{ "type": "text", "text": "The line" }] }
  ] });
  let (status, _) = answered(
    ran
      .as_reader("POST", "/notes", OWNER, "member")
      .json(&json!({ "id": "n1", "doc": doc })),
  )
  .await;
  assert_eq!(status, StatusCode::CREATED);
  for (user, permission) in [(EDITOR, "edit"), (READER, "read")] {
    let (status, _) = answered(
      ran
        .as_reader("POST", "/notes/n1/members", OWNER, "member")
        .json(&json!({ "users": [user], "permission": permission })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
  }
  (scratch, ran, held)
}

fn passage() -> Value {
  json!({ "mode": "passage", "lines": ["The line"], "instruction": "Make it better", "turns": [] })
}

fn made(held: &Shared) -> Vec<Made> {
  held.lock().unwrap().made.clone()
}

#[tokio::test]
async fn a_members_ask_runs_on_an_agent_of_their_own_account_and_gives_everything_back() {
  let (_scratch, ran, held) = ground("member", true).await;

  let (status, answer) =
    answered(ran.as_reader("POST", "/notes/n1/agent", OWNER, "member").json(&passage())).await;
  assert_eq!(status, StatusCode::OK, "{answer}");
  assert_eq!(answer, json!({ "answer": ANSWER }));

  let made = made(&held);
  let steps: Vec<String> = made
    .iter()
    .map(|call| format!("{} {}", call.method, call.path.split('?').next().unwrap()))
    .collect();
  assert_eq!(
    steps,
    [
      "GET /role-agents",
      "POST /role-agents",
      "POST /slot-requests",
      "PATCH /slot-requests/slot-1",
      "POST /sessions",
      "POST /sessions/note-assistant@run:1/turns",
      "DELETE /slot-requests"
    ]
  );

  // The account's own agent, on the road of the role's agent of no account.
  let added = &made[1].body;
  assert_eq!(
    (
      &added["role"],
      &added["ownerAccount"],
      &added["provider"],
      &added["model"],
      &added["effort"]
    ),
    (
      &json!("note-assistant"),
      &json!(OWNER),
      &json!("claude-code"),
      &json!("claude-opus-5-5"),
      &json!("medium")
    )
  );

  // The slot under the reader's own BMO, the session with the unit's instructions and no tool.
  assert_eq!(made[2].body["askedBy"], json!(format!("u{OWNER}")));
  assert_eq!(made[2].body["role"], json!("note-assistant"));
  let session = &made[4].body;
  assert_eq!(
    (&session["slot"], &session["line"], &session["toolsAllowed"]),
    (&json!("slot-1"), &json!("search"), &json!([]))
  );
  assert_eq!(
    session["systemPrompt"],
    json!(bmo_note::agent::instructions(bmo_note::agent::Mode::Passage))
  );

  // The turn hands the note, the passage and the instruction, and starts afresh.
  let turn = &made[5].body;
  let prompt: Value =
    serde_json::from_str(turn["prompt"].as_str().expect("a prompt")).expect("the prompt is JSON");
  assert_eq!(
    (&prompt["noteId"], &prompt["title"], &prompt["lines"], &prompt["instruction"]),
    (&json!("n1"), &json!("Plans"), &json!("The line"), &json!("Make it better"))
  );
  assert_eq!(turn["resume"], json!({ "kind": "fresh" }));

  // Everything the ask held is given back by its owner, the one its slot was asked under.
  let owner = made[2].body["owner"].as_str().expect("an owner");
  assert_eq!(made[6].path, format!("/slot-requests?owner={owner}"));

  // A second ask finds the account's agent standing and adds none.
  let (status, _) =
    answered(ran.as_reader("POST", "/notes/n1/agent", OWNER, "member").json(&passage())).await;
  assert_eq!(status, StatusCode::OK);
  let added = held
    .lock()
    .unwrap()
    .made
    .iter()
    .filter(|call| call.method == "POST" && call.path == "/role-agents")
    .count();
  assert_eq!(added, 1);
}

#[tokio::test]
async fn an_editing_member_asks_under_their_own_account_and_the_administrator_under_the_deployments() {
  let (_scratch, ran, held) = ground("accounts", true).await;

  let (status, _) = answered(
    ran
      .as_reader("POST", &format!("/notes/n1/agent?owner={OWNER}"), EDITOR, "member")
      .json(&passage()),
  )
  .await;
  assert_eq!(status, StatusCode::OK);
  let slot = made(&held)
    .into_iter()
    .find(|call| call.path == "/slot-requests")
    .expect("a slot was asked");
  assert_eq!(slot.body["askedBy"], json!(format!("u{EDITOR}")));

  held.lock().unwrap().made.clear();
  let (status, _) =
    answered(ran.as_reader("POST", "/notes/n1/agent", OWNER, "administrator").json(&passage())).await;
  assert_eq!(status, StatusCode::OK);
  let made = made(&held);
  assert!(
    made.iter().all(|call| call.path.split('?').next() != Some("/role-agents")),
    "the deployment's own agents answer"
  );
  let slot = made.iter().find(|call| call.path == "/slot-requests").expect("a slot was asked");
  assert!(slot.body.get("askedBy").is_none(), "{}", slot.body);
}

#[tokio::test]
async fn a_whole_notes_ask_opens_on_the_notes_own_instructions() {
  let (_scratch, ran, held) = ground("note", true).await;
  let ask = json!({
    "mode": "note",
    "lines": ["The line"],
    "instruction": "Add a second line",
    "turns": [{ "owner": true, "text": "Earlier" }, { "owner": false, "text": "Done" }]
  });

  let (status, _) = answered(ran.as_reader("POST", "/notes/n1/agent", OWNER, "member").json(&ask)).await;
  assert_eq!(status, StatusCode::OK);
  let made = made(&held);
  let session = made.iter().find(|call| call.path == "/sessions").expect("a session was started");
  assert_eq!(
    session.body["systemPrompt"],
    json!(bmo_note::agent::instructions(bmo_note::agent::Mode::Note))
  );
  let turn = made.iter().find(|call| call.path.ends_with("/turns")).expect("a turn was sent");
  let prompt: Value = serde_json::from_str(turn.body["prompt"].as_str().unwrap()).unwrap();
  assert_eq!(
    prompt["rounds"],
    json!([{ "by": "person", "text": "Earlier" }, { "by": "assistant", "text": "Done" }])
  );
}

#[tokio::test]
async fn a_reader_who_writes_nothing_is_refused_and_agency_is_never_asked() {
  let (_scratch, ran, held) = ground("reader", true).await;

  let (status, answer) = answered(
    ran
      .as_reader("POST", &format!("/notes/n1/agent?owner={OWNER}"), READER, "member")
      .json(&passage()),
  )
  .await;
  assert_eq!((status, &answer["code"]), (StatusCode::FORBIDDEN, &json!("forbidden")));

  let (status, answer) =
    answered(ran.as_reader("POST", "/notes/n1/agent", READER, "member").json(&passage())).await;
  assert_eq!(
    (status, &answer["code"]),
    (StatusCode::NOT_FOUND, &json!("not-found")),
    "the reader holds no note n1"
  );

  let (status, answer) = answered(
    ran
      .as_reader("POST", "/notes/n1/agent", OWNER, "member")
      .json(&json!({ "mode": "passage", "lines": [], "instruction": "  " })),
  )
  .await;
  assert_eq!((status, &answer["code"]), (StatusCode::BAD_REQUEST, &json!("bad-request")));
  assert!(made(&held).is_empty());
}

#[tokio::test]
async fn no_agency_named_answers_no_agent_and_a_slot_of_another_account_is_given_back_unused() {
  let (_scratch, ran, _held) = ground("unnamed", false).await;
  let (status, answer) =
    answered(ran.as_reader("POST", "/notes/n1/agent", OWNER, "member").json(&passage())).await;
  assert_eq!((status, &answer["code"]), (StatusCode::SERVICE_UNAVAILABLE, &json!("no-agent")));

  let (_scratch, ran, held) = ground("foreign", true).await;
  held.lock().unwrap().account_of_slot = Some(None);
  let (status, answer) =
    answered(ran.as_reader("POST", "/notes/n1/agent", OWNER, "member").json(&passage())).await;
  assert_eq!((status, &answer["code"]), (StatusCode::BAD_GATEWAY, &json!("unanswered")));
  let made = made(&held);
  assert!(
    made.iter().all(|call| call.path != "/sessions"),
    "no session runs on another account's seat"
  );
  assert_eq!(made.last().map(|call| call.method.as_str()), Some("DELETE"));
}
