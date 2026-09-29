//! Speaker audio the microphone picks up is transcribed on both tracks. The
//! microphone copy is found by matching words against the system track.

use super::types::{LibraryTranscriptionResult, TranscriptSegment};

// How far apart the two copies of a word may start. Covers speaker-to-mic
// latency plus timestamp jitter between the two transcriptions.
const MATCH_WINDOW_MS: u64 = 500;
// Neighbouring words further apart than this belong to different phrases.
const PHRASE_GAP_MS: u64 = 1500;
// Words either side of a word that decide whether it sits inside bleed.
const CONTEXT_WORDS: usize = 2;
// Share of matched words around a word for it to count as bleed. Tolerates
// the odd word the two transcriptions disagree on.
const BLEED_RATIO: f32 = 0.6;
// A lone longer word this close to its system copy is bleed too, but only once
// the recording shows other bleed. Short words are too likely to coincide.
const LONE_WORD_WINDOW_MS: u64 = 300;
const LONE_WORD_MIN_CHARS: usize = 4;
const LONE_WORD_MIN_BLEED: usize = 5;
// Segment fallback when a model gives no word timestamps.
const SEGMENT_OVERLAP_MS: u64 = 1000;
const SEGMENT_MATCH_RATIO: f32 = 0.7;
// System text further than this from microphone text can't match it.
pub(crate) const BLEED_REACH_MS: u64 = SEGMENT_OVERLAP_MS;

pub(super) fn remove_bleed(
    microphone: &mut LibraryTranscriptionResult,
    system: &LibraryTranscriptionResult,
) {
    remove_bleed_after(microphone, system, 0);
}

/// `remove_bleed` for a stretch of live microphone text and the system text
/// around it. `earlier_bleed` is the bleed words found so far in the session.
/// Returns how many of `words` were bleed.
pub(crate) fn remove_live_bleed(
    segments: &mut Vec<TranscriptSegment>,
    words: Vec<TranscriptSegment>,
    system_segments: Vec<TranscriptSegment>,
    system_words: Vec<TranscriptSegment>,
    earlier_bleed: usize,
) -> usize {
    let mut microphone = LibraryTranscriptionResult {
        segments: Some(std::mem::take(segments)),
        words: Some(words),
        ..Default::default()
    };
    let system = LibraryTranscriptionResult {
        segments: Some(system_segments),
        words: Some(system_words),
        ..Default::default()
    };
    let found = remove_bleed_after(&mut microphone, &system, earlier_bleed);
    *segments = microphone.segments.unwrap_or_default();
    found
}

fn remove_bleed_after(
    microphone: &mut LibraryTranscriptionResult,
    system: &LibraryTranscriptionResult,
    earlier_bleed: usize,
) -> usize {
    let mut found = 0;
    match (microphone.words.as_ref(), system.words.as_ref()) {
        (Some(mic_words), Some(system_words))
            if !mic_words.is_empty() && !system_words.is_empty() =>
        {
            let bleed = bleed_words(mic_words, system_words, earlier_bleed);
            found = bleed.iter().filter(|&&is_bleed| is_bleed).count();
            if found == 0 {
                return 0;
            }
            let mic_words = microphone.words.take().unwrap_or_default();
            if let Some(segments) = microphone.segments.take() {
                microphone.segments = Some(strip_segments(segments, &mic_words, &bleed));
            }
            microphone.words = Some(
                mic_words
                    .into_iter()
                    .zip(&bleed)
                    .filter(|(_, is_bleed)| !**is_bleed)
                    .map(|(word, _)| word)
                    .collect(),
            );
        }
        _ => {
            let (Some(segments), Some(system_segments)) =
                (microphone.segments.as_mut(), system.segments.as_ref())
            else {
                return 0;
            };
            segments.retain(|segment| !segment_is_bleed(segment, system_segments));
        }
    }
    if let Some(segments) = microphone.segments.as_ref() {
        microphone.transcript = segments
            .iter()
            .map(|segment| segment.text.trim())
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
    }
    found
}

