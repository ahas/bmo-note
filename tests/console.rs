//! The console bundle as a console finds it: the manifest by the contract's shape, the module and the
//! stylesheet at the paths their bytes name, the words whole, and the guard the contract holds
//! (`docs/api.md`, 「Console」).

use axum::http::StatusCode;
use serde_json::Value;

use crate::support::{Ran, Scratch, answered, held_port, settings};

async fn running(name: &str) -> (Scratch, Ran) {
  let scratch = Scratch::make(name);
  let (listener, listen) = held_port().await;
  let own = settings(&scratch, listen);
  (scratch, Ran::start(own, listener).await)
}

#[tokio::test]
async fn the_manifest_names_the_bundle_by_the_contract() {
  let (_scratch, ran) = running("manifest").await;
  let (status, manifest) = answered(ran.as_console("GET", "/console-manifest")).await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(manifest["name"], "note");
  assert_eq!(manifest["title"], "note.title");
  assert_eq!(manifest["screenPath"], "/note");
  assert_eq!(manifest["serviceName"], "note");
  assert_eq!(manifest["apiPrefix"], "/");
  assert_eq!(manifest["role"], "member");
  assert_eq!(manifest["ownerKey"], true);
  assert_eq!(manifest["events"], true);
  assert_eq!(manifest["websocket"], false);
  assert_eq!(manifest["pushKinds"].as_array().expect("a list").len(), 0);
  assert_eq!(manifest["calls"].as_array().expect("a list").len(), 0);
  assert_eq!(manifest["relays"].as_array().expect("a list").len(), 0);
  assert_eq!(manifest["shareReads"].as_array().expect("a list").len(), 0);
  assert_eq!(manifest["words"], "/console/words");

  // The module and stylesheet paths carry the digest of their bytes, sixteen hex digits deep.
  for (field, extension) in [("bundle", "js"), ("stylesheet", "css")] {
    let path = manifest[field].as_str().expect("a path");
    let name = path
      .strip_prefix("/console/bundle-")
      .expect("the console folder")
      .strip_suffix(&format!(".{extension}"))
      .unwrap_or_else(|| panic!("{path} is not a digested {extension}"));
    assert_eq!(name.len(), 16, "{path} carries a short digest");
    assert!(name.bytes().all(|byte| byte.is_ascii_hexdigit()), "{path} is not hex: {name}");
  }
}

#[tokio::test]
async fn the_module_and_stylesheet_and_words_answer_at_their_paths() {
  let (_scratch, ran) = running("files").await;
  let (_, manifest) = answered(ran.as_console("GET", "/console-manifest")).await;

  let response = ran
    .as_console("GET", manifest["bundle"].as_str().expect("a path"))
    .send()
    .await
    .expect("the module answers");
  assert_eq!(response.status(), StatusCode::OK);
  assert_eq!(response.headers()["content-type"], "text/javascript");
  assert_eq!(response.headers()["cache-control"], "private, max-age=31536000, immutable");
  let body = response.bytes().await.expect("the module is whole");
  assert!(
    String::from_utf8_lossy(&body).contains("export default"),
    "the module is the built bundle"
  );

  let response = ran
    .as_console("GET", manifest["stylesheet"].as_str().expect("a path"))
    .send()
    .await
    .expect("the stylesheet answers");
  assert_eq!(response.headers()["content-type"], "text/css");

  let (status, words) = answered(ran.as_console("GET", "/console/words")).await;
  assert_eq!(status, StatusCode::OK);
  let words: Value = words;
  assert_eq!(words["en"]["note"]["title"], "Notes");
  assert_eq!(words["ko"]["note"]["title"], "노트");

  let (status, _) = answered(ran.as_console("GET", "/console/bundle-0000000000000000.js")).await;
  assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn the_chunks_and_fonts_the_build_left_answer_under_their_own_names() {
  let (_scratch, ran) = running("chunks").await;

  let response = ran
    .as_console("GET", "/console/editor-chunk.js")
    .send()
    .await
    .expect("the chunk answers");
  assert_eq!(response.status(), StatusCode::OK);
  assert_eq!(response.headers()["content-type"], "text/javascript");
  assert_eq!(response.headers()["cache-control"], "private, max-age=31536000, immutable");

  let response = ran
    .as_console("GET", "/console/fonts/note.woff2")
    .send()
    .await
    .expect("the font answers");
  assert_eq!(response.headers()["content-type"], "font/woff2");

  // A name that walks out of the folder is not there, however it is spelled.
  let (status, _) = answered(ran.as_console("GET", "/console/%2e%2e/notes.toml")).await;
  assert_eq!(status, StatusCode::NOT_FOUND);
  let (status, _) = answered(ran.as_console("GET", "/console/editor-chunk.js/../../etc")).await;
  assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn the_bundle_routes_take_the_credential_and_no_reader() {
  let (_scratch, ran) = running("bundle-guard").await;
  let client = reqwest::Client::builder().no_proxy().build().expect("a client");
  let (status, _) = answered(client.get(format!("{}{}", ran.address, "/console-manifest"))).await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);

  // The console asks with its own credential: no reader key, no role.
  let (status, _) = answered(ran.as_console("GET", "/console-manifest")).await;
  assert_eq!(status, StatusCode::OK);

  // A reader's headers are neither needed nor refused.
  let (status, _) = answered(ran.as_reader("GET", "/console-manifest", "1", "member")).await;
  assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn a_service_without_a_built_bundle_answers_the_four_as_absent() {
  let scratch = Scratch::make("no-bundle");
  let folder = scratch.join("conf");
  std::fs::create_dir_all(&folder).expect("the settings folder is made");
  let (listener, listen) = held_port().await;
  std::fs::write(
    folder.join("settings.local.toml"),
    format!(
      "[server]\nlisten = \"{listen}\"\ntoken = \"{}\"\n[console]\ntoken = \"{}\"\nfolder = \"{}\"\n[store]\npath = \"{}\"\n",
      crate::support::TOKEN,
      crate::support::CONSOLE,
      scratch.join("nowhere").display(),
      scratch.join("note.db").display()
    ),
  )
  .expect("the settings are written");
  let settings = bmo_note::settings::Settings::read(&folder, Some(std::collections::HashMap::new()))
    .expect("the settings read");
  let ran = Ran::start(settings, listener).await;

  for path in ["/console-manifest", "/console/words", "/console/bundle-x.js"] {
    let (status, refusal) = answered(ran.as_console("GET", path)).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{path} answers absent with the bundle unbuilt");
    assert_eq!(refusal["code"], "not-found");
  }
}
