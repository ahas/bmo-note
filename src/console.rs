//! The console bundle the service serves (`docs/api.md`, 「Console」): its manifest by bmo-ui's console
//! plugin contract, the module and stylesheet answered at paths made from their bytes' digest, the
//! words, and every other file the build left in the folder — the chunks the editor imports as it works
//! and the fonts its stylesheet names — answered under `/console/` by their own build-made names, which
//! already follow their bytes.

use std::path::Path;

use sha2::{Digest, Sha256};

use crate::wire::{ConsoleManifest, Role};

/// The route the manifest is answered at.
pub const MANIFEST_PATH: &str = "/console-manifest";
/// The route the words are answered at.
pub const WORDS_PATH: &str = "/console/words";

// What the bundle's build writes into its folder.
const MODULE_FILE: &str = "bundle.js";
const STYLESHEET_FILE: &str = "bundle.css";
const WORDS_FILE: &str = "words.json";

// How many hexadecimal digits of a file's digest stand in its path.
const DIGEST_DIGITS: usize = 16;

/// The cache line of a file whose path follows its bytes.
pub const KEPT_FOR_GOOD: &str = "private, max-age=31536000, immutable";

/// One file of the bundle, as it is answered.
#[derive(Clone, Debug)]
pub struct Served {
  /// Its name under `/console/`: `bundle-<digest>.<extension>`.
  pub name: String,
  pub content_type: &'static str,
  pub bytes: Vec<u8>,
}

impl Served {
  fn read(folder: &Path, file: &str, extension: &str, content_type: &'static str) -> Result<Self, String> {
    let path = folder.join(file);
    let bytes =
      std::fs::read(&path).map_err(|why| format!("{} could not be read: {why}", path.display()))?;
    let digest = format!("{:x}", Sha256::digest(&bytes));
    Ok(Self {
      name: format!("bundle-{}.{extension}", &digest[..DIGEST_DIGITS]),
      content_type,
      bytes,
    })
  }

  fn path(&self) -> String {
    format!("/console/{}", self.name)
  }
}

/// One further file of the build, answered under its own name (chunk, font, or the like).
#[derive(Clone, Debug)]
pub struct Other {
  pub content_type: &'static str,
  pub bytes: Vec<u8>,
}

/// The largest file the folder may leave for serving.
const FILE_MAX: u64 = 32 * 1024 * 1024;

/// The bundle as the service serves it.
#[derive(Clone, Debug)]
pub struct Bundle {
  pub module: Served,
  pub stylesheet: Served,
  pub words: serde_json::Value,
  others: std::collections::BTreeMap<String, Other>,
}

impl Bundle {
  /// The bundle built into `folder`, or why it cannot be served.
  pub fn read(folder: &Path) -> Result<Self, String> {
    let module = Served::read(folder, MODULE_FILE, "js", "text/javascript")?;
    let stylesheet = Served::read(folder, STYLESHEET_FILE, "css", "text/css")?;
    let path = folder.join(WORDS_FILE);
    let words =
      std::fs::read(&path).map_err(|why| format!("{} could not be read: {why}", path.display()))?;
    let words: serde_json::Value =
      serde_json::from_slice(&words).map_err(|why| format!("{} is not JSON: {why}", path.display()))?;
    if !words.is_object() {
      return Err(format!("{} is not one object keyed by locale", path.display()));
    }
    let mut others = std::collections::BTreeMap::new();
    read_folder(folder, Path::new(""), &mut others)?;
    others.remove(MODULE_FILE);
    others.remove(STYLESHEET_FILE);
    others.remove(WORDS_FILE);
    Ok(Self {
      module,
      stylesheet,
      words,
      others,
    })
  }

  /// The manifest naming this bundle's files (`docs/api.md`, 「Console」).
  pub fn manifest(&self) -> ConsoleManifest {
    ConsoleManifest {
      name: "note".into(),
      title: "note.title".into(),
      icon: "i-material-symbols-edit-note-outline".into(),
      screen_path: "/note".into(),
      service_name: "note".into(),
      bundle: self.module.path(),
      stylesheet: self.stylesheet.path(),
      words: WORDS_PATH.into(),
      api_prefix: "/".into(),
      role: Role::Member,
      owner_key: true,
      events: true,
      websocket: false,
      push_kinds: Vec::new(),
      // The AI talk panel speaks to the supervisor through the receiver's one-turn road (`docs/design.md`,
      // 「The AI talk panel」); the console relays it on the receiver's own terms.
      calls: vec!["receiver".into()],
      relays: Vec::new(),
      share_reads: Vec::new(),
    }
  }

  /// The file answered under `name`, where the bundle has one.
  pub fn file(&self, name: &str) -> Option<&Served> {
    [&self.module, &self.stylesheet].into_iter().find(|served| served.name == name)
  }

  /// The further file answered under its build name, where the bundle holds one.
  pub fn other(&self, name: &str) -> Option<&Other> {
    self.others.get(name)
  }
}

/// Every servable file under `folder`, by its `/`-joined path, read into `held`.
fn read_folder(
  folder: &Path,
  under: &Path,
  held: &mut std::collections::BTreeMap<String, Other>,
) -> Result<(), String> {
  for entry in
    std::fs::read_dir(folder.join(under)).map_err(|why| format!("{}: {why}", folder.display()))?
  {
    let entry = entry.map_err(|why| why.to_string())?;
    let name = entry.file_name().to_string_lossy().to_string();

    if name.starts_with('.') {
      continue;
    }

    let path = under.join(&name);

    if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
      read_folder(folder, &path, held)?;
      continue;
    }

    if entry.metadata().map(|kind| !kind.is_file() || kind.len() > FILE_MAX).unwrap_or(true) {
      continue;
    }

    let bytes = std::fs::read(folder.join(&path)).map_err(|why| format!("{why}"))?;
    let content_type = match path.extension().and_then(|ext| ext.to_str()).unwrap_or_default() {
      "js" | "mjs" => "text/javascript",
      "css" => "text/css",
      "json" => "application/json",
      "svg" => "image/svg+xml",
      "png" => "image/png",
      "jpg" | "jpeg" => "image/jpeg",
      "gif" => "image/gif",
      "woff" => "font/woff",
      "woff2" => "font/woff2",
      "ttf" => "font/ttf",
      "otf" => "font/otf",
      "map" => "application/json",
      _ => "application/octet-stream",
    };
    held.insert(
      path.to_string_lossy().replace("\\", "/"),
      Other {
        content_type,
        bytes,
      },
    );
  }

  Ok(())
}
