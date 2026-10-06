use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow};
use glimpse_speech::models::{
    InstallSpec, ModelEngine, ModelInstallManager, ModelStorage, RemoteFile,
};
#[cfg(target_os = "macos")]
use serde::Deserialize;
use tauri::{AppHandle, Runtime};

use crate::library::{LibraryTranscriptionResult, Speaker, TranscriptSegment};
use crate::speech::catalog::ModelInfo;

pub const MODEL_KEY: &str = "speaker-diarization-local";
pub const MODEL_LABEL: &str = "Local person detection";

#[derive(Debug, Clone)]
pub struct Segment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub speaker: String,
}

const WEAK_SPEAKER_MAX_DURATION_MS: u64 = 4_000;
const WEAK_SPEAKER_MAX_SHARE_PERCENT: u64 = 15;
const WEAK_SPEAKER_MIN_DOMINANT_DURATION_MS: u64 = 12_000;

pub fn model_info() -> ModelInfo {
    #[cfg(target_os = "macos")]
    let (family, size_mb) = ("fluid-audio-coreml", 13.72);
    #[cfg(target_os = "windows")]
    let (family, size_mb) = ("sherpa-onnx", 46.56);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let (family, size_mb) = ("unsupported", 0.0);

    ModelInfo {
        key: MODEL_KEY.to_string(),
        label: MODEL_LABEL.to_string(),
        description: "Separates voices locally without uploading audio.".to_string(),
        size_mb,
        engine_id: "diarization".to_string(),
        family: family.to_string(),
        variant: String::new(),
        category: "diarization".to_string(),
        downloadable: cfg!(any(target_os = "macos", target_os = "windows")),
        tags: vec!["Local".to_string(), "Private".to_string()],
        capabilities: vec!["diarization".to_string()],
        supported_languages: Vec::new(),
        ane_size_mb: None,
        ane_total_size_mb: None,
    }
}

pub fn install_spec(model: &str) -> Option<InstallSpec> {
    (model == MODEL_KEY).then(platform_install_spec)
}

fn platform_install_spec() -> InstallSpec {
    InstallSpec {
        id: MODEL_KEY.to_string(),
        // The shared installer only uses this to select special built-in handling.
        // Diarization has its own runtime and never reaches ASR model resolution.
        engine: ModelEngine::Whisper,
        storage: ModelStorage::Directory,
        files: platform_files(),
        variant: Some("speaker-diarization".to_string()),
    }
}

#[cfg(target_os = "macos")]
fn platform_files() -> Vec<RemoteFile> {
    const BASE: &str =
        "https://huggingface.co/FluidInference/speaker-diarization-coreml/resolve/main";
    [
        (
            "pyannote_segmentation.mlmodelc/analytics/coremldata.bin",
            243,
            Some("b379db0541b35344a34bb7540783ae704c11599bbed5aa8bbbda11c20ad215ee"),
        ),
        (
            "pyannote_segmentation.mlmodelc/coremldata.bin",
            316,
            Some("4a450ea1b053b9eb7eef0cab6971018076600840c7e246d064e7c5387f456c98"),
        ),
        (
            "pyannote_segmentation.mlmodelc/metadata.json",
            1_763,
            Some("44e1fa36d6abafacf688beccad99f7569394248d8bb41545829997c67668c08c"),
        ),
        (
            "pyannote_segmentation.mlmodelc/model.mil",
            29_490,
            Some("97f2dec6f83e80bf4247b98e13c2dde19f92c05820ef08068bbf554488d70bdd"),
        ),
        (
            "pyannote_segmentation.mlmodelc/weights/weight.bin",
            5_734_720,
            Some("0266f4ad4d843ecf31ef9220ad6b80616b3ec64a4404b64f3ea0371554e236ec"),
        ),
        (
            "wespeaker_v2.mlmodelc/analytics/coremldata.bin",
            243,
            Some("d2b1fcde6121aea3ff0e14c1dc50d09dacb0314a2e89156353c31804230a422f"),
        ),
        (
            "wespeaker_v2.mlmodelc/coremldata.bin",
            359,
            Some("6feb2472a71fa9d8a84020c85206138a4f6261c565c9884bf518d59dd5838da7"),
        ),
        (
            "wespeaker_v2.mlmodelc/metadata.json",
            2_738,
            Some("ddc4858b4051254098015cd0b97080149839d697faf7b036f933190e70b26758"),
        ),
        (
            "wespeaker_v2.mlmodelc/model.mil",
            706_900,
            Some("2850f775d6ba659f01f616fed77ce6a45a25de3eb7e4bf3a4b07b658be4e13dd"),
        ),
        (
            "wespeaker_v2.mlmodelc/weights/weight.bin",
            7_243_904,
            Some("34004f6798d35cad7071e2fdc67e63faaa782f53697e1cb49bcb452cf81ae151"),
        ),
    ]
    .into_iter()
    .map(|(path, size_bytes, sha256)| RemoteFile {
        url: format!("{BASE}/{path}"),
        path: path.to_string(),
        size_bytes: Some(size_bytes),
        sha256: sha256.map(str::to_string),
        extract: false,
    })
    .collect()
}

