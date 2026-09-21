//! Local speaker diarization for Library items. Each audio track is diarized
//! as a whole, then segments and words take the speaker they overlap most.

use std::path::Path;

use anyhow::{Result, anyhow};
use glimpse_speech::diarization::{self, SpeakerTurn};

use super::processing::read_wav_resampled;
use super::types::{
    LibraryItem, LibraryTranscriptionResult, Speaker, TARGET_SAMPLE_RATE, TranscriptSegment,
};

const MICROPHONE_SPEAKER: &str = "you";
const SYSTEM_SPEAKER: &str = "others";

/// The speakers a two-track recording starts with: microphone, then system audio.
pub(super) fn recording_speakers() -> [Speaker; 2] {
    [
        Speaker {
            id: MICROPHONE_SPEAKER.to_string(),
            name: "You".to_string(),
            color: Some("#7aa2f7".to_string()),
        },
        Speaker {
            id: SYSTEM_SPEAKER.to_string(),
            name: "Others".to_string(),
            color: Some("#9ece6a".to_string()),
        },
    ]
}

/// The item's speaker for a recording track, keeping a name the user gave it.
pub(super) fn track_speaker(item: &LibraryItem, default: Speaker) -> Speaker {
    item.speakers
        .iter()
        .flatten()
        .find(|speaker| speaker.id == default.id)
        .cloned()
        .unwrap_or(default)
}

/// Runs the diarizer over a whole audio file so labels stay consistent across it.
pub(super) fn diarize_file(model_path: &Path, audio_path: &Path) -> Result<Vec<SpeakerTurn>> {
    // The diarizer resamples to 16 kHz anyway; decoding straight to it keeps the buffer small.
    let samples = read_wav_resampled(audio_path, TARGET_SAMPLE_RATE)?;
    // Settings have no GPU preference; local transcription picks its backend automatically too.
    diarization::diarize(model_path, &samples, TARGET_SAMPLE_RATE, true)
        .map_err(|err| anyhow!("Speaker detection failed: {err}"))
}

/// Who spoke when in one transcribed track: the remote provider's own split
/// when it made one, otherwise the local diarizer. A diarizer failure is
/// logged and only costs the speaker split.
pub(super) fn track_turns(
    result: &LibraryTranscriptionResult,
    audio_path: &Path,
    diarizer: Option<&Path>,
) -> Option<Vec<SpeakerTurn>> {
    if let Some(turns) = remote_turns(result) {
        return Some(turns);
    }
    let model_path = diarizer?;
    if result.segments.as_ref().is_none_or(Vec::is_empty) {
        return None;
    }
    match diarize_file(model_path, audio_path) {
        Ok(turns) => Some(turns),
        Err(err) => {
            tracing::warn!("[library] {err}");
            None
        }
    }
}

fn remote_turns(result: &LibraryTranscriptionResult) -> Option<Vec<SpeakerTurn>> {
    let speakers = result.speakers.as_ref()?;
    let segments = result.segments.as_ref()?;
    Some(
        segments
            .iter()
            .filter_map(|segment| {
                let index = speakers
                    .iter()
                    .position(|speaker| segment.speaker_id.as_ref() == Some(&speaker.id))?;
                Some(SpeakerTurn {
                    start_ms: segment.start_ms,
                    end_ms: segment.end_ms,
                    speaker: index as u32 + 1,
                })
            })
            .collect(),
    )
}

/// One audio track's transcript, who spoke when in it, and the speaker the
/// whole track gets when it holds a single voice (None leaves it unlabeled).
pub(super) struct Track<'a> {
    pub result: &'a mut LibraryTranscriptionResult,
    pub turns: Option<Vec<SpeakerTurn>>,
    pub identity: Option<Speaker>,
}

