use glimpse_speech::models::{InstallSpec, ModelStorage, RemoteFile};
use serde::Serialize;
use tauri::AppHandle;

use crate::model_language_table::{
    english_supported_languages, whisper_supported_languages, SupportedLanguageInfo,
};
#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
use crate::model_language_table::{
    nemotron_35_supported_languages, nemotron_supported_languages, parakeet_v3_supported_languages,
};
use crate::settings::UserSettings;
use crate::speech::{install, remote};
use crate::AppRuntime;

pub const MODEL_CAPABILITY_DICTIONARY: &str = "dictionary";
pub const MODEL_CAPABILITY_TIMESTAMPS: &str = "timestamps";
pub const MODEL_CAPABILITY_STREAMING: &str = "streaming";

pub use glimpse_speech::models::ModelEngine as LocalModelEngine;

#[derive(Debug, Serialize, Clone)]
pub struct ModelInfo {
    pub key: String,
    pub label: String,
    pub description: String,
    pub size_mb: f32,
    pub engine_id: String,
    pub family: String,
    pub variant: String,
    pub category: String,
    pub tags: Vec<String>,
    pub capabilities: Vec<String>,
    pub supported_languages: Vec<SupportedLanguageInfo>,
}

#[derive(Debug, Serialize, Clone)]
pub struct SpeechModel {
    pub id: String,
    pub key: String,
    pub label: String,
    pub description: String,
    pub size_mb: f32,
    pub engine_id: String,
    pub variant: String,
    pub tags: Vec<String>,
    pub capabilities: Vec<String>,
    pub supported_languages: Vec<SupportedLanguageInfo>,
    pub remote: bool,
    pub installed: bool,
}

struct CatalogFile {
    url: &'static str,
    path: &'static str,
    size_bytes: Option<u64>,
    sha256: Option<&'static str>,
}

