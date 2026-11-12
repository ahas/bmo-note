//! The console face (`docs/api.md`, 「Console」): the manifest the service serves, read through bmo-ui's own
//! reading of the contract on the release the client vendors, the face wired to the note's declaration, bundle
//! folder and credential, and no face where the bundle cannot be served. The face's own rules are
//! bmo-console-face's tests'.

use axum::http::StatusCode;
use bmo_console_face::read_manifest;
use serde_json::json;

use crate::support::{
  CONSOLE, Ran, Scratch, TOKEN, answered, held_port, release_layer, settings, vendored_release,
};

#[tokio::test]
async fn the_served_manifest_is_read_by_the_contract_on_the_vendored_release() {
  let scratch = Scratch::make("manifest");
  let (listener, listen) = held_port().await;
  let own = settings(&scratch, listen);
  let reach = bmo_note::console::reach(&own);
  let ran = Ran::start(own, listener).await;

  let (status, served) = answered(ran.as_console("GET", "/console-manifest")).await;
  assert_eq!(status, StatusCode::OK, "{served}");
  let read = read_manifest(&served, &vendored_release()).unwrap_or_else(|why| panic!("{why}"));
  assert_eq!(read["layer"], release_layer());
  assert_eq!(read["name"], "note");
  assert_eq!(read["screenPath"], "/note");
  assert_eq!(read["serviceName"], "note");
  assert_eq!(read["role"], "member");
  assert_eq!(read["ownerKey"], true);
  assert_eq!(read["events"], true);
  assert_eq!(read["calls"], json!(["receiver"]));

  // The face takes the console's credential, never the service's own token.
  let (status, _) = answered(ran.call("GET", "/console-manifest")).await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);

  // The words and the module are the note's own build: the words for no reader, the module a reader's.
  let (status, words) = answered(ran.as_console("GET", read["words"].as_str().expect("a path"))).await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(words["ko"]["note"]["title"], "노트");
  let module = read["bundle"].as_str().expect("a path");
  let response = ran.as_reader("GET", module, "1", "member").send().await.expect("the module answers");
  assert_eq!(response.status(), StatusCode::OK);
  assert_eq!(response.text().await.expect("the module reads"), "export default { routes: [] };\n");

  // How the deployment's console probe reaches this very service.
  assert_eq!(reach, json!({ "address": ran.address, "consoleToken": CONSOLE, "token": TOKEN }));
}

#[tokio::test]
async fn a_bundle_built_on_no_layer_stands_no_face_and_the_notes_are_answered() {
  let scratch = Scratch::make("no-layer");
  let (listener, listen) = held_port().await;
  let own = settings(&scratch, listen);
  std::fs::remove_file(scratch.join("dist/layer.json")).expect("the layer is removed");
  let ran = Ran::start(own, listener).await;

  let (status, refusal) = answered(ran.as_console("GET", "/console-manifest")).await;
  assert_eq!((status, refusal["code"].as_str()), (StatusCode::NOT_FOUND, Some("no-route")));
  let (status, _) = answered(ran.as_reader("GET", "/notes", "1", "member")).await;
  assert_eq!(status, StatusCode::OK);
}