fn bleed_words(
    mic_words: &[TranscriptSegment],
    system_words: &[TranscriptSegment],
    earlier_bleed: usize,
) -> Vec<bool> {
    let mut system: Vec<(u64, String)> = system_words
        .iter()
        .map(|word| (word.start_ms, normalize(&word.text)))
        .collect();
    system.sort_by_key(|(start_ms, _)| *start_ms);
    // Distance to the closest system copy of each microphone word.
    let offsets: Vec<Option<u64>> = mic_words
        .iter()
        .map(|word| {
            let text = normalize(&word.text);
            if text.is_empty() {
                return None;
            }
            let from =
                system.partition_point(|(start_ms, _)| *start_ms + MATCH_WINDOW_MS < word.start_ms);
            system[from..]
                .iter()
                .take_while(|(start_ms, _)| *start_ms <= word.start_ms + MATCH_WINDOW_MS)
                .filter(|(_, system_text)| *system_text == text)
                .map(|(start_ms, _)| start_ms.abs_diff(word.start_ms))
                .min()
        })
        .collect();

    let mut bleed: Vec<bool> = (0..mic_words.len())
        .map(|index| {
            let (first, last) = phrase_context(mic_words, index);
            let hits = offsets[first..=last]
                .iter()
                .filter(|hit| hit.is_some())
                .count();
            hits as f32 / (last - first + 1) as f32 >= BLEED_RATIO
        })
        .collect();
    if earlier_bleed + bleed.iter().filter(|&&is_bleed| is_bleed).count() >= LONE_WORD_MIN_BLEED {
        for (index, is_bleed) in bleed.iter_mut().enumerate() {
            *is_bleed = *is_bleed
                || (offsets[index].is_some_and(|offset| offset <= LONE_WORD_WINDOW_MS)
                    && normalize(&mic_words[index].text).chars().count() >= LONE_WORD_MIN_CHARS);
        }
    }
    bleed
}

/// Indices of the words around `index` that belong to the same phrase.
fn phrase_context(words: &[TranscriptSegment], index: usize) -> (usize, usize) {
    let mut first = index;
    while first > 0
        && index - first < CONTEXT_WORDS
        && words[first]
            .start_ms
            .saturating_sub(words[first - 1].end_ms)
            <= PHRASE_GAP_MS
    {
        first -= 1;
    }
    let mut last = index;
    while last + 1 < words.len()
        && last - index < CONTEXT_WORDS
        && words[last + 1].start_ms.saturating_sub(words[last].end_ms) <= PHRASE_GAP_MS
    {
        last += 1;
    }
    (first, last)
}

/// Rebuilds each segment from its surviving words. Segments with no word
/// timing inside them are left alone.
fn strip_segments(
    segments: Vec<TranscriptSegment>,
    words: &[TranscriptSegment],
    bleed: &[bool],
) -> Vec<TranscriptSegment> {
    let segment_count = segments.len();
    segments
        .into_iter()
        .enumerate()
        .filter_map(|(position, segment)| {
            let is_last = position + 1 == segment_count;
            let inside: Vec<usize> = (0..words.len())
                .filter(|&index| {
                    let start = words[index].start_ms;
                    start >= segment.start_ms && (start < segment.end_ms || is_last)
                })
                .collect();
            if inside.is_empty() || inside.iter().all(|&index| !bleed[index]) {
                return Some(segment);
            }
            let kept: Vec<&TranscriptSegment> = inside
                .iter()
                .filter(|&&index| !bleed[index])
                .map(|&index| &words[index])
                .collect();
            let (first, last) = (kept.first()?, kept.last()?);
            Some(TranscriptSegment {
                start_ms: first.start_ms,
                end_ms: last.end_ms,
                text: kept
                    .iter()
                    .map(|word| word.text.trim())
                    .collect::<Vec<_>>()
                    .join(" "),
                speaker_id: segment.speaker_id,
            })
        })
        .collect()
}

fn segment_is_bleed(segment: &TranscriptSegment, system_segments: &[TranscriptSegment]) -> bool {
    let words = tokens(&segment.text);
    if words.is_empty() {
        return false;
    }
    let mut pool: Vec<String> = system_segments
        .iter()
        .filter(|other| {
            other.start_ms <= segment.end_ms + SEGMENT_OVERLAP_MS
                && segment.start_ms <= other.end_ms + SEGMENT_OVERLAP_MS
        })
        .flat_map(|other| tokens(&other.text))
        .collect();
    let hits = words
        .iter()
        .filter(|token| {
            pool.iter()
                .position(|candidate| candidate == *token)
                .map(|found| pool.swap_remove(found))
                .is_some()
        })
        .count();
    hits as f32 / words.len() as f32 >= SEGMENT_MATCH_RATIO
}

pub(super) fn normalize(word: &str) -> String {
    word.chars()
        .filter(|ch| ch.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn tokens(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(normalize)
        .filter(|token| !token.is_empty())
        .collect()
}