pub struct LocalModelManifest {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub category: &'static str,
    pub tags: &'static [&'static str],
    pub engine: LocalModelEngine,
    pub family: &'static str,
    pub variant: &'static str,
    files: &'static [CatalogFile],
    pub capabilities: &'static [&'static str],
}

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
const PARAKEET_TDT_INT8_FILES: &[CatalogFile] = &[
    CatalogFile {
        url: "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main/encoder-model.int8.onnx",
        path: "encoder-model.int8.onnx",
        size_bytes: Some(652_183_999),
        sha256: Some("6139d2fa7e1b086097b277c7149725edbab89cc7c7ae64b23c741be4055aff09"),
    },
    CatalogFile {
        url: "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main/decoder_joint-model.int8.onnx",
        path: "decoder_joint-model.int8.onnx",
        size_bytes: Some(18_202_004),
        sha256: Some("eea7483ee3d1a30375daedc8ed83e3960c91b098812127a0d99d1c8977667a70"),
    },
    CatalogFile {
        url: "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main/vocab.txt",
        path: "vocab.txt",
        size_bytes: Some(93_939),
        sha256: Some("d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d"),
    },
];

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
const NEMOTRON_STREAMING_FILES: &[CatalogFile] = &[
    CatalogFile {
        url: "https://huggingface.co/altunenes/parakeet-rs/resolve/main/nemotron-speech-streaming-en-0.6b/encoder.onnx",
        path: "encoder.onnx",
        size_bytes: Some(42_159_995),
        sha256: Some("5c5110ca2e961c3ff5edc2b0ff49f29888b5213287624f7865c60f7384ac02f0"),
    },
    CatalogFile {
        url: "https://huggingface.co/altunenes/parakeet-rs/resolve/main/nemotron-speech-streaming-en-0.6b/encoder.onnx.data",
        path: "encoder.onnx.data",
        size_bytes: Some(2_436_567_040),
        sha256: Some("44f65771e1570546f61106b3d0c604a60b398d061476fda8042bb05432601bd4"),
    },
    CatalogFile {
        url: "https://huggingface.co/altunenes/parakeet-rs/resolve/main/nemotron-speech-streaming-en-0.6b/decoder_joint.onnx",
        path: "decoder_joint.onnx",
        size_bytes: Some(35_779_240),
        sha256: Some("8bcfde85fa9039a70caeb90204273f837923d63a706c186bd33e2ada25a91700"),
    },
    CatalogFile {
        url: "https://huggingface.co/altunenes/parakeet-rs/resolve/main/nemotron-speech-streaming-en-0.6b/tokenizer.model",
        path: "tokenizer.model",
        size_bytes: Some(251_056),
        sha256: Some("07d4e5a63840a53ab2d4d106d2874768143fb3fbdd47938b3910d2da05bfb0a9"),
    },
];

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
const NEMOTRON_35_STREAMING_FILES: &[CatalogFile] = &[
    CatalogFile {
        url: "https://huggingface.co/altunenes/parakeet-rs/resolve/main/nemotron-3.5-asr-streaming-0.6b-onnx/encoder.onnx",
        path: "encoder.onnx",
        size_bytes: Some(42_164_972),
        sha256: Some("d569fbe78b48fbb04e169d324f5d25463838ceed7b5fc3bfe209872441979bd9"),
    },
    CatalogFile {
        url: "https://huggingface.co/altunenes/parakeet-rs/resolve/main/nemotron-3.5-asr-streaming-0.6b-onnx/encoder.onnx.data",
        path: "encoder.onnx.data",
        size_bytes: Some(2_454_405_120),
        sha256: Some("7584f85df76bc9ae6fbdfa53aa8d97b07a842525d1c501d536d77fd9e4f57ac7"),
    },
    CatalogFile {
        url: "https://huggingface.co/altunenes/parakeet-rs/resolve/main/nemotron-3.5-asr-streaming-0.6b-onnx/decoder_joint.onnx",
        path: "decoder_joint.onnx",
        size_bytes: Some(97_590_054),
        sha256: Some("634dfadf24cb4f73c2fae170b36611d68db48186426882cbc8f7e02ed9f2bb29"),
    },
    CatalogFile {
        url: "https://huggingface.co/altunenes/parakeet-rs/resolve/main/nemotron-3.5-asr-streaming-0.6b-onnx/tokenizer.model",
        path: "tokenizer.model",
        size_bytes: Some(406_554),
        sha256: Some("ce3895e40806f02a26c3a225161b96ef682d6c0054bae32a245dec4258d7d291"),
    },
];

macro_rules! whisper_files {
    ($path:literal, $size_bytes:literal, $sha256:expr) => {
        &[CatalogFile {
            url: concat!(
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/",
                $path
            ),
            path: $path,
            size_bytes: Some($size_bytes),
            sha256: $sha256,
        }]
    };
}

macro_rules! distil_whisper_files {
    ($repo:literal, $path:literal, $size_bytes:literal, $sha256:expr) => {
        &[CatalogFile {
            url: concat!("https://huggingface.co/", $repo, "/resolve/main/", $path),
            path: $path,
            size_bytes: Some($size_bytes),
            sha256: $sha256,
        }]
    };
}

const WHISPER_DESCRIPTION: &str =
    "Local Whisper model with multilingual support and dictionary support.";
const DISTIL_WHISPER_DESCRIPTION: &str =
    "Fast English-only Distil-Whisper Q8 model with dictionary support.";
const WHISPER_CAPABILITIES: &[&str] = &[MODEL_CAPABILITY_DICTIONARY, MODEL_CAPABILITY_TIMESTAMPS];

