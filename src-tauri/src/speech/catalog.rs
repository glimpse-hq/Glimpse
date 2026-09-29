use glimpse_speech::models::{InstallSpec, ModelStorage, RemoteFile};
use serde::Serialize;
use tauri::AppHandle;

use crate::AppRuntime;
use crate::model_language_table::{
    SupportedLanguageInfo, english_supported_languages, nemotron_35_supported_languages,
    parakeet_v3_supported_languages, qwen3_asr_supported_languages, whisper_supported_languages,
};
use crate::settings::UserSettings;
use crate::speech::{install, remote};

pub const MODEL_CAPABILITY_DICTIONARY: &str = "dictionary";
pub const MODEL_CAPABILITY_TIMESTAMPS: &str = "timestamps";
pub const MODEL_CAPABILITY_STREAMING: &str = "streaming";
pub const MODEL_CAPABILITY_DIARIZATION: &str = "diarization";
pub const MODEL_CATEGORY_LEGACY: &str = "legacy";
pub const MODEL_CATEGORY_DIARIZATION: &str = "diarization";
pub const DIARIZER_MODEL: &str = "nemotron3_diar_q8";
/// Model directory and file of the Sortformer v2.1 diarizer that Nemotron-3 replaced.
pub const RETIRED_DIARIZER_MODEL: &str = "sortformer_4spk_v2_1_q8";
pub const RETIRED_DIARIZER_FILE: &str = "diar_streaming_sortformer_4spk-v2.1-Q8_0.gguf";

pub fn is_legacy_category(category: &str) -> bool {
    category.eq_ignore_ascii_case(MODEL_CATEGORY_LEGACY)
}

pub fn is_downloadable(manifest: &LocalModelManifest) -> bool {
    !is_legacy_category(manifest.category)
}

pub fn model_is_downloadable(key: &str) -> bool {
    installable_definition(key).is_some_and(is_downloadable)
}

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
    pub downloadable: bool,
    pub tags: Vec<String>,
    pub capabilities: Vec<String>,
    pub supported_languages: Vec<SupportedLanguageInfo>,
    pub ane_size_mb: Option<f32>,
    pub ane_total_size_mb: Option<f32>,
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

const PARAKEET_UNIFIED_GGUF_FILES: &[CatalogFile] = &[CatalogFile {
    url: "https://huggingface.co/handy-computer/parakeet-unified-en-0.6b-gguf/resolve/main/parakeet-unified-en-0.6b-Q8_0.gguf",
    path: "parakeet-unified-en-0.6b-Q8_0.gguf",
    size_bytes: Some(731_357_568),
    sha256: Some("4b50b6dd862bf6e346929aaf4f5eaacec003bfa3f56462d6c874b41ef2f38795"),
}];

const NEMOTRON_35_STREAMING_GGUF_FILES: &[CatalogFile] = &[CatalogFile {
    url: "https://huggingface.co/handy-computer/nemotron-3.5-asr-streaming-0.6b-gguf/resolve/main/nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf",
    path: "nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf",
    size_bytes: Some(751_094_240),
    sha256: Some("b94545b313b3223fda7b2857a52681da813935c2127643d1e9ff0c23d988089c"),
}];

const NEMOTRON_STREAMING_EN_GGUF_FILES: &[CatalogFile] = &[CatalogFile {
    url: "https://huggingface.co/handy-computer/nemotron-speech-streaming-en-0.6b-gguf/resolve/main/nemotron-speech-streaming-en-0.6b-Q8_0.gguf",
    path: "nemotron-speech-streaming-en-0.6b-Q8_0.gguf",
    size_bytes: Some(729_650_176),
    sha256: Some("90d8c89714cd31efc88be62a40c6b2bea57e0cc2063af1ffe2c28f1a228ca110"),
}];

const PARAKEET_GGUF_FILES: &[CatalogFile] = &[CatalogFile {
    url: "https://huggingface.co/handy-computer/parakeet-tdt-0.6b-v3-gguf/resolve/main/parakeet-tdt-0.6b-v3-Q8_0.gguf",
    path: "parakeet-tdt-0.6b-v3-Q8_0.gguf",
    size_bytes: Some(739_508_576),
    sha256: Some("5859f77944efcd8eafa23a6350731960b2b55b2203df51f319665c807d802cc7"),
}];

const PARAKEET_DECODER_FILE: CatalogFile = CatalogFile {
    url: "https://huggingface.co/Glimpse-Dictation/Parakeet-TDT-0.6B-V3-coreml/resolve/main/parakeet-tdt-0.6b-v3-Q8_0-decoder.gguf",
    path: "parakeet-tdt-0.6b-v3-Q8_0-decoder.gguf",
    size_bytes: Some(19_479_904),
    sha256: Some("dfcf670a00df8d49474fddea707bcfc77339789f65dde115aeb79570fc813744"),
};

const DIARIZER_FILES: &[CatalogFile] = &[CatalogFile {
    url: "https://huggingface.co/Glimpse-Dictation/Nemotron-3-Diarization-gguf/resolve/main/nemotron-3-diarization-Q8_0.gguf",
    path: "nemotron-3-diarization-Q8_0.gguf",
    size_bytes: Some(105_936_416),
    sha256: Some("877ff9e77e829e30158528cfaabf56188fca11d05349e09821b3033a97d31688"),
}];

const QWEN3_ASR_0_6B_FILES: &[CatalogFile] = &[CatalogFile {
    url: "https://huggingface.co/handy-computer/Qwen3-ASR-0.6B-gguf/resolve/main/Qwen3-ASR-0.6B-Q8_0.gguf",
    path: "Qwen3-ASR-0.6B-Q8_0.gguf",
    size_bytes: Some(850_423_456),
    sha256: Some("f081b2d5e23bd669d92cc331d722a8a0681943b8e6f34b48996fd5c319b5acd8"),
}];

