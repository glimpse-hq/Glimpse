use std::{cmp::Reverse, collections::HashSet, sync::LazyLock};

use regex::Regex;

use crate::{
    AppState,
    model_manager::{MODEL_CAPABILITY_DICTIONARY, ReadyModel, model_supports_capability},
    settings::{Replacement, UserSettings},
};

pub fn sanitize_dictionary_entries(entries: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut cleaned = Vec::new();

    for raw in entries {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let normalized = trimmed.to_lowercase();
        if seen.insert(normalized) {
            let capped: String = trimmed.chars().take(160).collect();
            let capped = capped.trim_end().to_string();
            cleaned.push(capped);
        }
        if cleaned.len() >= 64 {
            break;
        }
    }

    cleaned
}

pub fn dictionary_entries_for_model(model: &ReadyModel, settings: &UserSettings) -> Vec<String> {
    let supports_dictionary = model_supports_capability(&model.key, MODEL_CAPABILITY_DICTIONARY);

    if !supports_dictionary {
        return Vec::new();
    }

    sanitize_dictionary_entries(&settings.dictionary)
}

pub fn sanitize_replacements(replacements: &[Replacement]) -> Vec<Replacement> {
    let mut seen = HashSet::new();
    let mut cleaned = Vec::new();

    for r in replacements {
        let from = r.from.trim();
        let to = r.to.trim();
        if from.is_empty() {
            continue;
        }
        let key = from.to_lowercase();
        if seen.insert(key) {
            let from_capped: String = from.chars().take(100).collect();
            let to_capped: String = to.chars().take(200).collect();
            cleaned.push(Replacement {
                from: from_capped.trim().to_string(),
                to: to_capped.trim().to_string(),
            });
        }
        if cleaned.len() >= 64 {
            break;
        }
    }

    cleaned
}

pub fn apply_replacements(text: &str, replacements: &[Replacement]) -> String {
    let mut ordered: Vec<&Replacement> =
        replacements.iter().filter(|r| !r.from.is_empty()).collect();
    if ordered.is_empty() {
        return text.to_string();
    }
    ordered.sort_by_key(|r| Reverse(r.from.chars().count()));
    let alternatives: Vec<String> = ordered
        .iter()
        .map(|r| format!("({})", replacement_pattern(&r.from)))
        .collect();
    let Ok(re) = Regex::new(&format!("(?i){}", alternatives.join("|"))) else {
        return text.to_string();
    };
    re.replace_all(text, |caps: &regex::Captures| {
        let index = caps.iter().skip(1).position(|m| m.is_some()).unwrap_or(0);
        apply_case_pattern(&caps[0], &ordered[index].to)
    })
    .into_owned()
}

fn replacement_pattern(from: &str) -> String {
    static STARTS_WORD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\w").unwrap());
    static ENDS_WORD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\w$").unwrap());
    let boundary = |is_word: bool| if is_word { r"\b" } else { "" };
    format!(
        "{}{}{}",
        boundary(STARTS_WORD.is_match(from)),
        regex::escape(from),
        boundary(ENDS_WORD.is_match(from))
    )
}

fn apply_case_pattern(matched: &str, replacement: &str) -> String {
    if replacement.is_empty() || replacement.chars().any(char::is_uppercase) {
        return replacement.to_string();
    }

    let first_char = matched.chars().next();
    let is_first_upper = first_char.map(|c| c.is_uppercase()).unwrap_or(false);
    let is_all_upper = matched.chars().filter(|c| c.is_alphabetic()).count() > 1
        && matched
            .chars()
            .all(|c| !c.is_alphabetic() || c.is_uppercase());

    if is_all_upper {
        replacement.to_uppercase()
    } else if is_first_upper {
        let mut chars = replacement.chars();
        match chars.next() {
            Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            None => String::new(),
        }
    } else {
        replacement.to_string()
    }
}

#[tauri::command]
pub fn set_dictionary(
    entries: Vec<String>,
    app: tauri::AppHandle<crate::AppRuntime>,
    state: tauri::State<AppState>,
) -> Result<Vec<String>, String> {
    let cleaned = sanitize_dictionary_entries(&entries);
    if !cleaned.is_empty() {
        crate::analytics::track_feature_used(&app, "dictionary");
    }
    let mut settings = state.current_settings();
    settings.dictionary = cleaned.clone();
    settings.auto_dictionary_ignored =
        crate::auto_dictionary::remove_dictionary_entries_from_ignored(
            settings.auto_dictionary_ignored,
            &cleaned,
        );
    state
        .persist_settings(settings)
        .map_err(|err| err.to_string())?;
    crate::auto_dictionary::sync_ignored_dictionary_entries(&cleaned);
    Ok(cleaned)
}

#[tauri::command]
pub fn get_replacements(state: tauri::State<AppState>) -> Result<Vec<Replacement>, String> {
    let mut settings = state.current_settings();
    let cleaned = sanitize_replacements(&settings.replacements);
    if cleaned != settings.replacements {
        settings.replacements = cleaned.clone();
        state
            .persist_settings(settings)
            .map_err(|err| err.to_string())?;
    }
    Ok(cleaned)
}

#[tauri::command]
pub fn set_replacements(
    replacements: Vec<Replacement>,
    app: tauri::AppHandle<crate::AppRuntime>,
    state: tauri::State<AppState>,
) -> Result<Vec<Replacement>, String> {
    let cleaned = sanitize_replacements(&replacements);
    if !cleaned.is_empty() {
        crate::analytics::track_feature_used(&app, "replacements");
    }
    let mut settings = state.current_settings();
    settings.replacements = cleaned.clone();
    state
        .persist_settings(settings)
        .map_err(|err| err.to_string())?;
    Ok(cleaned)
}
