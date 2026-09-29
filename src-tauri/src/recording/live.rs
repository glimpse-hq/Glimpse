//! Live transcript of a recording in progress, a preview only: the Library job
//! still transcribes the saved tracks. Each track is cut into short windows at
//! pauses and transcribed through the dictation model, never while dictation
//! runs. System audio is split by voice when the Nemotron-3 diarizer is installed.

use std::{
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

use crossbeam_channel::{Receiver, Sender, TryRecvError, bounded};
use glimpse_speech::diarization::{LiveDiarizer, SpeakerTurn};
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use webrtc_vad::{SampleRate as VadSampleRate, Vad, VadMode};

use super::Shared;
use super::track::{LIVE_RATE, LiveTap};
use crate::library::{BLEED_REACH_MS, LiveSpeakerHints, LiveTurn, Speaker, TranscriptSegment};
use crate::model_manager::{LocalModelEngine, ReadyModel};
use crate::{AppRuntime, AppState};

pub const EVENT_TRANSCRIPT: &str = "recording-session:transcript";

const TICK: Duration = Duration::from_millis(250);
const EMIT_INTERVAL: Duration = Duration::from_millis(250);
const MANIFEST_INTERVAL: Duration = Duration::from_secs(10);
// 30 ms at 16 kHz, a frame size the VAD accepts.
const FRAME: usize = 480;
const FRAME_MS: u64 = 30;
const MIN_SPEECH_FRAMES: usize = 5;
// A pause this long (600 ms) ends a window.
const GAP_FRAMES: usize = 20;
// Audio kept around speech when a window is cut or silence is dropped.
const TAIL_FRAMES: usize = 10;
const MAX_WINDOW_FRAMES: usize = 500;
const MIN_WINDOW_FRAMES: usize = 100;
// Longest a live pass may hold the transcriber, which a dictation waits on.
// Windows start short and grow while they fit (15 s takes about 0.2 s on an
// M2 Pro). Whisper pads every pass to 30 s, so its length changes nothing.
const LOCK_BUDGET: Duration = Duration::from_millis(500);
// About 2 s of new audio before an open window is transcribed again.
const OPEN_STEP_FRAMES: usize = 67;
const SILENCE_DROP_FRAMES: usize = 67;
// Untranscribed speech past this (6 s) reports catching up.
const BEHIND_FRAMES: usize = 200;
// Audio waiting for live work is capped at 5 minutes per track.
const MAX_BACKLOG_FRAMES: usize = 10_000;
const MIN_TURN_MS: u64 = 300;
const DIARIZE_STEP: usize = LIVE_RATE as usize;
// About -35 dBFS on the level meter.
const SPEAKING_LEVEL: f32 = 0.67;
const SPEAKING_HOLD: Duration = Duration::from_millis(600);
// System audio this far behind the microphone counts as silence. A source
// with nothing to render can stop delivering.
const STALL_MS: u64 = 500;

const MICROPHONE_ID: &str = "you";
const SYSTEM_ID: &str = "others";
const NUMBERED_PREFIX: &str = "others_";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LiveStatus {
    #[default]
    Off,
    Starting,
    Live,
    CatchingUp,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LiveSegment {
    pub id: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub speaker_id: String,
    pub settled: bool,
}

/// `segments` replaces the receiver's list from `from_index` on. Snapshots
/// from `get_live_transcript` start at 0.
#[derive(Debug, Clone, Default, Serialize)]
pub struct LiveTranscript {
    pub revision: u64,
    pub from_index: usize,
    pub segments: Vec<LiveSegment>,
    pub speakers: Vec<Speaker>,
    pub active_speaker_id: Option<String>,
    pub status: LiveStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Source {
    Microphone,
    System,
}

impl Source {
    fn index(self) -> usize {
        match self {
            Source::Microphone => 0,
            Source::System => 1,
        }
    }
}

type SystemText = (Vec<TranscriptSegment>, Vec<TranscriptSegment>);

/// One transcribed window, times on the session timeline.
struct Piece {
    source: Source,
    start_ms: u64,
    segments: Vec<TranscriptSegment>,
    words: Vec<TranscriptSegment>,
    // Fixed for a system window once every turn under it has settled.
    voices: Option<Vec<(TranscriptSegment, Option<u32>)>>,
    // Microphone text waiting for the system track to be transcribed past
    // it, so speaker audio it picked up can be removed first.
    held: bool,
    // What stays on screen for this window while it is held.
    shown: Vec<TranscriptSegment>,
}

impl Piece {
    fn speech_start_ms(&self) -> u64 {
        self.segments
            .iter()
            .map(|s| s.start_ms)
            .min()
            .unwrap_or(self.start_ms)
    }

    fn end_ms(&self) -> u64 {
        self.segments.iter().map(|s| s.end_ms).max().unwrap_or(0)
    }

    fn into_shown(self) -> Vec<TranscriptSegment> {
        if self.held { self.shown } else { self.segments }
    }

    /// Segments and words of the system pieces close enough to match this one.
    fn system_near(&self, pieces: &[Piece]) -> SystemText {
        let (start_ms, end_ms) = (self.speech_start_ms(), self.end_ms());
        let nearby = pieces.iter().filter(|piece| {
            piece.source == Source::System
                && piece.start_ms <= end_ms + BLEED_REACH_MS
                && piece.end_ms() + BLEED_REACH_MS >= start_ms
        });
        let segments = nearby
            .clone()
            .flat_map(|piece| piece.segments.iter().cloned())
            .collect();
        let words = nearby
            .flat_map(|piece| piece.words.iter().cloned())
            .collect();
        (segments, words)
    }

    /// Shows a held piece without the words the system track also has.
    /// Returns how many words were removed.
    fn release(&mut self, (segments, words): SystemText, earlier_bleed: usize) -> usize {
        self.held = false;
        self.shown = Vec::new();
        crate::library::remove_live_bleed(
            &mut self.segments,
            std::mem::take(&mut self.words),
            segments,
            words,
            earlier_bleed,
        )
    }
}

#[derive(Default)]
pub(super) struct LiveState {
    requested: AtomicBool,
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    microphone: bool,
    system: bool,
    status: LiveStatus,
    pieces: Vec<Piece>,
    open: [Option<Piece>; 2],
    // System-track turns on the session timeline, short ones dropped.
    turns: Vec<SpeakerTurn>,
    // Where the running diarizer's turns start in `turns`.
    epoch_from: usize,
    settled_ms: u64,
    diarizing: bool,
    edits: Vec<Speaker>,
    merges: Vec<Merge>,
    active: Option<String>,
    last: LiveTranscript,
    // Microphone words found to be speaker audio this session.
    bleed_words: usize,
    // Where microphone text still to be matched against system words can start.
    microphone_from_ms: u64,
}

/// A system voice the user merged into another speaker. `None` is system
/// text without a voice, shown as Others.
struct Merge {
    voice: Option<u32>,
    into: MergeTarget,
}

#[derive(Clone, Copy)]
enum MergeTarget {
    Voice(u32),
    Id(&'static str),
}

impl LiveState {
    pub(super) fn set_requested(&self, enabled: bool) {
        self.requested.store(enabled, Ordering::Relaxed);
    }

    /// The last published transcript, in full.
    pub(super) fn last(&self) -> LiveTranscript {
        self.inner.lock().last.clone()
    }

    fn begin(&self, microphone: bool, system: bool) {
        let mut inner = self.inner.lock();
        let revision = inner.last.revision;
        *inner = Inner {
            microphone,
            system,
            ..Default::default()
        };
        inner.last.revision = revision;
    }

    /// Drops the session's transcript once it is saved or discarded. The next
    /// recording transcribes live only if the live view opens for it.
    pub(super) fn end(&self) {
        self.requested.store(false, Ordering::Relaxed);
        self.begin(false, false);
    }

    /// Emits what changed since the last publish, if anything, or always with `force`.
    pub(super) fn publish(&self, app: &AppHandle<AppRuntime>, force: bool) {
        let mut inner = self.inner.lock();
        let segments = inner.segments();
        let speakers = inner.speakers(&segments);
        let last = &inner.last;
        let from_index = last
            .segments
            .iter()
            .zip(&segments)
            .position(|(sent, next)| sent != next)
            .unwrap_or(last.segments.len().min(segments.len()));
        let unchanged = from_index == segments.len()
            && segments.len() == last.segments.len()
            && speakers == last.speakers
            && inner.active == last.active_speaker_id
            && inner.status == last.status;
        if unchanged && !force {
            return;
        }
        let revision = last.revision + 1;
        let event = LiveTranscript {
            revision,
            from_index,
            segments: segments[from_index..].to_vec(),
            speakers: speakers.clone(),
            active_speaker_id: inner.active.clone(),
            status: inner.status,
        };
        inner.last = LiveTranscript {
            revision,
            from_index: 0,
            segments,
            speakers,
            active_speaker_id: inner.active.clone(),
            status: inner.status,
        };
        drop(inner);
        let _ = app.emit(EVENT_TRANSCRIPT, event);
    }

    /// An empty name restores the default. False for an unknown speaker.
    pub(super) fn rename(&self, id: &str, name: &str) -> bool {
        let mut inner = self.inner.lock();
        let Some(default) = default_speaker(id) else {
            return false;
        };
        let name = name.trim();
        let name = if name.is_empty() {
            default.name
        } else {
            name.to_string()
        };
        inner.edit(id).name = name;
        true
    }

    pub(super) fn set_color(&self, id: &str, color: Option<String>) -> bool {
        let mut inner = self.inner.lock();
        if default_speaker(id).is_none() {
            return false;
        }
        inner.edit(id).color = color;
        true
    }

    /// Relabels a system speaker as another one for the rest of the session,
    /// including voices the diarizer attributes to it later. Both must be
    /// listed speakers, and You can't be merged away.
    pub(super) fn merge(&self, from: &str, into: &str) -> bool {
        let mut inner = self.inner.lock();
        let segments = inner.segments();
        let listed = inner.speakers(&segments);
        let is_listed = |id: &str| listed.iter().any(|speaker| speaker.id == id);
        if from == into || from == MICROPHONE_ID || !is_listed(from) || !is_listed(into) {
            return false;
        }
        let voices = voice_order(&inner.turns);
        let voice_of = |id: &str| {
            let number: usize = id.strip_prefix(NUMBERED_PREFIX)?.parse().ok()?;
            voices.get(number.checked_sub(1)?).copied()
        };
        let target = match into {
            MICROPHONE_ID => MergeTarget::Id(MICROPHONE_ID),
            SYSTEM_ID => MergeTarget::Id(SYSTEM_ID),
            _ => match voice_of(into) {
                Some(voice) => MergeTarget::Voice(voice),
                None => return false,
            },
        };
        // Others stands for voiceless text, and for the only voice before any are numbered.
        let merged: Vec<Option<u32>> = match from {
            SYSTEM_ID if voices.len() < 2 => {
                voices.iter().copied().map(Some).chain([None]).collect()
            }
            SYSTEM_ID => vec![None],
            _ => match voice_of(from) {
                Some(voice) => vec![Some(voice)],
                None => return false,
            },
        };
        inner.merges.retain(|merge| !merged.contains(&merge.voice));
        inner.merges.extend(merged.into_iter().map(|voice| Merge {
            voice,
            into: target,
        }));
        true
    }

    /// Edited and merged-into speakers and, when there are any, the system
    /// turns they map onto.
    pub(super) fn hints(&self) -> LiveSpeakerHints {
        let inner = self.inner.lock();
        if inner.edits.is_empty() && inner.merges.is_empty() {
            return LiveSpeakerHints::default();
        }
        let voices = voice_order(&inner.turns);
        let mut merged_into: Vec<String> = Vec::new();
        for merge in &inner.merges {
            let id = inner.label(&voices, merge.voice);
            if !merged_into.contains(&id) {
                merged_into.push(id);
            }
        }
        LiveSpeakerHints {
            speakers: inner.edits.clone(),
            turns: inner
                .turns
                .iter()
                .map(|turn| LiveTurn {
                    start_ms: turn.start_ms,
                    end_ms: turn.end_ms,
                    speaker_id: inner.label(&voices, Some(turn.speaker)),
                })
                .collect(),
            merged_into,
        }
    }
}

impl Inner {
    /// The speaker id for system text in `voice`, after merges.
    fn label(&self, voices: &[u32], voice: Option<u32>) -> String {
        let mut voice = voice;
        // Merges only target listed speakers, so chains end; the bound is a guard.
        for _ in 0..=self.merges.len() {
            match self.merges.iter().find(|merge| merge.voice == voice) {
                Some(Merge {
                    into: MergeTarget::Id(id),
                    ..
                }) => return id.to_string(),
                Some(Merge {
                    into: MergeTarget::Voice(next),
                    ..
                }) => voice = Some(*next),
                None => break,
            }
        }
        system_speaker_id(voices, voice)
    }

    fn edit(&mut self, id: &str) -> &mut Speaker {
        let index = match self.edits.iter().position(|speaker| speaker.id == id) {
            Some(index) => index,
            None => {
                let speaker = default_speaker(id).expect("known speaker id");
                self.edits.push(speaker);
                self.edits.len() - 1
            }
        };
        &mut self.edits[index]
    }

    fn segments(&mut self) -> Vec<LiveSegment> {
        let voices = voice_order(&self.turns);
        // Once voices are numbered, Others' name goes to the first of them.
        if voices.len() > 1
            && !self
                .edits
                .iter()
                .any(|s| s.id == format!("{NUMBERED_PREFIX}1"))
            && let Some(others) = self.edits.iter().find(|s| s.id == SYSTEM_ID)
        {
            self.edits.push(Speaker {
                id: format!("{NUMBERED_PREFIX}1"),
                ..others.clone()
            });
        }
        let (turns, settled_ms, diarizing) = (&self.turns, self.settled_ms, self.diarizing);
        for piece in &mut self.pieces {
            if piece.source == Source::System
                && piece.voices.is_none()
                && (!diarizing || piece.end_ms() <= settled_ms)
            {
                piece.voices = Some(piece_voices(piece, turns));
            }
            if piece.voices.is_some() && piece.end_ms() + BLEED_REACH_MS < self.microphone_from_ms {
                piece.words = Vec::new();
            }
        }

        let mut segments = Vec::new();
        let committed = self.pieces.iter().map(|piece| (piece, true));
        let open = self.open.iter().flatten().map(|piece| (piece, false));
        for (piece, committed) in committed.chain(open) {
            let prefix = match piece.source {
                Source::Microphone => 'm',
                Source::System => 's',
            };
            let labeled = match (&piece.voices, piece.source) {
                (Some(fixed), _) => fixed.clone(),
                (None, Source::System) => piece_voices(piece, &self.turns),
                (None, Source::Microphone) => {
                    let shown = if piece.held {
                        &piece.shown
                    } else {
                        &piece.segments
                    };
                    shown.iter().map(|s| (s.clone(), None)).collect()
                }
            };
            let settled = committed
                && !piece.held
                && (piece.source == Source::Microphone || piece.voices.is_some());
            for (index, (segment, voice)) in labeled.into_iter().enumerate() {
                segments.push(LiveSegment {
                    id: format!("{prefix}{}-{index}", piece.start_ms),
                    start_ms: segment.start_ms,
                    end_ms: segment.end_ms,
                    text: segment.text,
                    speaker_id: match piece.source {
                        Source::Microphone => MICROPHONE_ID.to_string(),
                        Source::System => self.label(&voices, voice),
                    },
                    settled,
                });
            }
        }
        segments.sort_by_key(|segment| (segment.start_ms, segment.end_ms));
        segments
    }

    fn speakers(&self, segments: &[LiveSegment]) -> Vec<Speaker> {
        let mut ids: Vec<&str> = Vec::new();
        if self.microphone {
            ids.push(MICROPHONE_ID);
        }
        let others_merged = self.merges.iter().any(|merge| merge.voice.is_none());
        if self.system && !others_merged && voice_order(&self.turns).len() < 2 {
            ids.push(SYSTEM_ID);
        }
        for segment in segments {
            if !ids.contains(&segment.speaker_id.as_str()) {
                ids.push(&segment.speaker_id);
            }
        }
        ids.sort_by_key(|id| speaker_rank(id));
        ids.into_iter()
            .filter_map(|id| {
                self.edits
                    .iter()
                    .find(|speaker| speaker.id == id)
                    .cloned()
                    .or_else(|| default_speaker(id))
            })
            .collect()
    }

    /// The system speaker of the latest turn, or Others before any.
    fn latest_system_id(&self) -> String {
        let latest = self.turns.iter().max_by_key(|turn| turn.end_ms);
        self.label(&voice_order(&self.turns), latest.map(|turn| turn.speaker))
    }
}

fn piece_voices(piece: &Piece, turns: &[SpeakerTurn]) -> Vec<(TranscriptSegment, Option<u32>)> {
    if turns.is_empty() {
        return piece.segments.iter().map(|s| (s.clone(), None)).collect();
    }
    crate::library::voiced_segments(piece.segments.clone(), piece.words.clone(), turns)
}

/// Voices in order of first appearance.
fn voice_order(turns: &[SpeakerTurn]) -> Vec<u32> {
    let mut voices = Vec::new();
    for turn in turns {
        if !voices.contains(&turn.speaker) {
            voices.push(turn.speaker);
        }
    }
    voices
}

/// Others while one voice has been heard, numbered once there are more.
fn system_speaker_id(voices: &[u32], voice: Option<u32>) -> String {
    match voice.and_then(|voice| voices.iter().position(|&known| known == voice)) {
        Some(index) if voices.len() > 1 => format!("{NUMBERED_PREFIX}{}", index + 1),
        _ => SYSTEM_ID.to_string(),
    }
}

fn speaker_rank(id: &str) -> (u8, u32) {
    match id {
        MICROPHONE_ID => (0, 0),
        SYSTEM_ID => (1, 0),
        _ => (
            2,
            id.strip_prefix(NUMBERED_PREFIX)
                .and_then(|n| n.parse().ok())
                .unwrap_or(u32::MAX),
        ),
    }
}

fn default_speaker(id: &str) -> Option<Speaker> {
    let [you, others] = crate::library::recording_speakers();
    match id {
        MICROPHONE_ID => Some(you),
        SYSTEM_ID => Some(others),
        _ => {
            let number: u32 = id.strip_prefix(NUMBERED_PREFIX)?.parse().ok()?;
            Some(Speaker {
                id: id.to_string(),
                name: format!("Speaker {number}"),
                color: None,
            })
        }
    }
}

/// Runs live transcription for one recording session on its own thread.
pub(super) struct LiveWorker {
    stop: Sender<()>,
    handle: JoinHandle<()>,
}

impl LiveWorker {
    pub(super) fn spawn(
        app: AppHandle<AppRuntime>,
        shared: Arc<Shared>,
        microphone: Option<Arc<LiveTap>>,
        system: Option<Arc<LiveTap>>,
    ) -> Option<Self> {
        shared.live.begin(microphone.is_some(), system.is_some());
        let (stop, stopped) = bounded::<()>(0);
        let handle = std::thread::Builder::new()
            .name("glimpse-recording-live".into())
            .spawn(move || {
                let tracks = [
                    microphone.map(|tap| TrackRun::new(Source::Microphone, tap)),
                    system.map(|tap| TrackRun::new(Source::System, tap)),
                ];
                Runner {
                    app,
                    shared,
                    stop: stopped,
                    tracks: tracks.into_iter().flatten().collect(),
                    running: false,
                    model: None,
                    warmed: false,
                    max_window: MIN_WINDOW_FRAMES,
                    diarizer: None,
                    speaking: None,
                    last_manifest: Instant::now(),
                    manifest_turns: 0,
                }
                .run();
            })
            .inspect_err(|err| tracing::warn!("Live transcription did not start: {err}"))
            .ok()?;
        Some(Self { stop, handle })
    }

    /// Waits for a transcription in flight, then frees the models.
    pub(super) fn stop(self) {
        drop(self.stop);
        let _ = self.handle.join();
    }
}

enum Plan {
    Wait,
    Drop(usize),
    Commit(usize),
    Open,
}

/// One track's audio not yet committed to the transcript.
struct TrackRun {
    source: Source,
    tap: Arc<LiveTap>,
    vad: Vad,
    // 16 kHz index of `samples[0]` on the session timeline.
    start: u64,
    samples: Vec<f32>,
    // Speech or not, per whole frame of `samples`.
    voiced: Vec<bool>,
    // Frames the open window was last transcribed with.
    open_frames: usize,
}

impl TrackRun {
    fn new(source: Source, tap: Arc<LiveTap>) -> Self {
        Self {
            source,
            tap,
            vad: Vad::new_with_rate_and_mode(VadSampleRate::Rate16kHz, VadMode::Aggressive),
            start: 0,
            samples: Vec::new(),
            voiced: Vec::new(),
            open_frames: 0,
        }
    }

    fn start_ms(&self) -> u64 {
        self.start * 1000 / LIVE_RATE as u64
    }

    fn end_ms(&self) -> u64 {
        (self.start + self.samples.len() as u64) * 1000 / LIVE_RATE as u64
    }

    /// Whether speech in `start_ms..end_ms` is still to be transcribed, or
    /// has not been heard yet when `heard_ms` falls short of it.
    fn speech_pending(&self, start_ms: u64, end_ms: u64, heard_ms: u64) -> bool {
        let from = self.start_ms();
        heard_ms < end_ms
            || self.voiced.iter().enumerate().any(|(index, &voiced)| {
                let frame_ms = from + index as u64 * FRAME_MS;
                voiced && frame_ms < end_ms && frame_ms + FRAME_MS > start_ms
            })
    }

    fn clear(&mut self) {
        self.samples.clear();
        self.voiced.clear();
        self.open_frames = 0;
    }

    /// New audio from the tap, also returned for the diarizer. `true` in the
    /// result means the window restarted after a jump.
    fn pull(&mut self) -> Option<(u64, Vec<f32>, bool)> {
        let (start, samples) = self.tap.take()?;
        if samples.is_empty() {
            return None;
        }
        let expected = self.start + self.samples.len() as u64;
        let restarted = !self.samples.is_empty() && start != expected;
        if self.samples.is_empty() || restarted {
            self.clear();
            self.start = start;
        }
        self.samples.extend_from_slice(&samples);
        while (self.voiced.len() + 1) * FRAME <= self.samples.len() {
            let from = self.voiced.len() * FRAME;
            let frame = to_pcm(&self.samples[from..from + FRAME]);
            self.voiced
                .push(self.vad.is_voice_segment(&frame).unwrap_or(false));
        }
        Some((start, samples, restarted))
    }

    fn advance(&mut self, frames: usize) {
        let frames = frames.min(self.voiced.len());
        self.samples.drain(..frames * FRAME);
        self.voiced.drain(..frames);
        self.start += (frames * FRAME) as u64;
        self.open_frames = 0;
    }

    fn untranscribed_speech(&self) -> usize {
        let fresh = &self.voiced[self.open_frames.min(self.voiced.len())..];
        if fresh.iter().any(|&voiced| voiced) {
            fresh.len()
        } else {
            0
        }
    }

    /// `flush` commits whatever speech is buffered, for a paused recording.
    fn plan(&self, flush: bool, max_window: usize) -> Plan {
        let frames = self.voiced.len();
        let Some(first) = self.voiced.iter().position(|&voiced| voiced) else {
            return if frames >= SILENCE_DROP_FRAMES {
                Plan::Drop(frames - TAIL_FRAMES)
            } else {
                Plan::Wait
            };
        };
        if first >= SILENCE_DROP_FRAMES {
            return Plan::Drop(first - TAIL_FRAMES);
        }
        let mut speech = 0;
        let mut quiet = 0;
        for (index, &voiced) in self.voiced.iter().enumerate().take(max_window) {
            if voiced {
                speech += 1;
                quiet = 0;
                continue;
            }
            quiet += 1;
            if quiet == GAP_FRAMES {
                let cut = index + 1 - GAP_FRAMES + TAIL_FRAMES;
                return if speech >= MIN_SPEECH_FRAMES {
                    Plan::Commit(cut)
                } else {
                    Plan::Drop(cut)
                };
            }
        }
        if frames >= max_window {
            let window = to_pcm(&self.samples[..max_window * FRAME]);
            let cut = crate::recorder::quiet_cut_index(&window, LIVE_RATE) / FRAME;
            return Plan::Commit(cut.max(1));
        }
        if speech < MIN_SPEECH_FRAMES {
            return Plan::Wait;
        }
        if flush {
            return Plan::Commit(frames);
        }
        if frames >= self.open_frames + OPEN_STEP_FRAMES {
            return Plan::Open;
        }
        Plan::Wait
    }
}

/// The only code that touches the live diarizer API.
struct SystemDiarizer {
    diarizer: LiveDiarizer,
    // Session time of the first sample fed.
    origin_ms: Option<u64>,
    pending: Vec<f32>,
    // Added to voice numbers so a restarted diarizer can't reuse earlier ones.
    voice_base: u32,
}

impl SystemDiarizer {
    fn open(model_path: &Path, voice_base: u32) -> Option<Self> {
        match LiveDiarizer::new(model_path, true) {
            Ok(diarizer) => Some(Self {
                diarizer,
                origin_ms: None,
                pending: Vec::new(),
                voice_base,
            }),
            Err(err) => {
                tracing::warn!("Live speaker detection did not start: {err}");
                None
            }
        }
    }

    fn queue(&mut self, start: u64, samples: &[f32]) {
        self.origin_ms
            .get_or_insert(start * 1000 / LIVE_RATE as u64);
        self.pending.extend_from_slice(samples);
    }

    /// Feeds queued audio in one-second pieces until `stop` says otherwise.
    /// Returns the turns on the session timeline and where they are settled,
    /// or `None` when nothing was fed.
    fn feed(
        &mut self,
        flush: bool,
        stop: impl Fn() -> bool,
    ) -> Result<Option<(Vec<SpeakerTurn>, u64)>, String> {
        let mut fed = 0;
        let mut latest = None;
        while self.pending.len() - fed >= DIARIZE_STEP || (flush && fed < self.pending.len()) {
            if stop() {
                break;
            }
            let end = (fed + DIARIZE_STEP).min(self.pending.len());
            latest = Some(
                self.diarizer
                    .feed(&self.pending[fed..end])
                    .map_err(|err| err.to_string())?,
            );
            fed = end;
        }
        self.pending.drain(..fed);
        let origin = self.origin_ms.unwrap_or(0);
        Ok(latest.map(|live| {
            let turns = live
                .turns
                .into_iter()
                .filter(|turn| turn.end_ms.saturating_sub(turn.start_ms) >= MIN_TURN_MS)
                .map(|turn| SpeakerTurn {
                    start_ms: turn.start_ms + origin,
                    end_ms: turn.end_ms + origin,
                    speaker: turn.speaker + self.voice_base,
                })
                .collect();
            (turns, live.settled_ms + origin)
        }))
    }
}

struct Runner {
    app: AppHandle<AppRuntime>,
    shared: Arc<Shared>,
    stop: Receiver<()>,
    tracks: Vec<TrackRun>,
    running: bool,
    // The local model live text uses, keyed by the setting that chose it.
    model: Option<(String, ReadyModel)>,
    warmed: bool,
    // Window length in frames that fits `LOCK_BUDGET` at the model's speed.
    max_window: usize,
    diarizer: Option<SystemDiarizer>,
    speaking: Option<(String, Instant)>,
    last_manifest: Instant,
    manifest_turns: usize,
}

impl Runner {
    fn run(mut self) {
        let mut last_emit = Instant::now();
        loop {
            let requested = self.shared.live.requested.load(Ordering::Relaxed);
            if requested && !self.running {
                self.enable();
            }
            let worked = self.running && self.step();
            if self.running {
                self.release_microphone(false);
            }
            self.update_speaking();
            if last_emit.elapsed() >= EMIT_INTERVAL {
                last_emit = Instant::now();
                self.shared.live.publish(&self.app, false);
            }
            self.persist_turns();
            let wait = if worked { Duration::ZERO } else { TICK };
            if crate::recorder::stop_requested(&self.stop, wait) {
                break;
            }
        }
        if self.running {
            self.release_microphone(true);
            self.shared.live.publish(&self.app, false);
        }
        for track in &self.tracks {
            track.tap.set_enabled(false);
        }
    }

    fn state(&self) -> tauri::State<'_, AppState> {
        self.app.state::<AppState>()
    }

    fn enable(&mut self) {
        self.running = true;
        self.shared.live.inner.lock().status = LiveStatus::Starting;
        for track in &mut self.tracks {
            track.clear();
            track.tap.set_enabled(true);
        }
        self.refresh_model();
        let has_system = self.tracks.iter().any(|t| t.source == Source::System);
        if has_system && self.model.is_some() {
            let base = {
                let mut inner = self.shared.live.inner.lock();
                inner.epoch_from = inner.turns.len();
                inner
                    .turns
                    .iter()
                    .map(|turn| turn.speaker)
                    .max()
                    .unwrap_or(0)
            };
            self.diarizer = crate::speech::live_diarizer_path(&self.app)
                .and_then(|path| SystemDiarizer::open(&path, base));
        }
        let mut inner = self.shared.live.inner.lock();
        inner.diarizing = self.diarizer.is_some();
        inner.status = if self.model.is_some() {
            LiveStatus::Starting
        } else {
            LiveStatus::Unavailable
        };
    }

    /// Follows the dictation model setting, falling back to any installed local model.
    fn refresh_model(&mut self) {
        let setting = self.state().current_settings().local_model;
        if self.model.as_ref().is_some_and(|(key, _)| *key == setting) {
            return;
        }
        self.warmed = false;
        self.model = match crate::model_manager::ensure_local_fallback_model(&self.app, &setting) {
            Ok(model) => {
                self.max_window = if matches!(model.engine, LocalModelEngine::Whisper) {
                    MAX_WINDOW_FRAMES
                } else {
                    MIN_WINDOW_FRAMES
                };
                // This runner is already off-thread. Windows GPU initialization
                // must finish before opening the diarizer to avoid a cold-load crash.
                #[cfg(target_os = "windows")]
                if let Err(err) = self.state().local_transcriber().preload_and_warm(&model) {
                    tracing::warn!("Live transcription model warm failed: {err}");
                }
                #[cfg(not(target_os = "windows"))]
                crate::speech::warm_model(&self.app, model.key.clone());
                Some((setting, model))
            }
            Err(err) => {
                tracing::warn!("Live transcription has no local model: {err}");
                None
            }
        };
    }

    /// Dictation always goes first, and a Library job on another model is
    /// not interleaved with, since each switch would reload a model.
    fn must_yield(&self, model: &ReadyModel) -> bool {
        let state = self.state();
        if state.pill().status() != crate::pill::PillStatus::Idle {
            return true;
        }
        state.library_job_active()
            && state.local_transcriber().loaded_model_id().as_deref() != Some(model.key.as_str())
    }

    /// Returns whether a transcription ran, so the loop goes again without waiting.
    fn step(&mut self) -> bool {
        let flush = self.shared.paused.load(Ordering::Relaxed);
        for track in &mut self.tracks {
            let Some((start, samples, restarted)) = track.pull() else {
                continue;
            };
            if restarted {
                self.shared.live.inner.lock().open[track.source.index()] = None;
            }
            if track.source == Source::System
                && let Some(diarizer) = self.diarizer.as_mut()
            {
                diarizer.queue(start, &samples);
            }
        }
        for track in &mut self.tracks {
            while let Plan::Drop(frames) = track.plan(flush, self.max_window) {
                track.advance(frames);
                self.shared.live.inner.lock().open[track.source.index()] = None;
            }
            // A long wait (a Library job on another model) skips the oldest audio.
            if track.voiced.len() > MAX_BACKLOG_FRAMES {
                track.advance(track.voiced.len() - MAX_BACKLOG_FRAMES);
                self.shared.live.inner.lock().open[track.source.index()] = None;
            }
        }
        if self
            .diarizer
            .as_ref()
            .is_some_and(|diarizer| diarizer.pending.len() > MAX_BACKLOG_FRAMES * FRAME)
        {
            tracing::warn!("Live speaker detection fell too far behind and stopped");
            self.diarizer = None;
            self.shared.live.inner.lock().diarizing = false;
        }

        self.refresh_model();
        let Some((_, model)) = self.model.clone() else {
            for track in &mut self.tracks {
                track.clear();
            }
            self.shared.live.inner.lock().status = LiveStatus::Unavailable;
            return false;
        };
        if !self.warmed {
            self.warmed = self
                .state()
                .local_transcriber()
                .loaded_model_id()
                .as_deref()
                == Some(model.key.as_str());
        }
        let behind = self
            .tracks
            .iter()
            .any(|track| track.untranscribed_speech() >= BEHIND_FRAMES);
        if self.must_yield(&model) {
            // Waiting out a dictation is expected, not falling behind.
            let dictating = self.state().pill().status() != crate::pill::PillStatus::Idle;
            let pending = self
                .tracks
                .iter()
                .any(|track| track.untranscribed_speech() > 0);
            self.set_status(!dictating && (pending || behind));
            return false;
        }

        self.diarize(flush);

        let commit = self
            .tracks
            .iter()
            .enumerate()
            .filter_map(|(index, track)| match track.plan(flush, self.max_window) {
                Plan::Commit(frames) => Some((index, frames, track.start)),
                _ => None,
            })
            .min_by_key(|&(_, _, start)| start);
        let worked = if let Some((index, frames, _)) = commit {
            self.transcribe(index, frames, true, &model)
        } else if let Some(index) = self
            .tracks
            .iter()
            .enumerate()
            .filter(|(_, track)| matches!(track.plan(flush, self.max_window), Plan::Open))
            .max_by_key(|(_, track)| track.untranscribed_speech())
            .map(|(index, _)| index)
        {
            let frames = self.tracks[index].voiced.len();
            self.transcribe(index, frames, false, &model)
        } else {
            false
        };
        let behind = self
            .tracks
            .iter()
            .any(|track| track.untranscribed_speech() >= BEHIND_FRAMES);
        self.set_status(behind);
        worked
    }

    fn set_status(&self, behind: bool) {
        let status = match (self.warmed, behind) {
            (false, _) => LiveStatus::Starting,
            (true, true) => LiveStatus::CatchingUp,
            (true, false) => LiveStatus::Live,
        };
        self.shared.live.inner.lock().status = status;
    }

    fn diarize(&mut self, flush: bool) {
        let Some(diarizer) = self.diarizer.as_mut() else {
            return;
        };
        // Gives way to a dictation, and to a finishing recording so saving
        // never waits on a backlog.
        let stop = || {
            self.app.state::<AppState>().pill().status() != crate::pill::PillStatus::Idle
                || !matches!(self.stop.try_recv(), Err(TryRecvError::Empty))
        };
        match diarizer.feed(flush, stop) {
            Ok(Some((turns, settled_ms))) => {
                let mut inner = self.shared.live.inner.lock();
                let from = inner.epoch_from;
                inner.turns.truncate(from);
                inner.turns.extend(turns);
                inner.settled_ms = settled_ms;
            }
            Ok(None) => {}
            Err(err) => {
                tracing::warn!("Live speaker detection stopped: {err}");
                self.diarizer = None;
                self.shared.live.inner.lock().diarizing = false;
            }
        }
    }

    /// Transcribes the first `frames` of a track, committing them or updating
    /// its open window. False when the transcriber was busy.
    fn transcribe(
        &mut self,
        index: usize,
        frames: usize,
        commit: bool,
        model: &ReadyModel,
    ) -> bool {
        let settings = self.state().current_settings();
        let track = &self.tracks[index];
        let pcm = to_pcm(&track.samples[..frames * FRAME]);
        let dictionary = crate::dictionary::dictionary_entries_for_model(model, &settings);
        let language = (!settings.language.trim().is_empty()).then_some(settings.language.as_str());
        let transcriber = self.state().local_transcriber();
        let was_loaded = transcriber.loaded_model_id().as_deref() == Some(model.key.as_str());
        let started = Instant::now();
        let Some(result) = transcriber.try_transcribe_with_segments(
            model,
            &pcm,
            LIVE_RATE,
            &dictionary,
            language,
            glimpse_speech::TimestampGranularity::Word,
        ) else {
            return false;
        };
        // Shrinks only after a pass over budget; short passes carry fixed
        // overhead, so they may only grow it. A load or a failure says nothing.
        let elapsed = started.elapsed().as_secs_f64();
        if was_loaded && result.is_ok() && !matches!(model.engine, LocalModelEngine::Whisper) {
            let fits = (frames as f64 * LOCK_BUDGET.as_secs_f64() / elapsed) as usize;
            let window = if elapsed > LOCK_BUDGET.as_secs_f64() {
                fits
            } else {
                self.max_window.max(fits)
            };
            self.max_window = window.clamp(MIN_WINDOW_FRAMES, MAX_WINDOW_FRAMES);
        }
        self.warmed = true;
        let piece = match result {
            Ok(result) => {
                // Whisper can write text over silence inside a window.
                let regions = matches!(model.engine, LocalModelEngine::Whisper)
                    .then(|| glimpse_speech::vad::speech_regions(&pcm, LIVE_RATE))
                    .flatten();
                Some(build_piece(
                    track.source,
                    track.start_ms(),
                    frames,
                    result,
                    regions.as_deref(),
                    &settings.replacements,
                ))
            }
            Err(err) => {
                tracing::warn!("Live transcription failed: {err}");
                None
            }
        };
        let source = track.source;
        let held = source == Source::Microphone
            && self
                .tracks
                .iter()
                .any(|track| track.source == Source::System);
        let mut inner = self.shared.live.inner.lock();
        let previous = inner.open[source.index()].take();
        let piece = piece.map(|mut piece| {
            if held {
                piece.held = true;
                // Keeps the window's last shown preview up, under the same id.
                piece.shown = previous
                    .filter(|previous| previous.start_ms == piece.start_ms)
                    .map(Piece::into_shown)
                    .unwrap_or_default();
            }
            piece
        });
        if commit {
            inner
                .pieces
                .extend(piece.filter(|piece| !piece.segments.is_empty()));
            drop(inner);
            self.tracks[index].advance(frames);
        } else {
            inner.open[source.index()] = piece;
            drop(inner);
            self.tracks[index].open_frames = frames;
        }
        true
    }

    /// Shows held microphone text once the system track has been transcribed
    /// past it, or at `finish` against the system text there is.
    fn release_microphone(&mut self, finish: bool) {
        let track = |source| self.tracks.iter().find(|track| track.source == source);
        let mut inner = self.shared.live.inner.lock();
        let inner = &mut *inner;
        let Some(microphone) = track(Source::Microphone) else {
            inner.microphone_from_ms = u64::MAX;
            return;
        };
        // Held pieces exist only with a system track.
        let Some(system) = track(Source::System) else {
            return;
        };
        // A paused recording gets no more audio for either track.
        let heard_ms = if finish || self.shared.paused.load(Ordering::Relaxed) {
            u64::MAX
        } else {
            system
                .end_ms()
                .max(microphone.end_ms().saturating_sub(STALL_MS))
        };
        let ready = |piece: &Piece| {
            piece.held
                && (finish
                    || !system.speech_pending(piece.speech_start_ms(), piece.end_ms(), heard_ms))
        };
        for index in 0..inner.pieces.len() {
            if !ready(&inner.pieces[index]) {
                continue;
            }
            let system_text = inner.pieces[index].system_near(&inner.pieces);
            let earlier = inner.bleed_words;
            inner.bleed_words += inner.pieces[index].release(system_text, earlier);
        }
        inner.pieces.retain(|piece| !piece.segments.is_empty());
        if let Some(piece) = inner.open[Source::Microphone.index()]
            .as_mut()
            .filter(|piece| ready(piece))
        {
            // A preview is transcribed again, so its bleed isn't counted.
            piece.release(piece.system_near(&inner.pieces), inner.bleed_words);
        }
        inner.microphone_from_ms = inner
            .pieces
            .iter()
            .filter(|piece| piece.held)
            .map(|piece| piece.start_ms)
            .fold(microphone.start_ms(), u64::min)
            // A muted or stalled microphone keeps its start; the system backlog cap bounds it.
            .max(
                system
                    .end_ms()
                    .saturating_sub(MAX_BACKLOG_FRAMES as u64 * FRAME_MS),
            );
    }

    fn update_speaking(&mut self) {
        let level =
            |bits: &std::sync::atomic::AtomicU32| f32::from_bits(bits.load(Ordering::Relaxed));
        let mut inner = self.shared.live.inner.lock();
        let now = if !self.running {
            None
        } else if inner.system && level(&self.shared.system_level) >= SPEAKING_LEVEL {
            Some(inner.latest_system_id())
        } else if inner.microphone && level(&self.shared.microphone_level) >= SPEAKING_LEVEL {
            Some(MICROPHONE_ID.to_string())
        } else {
            None
        };
        if let Some(id) = now {
            self.speaking = Some((id, Instant::now()));
        } else if !self.running {
            self.speaking = None;
        }
        inner.active = self
            .speaking
            .as_ref()
            .filter(|(_, at)| at.elapsed() < SPEAKING_HOLD)
            .map(|(id, _)| id.clone());
    }

    /// Keeps session.json's turns current for crash recovery while there are edits to carry.
    fn persist_turns(&mut self) {
        if self.last_manifest.elapsed() < MANIFEST_INTERVAL {
            return;
        }
        let turns = {
            let inner = self.shared.live.inner.lock();
            if inner.edits.is_empty() && inner.merges.is_empty() {
                return;
            }
            inner.turns.len()
        };
        if turns != self.manifest_turns {
            self.manifest_turns = turns;
            self.last_manifest = Instant::now();
            self.shared.write_manifest();
        }
    }
}

fn build_piece(
    source: Source,
    start_ms: u64,
    frames: usize,
    result: glimpse_speech::Transcription,
    regions: Option<&[(f32, f32)]>,
    replacements: &[crate::settings::Replacement],
) -> Piece {
    let spoken = |entry: &glimpse_speech::TranscriptionSegment| {
        regions.is_none_or(|regions| {
            crate::transcription_api::overlaps_speech(entry.start, entry.end, regions)
        })
    };
    let convert = |entries: Option<Vec<glimpse_speech::TranscriptionSegment>>| {
        entries
            .unwrap_or_default()
            .iter()
            .filter(|entry| spoken(entry))
            .map(|entry| TranscriptSegment {
                start_ms: start_ms + (entry.start * 1000.0).max(0.0) as u64,
                end_ms: start_ms + (entry.end * 1000.0).max(0.0) as u64,
                text: crate::dictionary::apply_replacements(entry.text.trim(), replacements),
                speaker_id: None,
            })
            .filter(|entry| !entry.text.is_empty())
            .collect::<Vec<_>>()
    };
    let mut segments = convert(result.segments);
    let words = convert(result.words);
    let text = result.text.trim();
    if segments.is_empty() && regions.is_none() && !text.is_empty() {
        segments.push(TranscriptSegment {
            start_ms,
            end_ms: start_ms + (frames * FRAME) as u64 * 1000 / LIVE_RATE as u64,
            text: crate::dictionary::apply_replacements(text, replacements),
            speaker_id: None,
        });
    }
    Piece {
        source,
        start_ms,
        segments,
        words,
        voices: None,
        held: false,
        shown: Vec::new(),
    }
}

fn to_pcm(samples: &[f32]) -> Vec<i16> {
    samples
        .iter()
        .map(|sample| (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16)
        .collect()
}