const QWEN3_ASR_0_6B_DECODER_FILE: CatalogFile = CatalogFile {
    url: "https://huggingface.co/Glimpse-Dictation/Qwen3-ASR-0.6B-coreml/resolve/main/Qwen3-ASR-0.6B-Q8_0-decoder.gguf",
    path: "Qwen3-ASR-0.6B-Q8_0-decoder.gguf",
    size_bytes: Some(639_554_336),
    sha256: Some("8a1bf11a571607b88ae53ae44c0e38b616c441fd64c53bce37fea9d403a9c489"),
};

/// Core ML encoder companions for transcribe.cpp models, unpacked next to the
/// GGUF as `<gguf stem>-encoder.mlmodelc` (the name the engine looks for).
struct TranscribeAneEncoder {
    // Some models replace the full GGUF with smaller files when using ANE.
    replacement_files: Option<&'static [CatalogFile]>,
    model: &'static str,
    dir_name: &'static str,
    url: &'static str,
    size_bytes: u64,
    sha256: &'static str,
}

// `ditto -c -k --keepParent --norsrc --noextattr <dir> <dir>.zip` of the
// companion produced by scripts/convert-qwen3-asr-gguf-to-coreml.py from the
// GGUF above (transcribe.cpp, docs/models/qwen3-asr.md).
const ANE_QWEN3_ASR_0_6B_ZIP_BYTES: u64 = 340_299_234;
const ANE_QWEN3_ASR_0_6B_ZIP_SHA256: &str =
    "cfd2e37a30d0da1b685da0f96e82f05ef6fc208136c85efa5368ddd2ee18ad5d";

const TRANSCRIBE_ANE_ENCODERS: &[TranscribeAneEncoder] = &[
    TranscribeAneEncoder {
        model: "parakeet_tdt_v3_gguf",
        replacement_files: Some(&[PARAKEET_DECODER_FILE]),
        dir_name: "parakeet-tdt-0.6b-v3-Q8_0-encoder.mlmodelc",
        url: "https://huggingface.co/Glimpse-Dictation/Parakeet-TDT-0.6B-V3-coreml/resolve/main/parakeet-tdt-0.6b-v3-Q8_0-encoder-v2.mlmodelc.zip",
        size_bytes: 1_091_438_144,
        sha256: "259685a7cc5f602d63fc7d3f3a4ccfa39b3969d775e116a126d156c6c9245914",
    },
    TranscribeAneEncoder {
        model: "qwen3_asr_0_6b_q8",
        replacement_files: Some(&[QWEN3_ASR_0_6B_DECODER_FILE]),
        dir_name: "Qwen3-ASR-0.6B-Q8_0-encoder.mlmodelc",
        url: "https://huggingface.co/Glimpse-Dictation/Qwen3-ASR-0.6B-coreml/resolve/main/Qwen3-ASR-0.6B-Q8_0-encoder.mlmodelc.zip",
        size_bytes: ANE_QWEN3_ASR_0_6B_ZIP_BYTES,
        sha256: ANE_QWEN3_ASR_0_6B_ZIP_SHA256,
    },
    // Keeps the full GGUF: live streaming still runs its ggml encoder.
    TranscribeAneEncoder {
        model: "parakeet_unified_en_int8",
        replacement_files: None,
        dir_name: "parakeet-unified-en-0.6b-Q8_0-encoder.mlmodelc",
        url: "https://huggingface.co/Glimpse-Dictation/Parakeet-Unified-EN-0.6B-coreml/resolve/main/parakeet-unified-en-0.6b-Q8_0-encoder.mlmodelc.zip",
        size_bytes: 1_091_102_158,
        sha256: "0f0db7464c605de1a129a9919da00f5b984274d6ff8d13214db63145ca76b089",
    },
];

macro_rules! whisper_files {
    ($family:literal, $quant:literal, $size_bytes:literal, $sha256:literal) => {
        &[CatalogFile {
            url: concat!(
                "https://huggingface.co/handy-computer/whisper-",
                $family,
                "-gguf/resolve/main/whisper-",
                $family,
                "-",
                $quant,
                ".gguf"
            ),
            path: concat!("whisper-", $family, "-", $quant, ".gguf"),
            size_bytes: Some($size_bytes),
            sha256: Some($sha256),
        }]
    };
}

macro_rules! distil_whisper_files {
    ($repo:literal, $path:literal, $size_bytes:literal, $sha256:expr_2021) => {
        &[CatalogFile {
            url: concat!("https://huggingface.co/", $repo, "/resolve/main/", $path),
            path: $path,
            size_bytes: Some($size_bytes),
            sha256: $sha256,
        }]
    };
}

macro_rules! whisper_bin {
    ($model:literal, $path:literal, $size_bytes:literal) => {
        whisper_bin!($model, "ggerganov/whisper.cpp", $path, $size_bytes)
    };
    ($model:literal, $repo:literal, $path:literal, $size_bytes:literal) => {
        (
            $model,
            CatalogFile {
                url: concat!("https://huggingface.co/", $repo, "/resolve/main/", $path),
                path: $path,
                size_bytes: Some($size_bytes),
                sha256: None,
            },
        )
    };
}