/// Labels every track's segments and words and returns the item's speakers.
/// A track with more than one voice gets numbered speakers, counted across
/// all tracks so labels never collide.
pub(super) fn label_tracks<'a>(
    tracks: impl IntoIterator<Item = Track<'a>>,
) -> Option<Vec<Speaker>> {
    let mut speakers = Vec::new();
    let mut next_number = 1;
    for track in tracks {
        // Leftover bleed can register as a stray voice on a recording track.
        let (segment_voices, word_voices) = match track.turns.as_deref() {
            Some(turns) if !turns.is_empty() => {
                assign_voices(track.result, turns, track.identity.is_some())
            }
            _ => (Vec::new(), Vec::new()),
        };
        let mut voices: Vec<u32> = Vec::new();
        for &voice in segment_voices.iter().chain(&word_voices).flatten() {
            if !voices.contains(&voice) {
                voices.push(voice);
            }
        }

        if voices.len() < 2 {
            let id = track.identity.as_ref().map(|speaker| speaker.id.clone());
            let mut spoke = false;
            for entry in entries(track.result) {
                entry.speaker_id = id.clone();
                spoke = true;
            }
            // A silent track adds no speaker.
            if spoke {
                speakers.extend(track.identity);
            }
            continue;
        }

        // Track-prefixed ids let a re-run split a recording back into its tracks.
        let prefix = track
            .identity
            .as_ref()
            .map_or("speaker", |speaker| speaker.id.as_str());
        let ids: Vec<String> = voices
            .iter()
            .map(|_| {
                let id = format!("{prefix}_{next_number}");
                speakers.push(Speaker {
                    id: id.clone(),
                    name: format!("Speaker {next_number}"),
                    color: None,
                });
                next_number += 1;
                id
            })
            .collect();
        let id_of = |voice: Option<u32>| {
            voice
                .and_then(|voice| voices.iter().position(|&known| known == voice))
                .map(|index| ids[index].clone())
        };
        for (segment, voice) in track
            .result
            .segments
            .iter_mut()
            .flatten()
            .zip(segment_voices)
        {
            segment.speaker_id = id_of(voice);
        }
        for (word, voice) in track.result.words.iter_mut().flatten().zip(word_voices) {
            word.speaker_id = id_of(voice);
        }
    }
    (!speakers.is_empty()).then_some(speakers)
}

/// Maps voices holding under 5% of `voices` to the most common one.
fn fold_minor_voices(voices: &[Option<u32>]) -> impl Fn(Option<u32>) -> Option<u32> {
    let mut counts: Vec<(u32, usize)> = Vec::new();
    for &voice in voices.iter().flatten() {
        match counts.iter_mut().find(|(known, _)| *known == voice) {
            Some((_, count)) => *count += 1,
            None => counts.push((voice, 1)),
        }
    }
    let total: usize = counts.iter().map(|(_, count)| count).sum();
    let main = counts
        .iter()
        .max_by_key(|(_, count)| *count)
        .map(|&(voice, _)| voice);
    let minor: Vec<u32> = counts
        .iter()
        .filter(|(_, count)| count * 20 < total)
        .map(|(voice, _)| *voice)
        .collect();
    move |voice| match voice {
        Some(voice) if minor.contains(&voice) => main,
        voice => voice,
    }
}

fn entries(
    result: &mut LibraryTranscriptionResult,
) -> impl Iterator<Item = &mut TranscriptSegment> {
    result
        .segments
        .iter_mut()
        .flatten()
        .chain(result.words.iter_mut().flatten())
}