#[cfg(target_os = "windows")]
fn platform_files() -> Vec<RemoteFile> {
    vec![
        RemoteFile {
            url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2".to_string(),
            path: "segmentation.tar.bz2".to_string(),
            size_bytes: Some(6_958_444),
            sha256: Some("24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488".to_string()),
            extract: false,
        },
        RemoteFile {
            url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx".to_string(),
            path: "embedding.onnx".to_string(),
            size_bytes: Some(39_593_761),
            sha256: Some("1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b".to_string()),
            extract: false,
        },
    ]
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_files() -> Vec<RemoteFile> {
    Vec::new()
}

pub fn model_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    Ok(crate::model_manager::model_cache_dir(app)?.join(MODEL_KEY))
}

pub fn is_installed<R: Runtime>(app: &AppHandle<R>) -> bool {
    model_dir(app)
        .map(|dir| installation_complete(&dir))
        .unwrap_or(false)
}

pub fn installation_complete(directory: &Path) -> bool {
    #[cfg(target_os = "macos")]
    return directory
        .join("pyannote_segmentation.mlmodelc/weights/weight.bin")
        .is_file()
        && directory
            .join("wespeaker_v2.mlmodelc/weights/weight.bin")
            .is_file();

    #[cfg(target_os = "windows")]
    return directory
        .join("sherpa-onnx-pyannote-segmentation-3-0/model.onnx")
        .is_file()
        && directory.join("embedding.onnx").is_file();

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    false
}

pub fn finalize_install(manager: &ModelInstallManager) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        let directory = manager.model_dir(MODEL_KEY);
        if !directory
            .join("sherpa-onnx-pyannote-segmentation-3-0/model.onnx")
            .is_file()
        {
            let archive_path = directory.join("segmentation.tar.bz2");
            let archive = std::fs::File::open(&archive_path)
                .with_context(|| format!("Failed to open {}", archive_path.display()))?;
            let decoder = bzip2::read::BzDecoder::new(archive);
            let mut archive = tar::Archive::new(decoder);
            archive
                .unpack(&directory)
                .context("Failed to unpack the local person detection model")?;
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = manager;
    Ok(())
}

pub fn run<R: Runtime>(app: &AppHandle<R>, audio_path: &Path) -> Result<Vec<Segment>> {
    let directory = model_dir(app)?;
    if !installation_complete(&directory) {
        return Err(anyhow!("Local person detection model is not installed"));
    }
    let (samples, sample_rate) = crate::transcribe::load_audio_for_transcription(audio_path)?;
    platform_run(&directory, &samples, sample_rate)
}