// whisper.cpp files earlier versions downloaded and verified. transcribe.cpp
// loads them, so they still count as installed.
const WHISPER_BIN_FILES: &[(&str, CatalogFile)] = &[
    whisper_bin!(
        "whisper_large_v3_turbo_q8",
        "ggml-large-v3-turbo-q8_0.bin",
        874_188_075
    ),
    whisper_bin!("whisper_small_q5", "ggml-small-q5_1.bin", 190_085_487),
    whisper_bin!(
        "distil_whisper_large_v35",
        "Pomni/distil-large-v3.5-ggml-allquants",
        "ggml-distil-large-v3.5-q8_0.bin",
        818_305_955
    ),
    whisper_bin!(
        "distil_whisper_medium_en",
        "Pomni/distil-medium.en-ggml-allquants",
        "ggml-distil-medium.en-q8_0.bin",
        429_655_940
    ),
    whisper_bin!(
        "distil_whisper_small_en",
        "Pomni/distil-small.en-ggml-allquants",
        "ggml-distil-small.en-q8_0.bin",
        183_833_897
    ),
    whisper_bin!("whisper_tiny_q5", "ggml-tiny-q5_1.bin", 32_152_673),
    whisper_bin!("whisper_tiny_q8", "ggml-tiny-q8_0.bin", 43_537_433),
    whisper_bin!("whisper_tiny", "ggml-tiny.bin", 77_691_713),
    whisper_bin!("whisper_base_q5", "ggml-base-q5_1.bin", 59_707_625),
    whisper_bin!("whisper_base_q8", "ggml-base-q8_0.bin", 81_768_585),
    whisper_bin!("whisper_base", "ggml-base.bin", 147_951_465),
    whisper_bin!("whisper_small_q8", "ggml-small-q8_0.bin", 264_464_607),
    whisper_bin!("whisper_small", "ggml-small.bin", 487_601_967),
    whisper_bin!("whisper_medium_q5", "ggml-medium-q5_0.bin", 539_212_467),
    whisper_bin!("whisper_medium_q8", "ggml-medium-q8_0.bin", 823_369_779),
    whisper_bin!("whisper_medium", "ggml-medium.bin", 1_533_763_059),
    whisper_bin!(
        "whisper_large_v3_q5",
        "ggml-large-v3-q5_0.bin",
        1_081_140_203
    ),
    whisper_bin!("whisper_large_v3", "ggml-large-v3.bin", 3_095_033_483),
    whisper_bin!(
        "whisper_large_v3_turbo_q5",
        "ggml-large-v3-turbo-q5_0.bin",
        574_041_195
    ),
    whisper_bin!(
        "whisper_large_v3_turbo",
        "ggml-large-v3-turbo.bin",
        1_624_555_275
    ),
];

pub(super) const ANE_SUPPORTED: bool = cfg!(all(target_os = "macos", target_arch = "aarch64"));

struct AneEncoder {
    // Catalog families it serves. Distil-Whisper keeps its teacher's encoder.
    families: &'static [&'static str],
    dir_name: &'static str,
    url: &'static str,
    size_bytes: u64,
    sha256: &'static str,
}

/// A downloadable Core ML encoder for one catalog entry: the zip to fetch and
/// the directory it unpacks to inside the model directory.
struct AneCompanion {
    dir_name: String,
    url: String,
    size_bytes: u64,
    sha256: &'static str,
}

// None for Distil-Whisper Medium.en: with it, a test recording fell into a
// repetition loop.
const WHISPER_ANE_ENCODERS: &[AneEncoder] = &[
    AneEncoder {
        families: &["whisper-tiny"],
        dir_name: "whisper-tiny-encoder.mlmodelc",
        url: "https://huggingface.co/Glimpse-Dictation/Whisper-Tiny-coreml/resolve/main/whisper-tiny-encoder.mlmodelc.zip",
        size_bytes: 14_955_833,
        sha256: "35041e7f9f9c3e016bf1ff23819109c9dbd60cb387f97526fd44ba26c916bf52",
    },
    AneEncoder {
        families: &["whisper-base"],
        dir_name: "whisper-base-encoder.mlmodelc",
        url: "https://huggingface.co/Glimpse-Dictation/Whisper-Base-coreml/resolve/main/whisper-base-encoder.mlmodelc.zip",
        size_bytes: 37_850_456,
        sha256: "f38ea79465a06476d59a7e60bba129df6fa0823264f22242c093b604f4c3e533",
    },
    AneEncoder {
        families: &["whisper-small"],
        dir_name: "whisper-small-encoder.mlmodelc",
        url: "https://huggingface.co/Glimpse-Dictation/Whisper-Small-coreml/resolve/main/whisper-small-encoder.mlmodelc.zip",
        size_bytes: 163_115_581,
        sha256: "8a7eff95acc7a237731d778d2269ea7aa7338cd1190fd6ab4266be506886a625",
    },
    AneEncoder {
        families: &["distil-small"],
        dir_name: "whisper-small.en-encoder.mlmodelc",
        url: "https://huggingface.co/Glimpse-Dictation/Whisper-Small.en-coreml/resolve/main/whisper-small.en-encoder.mlmodelc.zip",
        size_bytes: 162_989_269,
        sha256: "70d001bfa2cde210330796e602a95bee5e5a564f8cef28337210781f63f4b28a",
    },
    AneEncoder {
        families: &["whisper-medium"],
        dir_name: "whisper-medium-encoder.mlmodelc",
        url: "https://huggingface.co/Glimpse-Dictation/Whisper-Medium-coreml/resolve/main/whisper-medium-encoder.mlmodelc.zip",
        size_bytes: 568_607_692,
        sha256: "59782b3aa871f498673266ae64990ee0d0a61adc59321656b9a266f5a3f7650b",
    },
    AneEncoder {
        families: &["whisper-large-v3", "distil-large"],
        dir_name: "whisper-large-v3-encoder.mlmodelc",
        url: "https://huggingface.co/Glimpse-Dictation/Whisper-Large-V3-coreml/resolve/main/whisper-large-v3-encoder.mlmodelc.zip",
        size_bytes: 1_175_779_792,
        sha256: "504d9b03b34c689e91d61fb97d4c97eca979fc4d21e65d9c2963b7481cbc66dc",
    },
    AneEncoder {
        families: &["whisper-large-v3-turbo"],
        dir_name: "whisper-large-v3-turbo-encoder.mlmodelc",
        url: "https://huggingface.co/Glimpse-Dictation/Whisper-Large-V3-Turbo-coreml/resolve/main/whisper-large-v3-turbo-encoder.mlmodelc.zip",
        size_bytes: 1_174_156_358,
        sha256: "9a313371eb6927d446b8aa0081816979d46e08470b5262d72e1c22b81d104706",
    },
];

