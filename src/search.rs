//! How a search reads what it is asked and says where it found it (`docs/api.md`, 「Search」): the terms a
//! query holds, the full-text query the store's index reads, and the places the terms stand in a found
//! note's title and text. The query's grammar is the route's own — terms parted by spaces, a run between
//! two double quotes one term — so it is read here rather than by a general parser.

use crate::wire::Snippet;

/// The fewest characters a term the trigram index can read holds.
pub const INDEXED_MIN: usize = 3;

/// The most characters a query holds.
pub const QUERY_MAX: usize = 200;

/// How many characters of a note's text a snippet keeps before its first hit, and in all.
const LEAD_CHARS: usize = 40;
const SNIPPET_CHARS: usize = 160;

/// The terms of a query: each run of non-space characters, and each run between two double quotes, its
/// inner spaces and all. A quote left open runs to the end. Empty terms are dropped, and a term named twice
/// stands once.
pub fn terms(query: &str) -> Vec<String> {
  let mut terms: Vec<String> = Vec::new();
  let mut current = String::new();
  let mut quoted = false;
  let keep = |current: &mut String, terms: &mut Vec<String>| {
    let term = std::mem::take(current).trim().to_owned();
    if !term.is_empty() && !terms.contains(&term) {
      terms.push(term);
    }
  };
  for ch in query.chars() {
    if ch == '"' {
      keep(&mut current, &mut terms);
      quoted = !quoted;
    } else if ch.is_whitespace() && !quoted {
      keep(&mut current, &mut terms);
    } else {
      current.push(ch);
    }
  }
  keep(&mut current, &mut terms);
  terms
}

/// Whether the trigram index can read a term.
pub fn indexed(term: &str) -> bool {
  term.chars().count() >= INDEXED_MIN
}

/// The full-text query of the indexed terms: each one a string the index reads as the run of characters it
/// holds, all of them required, in the title alone where `title_only` says.
pub fn index_query(terms: &[String], title_only: bool) -> Option<String> {
  let strings: Vec<String> = terms
    .iter()
    .filter(|term| indexed(term))
    .map(|term| {
      let string = format!("\"{}\"", term.replace('"', "\"\""));
      if title_only { format!("title : {string}") } else { string }
    })
    .collect();
  if strings.is_empty() { None } else { Some(strings.join(" AND ")) }
}

/// A character as a match compares it: its lowercase, letter case set aside.
fn folded(ch: char) -> char {
  ch.to_lowercase().next().unwrap_or(ch)
}

/// Every place a term stands in `text`, letter case set aside, as `[start, end)` character indices in
/// order, overlapping places merged.
fn char_hits(text: &[char], terms: &[String]) -> Vec<[usize; 2]> {
  let haystack: Vec<char> = text.iter().copied().map(folded).collect();
  let mut hits: Vec<[usize; 2]> = Vec::new();
  for term in terms {
    let needle: Vec<char> = term.chars().map(folded).collect();
    if needle.is_empty() || needle.len() > haystack.len() {
      continue;
    }
    for start in 0..=haystack.len() - needle.len() {
      if haystack[start..start + needle.len()] == needle[..] {
        hits.push([start, start + needle.len()]);
      }
    }
  }
  hits.sort_unstable();
  let mut merged: Vec<[usize; 2]> = Vec::new();
  for hit in hits {
    match merged.last_mut() {
      Some(last) if hit[0] <= last[1] => last[1] = last[1].max(hit[1]),
      _ => merged.push(hit),
    }
  }
  merged
}

/// Character indices of `text` as UTF-16 code units, the way a browser's string counts.
fn utf16_places(text: &[char], hits: &[[usize; 2]]) -> Vec<[usize; 2]> {
  let mut units = Vec::with_capacity(text.len() + 1);
  let mut at = 0;
  for ch in text {
    units.push(at);
    at += ch.len_utf16();
  }
  units.push(at);
  hits.iter().map(|[start, end]| [units[*start], units[*end]]).collect()
}

/// The places the terms stand in a title, in UTF-16 code units.
pub fn title_hits(title: &str, terms: &[String]) -> Vec<[usize; 2]> {
  let chars: Vec<char> = title.chars().collect();
  utf16_places(&chars, &char_hits(&chars, terms))
}

/// A stretch of a note's text around the first place a term stands, its line breaks laid flat, with the
/// places the terms stand in it; none where no term stands in the text.
pub fn snippet(text: &str, terms: &[String]) -> Option<Snippet> {
  let flat: Vec<char> = text.split_whitespace().collect::<Vec<_>>().join(" ").chars().collect();
  let hits = char_hits(&flat, terms);
  let first = hits.first()?;
  let start = first[0].saturating_sub(LEAD_CHARS);
  let end = (start + SNIPPET_CHARS).min(flat.len());
  let lead: Vec<char> = if start > 0 { vec!['…'] } else { Vec::new() };
  let mut shown: Vec<char> = lead.clone();
  shown.extend_from_slice(&flat[start..end]);
  if end < flat.len() {
    shown.push('…');
  }
  let shift = lead.len();
  let inside: Vec<[usize; 2]> = hits
    .iter()
    .filter(|[from, _]| *from < end)
    .map(|[from, to]| [from - start + shift, (*to).min(end) - start + shift])
    .collect();
  Some(Snippet {
    hits: utf16_places(&shown, &inside),
    text: shown.into_iter().collect(),
  })
}