#[cfg(target_os = "macos")]
fn platform_run(directory: &Path, samples: &[i16], sample_rate: u32) -> Result<Vec<Segment>> {
    use std::ffi::{CStr, CString, c_char};

    unsafe extern "C" {
        fn glimpse_diarize_local(
            model_directory: *const c_char,
            samples: *const i16,
            sample_count: usize,
            sample_rate: i32,
        ) -> *mut c_char;
        fn glimpse_diarize_string_free(pointer: *mut c_char);
    }

    #[derive(Deserialize)]
    struct Response {
        segments: Vec<BridgeSegment>,
        error: Option<String>,
    }
    #[derive(Deserialize)]
    struct BridgeSegment {
        start: f64,
        end: f64,
        speaker: String,
    }

    let directory = CString::new(directory.to_string_lossy().as_bytes())?;
    let raw = unsafe {
        glimpse_diarize_local(
            directory.as_ptr(),
            samples.as_ptr(),
            samples.len(),
            sample_rate as i32,
        )
    };
    if raw.is_null() {
        return Err(anyhow!("Local person detection returned no result"));
    }
    let json = unsafe { CStr::from_ptr(raw) }
        .to_string_lossy()
        .into_owned();
    unsafe { glimpse_diarize_string_free(raw) };
    let response: Response = serde_json::from_str(&json)
        .context("Failed to decode the local person detection result")?;
    if let Some(error) = response.error {
        return Err(anyhow!(error));
    }
    Ok(response
        .segments
        .into_iter()
        .filter(|segment| segment.end > segment.start && !segment.speaker.trim().is_empty())
        .map(|segment| Segment {
            start_ms: (segment.start * 1000.0).max(0.0) as u64,
            end_ms: (segment.end * 1000.0).max(0.0) as u64,
            speaker: segment.speaker,
        })
        .collect())
}

