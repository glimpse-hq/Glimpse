use std::path::Path;

use serde::{Deserialize, Serialize};

use super::shared::ImportBundle;
use super::{aqua, handy, superwhisper, wispr};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedApp {
    pub id: String,
    pub name: String,
}

fn all_ids() -> Vec<(&'static str, &'static str, fn(&Path) -> bool)> {
    vec![
        (
            aqua::ID,
            aqua::DISPLAY_NAME,
            aqua::detect as fn(&Path) -> bool,
        ),
        (
            superwhisper::ID,
            superwhisper::DISPLAY_NAME,
            superwhisper::detect as fn(&Path) -> bool,
        ),
        (
            wispr::ID,
            wispr::DISPLAY_NAME,
            wispr::detect as fn(&Path) -> bool,
        ),
        (
            handy::ID,
            handy::DISPLAY_NAME,
            handy::detect as fn(&Path) -> bool,
        ),
    ]
}

pub fn detect_apps(home: &Path) -> Vec<DetectedApp> {
    all_ids()
        .into_iter()
        .filter(|(_, _, detect)| detect(home))
        .filter_map(|(id, name, _)| {
            let bundle = parse_app(id, home).ok()?;
            bundle_has_content(&bundle).then(|| DetectedApp {
                id: id.to_string(),
                name: name.to_string(),
            })
        })
        .collect()
}

fn bundle_has_content(bundle: &ImportBundle) -> bool {
    !bundle.dictionary.is_empty()
        || !bundle.replacements.is_empty()
        || !bundle.personalities.is_empty()
        || !bundle.transcripts.is_empty()
        || bundle.smart_shortcut.is_some()
        || bundle.language.is_some()
        || bundle.auto_launch.is_some()
        || bundle.model_hint.is_some()
}

pub fn display_name(id: &str) -> &'static str {
    match id {
        aqua::ID => aqua::DISPLAY_NAME,
        superwhisper::ID => superwhisper::DISPLAY_NAME,
        wispr::ID => wispr::DISPLAY_NAME,
        handy::ID => handy::DISPLAY_NAME,
        _ => "Unknown app",
    }
}

pub fn parse_app(id: &str, home: &Path) -> Result<ImportBundle, String> {
    let mut bundle = match id {
        aqua::ID => aqua::parse(home),
        superwhisper::ID => superwhisper::parse(home),
        wispr::ID => wispr::parse(home),
        handy::ID => handy::parse(home),
        _ => return Err(format!("Unknown import source: {id}")),
    }?;

    bundle.language = bundle
        .language
        .as_deref()
        .and_then(super::shared::normalize_language);
    bundle.transcript_count = bundle.transcripts.len() as u32;

    Ok(bundle)
}