// whisper.cpp encoder names drop the `-qX_Y` quantization.
fn strip_quant_suffix(stem: &str) -> &str {
    if let Some(pos) = stem.rfind('-') {
        let suffix = &stem.as_bytes()[pos..];
        if suffix.len() == 5 && suffix[1] == b'q' && suffix[3] == b'_' {
            return &stem[..pos];
        }
    }
    stem
}

fn whisper_bin_file(model: &str) -> Option<&'static CatalogFile> {
    WHISPER_BIN_FILES
        .iter()
        .find(|(id, _)| *id == model)
        .map(|(_, file)| file)
}

/// The whisper.cpp Core ML encoder earlier versions unpacked for this model.
/// transcribe.cpp can't load it.
pub(super) fn whisper_cpp_encoder_dir(manifest: &LocalModelManifest) -> Option<String> {
    let stem = whisper_bin_file(manifest.id)?
        .path
        .strip_prefix("ggml-")?
        .strip_suffix(".bin")?;
    let family = strip_quant_suffix(stem);
    Some(format!("ggml-{family}-encoder.mlmodelc"))
}

/// The partial file an interrupted download of the earlier `.bin` left, unless
/// this version still downloads that `.bin`.
pub(super) fn whisper_bin_partial(manifest: &LocalModelManifest) -> Option<String> {
    let bin = whisper_bin_file(manifest.id)?;
    (!manifest.files.iter().any(|file| file.path == bin.path)).then(|| format!("{}.part", bin.path))
}

fn ane_companion(manifest: &LocalModelManifest) -> Option<AneCompanion> {
    if !ANE_SUPPORTED {
        return None;
    }
    match manifest.engine {
        LocalModelEngine::Whisper => WHISPER_ANE_ENCODERS
            .iter()
            .find(|encoder| encoder.families.contains(&manifest.family))
            .map(|encoder| AneCompanion {
                dir_name: encoder.dir_name.to_string(),
                url: encoder.url.to_string(),
                size_bytes: encoder.size_bytes,
                sha256: encoder.sha256,
            }),
        LocalModelEngine::Transcribe => TRANSCRIBE_ANE_ENCODERS
            .iter()
            .find(|encoder| encoder.model == manifest.id)
            .map(|encoder| AneCompanion {
                dir_name: encoder.dir_name.to_string(),
                url: encoder.url.to_string(),
                size_bytes: encoder.size_bytes,
                sha256: encoder.sha256,
            }),
        _ => None,
    }
}

pub fn ane_encoder_dir(model: &str) -> Option<String> {
    definition(model)
        .and_then(ane_companion)
        .map(|companion| companion.dir_name)
}

const WHISPER_DESCRIPTION: &str =
    "Local Whisper model with multilingual support and dictionary support.";
const DISTIL_WHISPER_DESCRIPTION: &str =
    "Fast English-only Distil-Whisper Q8 model. Dictionary support is limited.";
const WHISPER_CAPABILITIES: &[&str] = &[MODEL_CAPABILITY_DICTIONARY, MODEL_CAPABILITY_TIMESTAMPS];