#[cfg(target_os = "windows")]
fn platform_run(directory: &Path, samples: &[i16], sample_rate: u32) -> Result<Vec<Segment>> {
    use sherpa_onnx::{
        FastClusteringConfig, OfflineSpeakerDiarization, OfflineSpeakerDiarizationConfig,
        OfflineSpeakerSegmentationModelConfig, OfflineSpeakerSegmentationPyannoteModelConfig,
        SpeakerEmbeddingExtractorConfig,
    };

    let config = OfflineSpeakerDiarizationConfig {
        segmentation: OfflineSpeakerSegmentationModelConfig {
            pyannote: OfflineSpeakerSegmentationPyannoteModelConfig {
                model: Some(
                    directory
                        .join("sherpa-onnx-pyannote-segmentation-3-0/model.onnx")
                        .display()
                        .to_string(),
                ),
            },
            ..Default::default()
        },
        embedding: SpeakerEmbeddingExtractorConfig {
            model: Some(directory.join("embedding.onnx").display().to_string()),
            ..Default::default()
        },
        clustering: FastClusteringConfig {
            num_clusters: -1,
            threshold: 0.5,
        },
        ..Default::default()
    };
    let diarizer = OfflineSpeakerDiarization::create(&config)
        .ok_or_else(|| anyhow!("Failed to initialize local person detection"))?;
    if diarizer.sample_rate() != sample_rate as i32 {
        return Err(anyhow!(
            "Local person detection expected {} Hz audio, received {sample_rate} Hz",
            diarizer.sample_rate()
        ));
    }
    let float_samples: Vec<f32> = samples
        .iter()
        .map(|sample| *sample as f32 / i16::MAX as f32)
        .collect();
    let result = diarizer
        .process(&float_samples)
        .ok_or_else(|| anyhow!("Local person detection failed"))?;
    Ok(result
        .sort_by_start_time()
        .into_iter()
        .map(|segment| Segment {
            start_ms: (segment.start * 1000.0).max(0.0) as u64,
            end_ms: (segment.end * 1000.0).max(0.0) as u64,
            speaker: format!("speaker_{}", segment.speaker),
        })
        .collect())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn platform_run(_directory: &Path, _samples: &[i16], _sample_rate: u32) -> Result<Vec<Segment>> {
    Err(anyhow!(
        "Local person detection is unsupported on this platform"
    ))
}

pub fn apply_to_transcription<F>(
    result: &mut LibraryTranscriptionResult,
    diarization: &[Segment],
    mut person_name: F,
) where
    F: FnMut(usize) -> String,
{
    if diarization.is_empty() || result.segments.as_ref().is_none_or(Vec::is_empty) {
        return;
    }

    let diarization = stabilize_speaker_segments(diarization);

    let mut labels = Vec::<String>::new();
    for segment in &diarization {
        if !labels.iter().any(|label| label == &segment.speaker) {
            labels.push(segment.speaker.clone());
        }
    }
    let speakers: Vec<Speaker> = labels
        .iter()
        .enumerate()
        .map(|(index, _)| Speaker {
            id: format!("speaker_{}", index + 1),
            name: person_name(index + 1),
            color: None,
        })
        .collect();

    let assign = |segment: &mut TranscriptSegment| {
        let best = diarization.iter().max_by_key(|voice| {
            overlap_ms(
                segment.start_ms,
                segment.end_ms,
                voice.start_ms,
                voice.end_ms,
            )
        });
        let Some(best) = best.filter(|voice| {
            overlap_ms(
                segment.start_ms,
                segment.end_ms,
                voice.start_ms,
                voice.end_ms,
            ) > 0
        }) else {
            return;
        };
        if let Some(index) = labels.iter().position(|label| label == &best.speaker) {
            segment.speaker_id = Some(speakers[index].id.clone());
        }
    };

    if let Some(segments) = result.segments.as_mut() {
        segments.iter_mut().for_each(assign);
    }
    if let Some(words) = result.words.as_mut() {
        words.iter_mut().for_each(assign);
    }
    result.speakers = (!speakers.is_empty()).then_some(speakers);
}

#[derive(Debug)]
struct SpeakerEvidence {
    label: String,
    duration_ms: u64,
    turns: usize,
}

fn stabilize_speaker_segments(diarization: &[Segment]) -> Vec<Segment> {
    let mut segments = diarization.to_vec();
    segments.sort_by(|left, right| {
        left.start_ms
            .cmp(&right.start_ms)
            .then(left.end_ms.cmp(&right.end_ms))
            .then(left.speaker.cmp(&right.speaker))
    });

    let mut evidence = Vec::<SpeakerEvidence>::new();
    let mut previous_speaker: Option<&str> = None;
    for segment in &segments {
        let index = evidence
            .iter()
            .position(|entry| entry.label == segment.speaker)
            .unwrap_or_else(|| {
                evidence.push(SpeakerEvidence {
                    label: segment.speaker.clone(),
                    duration_ms: 0,
                    turns: 0,
                });
                evidence.len() - 1
            });
        evidence[index].duration_ms = evidence[index]
            .duration_ms
            .saturating_add(segment.end_ms.saturating_sub(segment.start_ms));
        if previous_speaker != Some(segment.speaker.as_str()) {
            evidence[index].turns += 1;
        }
        previous_speaker = Some(segment.speaker.as_str());
    }

    // With three or more detected people there is not enough evidence here to
    // decide which pair should be merged safely. Leave those results intact.
    if evidence.len() != 2 {
        return segments;
    }

    let dominant_index = usize::from(evidence[1].duration_ms > evidence[0].duration_ms);
    let weak_index = 1 - dominant_index;
    let dominant = &evidence[dominant_index];
    let weak = &evidence[weak_index];
    let total_duration = dominant.duration_ms.saturating_add(weak.duration_ms);
    let weak_share_is_small = weak.duration_ms.saturating_mul(100)
        <= total_duration.saturating_mul(WEAK_SPEAKER_MAX_SHARE_PERCENT);
    let weak_cluster_is_unreliable = weak.turns == 1
        && weak.duration_ms <= WEAK_SPEAKER_MAX_DURATION_MS
        && dominant.duration_ms >= WEAK_SPEAKER_MIN_DOMINANT_DURATION_MS
        && weak_share_is_small;

    if weak_cluster_is_unreliable {
        let weak_label = weak.label.clone();
        let dominant_label = dominant.label.clone();
        for segment in &mut segments {
            if segment.speaker == weak_label {
                segment.speaker.clone_from(&dominant_label);
            }
        }
    }

    segments
}

fn overlap_ms(left_start: u64, left_end: u64, right_start: u64, right_end: u64) -> u64 {
    left_end
        .min(right_end)
        .saturating_sub(left_start.max(right_start))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assigns_transcript_segments_by_greatest_overlap() {
        let mut result = LibraryTranscriptionResult {
            transcript: "hello there".to_string(),
            segments: Some(vec![
                TranscriptSegment {
                    start_ms: 0,
                    end_ms: 900,
                    text: "hello".to_string(),
                    speaker_id: None,
                },
                TranscriptSegment {
                    start_ms: 900,
                    end_ms: 2_000,
                    text: "there".to_string(),
                    speaker_id: None,
                },
            ]),
            words: None,
            speech_model: None,
            speakers: None,
        };
        apply_to_transcription(
            &mut result,
            &[
                Segment {
                    start_ms: 0,
                    end_ms: 1_000,
                    speaker: "a".to_string(),
                },
                Segment {
                    start_ms: 1_000,
                    end_ms: 2_000,
                    speaker: "b".to_string(),
                },
            ],
            |index| format!("Person {index}"),
        );

        let segments = result.segments.unwrap();
        assert_eq!(segments[0].speaker_id.as_deref(), Some("speaker_1"));
        assert_eq!(segments[1].speaker_id.as_deref(), Some("speaker_2"));
        assert_eq!(result.speakers.unwrap().len(), 2);
    }

    #[test]
    fn collapses_a_short_isolated_tail_cluster_into_the_dominant_person() {
        let stabilized = stabilize_speaker_segments(&[
            Segment {
                start_ms: 0,
                end_ms: 60_000,
                speaker: "a".to_string(),
            },
            Segment {
                start_ms: 60_000,
                end_ms: 61_000,
                speaker: "b".to_string(),
            },
            Segment {
                start_ms: 61_000,
                end_ms: 62_500,
                speaker: "b".to_string(),
            },
        ]);

        assert!(stabilized.iter().all(|segment| segment.speaker == "a"));
    }

    #[test]
    fn keeps_a_short_person_when_they_speak_in_multiple_turns() {
        let stabilized = stabilize_speaker_segments(&[
            Segment {
                start_ms: 0,
                end_ms: 10_000,
                speaker: "a".to_string(),
            },
            Segment {
                start_ms: 10_000,
                end_ms: 11_000,
                speaker: "b".to_string(),
            },
            Segment {
                start_ms: 11_000,
                end_ms: 21_000,
                speaker: "a".to_string(),
            },
            Segment {
                start_ms: 21_000,
                end_ms: 22_000,
                speaker: "b".to_string(),
            },
        ]);

        assert!(stabilized.iter().any(|segment| segment.speaker == "a"));
        assert!(stabilized.iter().any(|segment| segment.speaker == "b"));
    }

    #[test]
    fn keeps_a_substantial_single_turn_from_a_second_person() {
        let stabilized = stabilize_speaker_segments(&[
            Segment {
                start_ms: 0,
                end_ms: 30_000,
                speaker: "a".to_string(),
            },
            Segment {
                start_ms: 30_000,
                end_ms: 36_000,
                speaker: "b".to_string(),
            },
        ]);

        assert!(stabilized.iter().any(|segment| segment.speaker == "b"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "requires downloaded Core ML models and a WAV fixture"]
    fn macos_engine_smoke_test_from_environment() {
        let models = std::env::var("GLIMPSE_DIARIZATION_TEST_MODELS")
            .expect("GLIMPSE_DIARIZATION_TEST_MODELS must point to the model directory");
        let audio = std::env::var("GLIMPSE_DIARIZATION_TEST_AUDIO")
            .expect("GLIMPSE_DIARIZATION_TEST_AUDIO must point to a WAV file");
        let (samples, sample_rate) =
            crate::transcribe::load_audio_for_transcription(Path::new(&audio)).unwrap();
        let segments = platform_run(Path::new(&models), &samples, sample_rate).unwrap();
        assert!(!segments.is_empty());
        assert!(
            segments
                .iter()
                .all(|segment| segment.end_ms > segment.start_ms)
        );
        let speakers: std::collections::HashSet<_> =
            segments.iter().map(|segment| &segment.speaker).collect();
        assert!(speakers.len() >= 2, "expected at least two detected people");
    }
}
