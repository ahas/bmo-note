//! The note service: editable BlockSuite notes kept as binary documents in the unit's own store,
//! answered on its own port, with the console bundle that shows them (`docs/design.md`, `docs/api.md`).

pub mod api;
pub mod app;
pub mod console;
pub mod error;
pub mod events;
pub mod model;
pub mod settings;
pub mod store;
pub mod wire;

use std::sync::Arc;

use tokio::net::TcpListener;

use crate::api::{Served, router};
use crate::app::App;
use crate::console::Bundle;
use crate::settings::Settings;
use crate::store::Store;

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
  let bundle = match Bundle::read(&settings.console.folder) {
    Ok(bundle) => Some(Arc::new(bundle)),
    Err(why) => {
      eprintln!("bmo-note: the console bundle is not served: {why}");
      None
    }
  };
  let app = App::new(settings, store);
  let stopping = Arc::clone(&app);
  axum::serve(listener, router(Served { app, bundle }))
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