const MODEL_MANIFESTS: &[LocalModelManifest] = &[
    LocalModelManifest {
        id: "parakeet_tdt_v3_gguf",
        family: "parakeet-tdt-0.6b-v3",
        label: "Parakeet TDT V3",
        description: "Multilingual Parakeet TDT V3 on CPU or GPU, with optional Neural Engine acceleration on Apple Silicon.",
        tags: &["Multilingual", "Fast"],
        category: "standard",
        engine: LocalModelEngine::Transcribe,
        variant: "Q8_0",
        files: PARAKEET_GGUF_FILES,
        capabilities: &[MODEL_CAPABILITY_DICTIONARY, MODEL_CAPABILITY_TIMESTAMPS],
    },
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    LocalModelManifest {
        id: "apple_speech",
        family: "apple-speech",
        label: "Apple Speech",
        description: "Built into this Mac. Nothing to download.",
        tags: &["Multilingual", "Built in"],
        category: "standard",
        engine: LocalModelEngine::Apple,
        variant: "System",
        files: &[],
        capabilities: &[MODEL_CAPABILITY_TIMESTAMPS],
    },
    LocalModelManifest {
        id: "whisper_large_v3_turbo_q8",
        family: "whisper-large-v3-turbo",
        label: "Whisper Large V3 Turbo",
        description: "Great quality local Whisper model with multilingual support and dictionary support.",
        tags: &["Dictionary", "Multilingual"],
        category: "standard",
        engine: LocalModelEngine::Whisper,
        variant: "Q8_0",
        files: whisper_files!(
            "large-v3-turbo",
            "Q8_0",
            886_381_760,
            "b2e30cc286bc9f3aba4db9099fc7403543497c05ce7100d0d83091ddfd25a183"
        ),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "qwen3_asr_0_6b_q8",
        family: "qwen3-asr-0.6b",
        label: "Qwen3-ASR 0.6B",
        description: "Multilingual Qwen3-ASR with optional Neural Engine acceleration on Apple Silicon.",
        tags: &["Multilingual", "Fast"],
        category: "experimental",
        engine: LocalModelEngine::Transcribe,
        variant: "Q8_0",
        files: QWEN3_ASR_0_6B_FILES,
        capabilities: &[MODEL_CAPABILITY_DICTIONARY],
    },
    LocalModelManifest {
        id: "parakeet_unified_en_int8",
        family: "parakeet-unified",
        label: "Parakeet Unified",
        description: "Fast English local transcription with streaming support.",
        tags: &["English", "Fast", "Streaming"],
        category: "experimental",
        engine: LocalModelEngine::Transcribe,
        variant: "Q8_0",
        files: PARAKEET_UNIFIED_GGUF_FILES,
        capabilities: &[
            MODEL_CAPABILITY_DICTIONARY,
            MODEL_CAPABILITY_TIMESTAMPS,
            MODEL_CAPABILITY_STREAMING,
        ],
    },
    LocalModelManifest {
        id: "nemotron_35_streaming_multilingual",
        family: "nemotron-35-streaming",
        label: "Nemotron 3.5 Streaming",
        description: "Multilingual streaming transcription with punctuation and capitalization.",
        tags: &["Multilingual", "Streaming"],
        category: "experimental",
        engine: LocalModelEngine::Transcribe,
        variant: "Q8_0",
        files: NEMOTRON_35_STREAMING_GGUF_FILES,
        capabilities: &[
            MODEL_CAPABILITY_DICTIONARY,
            MODEL_CAPABILITY_TIMESTAMPS,
            MODEL_CAPABILITY_STREAMING,
        ],
    },
    LocalModelManifest {
        id: "nemotron_streaming_en",
        family: "nemotron-streaming",
        label: "Nemotron Streaming",
        description: "Real-time streaming transcription. Text appears as you speak.",
        tags: &["English", "Streaming"],
        category: "legacy",
        engine: LocalModelEngine::Transcribe,
        variant: "Q8_0",
        files: NEMOTRON_STREAMING_EN_GGUF_FILES,
        capabilities: &[
            MODEL_CAPABILITY_DICTIONARY,
            MODEL_CAPABILITY_TIMESTAMPS,
            MODEL_CAPABILITY_STREAMING,
        ],
    },
    LocalModelManifest {
        id: "whisper_small_q5",
        family: "whisper-small",
        label: "Whisper Small",
        description: "Small & fast with dictionary support.",
        tags: &["Multilingual", "Dictionary", "Compute Friendly"],
        category: "legacy",
        engine: LocalModelEngine::Whisper,
        variant: "Q5_1",
        files: whisper_files!(
            "small",
            "Q5_K_M",
            193_749_056,
            "326cd00c3e7217c751667c7c1600eaf7e0de174e186ca2c16b4bf590251c3c3b"
        ),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "distil_whisper_large_v35",
        family: "distil-large",
        label: "Distil-Whisper Large V3.5",
        description: DISTIL_WHISPER_DESCRIPTION,
        tags: &["English", "Fast"],
        category: "legacy",
        engine: LocalModelEngine::Whisper,
        variant: "Q8_0",
        files: distil_whisper_files!(
            "Glimpse-Dictation/Distil-Whisper-Large-V3.5-gguf",
            "distil-large-v3.5-Q8_0.gguf",
            830_499_360,
            Some("a6f012fa357e28fdc4c4a5108341571add35e77d576c87c3eda7b41033d8cfe2")
        ),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "distil_whisper_medium_en",
        family: "distil-medium",
        label: "Distil-Whisper Medium",
        description: DISTIL_WHISPER_DESCRIPTION,
        tags: &["English", "Fast"],
        category: "legacy",
        engine: LocalModelEngine::Whisper,
        variant: "Q8_0",
        files: distil_whisper_files!(
            "Glimpse-Dictation/Distil-Whisper-Medium.en-gguf",
            "distil-medium.en-Q8_0.gguf",
            437_727_104,
            Some("bf726a0d84dd911d4fe3a36413bf7d10b8b065d70ff86eef3f81b15326297fce")
        ),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "distil_whisper_small_en",
        family: "distil-small",
        label: "Distil-Whisper Small",
        description: DISTIL_WHISPER_DESCRIPTION,
        tags: &["English", "Fast", "Compute Friendly"],
        category: "legacy",
        engine: LocalModelEngine::Whisper,
        variant: "Q8_0",
        files: distil_whisper_files!(
            "Glimpse-Dictation/Distil-Whisper-Small.en-gguf",
            "distil-small.en-Q8_0.gguf",
            189_027_904,
            Some("552869c2c9ac97f03da6497e5ffabdb81b2dee50a81b7bcfb67344c41cadeaa6")
        ),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_tiny_q5",
        family: "whisper-tiny",
        label: "Whisper Tiny",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary", "Compute Friendly"],
        category: "legacy",
        engine: LocalModelEngine::Whisper,
        variant: "Q5_1",
        files: whisper_files!(
            "tiny",
            "Q8_0",
            45_981_088,
            "325b9c7997cd1eff81ef709d55766565e71be696130cc3a3d444713798706834"
        ),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_tiny_q8",
        family: "whisper-tiny",
        label: "Whisper Tiny",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary", "Compute Friendly"],
        category: "legacy",
        engine: LocalModelEngine::Whisper,
        variant: "Q8_0",
        files: whisper_files!(
            "tiny",
            "Q8_0",
            45_981_088,
            "325b9c7997cd1eff81ef709d55766565e71be696130cc3a3d444713798706834"
        ),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_tiny",
        family: "whisper-tiny",
        label: "Whisper Tiny",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary", "Compute Friendly"],
        category: "legacy",
        engine: LocalModelEngine::Whisper,
        variant: "Full",
        files: whisper_files!(
            "tiny",
            "F16",
            80_135_360,
            "5b44043278b47d3b6e56fb16c6bc5bb0aa16f2e69086f4d67175ed0a30d6a987"
        ),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_base_q5",
        family: "whisper-base",
        label: "Whisper Base",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary", "Compute Friendly"],
        category: "legacy",
        engine: LocalModelEngine::Whisper,
        variant: "Q5_1",
        files: whisper_files!(
            "base",
            "Q5_K_M",
            63_786_048,
            "8e0feb7bc35780353cf31821018e601bb7b7cff6c9a0e17ada5a5db23f4db867"
        ),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_base_q8",
        family: "whisper-base",
        label: "Whisper Base",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary", "Compute Friendly"],
        category: "legacy",
        engine: LocalModelEngine::Whisper,
        variant: "Q8_0",
        files: whisper_files!(
            "base",
            "Q8_0",
            84_962_880,
            "81c069428bc8a24551a8169cf31cf09bcfd9d4cf50389ae281323c9aa9648c81"
        ),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_base",
        family: "whisper-base",
        label: "Whisper Base",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary", "Compute Friendly"],
        category: "legacy",
        engine: LocalModelEngine::Whisper,
        variant: "Full",
        files: whisper_files!(
            "base",
            "F16",
            151_145_760,
            "38ab6b0ed742e9eded4d5a2ba7fc34d44fc28cdb71d6360f6321d4b306ef8039"
        ),
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
        files: whisper_files!(
            "small",
            "Q8_0",
            269_751_136,
            "9b9c8811bbcc82a7766f0fb0925614bdacb0923b2cc630daeac17108b655b860"
        ),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_small",
        family: "whisper-small",
        label: "Whisper Small",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary"],
        category: "legacy",
        engine: LocalModelEngine::Whisper,
        variant: "Full",
        files: whisper_files!(
            "small",
            "F16",
            492_888_480,
            "bef65e1ac9d012269453243243aac0d0f67792693ba6c99b584a124e0ee326fc"
        ),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_medium_q5",
        family: "whisper-medium",
        label: "Whisper Medium",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary"],
        category: "legacy",
        engine: LocalModelEngine::Whisper,
        variant: "Q5_0",
        files: whisper_files!(
            "medium",
            "Q5_K_M",
            582_746_048,
            "4e2a8904a866b3aa7ef70d7640ec6abc5f0a05524cd950ea4b66ace12122bf53"
        ),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_medium_q8",
        family: "whisper-medium",
        label: "Whisper Medium",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary"],
        category: "legacy",
        engine: LocalModelEngine::Whisper,
        variant: "Q8_0",
        files: whisper_files!(
            "medium",
            "Q8_0",
            831_538_144,
            "09e6a65e7de377aa5b10bae24608bc6f8ca2ed04b3993ef10d4a02bcd9a82adf"
        ),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_medium",
        family: "whisper-medium",
        label: "Whisper Medium",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary"],
        category: "legacy",
        engine: LocalModelEngine::Whisper,
        variant: "Full",
        files: whisper_files!(
            "medium",
            "F16",
            1_541_931_424,
            "62338e5194cb9ccc6734adf6f42694805a98a158028b2022e39ec060559bd517"
        ),
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
        // Measured more accurate and smaller than the Q5_K_M GGUF.
        files: &[CatalogFile {
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-q5_0.bin",
            path: "ggml-large-v3-q5_0.bin",
            size_bytes: Some(1_081_140_203),
            sha256: Some("d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1"),
        }],
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_large_v3",
        family: "whisper-large-v3",
        label: "Whisper Large V3",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary"],
        category: "legacy",
        engine: LocalModelEngine::Whisper,
        variant: "Full",
        files: whisper_files!(
            "large-v3",
            "F16",
            3_107_236_640,
            "e633ab1d74b0e98f4f57daedaee34291297dbbf01389bda3d890766600c1c584"
        ),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_large_v3_turbo_q5",
        family: "whisper-large-v3-turbo",
        label: "Whisper Large V3 Turbo",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary"],
        category: "legacy",
        engine: LocalModelEngine::Whisper,
        variant: "Q5_0",
        files: whisper_files!(
            "large-v3-turbo",
            "Q5_K_M",
            619_628_128,
            "977b5db4e004349dffd1ab9caa10ba5aaba3fc3edd3ba72cadb84328a3203e36"
        ),
        capabilities: WHISPER_CAPABILITIES,
    },
    LocalModelManifest {
        id: "whisper_large_v3_turbo",
        family: "whisper-large-v3-turbo",
        label: "Whisper Large V3 Turbo",
        description: WHISPER_DESCRIPTION,
        tags: &["Multilingual", "Dictionary"],
        category: "legacy",
        engine: LocalModelEngine::Whisper,
        variant: "Full",
        files: whisper_files!(
            "large-v3-turbo",
            "F16",
            1_625_935_520,
            "e1d0144e9afc9f479d9e51fc92c7dea9dc36059655eeb3819f16ad2de779046a"
        ),
        capabilities: WHISPER_CAPABILITIES,
    },
];

