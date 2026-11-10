//! What the tests share: the service started in this process on a loopback port over a scratch store
//! and a scratch console bundle, and calls of its routes.

use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use axum::http::StatusCode;
use bmo_note::settings::Settings;
use serde_json::Value;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

/// The service token.
pub const TOKEN: &str = "service-token";
/// The cap a test service holds, small enough to cross with one body.
pub const TEST_DOC_MAX: usize = 1024;
/// The console's credential.
pub const CONSOLE: &str = "console-token";

/// The scratch folder a test runs in, removed when the test ends.
pub struct Scratch {
  pub path: PathBuf,
}

static SEQ: AtomicU64 = AtomicU64::new(0);

impl Scratch {
  /// A fresh scratch folder under the system's temporary one.
  pub fn make(name: &str) -> Self {
    let path = std::env::temp_dir().join(format!(
      "bmo-note-{}-{}-{name}",
      std::process::id(),
      SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&path).expect("the scratch folder is made");
    Self { path }
  }

  pub fn join(&self, tail: &str) -> PathBuf {
    self.path.join(tail)
  }

  /// The console bundle as the build leaves it: a module, a stylesheet and words in a folder.
  pub fn bundle_folder(&self) -> PathBuf {
    let folder = self.join("dist");
    fs::create_dir_all(&folder).expect("the bundle folder is made");
    fs::write(folder.join("bundle.js"), "export default { routes: [] };\n").expect("the module is written");
    fs::write(folder.join("bundle.css"), ".note-screen{color:red}\n").expect("the stylesheet is written");
    fs::write(
      folder.join("words.json"),
      r#"{"en":{"note":{"title":"Notes"}},"ko":{"note":{"title":"노트"}}}"#,
    )
    .expect("the words are written");
    fs::create_dir_all(folder.join("fonts")).expect("the font folder is made");
    fs::write(folder.join("editor-chunk.js"), "export const chunk = 1;\n").expect("the chunk is written");
    fs::write(folder.join("fonts/note.woff2"), "fontbytes").expect("the font is written");
    folder
  }
}

impl Drop for Scratch {
  fn drop(&mut self) {
    let _ = fs::remove_dir_all(&self.path);
  }
}

/// The service as it runs in the test process.
pub struct Ran {
  pub address: String,
  stop: Option<oneshot::Sender<()>>,
  task: Option<tokio::task::JoinHandle<()>>,
}

impl Drop for Ran {
  fn drop(&mut self) {
    if let Some(stop) = self.stop.take() {
      let _ = stop.send(());
    }
    if let Some(task) = self.task.take() {
      task.abort();
    }
  }
}

impl Ran {
  /// Starts the service over `settings` on the `listener` the test holds open for it, answering at the
  /// settings' listen address until the `Ran` is dropped. The port is held, not probed: a test that let
  /// go of a port it only borrowed can be refused it at the real bind by another test's service.
  pub async fn start(settings: Settings, listener: TcpListener) -> Self {
    let address = settings.base_address();
    let (stop, ended) = oneshot::channel::<()>();
    let task = tokio::spawn(async move {
      let _ = bmo_note::serve_on(settings, listener, async move {
        let _ = ended.await;
      })
      .await;
    });
    Self {
      address,
      stop: Some(stop),
      task: Some(task),
    }
  }

  /// A call's builder: the method, the path, and the credential and reader headers the route reads.
  pub fn call(&self, method: &str, path: &str) -> reqwest::RequestBuilder {
    let client = reqwest::Client::builder().no_proxy().build().expect("an HTTP client");
    client
      .request(method.parse().expect("the method reads"), format!("{}{path}", self.address))
      .bearer_auth(TOKEN)
  }

  /// A call the console makes for a reader.
  pub fn as_reader(&self, method: &str, path: &str, key: &str, role: &str) -> reqwest::RequestBuilder {
    let client = reqwest::Client::builder().no_proxy().build().expect("an HTTP client");
    client
      .request(method.parse().expect("the method reads"), format!("{}{path}", self.address))
      .bearer_auth(CONSOLE)
      .header("Owner-Key", key)
      .header("Owner-Role", role)
  }

  /// A call the console makes for itself: the credential with no reader.
  pub fn as_console(&self, method: &str, path: &str) -> reqwest::RequestBuilder {
    let client = reqwest::Client::builder().no_proxy().build().expect("an HTTP client");
    client
      .request(method.parse().expect("the method reads"), format!("{}{path}", self.address))
      .bearer_auth(CONSOLE)
  }
}

/// A note made as the client would make one: its id, a title, and document bytes for the tests to read.
pub fn note_body(id: &str, title: &str, bytes: &[u8]) -> Value {
  serde_json::json!({
    "id": id,
    "title": title,
    "doc": base64(bytes),
  })
}

/// The bytes a document stands for in the tests: not a Yjs state, only opaque bytes the service stores.
pub fn doc_bytes(mark: u8) -> Vec<u8> {
  vec![mark, mark ^ 0x5a, 0x79, 0x4a, 0x73]
}

/// Bytes as they travel on the wire.
pub fn base64(bytes: &[u8]) -> String {
  use base64::Engine;
  base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// A port held for a test service: the open listener and the address it answers at. A test hands the
/// listener to `Ran::start_on` without letting go of it, so no other test can be given the same port
/// between the probe and the bind.
pub async fn held_port() -> (TcpListener, SocketAddr) {
  let listener = TcpListener::bind("127.0.0.1:0").await.expect("a port is free");
  let address = listener.local_addr().expect("the listener names its address");
  (listener, address)
}

/// The status and the JSON answer of a call, the JSON read where the answer carries any.
pub async fn answered(request: reqwest::RequestBuilder) -> (StatusCode, Value) {
  let response = request.send().await.expect("the service answered");
  let status = response.status();
  let value = response.json::<Value>().await.unwrap_or(Value::Null);
  (status, value)
}

/// The settings of a test service: the repository's defaults with its port, tokens, store and bundle
// folder replaced, read the way a deployment reads them.
pub fn settings(scratch: &Scratch, listen: SocketAddr) -> Settings {
  let folder = scratch.join("conf");
  fs::create_dir_all(&folder).expect("the settings folder is made");
  let toml = format!(
    "[server]\nlisten = \"{listen}\"\ntoken = \"{TOKEN}\"\n\
     [console]\ntoken = \"{CONSOLE}\"\nfolder = \"{}\"\n\
     [store]\npath = \"{}\"\n\
     [notes]\nmax_doc_bytes = {}\n",
    scratch.bundle_folder().display(),
    scratch.join("note.db").display(),
    TEST_DOC_MAX
  );
  fs::write(folder.join("settings.local.toml"), toml).expect("the settings are written");
  Settings::read(&folder, Some(std::collections::HashMap::new())).expect("the settings read")
}
