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

pub fn strip_hallucinated_thank_you(input: &str) -> String {
    const HALLUCINATED_THANK_YOU: &str = "Thank you.";

    let trimmed = input.trim();
    if trimmed == HALLUCINATED_THANK_YOU {
        return String::new();
    }

    if let Some(prefix) = trimmed.strip_suffix(HALLUCINATED_THANK_YOU) {
        let prefix_trimmed_end = prefix.trim_end();
        let has_separator = prefix.len() > prefix_trimmed_end.len();
        if has_separator && prefix_trimmed_end.ends_with('.') {
            return prefix_trimmed_end.to_string();
        }
    }

    trimmed.to_string()
}
