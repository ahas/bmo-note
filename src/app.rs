//! The service as it runs: its settings, its note store and the events it publishes. It reaches no
//! other unit (`docs/api.md`, 「Calls the note service makes」), so it has nothing to be unready for
//! beyond the store standing open.

use std::sync::Arc;

use crate::events::Events;
use crate::settings::Settings;
use crate::store::Store;

/// The service's state, shared by every route.
pub struct App {
  pub settings: Settings,
  pub store: Store,
  pub events: Events,
}

impl App {
  pub fn new(settings: Settings, store: Store) -> Arc<Self> {
    Arc::new(Self {
      settings,
      store,
      events: Events::new(),
    })
  }
}
