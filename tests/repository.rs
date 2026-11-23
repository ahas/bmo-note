//! Checks that span the unit: what its crate may depend on, its testbed declaration and service unit,
//! its settings, the README's folder table, and what no unit file may hold (`PERSONAL-DATA.md`). The
//! fork's upstream folders are out of this scope: the unit owns the folders the README's table names as
//! its own, and the licence line of `docs/affine.md`.

use std::collections::BTreeSet;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

const ROOT: &str = env!("CARGO_MANIFEST_DIR");

/// The folders the unit owns wholly, as this test and `PERSONAL-DATA.md` scope them.
const UNIT_FOLDERS: [&str; 3] = ["src", "client", "deploy"];

/// The files under the fork's own `docs/` and `tests/` that belong to the unit.
const UNIT_LOOSE_FILES: [&str; 11] = [
  "docs/design.md",
  "docs/api.md",
  "docs/affine.md",
  "tests/main.rs",
  "tests/support.rs",
  "tests/notes.rs",
  "tests/blobs.rs",
  "tests/sharing.rs",
  "tests/events.rs",
  "tests/console.rs",
  "tests/repository.rs",
];

/// The root files the unit owns.
const UNIT_FILES: [&str; 11] = [
  "README.md",
  "CLAUDE.md",
  "PERSONAL-DATA.md",
  "Cargo.toml",
  "Cargo.lock",
  "testbed.toml",
  "settings.toml",
  "rustfmt.toml",
  ".gitignore",
  "LICENSE",
  "LICENSE-MIT",
];

/// The Hangul blocks of Unicode: Jamo, compatibility Jamo, Jamo extended A and B, syllables, and the
/// halfwidth forms.
const HANGUL: [(u32, u32); 6] = [
  (0x1100, 0x11FF),
  (0x3130, 0x318F),
  (0xA960, 0xA97F),
  (0xAC00, 0xD7AF),
  (0xD7B0, 0xD7FF),
  (0xFFA0, 0xFFDC),
];

fn metadata() -> Value {
  let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned());
  let output = Command::new(cargo)
    .args(["metadata", "--no-deps", "--format-version", "1"])
    .current_dir(ROOT)
    .output()
    .expect("cargo metadata runs");
  assert!(
    output.status.success(),
    "cargo metadata failed: {}",
    String::from_utf8_lossy(&output.stderr)
  );
  serde_json::from_slice(&output.stdout).expect("cargo metadata answers JSON")
}

/// Every file git tracks or would track under the unit's folders and files.
fn unit_files() -> Vec<String> {
  let output = Command::new("git")
    .args(
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--"]
        .into_iter()
        .chain(UNIT_FOLDERS)
        .chain(UNIT_LOOSE_FILES)
        .chain(UNIT_FILES)
        .collect::<Vec<_>>(),
    )
    .current_dir(ROOT)
    .output()
    .expect("git ls-files runs");
  assert!(
    output.status.success(),
    "git ls-files failed: {}",
    String::from_utf8_lossy(&output.stderr)
  );
  let mut files: Vec<String> = String::from_utf8(output.stdout)
    .expect("tracked paths are UTF-8")
    .split('\0')
    .filter(|path| !path.is_empty() && !is_build_output(path))
    .map(str::to_owned)
    .collect();
  files.sort();
  files.dedup();
  files
}

/// The build outputs a check has no business reading.
fn is_build_output(path: &str) -> bool {
  ["node_modules/", "/dist/", "/vendor/", "/target/", "/.nuxt/"]
    .iter()
    .any(|name| path.contains(name))
    || path.ends_with(".tsbuildinfo")
}

fn text_of(path: &str) -> Option<String> {
  match fs::read(Path::new(ROOT).join(path)) {
    Ok(bytes) => String::from_utf8(bytes).ok(),
    Err(error) if error.kind() == ErrorKind::NotFound => None,
    Err(error) => panic!("{path} is unreadable: {error}"),
  }
}

/// One form no unit file may hold, and the kind the check reports it as (`PERSONAL-DATA.md`).
struct PersonalData {
  kind: &'static str,
  pattern: Regex,
}

