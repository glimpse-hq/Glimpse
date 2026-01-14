use std::fs;

use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::recorder::RecordingSaved;
use crate::settings::Personality;

/// Maximum audio file size 25MB
const MAX_AUDIO_SIZE_BYTES: u64 = 25 * 1024 * 1024;

#[derive(Debug)]
pub struct TranscriptionSuccess {
    pub transcript: String,
    pub speech_model: Option<String>,
}

pub fn auto_paste_enabled() -> bool {
    env_flag("GLIMPSE_AUTO_PASTE", true)
}

#[derive(Debug, Clone, Serialize)]
pub struct TranscriptionPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_name: Option<String>,
    pub language: String,
    pub dictionary: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub personality: Option<PersonalityPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_text: Option<String>,
    pub history_sync: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PersonalityPayload {
    pub id: String,
    pub name: String,
    pub instructions: Vec<String>,
}

impl PersonalityPayload {
    pub fn from_personality(p: &Personality) -> Self {
        Self {
            id: p.id.clone(),
            name: p.name.clone(),
            instructions: p.instructions.clone(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct CloudTranscriptionConfig {
    pub function_url: String,
    pub jwt: String,
    pub payload: TranscriptionPayload,
}

fn env_flag(key: &str, default: bool) -> bool {
    std::env::var(key)
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(default)
}

impl CloudTranscriptionConfig {
    pub fn new(function_url: String, jwt: String, payload: TranscriptionPayload) -> Self {
        Self {
            function_url,
            jwt,
            payload,
        }
    }
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

#[derive(Debug, Deserialize)]
struct ApiErrorResponse {
    error: String,
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    user_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CloudTranscriptionResponse {
    pub transcript: String,
    pub raw_text: Option<String>,
    pub model: String,
    pub llm_cleaned: bool,
    pub llm_model: Option<String>,
    #[serde(default)]
    pub transcription_id: Option<String>,
}

#[derive(Debug)]
pub struct CloudTranscriptionSuccess {
    pub transcript: String,
    pub raw_text: Option<String>,
    pub speech_model: String,
    pub llm_cleaned: bool,
    pub llm_model: Option<String>,
    pub transcription_id: Option<String>,
}

pub async fn request_cloud_transcription(
    client: &Client,
    saved: &RecordingSaved,
    config: &CloudTranscriptionConfig,
) -> Result<CloudTranscriptionSuccess> {
    let metadata = fs::metadata(&saved.path)
        .with_context(|| format!("Failed to read file metadata at {}", saved.path.display()))?;
    if metadata.len() > MAX_AUDIO_SIZE_BYTES {
        return Err(anyhow!(
            "Audio file too large ({:.1}MB, max {}MB)",
            metadata.len() as f64 / 1024.0 / 1024.0,
            MAX_AUDIO_SIZE_BYTES / 1024 / 1024
        ));
    }

    let bytes = fs::read(&saved.path)
        .with_context(|| format!("Failed to read recording at {}", saved.path.display()))?;

    let url = config.function_url.clone();

    use base64::Engine;
    let audio_encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let body = serde_json::json!({
        "audio_base64": audio_encoded,
        "meta": &config.payload,
    });

    eprintln!(
        "[cloud_transcription] POST {} (audio size: {} bytes, edit_mode: {})",
        url,
        bytes.len(),
        config.payload.selected_text.is_some()
    );

    let request = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", &config.jwt))
        .header("Content-Type", "application/json");

    let response = request
        .json(&body)
        .send()
        .await
        .context("Failed to reach cloud transcription API")?;

    let status = response.status();
    let text = response.text().await.unwrap_or_default();

    eprintln!(
        "[cloud_transcription] Response status={} body_len={}",
        status,
        text.len()
    );
    if !status.is_success() {
        eprintln!("[cloud_transcription] Error response: {} chars", text.len());
    }

    if status.is_success() {
        let parsed: CloudTranscriptionResponse =
            serde_json::from_str(&text).context("Failed to parse cloud transcription response")?;
        return Ok(CloudTranscriptionSuccess {
            transcript: normalize_transcript(&parsed.transcript),
            raw_text: parsed.raw_text.map(|t| normalize_transcript(&t)),
            speech_model: parsed.model,
            llm_cleaned: parsed.llm_cleaned,
            llm_model: parsed.llm_model,
            transcription_id: parsed.transcription_id,
        });
    }

    if let Ok(parsed) = serde_json::from_str::<ApiErrorResponse>(&text) {
        // Check for quota-related error codes
        if let Some(ref code) = parsed.code {
            match code.as_str() {
                "QUOTA_EXCEEDED" => {
                    let user_type = parsed.user_type.as_deref().unwrap_or("cloud");
                    return Err(anyhow!("QUOTA_EXCEEDED:{}", user_type));
                }
                "QUOTA_CHECK_FAILED" => {
                    return Err(anyhow!("QUOTA_CHECK_FAILED"));
                }
                _ => {}
            }
        }
        Err(anyhow!(parsed.error))
    } else if text.is_empty() {
        Err(anyhow!(format!(
            "Cloud transcription API returned status {status}"
        )))
    } else {
        Err(anyhow!(text))
    }
}
