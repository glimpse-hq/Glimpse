pub(crate) mod icons;

use std::collections::HashSet;

use tauri::AppHandle;
use uuid::Uuid;

use crate::settings::{GLOBAL_PERSONALITY_ID, Personality, default_global_personality};
use crate::{AppRuntime, AppState};

const INSTRUCTION_CHAR_LIMIT: usize = 3000;

fn sanitize_list(entries: &[String], limit: usize, max_len: usize, lower: bool) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut cleaned = Vec::new();

    for raw in entries {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let capped: String = trimmed.chars().take(max_len).collect();
        let capped = capped.trim();
        let value = if lower {
            capped.to_lowercase()
        } else {
            capped.to_string()
        };
        let key = capped.to_lowercase();
        if seen.insert(key) {
            cleaned.push(value);
        }
        if cleaned.len() >= limit {
            break;
        }
    }

    cleaned
}

fn sanitize_instructions(entries: &[String]) -> Vec<String> {
    let mut cleaned = Vec::new();
    let mut remaining_chars = INSTRUCTION_CHAR_LIMIT;

    for raw in entries {
        if remaining_chars == 0 {
            break;
        }

        let newline_cost = usize::from(!cleaned.is_empty());
        if remaining_chars <= newline_cost {
            break;
        }

        let allowed_chars = remaining_chars - newline_cost;
        let capped: String = raw.chars().take(allowed_chars).collect();

        remaining_chars -= newline_cost;
        remaining_chars = remaining_chars.saturating_sub(capped.chars().count());
        cleaned.push(capped);
    }

    cleaned
}

fn sanitize_global_instructions(entries: &[String]) -> Vec<String> {
    let joined = entries.join("\n");
    if joined.trim().is_empty() || joined.trim() == crate::llm_cleanup::CLEANUP_RULES {
        return Vec::new();
    }
    sanitize_instructions(entries)
}

pub fn sanitize_personalities(entries: &[Personality]) -> Vec<Personality> {
    let mut seen = HashSet::from([GLOBAL_PERSONALITY_ID.to_string()]);
    let mut global = default_global_personality();
    if let Some(entry) = entries
        .iter()
        .find(|entry| entry.id.trim().eq_ignore_ascii_case(GLOBAL_PERSONALITY_ID))
    {
        global.instructions = sanitize_global_instructions(&entry.instructions);
    }
    let mut cleaned = vec![global];

    for entry in entries {
        if entry.id.trim().eq_ignore_ascii_case(GLOBAL_PERSONALITY_ID) {
            continue;
        }
        let name = entry.name.trim();
        if name.is_empty() {
            continue;
        }
        let mut id = entry.id.trim().to_string();
        if id.is_empty() {
            id = Uuid::new_v4().to_string();
        }
        while !seen.insert(id.to_lowercase()) {
            id = Uuid::new_v4().to_string();
        }

        let capped_name: String = name.chars().take(60).collect();
        let apps = sanitize_list(&entry.apps, 64, 60, false);
        let websites = sanitize_list(&entry.websites, 64, 120, true);
        let instructions = sanitize_instructions(&entry.instructions);

        cleaned.push(Personality {
            id,
            name: capped_name.trim().to_string(),
            enabled: entry.enabled,
            apps,
            websites,
            instructions,
        });

        if cleaned.len() >= 33 {
            break;
        }
    }

    cleaned
}

#[tauri::command]
pub fn get_default_cleanup_instructions() -> String {
    crate::llm_cleanup::CLEANUP_RULES.to_string()
}

#[tauri::command]
pub fn get_personalities(state: tauri::State<AppState>) -> Result<Vec<Personality>, String> {
    let current = state.current_settings_unmasked().personalities;
    let cleaned = sanitize_personalities(&current);
    if cleaned != current {
        state
            .persist_settings_with(|_, next| next.personalities = cleaned.clone())
            .map_err(|err| err.to_string())?;
    }
    Ok(cleaned)
}

#[tauri::command]
pub fn set_personalities(
    personalities: Vec<Personality>,
    app: AppHandle<AppRuntime>,
    state: tauri::State<AppState>,
) -> Result<Vec<Personality>, String> {
    let mut cleaned = sanitize_personalities(&personalities);
    let has_global = personalities
        .iter()
        .any(|mode| mode.id.trim().eq_ignore_ascii_case(GLOBAL_PERSONALITY_ID));
    let (previous, saved) = state
        .persist_settings_with(|previous, next| {
            if !has_global
                && let Some(global) = previous
                    .personalities
                    .iter()
                    .find(|mode| mode.id == GLOBAL_PERSONALITY_ID)
            {
                cleaned[0].instructions = sanitize_global_instructions(&global.instructions);
            }
            next.personalities = cleaned.clone();
        })
        .map_err(|err| err.to_string())?;
    let previous_custom = custom_count(&previous.personalities);

    state.emit_settings_changed(&app, &saved);
    let custom = custom_count(&cleaned);
    if custom != previous_custom {
        crate::analytics::track_personalities_changed(&app, custom);
    }

    Ok(cleaned)
}

fn custom_count(personalities: &[Personality]) -> usize {
    personalities
        .iter()
        .filter(|personality| personality.id != GLOBAL_PERSONALITY_ID)
        .filter(|personality| crate::analytics::personality_label(Some(personality)) == "custom")
        .count()
}
