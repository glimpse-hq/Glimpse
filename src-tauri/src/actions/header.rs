//! Reads an action's `@glimpse.<key> <value>` header lines.

use std::ops::Range;
use std::time::Duration;

use crate::core::hotkeys::{self, Hotkey, ShortcutAction};

pub(crate) const EVENTS: [&str; 4] = [
    "dictation.saved",
    "library.added",
    "library.complete",
    "library.error",
];

pub(crate) struct ShortcutLine {
    pub(crate) text: String,
    pub(crate) hotkey: Option<Hotkey>,
    pub(crate) behavior: ShortcutAction,
    /// Where the value sits in the file, for rewriting it in place.
    pub(crate) value: Range<usize>,
    pub(crate) has_behavior_word: bool,
}

pub(crate) struct Header {
    pub(crate) shebang: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) shortcuts: Vec<ShortcutLine>,
    pub(crate) phrases: Vec<String>,
    pub(crate) events: Vec<String>,
    pub(crate) apps: Vec<String>,
    pub(crate) sites: Vec<String>,
    pub(crate) insert: bool,
    /// None runs without a limit.
    pub(crate) timeout: Option<Duration>,
    pub(crate) listen: bool,
    pub(crate) problems: Vec<String>,
}

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

pub(crate) fn parse(content: &str) -> Header {
    let mut header = Header {
        shebang: None,
        description: None,
        shortcuts: Vec::new(),
        phrases: Vec::new(),
        events: Vec::new(),
        apps: Vec::new(),
        sites: Vec::new(),
        insert: false,
        timeout: Some(DEFAULT_TIMEOUT),
        listen: true,
        problems: Vec::new(),
    };
    let mut seen_single: Vec<&str> = Vec::new();
    let mut offset = if content.starts_with('\u{feff}') {
        3
    } else {
        0
    };
    let mut lines = content[offset..].split_inclusive('\n').enumerate();
    for (index, line) in lines.by_ref() {
        let start = offset;
        offset += line.len();
        let trimmed = line.trim();
        if index == 0
            && let Some(program) = trimmed.strip_prefix("#!")
        {
            header.shebang = Some(program.trim().to_string());
            continue;
        }
        if trimmed.is_empty() {
            continue;
        }
        if !is_comment(trimmed) {
            break;
        }
        let Some(at) = line.find("@glimpse.") else {
            continue;
        };
        let after = &line[at + "@glimpse.".len()..];
        let key_len = after
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
            .unwrap_or(after.len());
        let key = &after[..key_len];
        let rest = &after[key_len..];
        let value = rest.trim();
        let value_start =
            start + at + "@glimpse.".len() + key_len + (rest.len() - rest.trim_start().len());
        if matches!(key, "description" | "show" | "timeout" | "listen") {
            if seen_single.contains(&key) {
                header.problems.push(format!("@glimpse.{key} is set twice"));
                continue;
            }
            seen_single.push(key);
        }
        let bad_value = || format!("@glimpse.{key} can't be \"{value}\"");
        match key {
            "description" if !value.is_empty() => header.description = Some(value.to_string()),
            "shortcut" => header
                .shortcuts
                .push(shortcut_line(value, value_start..value_start + value.len())),
            "say" if !words(value).is_empty() => header.phrases.push(value.to_string()),
            "on" if EVENTS.contains(&value) => header.events.push(value.to_string()),
            "on" if matches!(value, "call.start" | "call.end") => {
                header.problems.push(format!("{value} isn't available yet"))
            }
            "app" if !value.is_empty() => header.apps.push(value.to_string()),
            "site" if !value.is_empty() => header.sites.push(value.to_string()),
            "show" if matches!(value, "toast" | "insert") => header.insert = value == "insert",
            "timeout" => match value.parse::<u64>() {
                Ok(0) => header.timeout = None,
                Ok(seconds) => header.timeout = Some(Duration::from_secs(seconds)),
                Err(_) => header.problems.push(bad_value()),
            },
            "listen" if matches!(value, "true" | "false") => header.listen = value == "true",
            "description" | "say" | "on" | "app" | "site" | "show" | "listen" => {
                header.problems.push(bad_value())
            }
            _ => header
                .problems
                .push(format!("Unknown header line @glimpse.{key}")),
        }
    }
    for (_, line) in lines {
        if let Some(key) = header_key(line.trim()) {
            header.problems.push(below_code(key));
        }
    }
    header
}

