//! The service as it runs: its settings, its note store and the events it publishes. It reaches agency alone,
//! for the Agent's asks (`docs/api.md`, 「Calls the note service makes」), and nothing it is unready for beyond
//! the store standing open.

use std::sync::Arc;

use crate::agent::Talks;
use crate::events::Events;
use crate::settings::Settings;
use crate::store::Store;

/// The service's state, shared by every route.
pub struct App {
  pub settings: Settings,
  pub store: Store,
  pub events: Events,
  /// The talks whose session the Agent keeps for their next round (`docs/design.md`, 「The talk panel」).
  pub talks: Talks,
}

impl App {
  pub fn new(settings: Settings, store: Store) -> Arc<Self> {
    Arc::new(Self {
      settings,
      store,
      events: Events::new(),
      talks: Talks::default(),
    })
  }
}