fn personal_data() -> &'static [PersonalData] {
  static FORMS: LazyLock<Vec<PersonalData>> = LazyLock::new(|| {
    let form = |kind, source: &str| PersonalData {
      kind,
      pattern: Regex::new(source).expect("a personal-data form"),
    };

    vec![
      form("a mail address", r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
      form("a home path", r"(?:/home/|/Users/|[A-Za-z]:\\Users\\)[A-Za-z0-9._-]+"),
      form("a telephone number", r"\b01[016789][-. ]?[0-9]{3,4}[-. ][0-9]{4}\b"),
      form("a telephone number", r"\b0[2-9][0-9]?[-. ][0-9]{3,4}[-. ][0-9]{4}\b"),
      form("a telephone number", r"\+\d{1,3}[-. ]\d{2,4}[-. ]\d{3,4}"),
      form("a telephone number", r"\+\d{9,15}\b"),
      form("a token", r"\bgh[pousr]_[A-Za-z0-9]{20,}"),
      form("a token", r"\bgithub_pat_[A-Za-z0-9_]{20,}"),
      form("a token", r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
      form("a token", r"\bsk-[A-Za-z0-9_-]{20,}"),
      form("a token", r"\bxox[baprs]-[A-Za-z0-9-]{10,}"),
      form("a token", r"\bAIza[0-9A-Za-z_-]{35}"),
      form("a token", r"\bglpat-[A-Za-z0-9_-]{20,}"),
      form("a token", r"\bnpm_[A-Za-z0-9]{36}\b"),
      form("a token", r"-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----"),
      form("a private network address", r"\b10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\b"),
      form("a private network address", r"\b192\.168\.[0-9]{1,3}\.[0-9]{1,3}\b"),
      form("a private network address", r"\b172\.(?:1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}\b"),
      form("a private network address", r"(?i)\b(?:f[cd][0-9a-f]{2}|fe80):"),
    ]
  });

  FORMS.as_slice()
}

fn personal_data_in(line: &str) -> BTreeSet<&'static str> {
  personal_data()
    .iter()
    .filter(|form| form.pattern.is_match(line))
    .map(|form| form.kind)
    .collect()
}

fn is_hangul(character: char) -> bool {
  let point = u32::from(character);
  HANGUL.iter().any(|&(first, last)| (first..=last).contains(&point))
}

#[test]
fn no_unit_file_holds_personal_data() {
  let mut refused = Vec::new();
  for path in unit_files() {
    let Some(text) = text_of(&path) else {
      continue;
    };
    for (number, line) in text.lines().enumerate() {
      let kinds = personal_data_in(line);
      if !kinds.is_empty() {
        refused.push(format!(
          "{path}:{}: {}",
          number + 1,
          kinds.into_iter().collect::<Vec<_>>().join(", ")
        ));
      }
    }
  }
  assert!(refused.is_empty(), "personal data in unit files:\n{}", refused.join("\n"));
}

#[test]
fn korean_stands_only_where_the_ledger_of_the_unit_allows_it() {
  // English in code, comments, documents and commits; Korean in the bundle's `ko` words alone, the pack
  // and the editor's word table inside the bundle's words folder, in the test fixtures that read them, and
  // in the README's language line, which names the Korean translation in its own script (CLAUDE.md).
  let mut refused = Vec::new();
  for path in unit_files() {
    let words = path.starts_with("client/i18n/") && path.ends_with("/ko.json");
    let allowed = words || (path.starts_with("tests/") && path.ends_with(".rs"));
    if allowed {
      continue;
    }
    let Some(mut text) = text_of(&path) else {
      continue;
    };
    if path == "README.md" {
      text = text.lines().skip(1).collect::<Vec<_>>().join("\n");
    }
    let wordy = [".rs", ".md", ".json", ".toml"].iter().any(|tail| path.ends_with(tail));
    if wordy && text.chars().any(is_hangul) {
      refused.push(path);
    }
  }
  assert!(
    refused.is_empty(),
    "Hangul outside the bundle's words and the test fixtures: {refused:?}"
  );
}

#[test]
fn the_crate_depends_on_registry_crates_and_its_declared_base_libraries_alone() {
  let declaration = declaration();
  let base_libraries: Vec<&str> = table(&declaration, "check")
    .get("base_libraries")
    .and_then(toml::Value::as_array)
    .expect("the declaration names its base libraries")
    .iter()
    .map(|library| library.as_str().expect("a base library is named"))
    .collect();
  let metadata = metadata();
  let packages = metadata["packages"].as_array().expect("metadata lists packages");
  let mut refused = Vec::new();
  for package in packages {
    let name = package["name"].as_str().expect("a package has a name");
    if name != "bmo-note" {
      refused.push(format!("{name} is in the workspace, which holds the unit's crate alone"));
    }
    // One metadata table carries every kind of dependency, dev ones included.
    for dependency in package["dependencies"].as_array().expect("a dependency table") {
      let source = dependency["source"].as_str().unwrap_or_default();
      let given = dependency["name"].as_str().expect("a dependency has a name");
      if base_libraries.contains(&given) {
        continue;
      }
      if !source.starts_with("registry+") {
        refused.push(format!("{name} -> {given} is not a registry crate"));
      }
      if given.starts_with("bmo-") {
        refused.push(format!("{name} -> {given} is a base library this crate does not take"));
      }
    }
  }
  assert!(
    refused.is_empty(),
    "dependencies outside the registry and the base libraries: {refused:?}"
  );
}

