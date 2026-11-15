// The icons a note may wear (`docs/design.md`, 「The console surface」, the page head): a small set of
// emoji the picker offers, each standing for itself. A note holds one of them, or another the service kept
// for it, or none.

/** The emoji the picker offers, in the order it shows them. */
export const NOTE_ICONS = [
  "📝", "📄", "📌", "📎", "📚", "📖", "🗂️", "📅",
  "✅", "💡", "⭐", "🔥", "🎯", "🚀", "🧭", "🧪",
  "💬", "📣", "🔒", "🔑", "⚙️", "🛠️", "📊", "📈",
  "🏠", "🏢", "✈️", "🌱", "🌊", "☕", "🍽️", "🎵",
  "❤️", "🙂", "🎉", "🐶", "🐱", "🌙", "☀️", "❄️"
] as const;

/** The mark a note with no icon of its own wears in a row. */
export const NOTE_MARK = "i-material-symbols-description-outline";