// Speaker detection for Library items. Kept out of MODEL_MANIFESTS so it never
// shows up where a transcription model is expected.
const DIARIZER_MANIFEST: LocalModelManifest = LocalModelManifest {
    id: DIARIZER_MODEL,
    family: "nemotron-3-diarization",
    label: "Nemotron-3 Diarization",
    description: "Labels who is speaking in Library transcripts.",
    tags: &[],
    category: MODEL_CATEGORY_DIARIZATION,
    engine: LocalModelEngine::Transcribe,
    variant: "Q8_0",
    files: DIARIZER_FILES,
    capabilities: &[],
};

pub fn local_manifests() -> &'static [LocalModelManifest] {
    MODEL_MANIFESTS
}

/// Transcription models only. [`installable_definition`] also covers the diarizer.
pub fn definition(key: &str) -> Option<&'static LocalModelManifest> {
    MODEL_MANIFESTS.iter().find(|manifest| manifest.id == key)
}

pub(crate) fn installable_definition(key: &str) -> Option<&'static LocalModelManifest> {
    definition(key).or_else(|| (key == DIARIZER_MODEL).then_some(&DIARIZER_MANIFEST))
}

fn ane_replacement_files(model: &str) -> Option<&'static [CatalogFile]> {
    if !ANE_SUPPORTED {
        return None;
    }
    TRANSCRIBE_ANE_ENCODERS
        .iter()
        .find(|encoder| encoder.model == model)
        .and_then(|encoder| encoder.replacement_files)
}