const MODEL_MANIFESTS: &[LocalModelManifest] = &[
    LocalModelManifest {
        id: "whisper_large_v3_turbo_q8",
        family: "whisper-large-v3-turbo",
        label: "Whisper Large V3 Turbo",
        description:
            "Great quality local Whisper model with multilingual support and dictionary support.",
        tags: &["Dictionary", "Multilingual"],
        category: "standard",
        engine: LocalModelEngine::Whisper,
        variant: "Q8_0",
        files: whisper_files!(
            "ggml-large-v3-turbo-q8_0.bin",
            874_188_075,
            Some("317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1")
        ),
        capabilities: WHISPER_CAPABILITIES,
    },
    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    LocalModelManifest {
        id: "parakeet_tdt_int8",
        family: "parakeet-tdt",
        label: "Parakeet TDT 0.6B (Int8)",
        description:
            "Fast, multilingual and accurate. Based on ONNX for everyday local transcription.",
        tags: &["Multilingual", "Fast"],
        category: "experimental",
        engine: LocalModelEngine::Parakeet,
        variant: "Int8",
        files: PARAKEET_TDT_INT8_FILES,
        capabilities: &[MODEL_CAPABILITY_TIMESTAMPS],
    },
    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    LocalModelManifest {
        id: "nemotron_streaming_en",
        family: "nemotron-streaming",
        label: "Nemotron Streaming 0.6B",
        description: "Real-time streaming transcription. Text appears as you speak.",
        tags: &["English", "Streaming"],
        category: "experimental",
        engine: LocalModelEngine::Nemotron,
        variant: "Int8",
        files: NEMOTRON_STREAMING_FILES,
        capabilities: &[MODEL_CAPABILITY_STREAMING],
    },
    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    LocalModelManifest {
        id: "nemotron_35_streaming_multilingual",
        family: "nemotron-35-streaming",
        label: "Nemotron 3.5 Streaming 0.6B",
        description: "Multilingual streaming transcription with punctuation and capitalization.",
        tags: &["Multilingual", "Streaming"],
        category: "experimental",
        engine: LocalModelEngine::Nemotron,
        variant: "Multilingual",
        files: NEMOTRON_35_STREAMING_FILES,
        capabilities: &[MODEL_CAPABILITY_STREAMING],
    },
    LocalModelManifest {
        id: "whisper_small_q5",
        family: "whisper-small",
        label: "Whisper Small",
        description: "Small & fast with dictionary support.",
        tags: &["Multilingual", "Dictionary", "Compute Friendly"],
        category: "standard",
        engine: LocalModelEngine::Whisper,
        variant: "Q5_1",
        files: whisper_files!(
            "ggml-small-q5_1.bin",
            190_085_487,
            Some("ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb")
        ),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "distil_whisper_large_v35",
        family: "distil-large",
        label: "Distil-Whisper Large V3.5",
        description: DISTIL_WHISPER_DESCRIPTION,
        tags: &["English", "Dictionary", "Fast"],
        category: "standard",
        engine: LocalModelEngine::Whisper,
        variant: "Q8_0",
        files: distil_whisper_files!(
            "Pomni/distil-large-v3.5-ggml-allquants",
            "ggml-distil-large-v3.5-q8_0.bin",
            818_305_955,
            Some("7e570abdf13b681354a2ecc93802e25bf204dd6f8c0dd9f6ecb9478b71b231d7")
        ),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "distil_whisper_medium_en",
        family: "distil-medium",
        label: "Distil-Whisper Medium",
        description: DISTIL_WHISPER_DESCRIPTION,
        tags: &["English", "Dictionary", "Fast"],
        category: "standard",
        engine: LocalModelEngine::Whisper,
        variant: "Q8_0",
        files: distil_whisper_files!(
            "Pomni/distil-medium.en-ggml-allquants",
            "ggml-distil-medium.en-q8_0.bin",
            429_655_940,
            Some("8dff90cdf0124169e906aa05a208ba2bfc94e60d09b983ba87a60b9ea3aca42a")
        ),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "distil_whisper_small_en",
        family: "distil-small",
        label: "Distil-Whisper Small",
        description: DISTIL_WHISPER_DESCRIPTION,
        tags: &["English", "Dictionary", "Fast", "Compute Friendly"],
        category: "standard",
        engine: LocalModelEngine::Whisper,
        variant: "Q8_0",
        files: distil_whisper_files!(
            "Pomni/distil-small.en-ggml-allquants",
            "ggml-distil-small.en-q8_0.bin",
            183_833_897,
            Some("8564c3a318d354992fc4654044f48908514783209b4f09ff043ecb8a0c1ebe8e")
        ),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_tiny_q5",
        family: "whisper-tiny",
        label: "Whisper Tiny",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary", "Compute Friendly"],
        category: "standard",
        engine: LocalModelEngine::Whisper,
        variant: "Q5_1",
        files: whisper_files!("ggml-tiny-q5_1.bin", 32_152_673, None),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_tiny_q8",
        family: "whisper-tiny",
        label: "Whisper Tiny",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary", "Compute Friendly"],
        category: "standard",
        engine: LocalModelEngine::Whisper,
        variant: "Q8_0",
        files: whisper_files!("ggml-tiny-q8_0.bin", 43_537_433, None),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_tiny",
        family: "whisper-tiny",
        label: "Whisper Tiny",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary", "Compute Friendly"],
        category: "standard",
        engine: LocalModelEngine::Whisper,
        variant: "Full",
        files: whisper_files!("ggml-tiny.bin", 77_691_713, None),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_base_q5",
        family: "whisper-base",
        label: "Whisper Base",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary", "Compute Friendly"],
        category: "standard",
        engine: LocalModelEngine::Whisper,
        variant: "Q5_1",
        files: whisper_files!("ggml-base-q5_1.bin", 59_707_625, None),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_base_q8",
        family: "whisper-base",
        label: "Whisper Base",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary", "Compute Friendly"],
        category: "standard",
        engine: LocalModelEngine::Whisper,
        variant: "Q8_0",
        files: whisper_files!("ggml-base-q8_0.bin", 81_768_585, None),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_base",
        family: "whisper-base",
        label: "Whisper Base",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary", "Compute Friendly"],
        category: "standard",
        engine: LocalModelEngine::Whisper,
        variant: "Full",
        files: whisper_files!("ggml-base.bin", 147_951_465, None),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_small_q8",
        family: "whisper-small",
        label: "Whisper Small",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary", "Compute Friendly"],
        category: "standard",
        engine: LocalModelEngine::Whisper,
        variant: "Q8_0",
        files: whisper_files!("ggml-small-q8_0.bin", 264_464_607, None),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_small",
        family: "whisper-small",
        label: "Whisper Small",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary"],
        category: "standard",
        engine: LocalModelEngine::Whisper,
        variant: "Full",
        files: whisper_files!("ggml-small.bin", 487_601_967, None),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_medium_q5",
        family: "whisper-medium",
        label: "Whisper Medium",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary"],
        category: "standard",
        engine: LocalModelEngine::Whisper,
        variant: "Q5_0",
        files: whisper_files!("ggml-medium-q5_0.bin", 539_212_467, None),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_medium_q8",
        family: "whisper-medium",
        label: "Whisper Medium",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary"],
        category: "standard",
        engine: LocalModelEngine::Whisper,
        variant: "Q8_0",
        files: whisper_files!("ggml-medium-q8_0.bin", 823_369_779, None),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_medium",
        family: "whisper-medium",
        label: "Whisper Medium",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary"],
        category: "standard",
        engine: LocalModelEngine::Whisper,
        variant: "Full",
        files: whisper_files!("ggml-medium.bin", 1_533_763_059, None),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_large_v3_q5",
        family: "whisper-large-v3",
        label: "Whisper Large V3",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary"],
        category: "standard",
        engine: LocalModelEngine::Whisper,
        variant: "Q5_0",
        files: whisper_files!("ggml-large-v3-q5_0.bin", 1_081_140_203, None),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_large_v3",
        family: "whisper-large-v3",
        label: "Whisper Large V3",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary"],
        category: "standard",
        engine: LocalModelEngine::Whisper,
        variant: "Full",
        files: whisper_files!("ggml-large-v3.bin", 3_095_033_483, None),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_large_v3_turbo_q5",
        family: "whisper-large-v3-turbo",
        label: "Whisper Large V3 Turbo",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary"],
        category: "standard",
        engine: LocalModelEngine::Whisper,
        variant: "Q5_0",
        files: whisper_files!("ggml-large-v3-turbo-q5_0.bin", 574_041_195, None),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_large_v3_turbo",
        family: "whisper-large-v3-turbo",
        label: "Whisper Large V3 Turbo (Full)",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary"],
        category: "standard",
        engine: LocalModelEngine::Whisper,
        variant: "Full",
        files: whisper_files!("ggml-large-v3-turbo.bin", 1_624_555_275, None),
        capabilities: WHISPER_CAPABILITIES,
    },
];