/// Gives every word and segment its dominant voice. A segment whose words
/// change voice is split at each change, rebuilt from those words. With
/// `fold_minor`, minor voices fold into the main one before any split.
fn assign_voices(
    result: &mut LibraryTranscriptionResult,
    turns: &[SpeakerTurn],
    fold_minor: bool,
) -> (Vec<Option<u32>>, Vec<Option<u32>>) {
    let mut words = result.words.take().unwrap_or_default();
    words.sort_by_key(|word| (word.start_ms, word.end_ms));
    let mut segments = result.segments.take().unwrap_or_default();
    segments.sort_by_key(|segment| (segment.start_ms, segment.end_ms));
    let mut word_voices: Vec<Option<u32>> = words
        .iter()
        .map(|word| voice_at(turns, word.start_ms, word.end_ms))
        .collect();
    // Voices are counted by word, or by segment when there are no words.
    let counted: Vec<Option<u32>> = match (fold_minor, words.is_empty()) {
        (false, _) => Vec::new(),
        (true, false) => word_voices.clone(),
        (true, true) => segments
            .iter()
            .map(|segment| voice_at(turns, segment.start_ms, segment.end_ms))
            .collect(),
    };
    let fold = fold_minor_voices(&counted);
    for voice in &mut word_voices {
        *voice = fold(*voice);
    }

    let mut split = Vec::with_capacity(segments.len());
    let mut segment_voices = Vec::with_capacity(segments.len());
    let mut next_word = 0;
    for (position, segment) in segments.iter().enumerate() {
        // Each word belongs to the last segment starting at or before it.
        let end = match segments.get(position + 1) {
            Some(next) => words.partition_point(|word| word.start_ms < next.start_ms),
            None => words.len(),
        };
        let own = next_word..end.max(next_word);
        next_word = own.end;
        if own.is_empty() {
            segment_voices.push(fold(voice_at(turns, segment.start_ms, segment.end_ms)));
            split.push(segment.clone());
            continue;
        }

        // A lone word between two words of the same voice is boundary jitter.
        for index in own.start + 1..own.end - 1 {
            if word_voices[index - 1] == word_voices[index + 1] {
                word_voices[index] = word_voices[index - 1];
            }
        }
        let mut runs: Vec<(usize, usize)> = Vec::new();
        for index in own.clone() {
            match runs.last_mut() {
                Some((_, last)) if word_voices[*last] == word_voices[index] => *last = index,
                _ => runs.push((index, index)),
            }
        }
        if runs.len() == 1 {
            segment_voices.push(word_voices[own.start]);
            split.push(segment.clone());
            continue;
        }
        let run_count = runs.len();
        for (run_index, (first, last)) in runs.into_iter().enumerate() {
            segment_voices.push(word_voices[first]);
            split.push(TranscriptSegment {
                start_ms: if run_index == 0 {
                    segment.start_ms
                } else {
                    words[first].start_ms
                },
                end_ms: if run_index + 1 == run_count {
                    segment.end_ms
                } else {
                    words[last].end_ms
                },
                text: words[first..=last]
                    .iter()
                    .map(|word| word.text.trim())
                    .collect::<Vec<_>>()
                    .join(" "),
                speaker_id: None,
            });
        }
    }

    result.segments = (!split.is_empty()).then_some(split);
    result.words = (!words.is_empty()).then_some(words);
    (segment_voices, word_voices)
}

/// The voice with the most overlap, or the closest turn when nothing overlaps.
fn voice_at(turns: &[SpeakerTurn], start_ms: u64, end_ms: u64) -> Option<u32> {
    let mut totals: Vec<(u32, u64)> = Vec::new();
    for turn in turns {
        let overlap = turn
            .end_ms
            .min(end_ms)
            .saturating_sub(turn.start_ms.max(start_ms));
        if overlap == 0 {
            continue;
        }
        match totals.iter_mut().find(|(voice, _)| *voice == turn.speaker) {
            Some((_, total)) => *total += overlap,
            None => totals.push((turn.speaker, overlap)),
        }
    }
    if let Some(&(voice, _)) = totals.iter().max_by_key(|(_, total)| *total) {
        return Some(voice);
    }
    turns
        .iter()
        .min_by_key(|turn| {
            if turn.end_ms <= start_ms {
                start_ms - turn.end_ms
            } else {
                turn.start_ms.saturating_sub(end_ms)
            }
        })
        .map(|turn| turn.speaker)
}

pub(super) struct Rediarized {
    pub segments: Vec<TranscriptSegment>,
    pub words: Option<Vec<TranscriptSegment>>,
    pub speakers: Option<Vec<Speaker>>,
}