pub fn ane_replaces_model_files(model: &str) -> bool {
    ane_replacement_files(model).is_some()
}

pub fn install_spec(model: &str, ane: bool) -> Option<InstallSpec> {
    let manifest = installable_definition(model)?;
    let model_files = if ane {
        ane_replacement_files(model).unwrap_or(manifest.files)
    } else {
        manifest.files
    };
    Some(spec_from_files(manifest, model_files, ane))
}

/// The spec for the whisper.cpp `.bin` an earlier version installed.
pub fn whisper_bin_install_spec(model: &str, ane: bool) -> Option<InstallSpec> {
    let manifest = definition(model)?;
    let file = whisper_bin_file(model)?;
    Some(spec_from_files(manifest, std::slice::from_ref(file), ane))
}

fn spec_from_files(
    manifest: &LocalModelManifest,
    model_files: &[CatalogFile],
    ane: bool,
) -> InstallSpec {
    let storage = match model_files {
        [single] => ModelStorage::File {
            artifact: single.path.to_string(),
        },
        _ => ModelStorage::Directory,
    };
    let mut files: Vec<RemoteFile> = model_files
        .iter()
        .map(|file| RemoteFile {
            url: file.url.to_string(),
            path: file.path.to_string(),
            size_bytes: file.size_bytes,
            sha256: file.sha256.map(str::to_string),
            extract: false,
        })
        .collect();
    if ane && let Some(companion) = ane_companion(manifest) {
        files.push(RemoteFile {
            url: companion.url,
            path: companion.dir_name,
            size_bytes: Some(companion.size_bytes),
            sha256: Some(companion.sha256.to_string()),
            extract: true,
        });
    }
    InstallSpec {
        id: manifest.id.to_string(),
        engine: manifest.engine,
        storage,
        files,
        variant: Some(manifest.family.to_string()),
    }
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
    if manifest.id == DIARIZER_MODEL {
        return Vec::new();
    }
    if supports_only_english(manifest) {
        return english_supported_languages();
    }

    match manifest.engine {
        LocalModelEngine::Whisper => whisper_supported_languages(),
        LocalModelEngine::Apple => apple_supported_languages(),
        LocalModelEngine::Transcribe if manifest.id == "parakeet_tdt_v3_gguf" => {
            parakeet_v3_supported_languages()
        }
        LocalModelEngine::Transcribe if manifest.id == "nemotron_35_streaming_multilingual" => {
            nemotron_35_supported_languages()
        }
        LocalModelEngine::Transcribe => qwen3_asr_supported_languages(),
    }
}

fn apple_supported_languages() -> Vec<SupportedLanguageInfo> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        static LANGUAGES: std::sync::OnceLock<Vec<SupportedLanguageInfo>> =
            std::sync::OnceLock::new();
        LANGUAGES
            .get_or_init(|| {
                let mut codes: Vec<String> = glimpse_speech::engines::apple::supported_locales()
                    .iter()
                    .filter_map(|locale| locale.split('-').next())
                    .map(str::to_string)
                    .collect();
                codes.sort();
                codes.dedup();
                crate::model_language_table::supported_languages_for_owned_codes(&codes)
            })
            .clone()
    }
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        Vec::new()
    }
}

pub(crate) fn apple_engine_available() -> bool {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        glimpse_speech::engines::apple::available()
    }
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        false
    }
}

/// Engine name for analytics. Models that ran on the NVIDIA ONNX runtimes
/// before 1.3.0 keep theirs so dashboards stay continuous.
pub fn engine_name(manifest: &LocalModelManifest) -> &'static str {
    match manifest.family {
        "parakeet-unified" => "parakeet",
        "nemotron-streaming" | "nemotron-35-streaming" => "nemotron",
        _ => manifest.engine.as_str(),
    }
}

fn engine_id(manifest: &LocalModelManifest) -> &'static str {
    match engine_name(manifest) {
        "nemotron" | "parakeet" => "nvidia",
        name => name,
    }
}

fn capability_strings(capabilities: &[&str]) -> Vec<String> {
    capabilities.iter().map(|c| c.to_string()).collect()
}