pub fn local_manifests() -> &'static [LocalModelManifest] {
    MODEL_MANIFESTS
}

pub fn definition(key: &str) -> Option<&'static LocalModelManifest> {
    MODEL_MANIFESTS.iter().find(|manifest| manifest.id == key)
}

fn to_install_spec(manifest: &LocalModelManifest) -> InstallSpec {
    let storage = match manifest.files {
        [single] => ModelStorage::File {
            artifact: single.path.to_string(),
        },
        _ => ModelStorage::Directory,
    };
    let files = manifest
        .files
        .iter()
        .map(|file| RemoteFile {
            url: file.url.to_string(),
            path: file.path.to_string(),
            size_bytes: file.size_bytes,
            sha256: file.sha256.map(str::to_string),
        })
        .collect();
    InstallSpec {
        id: manifest.id.to_string(),
        engine: manifest.engine,
        storage,
        files,
    }
}

pub fn install_spec(model: &str) -> Option<InstallSpec> {
    definition(model).map(to_install_spec)
}

pub fn model_label(key: &str) -> String {
    definition(key)
        .map(|model| model.label.to_string())
        .unwrap_or_else(|| key.to_string())
}

pub fn model_supports_capability(model_key: &str, capability: &str) -> bool {
    definition(model_key)
        .map(|manifest| {
            manifest
                .capabilities
                .iter()
                .any(|entry| entry.eq_ignore_ascii_case(capability))
        })
        .unwrap_or(false)
}

