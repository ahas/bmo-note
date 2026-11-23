//! The Agent (`docs/api.md`, 「Agent」, `docs/design.md`, 「Agent」): one ask over a passage of a note, or over the
//! whole note, answered by an agent of the note-assistant role under the reader's own account. Each ask is one
//! slot of the role asked under the reader's supervisor, one session started on it with the unit's instructions
//! and no tool, and one turn; everything the ask held of agency is given back by its owner as the ask ends, however
//! it ends.

use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::body::Bytes;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::response::Json;
use axum::routing::post;
use bmo_console_face::OWNER_ROLE_HEADER;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::api::{Answer, body, credential, query, reach};
use crate::app::App;
use crate::error::ApiError;
use crate::model::fresh_id;
use crate::wire::NoteQuery;

/// The role a console caller names for the platform administrator.
const ADMINISTRATOR: &str = "administrator";
/// The source and the owner prefix every slot of the Agent is asked under.
const SOURCE: &str = "note";
/// The line a session of the role goes out on, which runs on the instructions its caller hands in.
const LINE: &str = "search";
/// How often a waiting slot is asked for admission again: a pace, never a bound.
const ADMISSION_PACE: Duration = Duration::from_secs(1);
/// The most characters an instruction holds.
const INSTRUCTION_MAX: usize = 10_000;

/// What the Agent is asked to work over.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
  /// One passage, the result standing beside it.
  Passage,
  /// The whole note, the result the note edited.
  Note,
}

/// One round said before this ask, the reader's or the agent's.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Round {
  pub owner: bool,
  pub text: String,
}

/// One ask: what is worked over, in the note's line grammar, the reader's instruction and the rounds before it.
#[derive(Debug, Deserialize)]
pub struct AgentAsk {
  pub mode: Mode,
  pub lines: Vec<String>,
  pub instruction: String,
  #[serde(default)]
  pub turns: Vec<Round>,
}

/// The agent's words, or null where it said nothing.
#[derive(Debug, Serialize)]
pub struct AgentAnswer {
  pub answer: Option<String>,
}

/// The note's line grammar, as both instructions state it: the screen's own protocol.
const GRAMMAR: &str = "Each line is one block. A plain paragraph is bare text. # to ###### head a section. - is a \
bulleted item, 1. a numbered one, - [ ] and - [x] to-do items, > a quote, and ```<tab>text a code block. \
[[divider]], [[image]] and [[table]] name blocks that stand as they are. A deeper block carries two spaces per level.";

/// What every session opens on, before the instructions of its mode.
const STANDING: &str = "You are the note assistant: you work on the notes of the one person who asks you, and on \
nothing else. Use no tool of any kind: no shell, no file, no web, no MCP tool, no skill and no subagent. Everything \
you know of the note stands in the turn, as one JSON object: noteId and title name the note, lines holds the text \
you work on, instruction is what the person asks now, and rounds are the earlier asks and answers over the same \
text, oldest first. This is no job: no item, no report, no brain and no question for anyone.";

/// The instructions of an ask over a passage.
const PASSAGE: &str = "The lines are one passage of the note. Follow the instruction and answer with the result \
alone, written in the same line grammar, in one fenced code block and nothing outside it.";

/// The instructions of an ask over the whole note.
const NOTE: &str = "The lines are the whole note. Answer with the whole edited note in one fenced code block and \
nothing outside it. Change only what the person asks for, and keep every line the request does not change. To \
rename the note, put [[title]] and the new title on the first line of your block, above the lines; it carries no \
indent and is the title alone, not a line of the note. Where the title stands, write no such line. Where the \
person asks a question rather than a change, answer in words with no fenced block.";

/// The instructions a session of `mode` opens on.
pub fn instructions(mode: Mode) -> String {
  let own = match mode {
    Mode::Passage => PASSAGE,
    Mode::Note => NOTE,
  };
  format!("{STANDING}\n\nThe text is written in the note's line grammar. {GRAMMAR}\n\n{own}")
}

/// The turn's prompt: the note, the text, the instruction and the rounds before it, as one JSON object.
pub fn prompt(note: &str, title: &str, ask: &AgentAsk) -> String {
  let rounds: Vec<Value> = ask
    .turns
    .iter()
    .map(|round| json!({ "by": if round.owner { "person" } else { "assistant" }, "text": round.text }))
    .collect();
  json!({
    "noteId": note,
    "title": title,
    "lines": ask.lines.join("\n"),
    "instruction": ask.instruction.trim(),
    "rounds": rounds,
  })
  .to_string()
}

pub fn routes() -> Router<Arc<App>> {
  Router::new().route("/notes/{noteId}/agent", post(ask_agent))
}

/// Whose account an ask stands under: the supervisor its slot is asked under, none for the deployment's own, and
/// the account agency must answer the slot under, none for the deployment's own.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Asker {
  pub supervisor: Option<String>,
  pub account: Option<String>,
}

