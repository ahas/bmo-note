//! The `bmo-note` command: `serve` answers the routes until it is told to stop; `health` ends 0 only
//! where the service its settings name answers ready; `console-reach` prints how a console reaches the
//! service.

use std::process::ExitCode;

use bmo_note::settings::Settings;
use bmo_note::wire::Health;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "bmo-note", version = bmo_note::VERSION, about = "The note service and its command.")]
struct Command {
  #[command(subcommand)]
  verb: Verb,
}

#[derive(Subcommand)]
enum Verb {
  /// Opens the store and answers the routes until the process is told to stop.
  Serve,
  /// Whether the service the settings name answers ready: exit code 0 where it does, 1 where not.
  Health,
  /// Prints how a console reaches the service, as one JSON object, for a deployment's console probe.
  ConsoleReach,
}

async fn health(settings: &Settings) -> Result<(), String> {
  let base = settings.base_address();
  let response = reqwest::Client::builder()
    .no_proxy()
    .build()
    .map_err(|why| format!("no HTTP client: {why}"))?
    .get(format!("{base}/health"))
    .bearer_auth(&settings.server.token)
    .send()
    .await
    .map_err(|why| format!("{base}: {why}"))?;
  let status = response.status();
  let health: Health = response.json().await.map_err(|why| format!("{base} answered {status}: {why}"))?;
  if health.ready {
    Ok(())
  } else {
    Err(format!(
      "the service is not ready: {}",
      health.reason.as_deref().unwrap_or("it gave no reason")
    ))
  }
}

#[tokio::main]
async fn main() -> ExitCode {
  let Command { verb } = Command::parse();
  let ended = match Settings::load() {
    Err(why) => Err(why),
    Ok(settings) => match verb {
      Verb::Serve => bmo_note::serve(settings).await,
      Verb::Health => health(&settings).await,
      Verb::ConsoleReach => {
        println!("{}", bmo_note::console::reach(&settings));
        Ok(())
      }
    },
  };
  match ended {
    Ok(()) => ExitCode::SUCCESS,
    Err(why) => {
      eprintln!("bmo-note: {why}");
      ExitCode::FAILURE
    }
  }
}