pub fn is_streaming_model(model_key: &str) -> bool {
    model_supports_capability(model_key, MODEL_CAPABILITY_STREAMING)
}

fn supports_only_english(manifest: &LocalModelManifest) -> bool {
    manifest
        .tags
        .iter()
        .any(|tag| tag.eq_ignore_ascii_case("English"))
        && !manifest
            .tags
            .iter()
            .any(|tag| tag.eq_ignore_ascii_case("Multilingual"))
}

fn supported_languages(manifest: &LocalModelManifest) -> Vec<SupportedLanguageInfo> {
    if supports_only_english(manifest) {
        return english_supported_languages();
    }

    match manifest.engine {
        LocalModelEngine::Whisper => whisper_supported_languages(),
        LocalModelEngine::Nemotron => {
            #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
            {
                if manifest.id == "nemotron_35_streaming_multilingual" {
                    nemotron_35_supported_languages()
                } else {
                    nemotron_supported_languages()
                }
            }

            #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
            {
                Vec::new()
            }
        }
        LocalModelEngine::Parakeet => {
            #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
            {
                parakeet_v3_supported_languages()
            }

            #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
            {
                Vec::new()
            }
        }
    }
}

fn engine_id(engine: &LocalModelEngine) -> &'static str {
    match engine {
        LocalModelEngine::Nemotron | LocalModelEngine::Parakeet => "nvidia",
        LocalModelEngine::Whisper => "whisper",
    }
}

fn capability_strings(capabilities: &[&str]) -> Vec<String> {
    capabilities.iter().map(|c| c.to_string()).collect()
}

fn manifest_to_model_info(manifest: &LocalModelManifest) -> ModelInfo {
    ModelInfo {
        key: manifest.id.to_string(),
        label: manifest.label.to_string(),
        description: manifest.description.to_string(),
        size_mb: manifest
            .files
            .iter()
            .map(|file| file.size_bytes.unwrap_or(0))
            .sum::<u64>() as f32
            / 1_000_000.0,
        engine_id: engine_id(&manifest.engine).to_string(),
        family: manifest.family.to_string(),
        variant: manifest.variant.to_string(),
        category: manifest.category.to_string(),
        tags: manifest.tags.iter().map(|tag| tag.to_string()).collect(),
        capabilities: capability_strings(manifest.capabilities),
        supported_languages: supported_languages(manifest),
    }
}