/// The asker of a call: the platform administrator's asks stand under the deployment's own account, asked under
/// the supervisor the settings name where they name one; every other reader's under their own BMO, `u<key>`.
fn asker(app: &App, headers: &HeaderMap, account: &str) -> Answer<Asker> {
  let console = !credential(app, headers)?;
  let role = headers.get(OWNER_ROLE_HEADER).and_then(|value| value.to_str().ok()).map(str::trim);
  if console && role == Some(ADMINISTRATOR) {
    let named = app.settings.agent.supervisor.trim();
    return Ok(Asker {
      supervisor: (!named.is_empty()).then(|| named.to_owned()),
      account: None,
    });
  }
  Ok(Asker {
    supervisor: Some(format!("u{account}")),
    account: Some(account.to_owned()),
  })
}

async fn ask_agent(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(id): Path<String>,
  given: Result<Query<NoteQuery>, QueryRejection>,
  bytes: Bytes,
) -> Answer<Json<AgentAnswer>> {
  let reach = reach(&app, &headers, query(given)?.owner, &id)?;
  let row = app
    .store
    .note(&reach.owner, &id, Some(false))
    .map_err(ApiError::failed)?
    .ok_or_else(|| ApiError::not_found(format!("No note {id} stands live.")))?;
  reach.writes()?;
  let ask: AgentAsk = body(&bytes)?;
  let instruction = ask.instruction.trim();
  if instruction.is_empty() || instruction.chars().count() > INSTRUCTION_MAX {
    return Err(ApiError::bad_request("An instruction is 1 to 10000 characters."));
  }
  let asker = asker(&app, &headers, &reach.account)?;
  let agency = Agency::of(&app)?;
  let answer = agency
    .answer(&asker, &instructions(ask.mode), &prompt(&id, &row.meta.title, &ask), &id)
    .await?;
  Ok(Json(AgentAnswer { answer }))
}

/// Agency's control port, as the settings name it.
#[derive(Clone)]
struct Agency {
  http: reqwest::Client,
  address: String,
  token: String,
  role: String,
}

impl Agency {
  /// The agency the settings name, its token read now; none named, the Agent answers nothing.
  fn of(app: &App) -> Answer<Self> {
    let settings = &app.settings.agent;
    let address = settings.address.trim().trim_end_matches('/').to_owned();
    if address.is_empty() {
      return Err(ApiError::no_agent("No agency is named, so no agent answers."));
    }
    let token = std::fs::read_to_string(app.settings.agent_token_path())
      .map(|token| token.trim().to_owned())
      .map_err(|_| ApiError::no_agent("Agency's token could not be read."))?;
    let http = reqwest::Client::builder()
      .no_proxy()
      .build()
      .map_err(|why| ApiError::failed(why.to_string()))?;
    Ok(Self {
      http,
      address,
      token,
      role: settings.role.clone(),
    })
  }

  async fn call(&self, method: reqwest::Method, path: &str, body: Option<&Value>) -> Result<Value, String> {
    let mut request = self
      .http
      .request(method.clone(), format!("{}{path}", self.address))
      .bearer_auth(&self.token);
    if let Some(body) = body {
      request = request.json(body);
    }
    let response = request.send().await.map_err(|why| format!("agency could not be reached: {why}"))?;
    let status = response.status();
    let answer: Value = response.json().await.unwrap_or_default();
    if status.is_success() {
      Ok(answer)
    } else {
      Err(format!(
        "{method} {path} answered {} {}",
        status.as_u16(),
        answer["code"].as_str().unwrap_or("")
      ))
    }
  }

  /// The account's agent of the role: found where one stands under it, else added on the road and settings of the
  /// role's agent of no account, so a reader's asks run on a seat of their own account.
  async fn stand_agent(&self, account: &str) -> Result<(), String> {
    let listed = self
      .call(reqwest::Method::GET, &format!("/role-agents?role={}", self.role), None)
      .await?;
    let agents = listed["items"].as_array().cloned().unwrap_or_default();
    if agents.iter().any(|agent| agent["ownerAccount"].as_str() == Some(account)) {
      return Ok(());
    }
    let shared = agents
      .iter()
      .find(|agent| agent["ownerAccount"].is_null() && agent["enabled"].as_bool() != Some(false))
      .ok_or_else(|| format!("the role {} holds no agent to copy for account {account}", self.role))?;
    let mut added = json!({
      "role": self.role,
      "name": format!("{}-u{account}", self.role),
      "ownerAccount": account,
      "enabled": true,
    });
    for field in [
      "provider",
      "model",
      "effort",
      "thinking",
      "answerTokens",
      "advisor",
      "sessions",
      "foldRatio",
    ] {
      if !shared[field].is_null() {
        added[field] = shared[field].clone();
      }
    }
    self.call(reqwest::Method::POST, "/role-agents", Some(&added)).await.map(|_| ())
  }