fn manifest_to_model_info(manifest: &LocalModelManifest) -> ModelInfo {
    let companion = ane_companion(manifest);
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
        engine_id: engine_id(manifest).to_string(),
        family: manifest.family.to_string(),
        variant: manifest.variant.to_string(),
        category: manifest.category.to_string(),
        downloadable: is_downloadable(manifest),
        tags: manifest.tags.iter().map(|tag| tag.to_string()).collect(),
        capabilities: capability_strings(manifest.capabilities),
        supported_languages: supported_languages(manifest),
        ane_size_mb: companion
            .as_ref()
            .map(|c| c.size_bytes as f32 / 1_000_000.0),
        ane_total_size_mb: companion.and_then(|c| {
            ane_replacement_files(manifest.id).map(|files| {
                (c.size_bytes + files.iter().map(|f| f.size_bytes.unwrap_or(0)).sum::<u64>()) as f32
                    / 1_000_000.0
            })
        }),
    }
}

pub fn api_model_infos() -> Vec<glimpse_speech::api::ApiModelInfo> {
    MODEL_MANIFESTS
        .iter()
        .map(|manifest| {
            glimpse_speech::api::ApiModelInfo::new(
                manifest.id.to_string(),
                manifest.label.to_string(),
                manifest.description.to_string(),
                manifest.tags.iter().map(|tag| tag.to_string()).collect(),
                capability_strings(manifest.capabilities),
            )
        })
        .collect()
}

pub fn list_local_models() -> Vec<ModelInfo> {
    MODEL_MANIFESTS
        .iter()
        .filter(|manifest| manifest.engine != LocalModelEngine::Apple || apple_engine_available())
        .map(manifest_to_model_info)
        .collect()
}

pub fn diarizer_model_info() -> ModelInfo {
    manifest_to_model_info(&DIARIZER_MANIFEST)
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

/// Headless variant of [`list_models`] that derives installed status from a
/// models directory path instead of an `AppHandle`.
pub(crate) fn list_models_at(
    models_dir: &std::path::Path,
    settings: &UserSettings,
) -> Vec<SpeechModel> {
    let mut models = Vec::new();

    if remote::is_configured(settings) {
        models.push(remote_entry(settings));
    }

    for info in list_local_models() {
        let installed = install::check_model_installed_at(models_dir, &info.key);
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
        capabilities: {
            let mut caps = vec![
                MODEL_CAPABILITY_TIMESTAMPS.to_string(),
                MODEL_CAPABILITY_DICTIONARY.to_string(),
            ];
            if glimpse_speech::remote::supports_diarization(
                &remote::resolved_endpoint(settings),
                &remote::resolved_model_name(settings).unwrap_or_default(),
            ) {
                caps.push(MODEL_CAPABILITY_DIARIZATION.to_string());
            }
            caps
        },
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
        "xai" => "xAI (Grok)".to_string(),
        "mistral" => "Mistral".to_string(),
        "fireworks" => "Fireworks".to_string(),
        "openrouter" => "OpenRouter".to_string(),
        "litellm" => "LiteLLM".to_string(),
        "deepgram" => "Deepgram".to_string(),
        "elevenlabs" => "ElevenLabs".to_string(),
        "vllm" => "vLLM".to_string(),
        "localai" => "LocalAI".to_string(),
        "whisper-cpp" => "whisper.cpp".to_string(),
        "llamaedge" => "LlamaEdge".to_string(),
        "custom" => "Custom".to_string(),
        "" => "Remote".to_string(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parakeet_gguf_has_platform_appropriate_packages() {
        let full = install_spec("parakeet_tdt_v3_gguf", false).unwrap();
        let ane = install_spec("parakeet_tdt_v3_gguf", true).unwrap();
        assert_eq!(full.files.len(), 1);
        assert_eq!(full.engine, LocalModelEngine::Transcribe);
        let info = manifest_to_model_info(definition("parakeet_tdt_v3_gguf").unwrap());
        assert_eq!(info.supported_languages.len(), 25);
        assert_eq!(
            info.capabilities,
            [MODEL_CAPABILITY_DICTIONARY, MODEL_CAPABILITY_TIMESTAMPS]
        );
        assert!(info.size_mb < 740.0);
        if ANE_SUPPORTED {
            assert_eq!(ane.files.len(), 2);
            assert!(ane.files[0].path.ends_with("-decoder.gguf"));
            assert!(ane.files[1].extract);
            assert!(info.ane_total_size_mb.unwrap() < 1113.0);
        } else {
            assert_eq!(ane.files[0].path, full.files[0].path);
            assert_eq!(ane.files.len(), 1);
            assert!(info.ane_total_size_mb.is_none());
        }
    }

    #[test]
    fn legacy_models_are_not_downloadable() {
        let legacy = LocalModelManifest {
            id: "legacy_test",
            label: "Legacy Test",
            description: "test",
            category: MODEL_CATEGORY_LEGACY,
            tags: &[],
            engine: LocalModelEngine::Whisper,
            family: "whisper-tiny",
            variant: "Full",
            files: whisper_files!(
                "tiny",
                "F16",
                80_135_360,
                "5b44043278b47d3b6e56fb16c6bc5bb0aa16f2e69086f4d67175ed0a30d6a987"
            ),
            capabilities: WHISPER_CAPABILITIES,
        };

        assert!(is_legacy_category(MODEL_CATEGORY_LEGACY));
        assert!(!is_downloadable(&legacy));
    }

    #[test]
    fn active_models_remain_downloadable() {
        let manifest = definition("whisper_large_v3_turbo_q8").expect("fixture model");
        assert!(is_downloadable(manifest));
        assert!(model_is_downloadable("whisper_large_v3_turbo_q8"));
    }

    #[test]
    fn unknown_models_are_not_downloadable() {
        assert!(!model_is_downloadable("not_a_real_model"));
    }
}