/// Re-runs diarization on a finished item's stored transcript and audio.
pub(super) fn rediarize(item: &LibraryItem, model_path: &Path) -> Result<Rediarized> {
    let segments = item
        .segments
        .clone()
        .filter(|segments| !segments.is_empty())
        .ok_or_else(|| anyhow!("This transcript has no timestamps to match speakers to"))?;
    let words = item.words.clone().unwrap_or_default();
    let track = |segments: Vec<TranscriptSegment>, words: Vec<TranscriptSegment>| {
        LibraryTranscriptionResult {
            segments: Some(segments),
            words: Some(words),
            ..Default::default()
        }
    };

    let Some(secondary) = item.secondary_audio_path.as_deref() else {
        let mut result = track(segments, words);
        let turns = diarize_file(model_path, Path::new(&item.audio_path))?;
        let speakers = label_tracks([Track {
            result: &mut result,
            turns: Some(turns),
            identity: None,
        }]);
        return Ok(Rediarized {
            segments: result.segments.unwrap_or_default(),
            words: result.words,
            speakers,
        });
    };

    let (system_words, microphone_words): (Vec<_>, Vec<_>) = words
        .into_iter()
        .partition(|word| from_system_track(word.speaker_id.as_deref()) == Some(true));
    // Segments can be reassigned by hand but words keep their track, so a
    // segment goes with the track whose word starts closest to it. Segment
    // ends can run far past the speech, so only the start is compared.
    let nearest_start = |words: &[TranscriptSegment], segment: &TranscriptSegment| {
        let index = words.partition_point(|word| word.start_ms < segment.start_ms);
        [index.checked_sub(1), Some(index)]
            .into_iter()
            .flatten()
            .filter_map(|index| words.get(index))
            .map(|word| word.start_ms.abs_diff(segment.start_ms))
            .min()
    };
    let (system_segments, microphone_segments): (Vec<_>, Vec<_>) =
        segments.into_iter().partition(|segment| {
            match (
                nearest_start(&system_words, segment),
                nearest_start(&microphone_words, segment),
            ) {
                (Some(system), Some(microphone)) if system != microphone => system < microphone,
                (Some(_), None) => true,
                (None, Some(_)) => false,
                _ => from_system_track(segment.speaker_id.as_deref()).unwrap_or(false),
            }
        });
    // A track with nothing transcribed has nothing to label.
    let turns_for = |segments: &[TranscriptSegment], path: &Path| {
        (!segments.is_empty())
            .then(|| diarize_file(model_path, path))
            .transpose()
    };
    let microphone_turns = turns_for(&microphone_segments, Path::new(&item.audio_path))?;
    let system_turns = turns_for(&system_segments, Path::new(secondary))?;
    let mut microphone = track(microphone_segments, microphone_words);
    let mut system = track(system_segments, system_words);
    let [you, others] = recording_speakers();
    let speakers = label_tracks([
        Track {
            result: &mut microphone,
            turns: microphone_turns,
            identity: Some(track_speaker(item, you)),
        },
        Track {
            result: &mut system,
            turns: system_turns,
            identity: Some(track_speaker(item, others)),
        },
    ]);

    let mut segments = microphone.segments.unwrap_or_default();
    segments.extend(system.segments.unwrap_or_default());
    segments.sort_by_key(|segment| (segment.start_ms, segment.end_ms));
    let mut words = microphone.words.unwrap_or_default();
    words.extend(system.words.unwrap_or_default());
    words.sort_by_key(|word| (word.start_ms, word.end_ms));
    Ok(Rediarized {
        segments,
        words: (!words.is_empty()).then_some(words),
        speakers,
    })
}

/// Which recording track a speaker id belongs to, when the id says so.
fn from_system_track(speaker_id: Option<&str>) -> Option<bool> {
    let id = speaker_id?;
    let belongs = |track: &str| {
        id == track
            || id
                .strip_prefix(track)
                .is_some_and(|rest| rest.starts_with('_'))
    };
    if belongs(SYSTEM_SPEAKER) {
        Some(true)
    } else if belongs(MICROPHONE_SPEAKER) {
        Some(false)
    } else {
        None
    }
}