pub fn api_model_infos() -> Vec<glimpse_speech::api::ApiModelInfo> {
    MODEL_MANIFESTS
        .iter()
        .map(|manifest| glimpse_speech::api::ApiModelInfo {
            id: manifest.id.to_string(),
            label: manifest.label.to_string(),
            description: manifest.description.to_string(),
            tags: manifest.tags.iter().map(|tag| tag.to_string()).collect(),
            capabilities: capability_strings(manifest.capabilities),
        })
        .collect()
}

pub fn list_local_models() -> Vec<ModelInfo> {
    MODEL_MANIFESTS.iter().map(manifest_to_model_info).collect()
}

pub fn list_models(app: &AppHandle<AppRuntime>, settings: &UserSettings) -> Vec<SpeechModel> {
    let mut models = Vec::new();

    if remote::is_configured(settings) {
        models.push(remote_entry(settings));
    }

    for info in list_local_models() {
        let installed = install::check_model_status(app.clone(), info.key.clone())
            .map(|status| status.installed)
            .unwrap_or(false);
        models.push(from_local(info, installed));
    }

    models
}

fn from_local(info: ModelInfo, installed: bool) -> SpeechModel {
    SpeechModel {
        id: info.key.clone(),
        key: info.key,
        label: info.label,
        description: info.description,
        size_mb: info.size_mb,
        engine_id: info.engine_id,
        variant: info.variant,
        tags: info.tags,
        capabilities: info.capabilities,
        supported_languages: info.supported_languages,
        remote: false,
        installed,
    }
}

pub(crate) fn configured_remote_model(settings: &UserSettings) -> Option<SpeechModel> {
    remote::has_valid_config(settings).then(|| remote_entry(settings))
}

fn remote_entry(settings: &UserSettings) -> SpeechModel {
    let id = remote::speech_model_storage_label(settings, None);
    SpeechModel {
        label: label(&id),
        key: id.clone(),
        id,
        description: "Transcribes through your configured remote speech provider.".to_string(),
        size_mb: 0.0,
        engine_id: "remote".to_string(),
        variant: String::new(),
        tags: vec!["Remote".to_string()],
        capabilities: vec![
            MODEL_CAPABILITY_TIMESTAMPS.to_string(),
            MODEL_CAPABILITY_DICTIONARY.to_string(),
        ],
        supported_languages: Vec::new(),
        remote: true,
        installed: true,
    }
}

pub fn label(model_id: &str) -> String {
    if remote::is_remote_model(model_id) {
        token_label(model_id)
    } else {
        model_label(model_id)
    }
}

fn token_label(token: &str) -> String {
    let rest = token
        .trim()
        .strip_prefix(remote::SPEECH_MODEL_REMOTE_PREFIX)
        .unwrap_or(token);
    let mut parts = rest.splitn(2, ':');
    let provider = parts.next().unwrap_or_default();
    let model = parts.next().filter(|value| !value.is_empty());
    let provider_label = provider_display(provider);
    match model {
        Some(model) => format!("{provider_label} · {model}"),
        None => provider_label,
    }
}

fn provider_display(provider: &str) -> String {
    match provider.trim().to_ascii_lowercase().as_str() {
        "openai" => "OpenAI".to_string(),
        "groq" => "Groq".to_string(),
        "mistral" => "Mistral".to_string(),
        "fireworks" => "Fireworks".to_string(),
        "openrouter" => "OpenRouter".to_string(),
        "litellm" => "LiteLLM".to_string(),
        "deepgram" => "Deepgram".to_string(),
        "elevenlabs" => "ElevenLabs".to_string(),
        "huggingface" => "Hugging Face".to_string(),
        "vllm" => "vLLM".to_string(),
        "localai" => "LocalAI".to_string(),
        "whisper-cpp" => "whisper.cpp".to_string(),
        "llamaedge" => "LlamaEdge".to_string(),
        "custom" => "Custom".to_string(),
        "" => "Remote".to_string(),
        other => other.to_string(),
    }
}