  /// One ask answered: a slot under the asker, a session on it with `instructions` and no tool, one turn of
  /// `prompt`, and everything given back.
  async fn answer(
    &self,
    asker: &Asker,
    instructions: &str,
    prompt: &str,
    note: &str,
  ) -> Answer<Option<String>> {
    if let Some(account) = &asker.account {
      self.stand_agent(account).await.map_err(ApiError::unanswered)?;
    }
    let owner = format!("{SOURCE}:{}", fresh_id());
    let held = Held {
      agency: self.clone(),
      owner: owner.clone(),
      given: false,
    };
    let answered = self.asked(asker, &owner, instructions, prompt, note).await;
    held.give_back().await;
    answered
  }

  async fn asked(
    &self,
    asker: &Asker,
    owner: &str,
    instructions: &str,
    prompt: &str,
    note: &str,
  ) -> Answer<Option<String>> {
    let mut asked = json!({
      "requestKey": owner,
      "owner": owner,
      "role": self.role,
      "source": SOURCE,
      "title": format!("note {note}"),
    });
    if let Some(supervisor) = &asker.supervisor {
      asked["askedBy"] = json!(supervisor);
    }
    let slot = self
      .call(reqwest::Method::POST, "/slot-requests", Some(&asked))
      .await
      .map_err(ApiError::unanswered)?;
    let token = slot["token"]
      .as_str()
      .ok_or_else(|| ApiError::unanswered("agency named no slot"))?
      .to_owned();
    // A slot agency put under another account than the reader's would run on another's seat: it is not used.
    if slot["account"].as_str() != asker.account.as_deref() {
      return Err(ApiError::unanswered(format!(
        "the slot asked under {} stands under another account",
        asker.supervisor.as_deref().unwrap_or("no supervisor")
      )));
    }
    let mut state = slot["state"].as_str().unwrap_or("waiting").to_owned();
    while state != "active" {
      if state == "released" || state == "cancelled" {
        return Err(ApiError::unanswered(format!("the slot was given back while it waited: {state}")));
      }
      tokio::time::sleep(ADMISSION_PACE).await;
      let admitted = self
        .call(reqwest::Method::PATCH, &format!("/slot-requests/{token}"), Some(&json!({})))
        .await
        .map_err(ApiError::unanswered)?;
      state = admitted["state"].as_str().unwrap_or("waiting").to_owned();
    }
    let session = self
      .call(
        reqwest::Method::POST,
        "/sessions",
        Some(&json!({
          "scope": "role",
          "slot": token,
          "line": LINE,
          "systemPrompt": instructions,
          "toolsAllowed": [],
        })),
      )
      .await
      .map_err(ApiError::unanswered)?;
    let session = session["id"].as_str().ok_or_else(|| ApiError::unanswered("agency named no session"))?;
    let turn = self
      .call(
        reqwest::Method::POST,
        &format!("/sessions/{session}/turns"),
        Some(&json!({
          "prompt": prompt,
          "key": owner,
          "resume": { "kind": "fresh" },
          "title": format!("note {note}"),
          "hearsWords": false,
        })),
      )
      .await
      .map_err(ApiError::unanswered)?;
    if let Some(answer) = turn["answer"].as_str().map(str::trim).filter(|answer| !answer.is_empty()) {
      return Ok(Some(answer.to_owned()));
    }
    match turn["outcome"].as_str().filter(|outcome| *outcome != "answered") {
      Some(outcome) => Err(ApiError::unanswered(format!(
        "the agent's turn ended {outcome}: {}",
        turn["reason"].as_str().unwrap_or("no reason given")
      ))),
      None => Ok(None),
    }
  }
}

/// What an ask holds of agency, given back by its owner once the ask ends; an ask dropped before then, its caller
/// gone, gives it back from a task of its own.
struct Held {
  agency: Agency,
  owner: String,
  given: bool,
}

impl Held {
  async fn give_back(mut self) {
    self.given = true;
    release(&self.agency, &self.owner).await;
  }
}

impl Drop for Held {
  fn drop(&mut self) {
    if self.given {
      return;
    }
    let agency = self.agency.clone();
    let owner = std::mem::take(&mut self.owner);
    if let Ok(runtime) = tokio::runtime::Handle::try_current() {
      runtime.spawn(async move { release(&agency, &owner).await });
    }
  }
}

async fn release(agency: &Agency, owner: &str) {
  if let Err(why) = agency
    .call(reqwest::Method::DELETE, &format!("/slot-requests?owner={owner}"), None)
    .await
  {
    eprintln!("bmo-note: what {owner} held of agency was not given back: {why}");
  }
}
