#[derive(Debug)]
pub struct TranscriptionSuccess {
    pub transcript: String,
    pub speech_model: Option<String>,
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
