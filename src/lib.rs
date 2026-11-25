//! The note service: editable notes kept as TipTap documents in the unit's own store, with their links
//! and comment threads, answered on its own port, with the console face that shows them
//! (`docs/design.md`, `docs/api.md`).

pub mod agent;
pub mod api;
pub mod app;
pub mod comments;
pub mod console;
pub mod doc;
pub mod error;
pub mod events;
pub mod folders;
pub mod model;
pub mod own;
pub mod removal;
pub mod search;
pub mod settings;
pub mod share;
pub mod store;
pub mod wire;

use std::sync::Arc;

use tokio::net::TcpListener;

use crate::api::router;
use crate::app::App;
use crate::settings::Settings;
use crate::store::Store;

/// The version this build answers with: the set's, which the testbed hands the build as `BMO_VERSION`, else
/// the manifest's placeholder (bmo-chat's `docs/conventions.md`, 「Versions」).
pub const VERSION: &str = match option_env!("BMO_VERSION") {
  Some(version) => version,
  None => env!("CARGO_PKG_VERSION"),
};

/// Opens the store and answers the routes on the settings' address until the process is told to stop,
/// the open event streams ended at once.
pub async fn serve(settings: Settings) -> Result<(), String> {
  let listener = TcpListener::bind(settings.server.listen)
    .await
    .map_err(|why| format!("{} could not be listened on: {why}", settings.server.listen))?;
  serve_on(settings, listener, stopped()).await
}

/// The service on a listener already bound, until `stop` resolves.
pub async fn serve_on(
  settings: Settings,
  listener: TcpListener,
  stop: impl Future<Output = ()> + Send + 'static,
) -> Result<(), String> {
  let store = Store::open(&settings.store_path())?;
  let face = if settings.console.token.is_empty() {
    eprintln!("bmo-note: the console face is not served: no console credential is set");
    None
  } else {
    match console::face(&settings.console.folder, &settings.console.token) {
      Ok(face) => Some(face),
      Err(why) => {
        eprintln!("bmo-note: the console face is not served: {why}");
        None
      }
    }
  };
  let app = App::new(settings, store);
  let stopping = Arc::clone(&app);
  axum::serve(listener, router(app, face))
    .with_graceful_shutdown(async move {
      stop.await;
      stopping.events.stop();
    })
    .await
    .map_err(|why| why.to_string())
}

/// Resolves once the process is told to stop: an interrupt, or the service manager's terminate.
async fn stopped() {
  let interrupt = async {
    let _ = tokio::signal::ctrl_c().await;
  };
  let terminate = async {
    match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
      Ok(mut signal) => {
        signal.recv().await;
      }
      Err(_) => std::future::pending().await,
    }
  };
  tokio::select! {
    () = interrupt => {}
    () = terminate => {}
  }
}