/// The key of a comment line that is only a header line, like `# @glimpse.say hi`.
fn header_key(line: &str) -> Option<&str> {
    let at = line.find("@glimpse.")?;
    let marker = line[..at].trim();
    let marker_only = !marker.is_empty()
        && (marker.eq_ignore_ascii_case("rem") || marker.chars().all(|c| "#/-:".contains(c)));
    let after = &line[at + "@glimpse.".len()..];
    marker_only.then(|| {
        &after[..after
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
            .unwrap_or(after.len())]
    })
}

fn below_code(key: &str) -> String {
    format!("@glimpse.{key} is below the first line of code and is ignored")
}

fn is_comment(line: &str) -> bool {
    ["#", "//", "--", "::"]
        .iter()
        .any(|marker| line.starts_with(marker))
        || (line
            .get(..3)
            .is_some_and(|word| word.eq_ignore_ascii_case("rem"))
            && line[3..].chars().next().is_none_or(char::is_whitespace))
}

fn shortcut_line(value: &str, range: Range<usize>) -> ShortcutLine {
    let (text, behavior) = match value.rsplit_once(char::is_whitespace) {
        Some((text, "smart")) => (text.trim(), Some(ShortcutAction::Smart)),
        Some((text, "hold")) => (text.trim(), Some(ShortcutAction::Hold)),
        Some((text, "toggle")) => (text.trim(), Some(ShortcutAction::Toggle)),
        _ => (value, None),
    };
    let hotkey = hotkeys::parse_shortcut(text)
        .ok()
        .filter(|hotkey| hotkeys::validate_recording_shortcut(hotkey).is_ok());
    ShortcutLine {
        text: text.to_string(),
        hotkey,
        behavior: behavior.unwrap_or(ShortcutAction::Smart),
        value: range,
        has_behavior_word: behavior.is_some(),
    }
}

pub(crate) fn behavior_name(behavior: ShortcutAction) -> &'static str {
    match behavior {
        ShortcutAction::Smart => "smart",
        ShortcutAction::Hold => "hold",
        ShortcutAction::Toggle => "toggle",
    }
}

// Thai and Devanagari write some vowels and tone marks as combining
// characters that aren't alphanumeric, but they belong to the word. Their
// punctuation, like the danda, separates words.
fn is_word_char(c: char) -> bool {
    c.is_alphanumeric()
        || matches!(c,
            '\u{0900}'..='\u{0963}'
            | '\u{0966}'..='\u{097F}'
            | '\u{0E00}'..='\u{0E3E}'
            | '\u{0E40}'..='\u{0E4E}'
            | '\u{0E50}'..='\u{0E59}')
}

/// Written without spaces between words, so each character is matched as a word.
fn is_unspaced(c: char) -> bool {
    matches!(c,
        '\u{0E00}'..='\u{0E7F}'
        | '\u{3040}'..='\u{30FF}'
        | '\u{3400}'..='\u{4DBF}'
        | '\u{4E00}'..='\u{9FFF}'
        | '\u{AC00}'..='\u{D7AF}'
        | '\u{F900}'..='\u{FAFF}'
        | '\u{20000}'..='\u{2A6DF}')
}

/// Thai vowel and tone marks, which stay with the letter before them.
fn is_mark(c: char) -> bool {
    matches!(c, '\u{0E31}' | '\u{0E34}'..='\u{0E3A}' | '\u{0E47}'..='\u{0E4E}')
}

/// Byte ranges of the words in `text`, for matching without case or
/// punctuation. Each character of a script written without spaces is a word.
pub(crate) fn word_spans(text: &str) -> impl Iterator<Item = Range<usize>> + '_ {
    let mut chars = text.char_indices().peekable();
    std::iter::from_fn(move || {
        let (start, first) = chars.by_ref().find(|(_, c)| is_word_char(*c))?;
        let unspaced = is_unspaced(first);
        let mut end = text.len();
        while let Some(&(at, c)) = chars.peek() {
            let continues = if unspaced {
                is_mark(c)
            } else {
                is_word_char(c) && !is_unspaced(c)
            };
            if !continues {
                end = at;
                break;
            }
            chars.next();
        }
        Some(start..end)
    })
}

pub(crate) fn words(text: &str) -> Vec<String> {
    word_spans(text)
        .map(|span| text[span].to_lowercase())
        .collect()
}

/// Where `phrase` ends in `text` when `text` starts with it. `spans` and
/// `words` are `text`'s, from `word_spans` and `words`.
pub(crate) fn phrase_end(
    spans: &[Range<usize>],
    words: &[String],
    phrase: &[String],
) -> Option<usize> {
    (!phrase.is_empty() && words.starts_with(phrase)).then(|| spans[phrase.len() - 1].end)
}