fn declaration() -> toml::Table {
  let text = text_of("testbed.toml").expect("testbed.toml is at the root");
  text.parse().expect("testbed.toml is TOML")
}

fn table<'a>(within: &'a toml::Table, key: &str) -> &'a toml::Table {
  within
    .get(key)
    .and_then(toml::Value::as_table)
    .unwrap_or_else(|| panic!("testbed.toml has `[{key}]`"))
}

fn text<'a>(within: &'a toml::Table, key: &str) -> &'a str {
  within
    .get(key)
    .and_then(toml::Value::as_str)
    .unwrap_or_else(|| panic!("`{key}` is a string"))
}

#[test]
fn the_declaration_names_the_unit_service_store_and_bundle() {
  let declaration = declaration();
  assert_eq!(declaration.get("testbed").and_then(toml::Value::as_integer), Some(0));
  assert_eq!(text(&declaration, "name"), "bmo-note");
  let deploy = table(&declaration, "deploy");
  assert_eq!(text(deploy, "root"), "~/.local/share/bmo-note");
  assert_eq!(text(deploy, "data_root"), "~/.local/share/bmo/data");
  let links = deploy.get("env_links").and_then(toml::Value::as_array).expect("one env link").clone();
  let link = links[0].as_table().expect("an env link");
  assert_eq!(text(link, "link"), "settings.local.toml");
  assert_eq!(text(link, "target"), "env/note.toml");
  assert!(text(deploy, "health").ends_with("bin/bmo-note health"));
  let build = table(&declaration, "build");
  let binaries = build.get("binaries").and_then(toml::Value::as_array).expect("the built binaries");
  assert_eq!(binaries.len(), 1);
  assert_eq!(binaries[0].as_str().expect("a binary"), "bmo-note");
  let projects = table(&declaration, "projects");
  let paths = projects.get("paths").and_then(toml::Value::as_array).expect("one project");
  assert_eq!(paths[0].as_str().expect("a project"), "client");
}

#[test]
fn the_service_unit_runs_the_service_where_the_deploy_tree_stands() {
  let text = text_of("deploy/bmo-note.service").expect("the unit file stands under deploy/");
  let parsed = ini::Ini::load_from_file(Path::new(ROOT).join("deploy/bmo-note.service"))
    .expect("the unit file reads as INI");
  let service = parsed.section(Some("Service")).expect("a [Service] section");
  assert_eq!(service.get("ExecStart"), Some("%h/.local/share/bmo-note/deploy/bin/bmo-note serve"));
  assert_eq!(service.get("WorkingDirectory"), Some("%h/.local/share/bmo-note/deploy"));
  assert_eq!(service.get("Restart"), Some("always"));
  assert_eq!(service.get("TimeoutStopSec"), Some("infinity"));
  let unit = parsed.section(Some("Unit")).expect("a [Unit] section");
  assert!(unit.get("Description").expect("a description").starts_with("bmo-note"));
  assert_eq!(unit.get("ConditionPathExists"), Some("%h/.local/share/bmo/data/env/note.toml"));
  assert!(text.contains("X-BMO-Deploy=bot"), "the unit is marked bot");
}

#[test]
fn the_built_in_settings_answer_on_the_units_own_port() {
  let source = text_of("settings.toml").expect("settings.toml is at the root");
  let parsed: toml::Table = source.parse().expect("settings.toml is TOML");
  let server = table(&parsed, "server");
  assert_eq!(text(server, "listen"), "127.0.0.1:13129");
  assert_eq!(text(server, "token"), "");
  let console = table(&parsed, "console");
  assert_eq!(text(console, "token"), "");
  assert_eq!(text(console, "folder"), "client/dist");
  let store = table(&parsed, "store");
  assert_eq!(text(store, "path"), "note.db");
  let notes = table(&parsed, "notes");
  assert!(notes.get("max_doc_bytes").and_then(toml::Value::as_integer).expect("a cap") > 0);
}

#[test]
fn the_readme_table_names_the_unit_folders() {
  let readme = text_of("README.md").expect("README.md is at the root");
  for folder in UNIT_FOLDERS {
    assert!(readme.contains(&format!("| `{folder}/` |")), "README.md does not name `{folder}/`");
  }
  let declared = declaration();
  let deploy = table(&declared, "deploy");
  let root = PathBuf::from(text(deploy, "root").strip_prefix("~").expect("a home-relative deploy root"));
  assert!(root.display().to_string().contains("bmo-note"), "the deploy root is another unit's");
}

#[test]
fn the_licence_line_of_the_fork_is_stated_in_the_unit() {
  let record = text_of("docs/affine.md").expect("docs/affine.md is the study record");
  for phrase in ["packages/backend/", "packages/common/native", "Enterprise Edition", "MIT"] {
    assert!(record.contains(phrase), "docs/affine.md does not name {phrase}");
  }
}
