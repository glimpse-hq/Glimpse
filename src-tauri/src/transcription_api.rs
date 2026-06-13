#[derive(Debug)]
pub struct TranscriptionSuccess {
    pub transcript: String,
    pub speech_model: Option<String>,
    pub segments: Option<Vec<glimpse_speech::TranscriptionSegment>>,
    pub words: Option<Vec<glimpse_speech::TranscriptionSegment>>,
}

pub fn auto_paste_enabled() -> bool {
    env_flag("GLIMPSE_AUTO_PASTE", true)
}

fn env_flag(key: &str, default: bool) -> bool {
    std::env::var(key)
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(default)
}

pub fn normalize_transcript(input: &str) -> String {
    input
        .lines()
        .map(|line| {
            let mut normalized = String::with_capacity(line.len());
            let mut had_space = false;
            for ch in line.chars() {
                if ch == ' ' || ch == '\t' {
                    if !normalized.is_empty() && !had_space {
                        normalized.push(' ');
                    }
                    had_space = true;
                } else {
                    normalized.push(ch);
                    had_space = false;
                }
            }
            normalized.trim_end().to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

/// True if a segment spanning `[start, end]` seconds overlaps any speech region.
pub fn overlaps_speech(start: f32, end: f32, regions: &[(f32, f32)]) -> bool {
    regions.iter().any(|&(rs, re)| start < re && end > rs)
}

pub fn keep_spoken_segments(
    transcript: &str,
    segments: Option<&[glimpse_speech::TranscriptionSegment]>,
    regions: Option<&[(f32, f32)]>,
) -> String {
    let (Some(segments), Some(regions)) = (segments, regions) else {
        return transcript.trim().to_string();
    };
    if regions.is_empty() {
        return String::new();
    }
    segments
        .iter()
        .filter(|s| overlaps_speech(s.start, s.end, regions))
        .map(|s| s.text.trim())
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Removes whisper's non-speech tags (`[BLANK_AUDIO]`, `(music)`). Returns empty
/// when nothing but tags or punctuation remains.
pub fn strip_non_speech_tags(transcript: &str) -> String {
    let mut out = String::with_capacity(transcript.len());
    let mut rest = transcript;
    while let Some(open_idx) = rest.find(['[', '(']) {
        let close = if rest.as_bytes()[open_idx] == b'[' {
            ']'
        } else {
            ')'
        };
        let Some(rel_close) = rest[open_idx + 1..].find(close) else {
            break;
        };
        out.push_str(&rest[..open_idx]);
        rest = &rest[open_idx + 1 + rel_close + 1..];
    }
    out.push_str(rest);

    let cleaned = out.split_whitespace().collect::<Vec<_>>().join(" ");
    if !cleaned.chars().any(char::is_alphanumeric) {
        return String::new();
    }
    cleaned
}
