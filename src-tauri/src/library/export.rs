use anyhow::{Result, anyhow};

use super::types::{ExportFormat, LibraryItem, TranscriptSegment};

pub(crate) fn build_export_content(item: &LibraryItem, format: ExportFormat) -> Result<String> {
    let title = item.name.clone();
    let transcript = item.transcript.clone().unwrap_or_default();
    match format {
        ExportFormat::Txt => Ok(format!(
            "{}\nTranscribed: {}\n\n{}{}",
            title,
            item.transcribed_at
                .clone()
                .unwrap_or_else(|| item.created_at.clone()),
            bookmark_list(item, false)
                .map(|list| format!("Bookmarks\n{list}\n\n"))
                .unwrap_or_default(),
            build_speaker_transcript(item, false).unwrap_or(transcript)
        )),
        ExportFormat::Md => Ok(format!(
            "# {}\n\n**Duration:** {}  \n**Transcribed:** {}  \n**Tags:** {}\n\n{}---\n\n{}",
            title,
            format_duration(item.duration_seconds),
            item.transcribed_at
                .clone()
                .unwrap_or_else(|| item.created_at.clone()),
            if item.tags.is_empty() {
                "None".to_string()
            } else {
                item.tags.join(", ")
            },
            bookmark_list(item, true)
                .map(|list| format!("## Bookmarks\n\n{list}\n\n"))
                .unwrap_or_default(),
            build_speaker_transcript(item, true).unwrap_or(transcript)
        )),
        ExportFormat::Srt => build_srt(item),
        ExportFormat::Vtt => build_vtt(item),
    }
}

/// Bookmarks in time order, one `time  note` line each; None without any.
fn bookmark_list(item: &LibraryItem, markdown: bool) -> Option<String> {
    let mut bookmarks: Vec<_> = item.bookmarks.as_deref()?.iter().collect();
    if bookmarks.is_empty() {
        return None;
    }
    bookmarks.sort_by_key(|bookmark| bookmark.at_ms);
    let lines: Vec<String> = bookmarks
        .into_iter()
        .map(|bookmark| {
            let at = format_duration(bookmark.at_ms as f32 / 1000.0);
            let label = bookmark
                .label
                .as_deref()
                .map(|label| label.replace(['\r', '\n'], " "))
                .filter(|label| !label.trim().is_empty())
                .unwrap_or_else(|| "Bookmark".to_string());
            let label = label.trim();
            if markdown {
                format!("- **{at}** {label}")
            } else {
                format!("{at}  {label}")
            }
        })
        .collect();
    Some(lines.join("\n"))
}

pub(crate) fn speaker_name<'a>(
    item: &'a LibraryItem,
    speaker_id: &Option<String>,
) -> Option<&'a str> {
    let id = speaker_id.as_deref()?;
    item.speakers
        .as_ref()?
        .iter()
        .find(|speaker| speaker.id == id)
        .map(|speaker| speaker.name.as_str())
}

fn has_assigned_speakers(item: &LibraryItem) -> bool {
    item.speakers.as_ref().is_some_and(|s| !s.is_empty())
        && item
            .segments
            .as_ref()
            .is_some_and(|segments| segments.iter().any(|s| s.speaker_id.is_some()))
}

/// Groups consecutive same-speaker segments into labeled paragraphs.
fn build_speaker_transcript(item: &LibraryItem, markdown: bool) -> Option<String> {
    if !has_assigned_speakers(item) {
        return None;
    }
    let segments = item.segments.as_ref()?;
    let mut out = String::new();
    let mut current: Option<Option<&str>> = None;
    for segment in segments {
        let text = segment.text.trim();
        if text.is_empty() {
            continue;
        }
        let name = speaker_name(item, &segment.speaker_id);
        if current != Some(name) {
            if !out.is_empty() {
                out.push_str("\n\n");
            }
            if let Some(name) = name {
                if markdown {
                    out.push_str(&format!("**{}:** ", name));
                } else {
                    out.push_str(&format!("{}: ", name));
                }
            }
            current = Some(name);
        } else {
            out.push(' ');
        }
        out.push_str(text);
    }
    Some(out)
}

// A blank cue payload reads as the end of the cue, so blank segments are dropped.
fn timed_cues(item: &LibraryItem) -> Result<impl Iterator<Item = &TranscriptSegment>> {
    let segments = item
        .segments
        .as_ref()
        .ok_or_else(|| anyhow!("No timestamp segments available"))?;
    Ok(segments.iter().filter(|s| !s.text.trim().is_empty()))
}

fn build_srt(item: &LibraryItem) -> Result<String> {
    let mut out = String::new();
    for (idx, segment) in timed_cues(item)?.enumerate() {
        out.push_str(&(idx + 1).to_string());
        out.push('\n');
        let text = match speaker_name(item, &segment.speaker_id) {
            Some(name) => format!(
                "{}: {}",
                name.replace(['\r', '\n'], " "),
                segment.text.trim()
            ),
            None => segment.text.trim().to_string(),
        };
        out.push_str(&format!(
            "{} --> {}\n{}\n\n",
            format_srt_timestamp(segment.start_ms),
            format_srt_timestamp(segment.end_ms),
            text
        ));
    }
    Ok(out.trim().to_string())
}

fn escape_vtt_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn escape_vtt_voice(value: &str) -> String {
    value
        .chars()
        .filter(|ch| !matches!(ch, '\r' | '\n' | '>'))
        .collect()
}

fn build_vtt(item: &LibraryItem) -> Result<String> {
    let mut out = String::from("WEBVTT\n\n");
    for segment in timed_cues(item)? {
        // WebVTT voice spans render as speaker labels in players.
        let text = match speaker_name(item, &segment.speaker_id) {
            Some(name) => format!(
                "<v {}>{}</v>",
                escape_vtt_voice(name),
                escape_vtt_text(segment.text.trim())
            ),
            None => escape_vtt_text(segment.text.trim()),
        };
        out.push_str(&format!(
            "{} --> {}\n{}\n\n",
            format_vtt_timestamp(segment.start_ms),
            format_vtt_timestamp(segment.end_ms),
            text
        ));
    }
    Ok(out.trim().to_string())
}

fn format_cue_timestamp(ms: u64, millis_separator: char) -> String {
    let total_seconds = ms / 1000;
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let seconds = total_seconds % 60;
    let millis = ms % 1000;
    format!(
        "{:02}:{:02}:{:02}{}{:03}",
        hours, minutes, seconds, millis_separator, millis
    )
}

fn format_srt_timestamp(ms: u64) -> String {
    format_cue_timestamp(ms, ',')
}

fn format_vtt_timestamp(ms: u64) -> String {
    format_cue_timestamp(ms, '.')
}

fn format_duration(seconds: f32) -> String {
    if seconds <= 0.0 {
        return "0:00".to_string();
    }
    let total = seconds.round() as u64;
    let hours = total / 3600;
    let minutes = (total % 3600) / 60;
    let secs = total % 60;
    if hours > 0 {
        format!("{}:{:02}:{:02}", hours, minutes, secs)
    } else {
        format!("{}:{:02}", minutes, secs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::types::{Bookmark, LibraryItemStatus, Speaker};

    fn item() -> LibraryItem {
        LibraryItem {
            id: "0123456789abcdef".to_string(),
            name: "Standup".to_string(),
            audio_path: String::new(),
            source_path: String::new(),
            store_original: false,
            status: LibraryItemStatus::Complete,
            transcript: Some("Hello there. General Kenobi.".to_string()),
            transcript_edited: false,
            segments: None,
            words: None,
            duration_seconds: 65.4,
            file_size_bytes: 0,
            original_format: "wav".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            transcribed_at: Some("2026-01-02T00:00:00Z".to_string()),
            tags: Vec::new(),
            llm_cleanup_enabled: false,
            speech_model: "parakeet".to_string(),
            show_timestamps: true,
            detect_speakers: false,
            kind: "import".to_string(),
            speakers: None,
            secondary_audio_path: None,
            sources: None,
            bookmarks: None,
        }
    }

    fn segment(start_ms: u64, end_ms: u64, text: &str, speaker: Option<&str>) -> TranscriptSegment {
        TranscriptSegment {
            start_ms,
            end_ms,
            text: text.to_string(),
            speaker_id: speaker.map(str::to_string),
        }
    }

    fn speaker(id: &str, name: &str) -> Speaker {
        Speaker {
            id: id.to_string(),
            name: name.to_string(),
            color: None,
        }
    }

    fn bookmark(at_ms: u64, label: Option<&str>) -> Bookmark {
        Bookmark {
            id: format!("b{at_ms}"),
            at_ms,
            label: label.map(str::to_string),
        }
    }

    #[test]
    fn cue_timestamps_pad_every_field_and_use_format_separator() {
        assert_eq!(format_srt_timestamp(0), "00:00:00,000");
        assert_eq!(format_vtt_timestamp(0), "00:00:00.000");
        assert_eq!(format_srt_timestamp(61_005), "00:01:01,005");
        assert_eq!(format_vtt_timestamp(3_599_999), "00:59:59.999");
    }

    #[test]
    fn cue_timestamps_roll_over_into_hours_past_one_hour() {
        assert_eq!(format_srt_timestamp(3_600_000), "01:00:00,000");
        assert_eq!(format_vtt_timestamp(3_723_456), "01:02:03.456");
        assert_eq!(format_srt_timestamp(100 * 3_600_000), "100:00:00,000");
    }

    #[test]
    fn duration_uses_minutes_until_an_hour_then_adds_hours() {
        assert_eq!(format_duration(0.0), "0:00");
        assert_eq!(format_duration(-5.0), "0:00");
        assert_eq!(format_duration(f32::NAN), "0:00");
        assert_eq!(format_duration(0.4), "0:00");
        assert_eq!(format_duration(9.5), "0:10");
        assert_eq!(format_duration(65.4), "1:05");
        assert_eq!(format_duration(3599.4), "59:59");
        assert_eq!(format_duration(3599.6), "1:00:00");
        assert_eq!(format_duration(3_723.0), "1:02:03");
    }

    #[test]
    fn txt_export_has_title_transcribed_date_and_plain_transcript() {
        let out = build_export_content(&item(), ExportFormat::Txt).unwrap();
        assert_eq!(
            out,
            "Standup\nTranscribed: 2026-01-02T00:00:00Z\n\nHello there. General Kenobi."
        );
    }

    #[test]
    fn txt_export_falls_back_to_created_at_and_empty_transcript() {
        let mut item = item();
        item.transcribed_at = None;
        item.transcript = None;
        let out = build_export_content(&item, ExportFormat::Txt).unwrap();
        assert_eq!(out, "Standup\nTranscribed: 2026-01-01T00:00:00Z\n\n");
    }

    #[test]
    fn md_export_lists_duration_and_tags_or_none() {
        let mut item = item();
        let out = build_export_content(&item, ExportFormat::Md).unwrap();
        assert_eq!(
            out,
            "# Standup\n\n**Duration:** 1:05  \n**Transcribed:** 2026-01-02T00:00:00Z  \n**Tags:** None\n\n---\n\nHello there. General Kenobi."
        );

        item.tags = vec!["work".to_string(), "daily".to_string()];
        let out = build_export_content(&item, ExportFormat::Md).unwrap();
        assert!(out.contains("**Tags:** work, daily\n"));
    }

    #[test]
    fn bookmarks_are_sorted_and_blank_or_multiline_labels_are_cleaned() {
        let mut item = item();
        item.bookmarks = Some(vec![
            bookmark(3_725_000, Some("Wrap\nup")),
            bookmark(5_000, None),
            bookmark(61_000, Some("  \n ")),
        ]);

        let txt = build_export_content(&item, ExportFormat::Txt).unwrap();
        assert!(txt.contains(
            "\n\nBookmarks\n0:05  Bookmark\n1:01  Bookmark\n1:02:05  Wrap up\n\nHello there."
        ));

        let md = build_export_content(&item, ExportFormat::Md).unwrap();
        assert!(md.contains(
            "## Bookmarks\n\n- **0:05** Bookmark\n- **1:01** Bookmark\n- **1:02:05** Wrap up\n\n---\n\n"
        ));
    }

    #[test]
    fn empty_bookmark_list_adds_no_section() {
        let mut item = item();
        item.bookmarks = Some(Vec::new());
        let txt = build_export_content(&item, ExportFormat::Txt).unwrap();
        assert!(!txt.contains("Bookmarks"));
    }

    #[test]
    fn speaker_transcript_groups_consecutive_segments_and_skips_blank_text() {
        let mut item = item();
        item.speakers = Some(vec![speaker("s1", "Ada"), speaker("s2", "Grace")]);
        item.segments = Some(vec![
            segment(0, 1_000, " Hi. ", Some("s1")),
            segment(1_000, 2_000, "   ", Some("s2")),
            segment(2_000, 3_000, "How are you?", Some("s1")),
            segment(3_000, 4_000, "Fine.", Some("s2")),
            segment(4_000, 5_000, "Unlabeled.", None),
        ]);

        let txt = build_export_content(&item, ExportFormat::Txt).unwrap();
        assert!(txt.ends_with("Ada: Hi. How are you?\n\nGrace: Fine.\n\nUnlabeled."));

        let md = build_export_content(&item, ExportFormat::Md).unwrap();
        assert!(md.ends_with("**Ada:** Hi. How are you?\n\n**Grace:** Fine.\n\nUnlabeled."));
    }

    #[test]
    fn speaker_transcript_needs_both_speakers_and_assigned_segments() {
        let mut item = item();
        item.segments = Some(vec![segment(0, 1_000, "Segment text.", Some("s1"))]);
        let txt = build_export_content(&item, ExportFormat::Txt).unwrap();
        assert!(txt.ends_with("Hello there. General Kenobi."));

        item.speakers = Some(vec![speaker("s1", "Ada")]);
        item.segments = Some(vec![segment(0, 1_000, "Segment text.", None)]);
        let txt = build_export_content(&item, ExportFormat::Txt).unwrap();
        assert!(txt.ends_with("Hello there. General Kenobi."));
    }

    #[test]
    fn srt_numbers_cues_and_prefixes_known_speakers() {
        let mut item = item();
        item.speakers = Some(vec![speaker("s1", "Ada\nLovelace")]);
        item.segments = Some(vec![
            segment(0, 1_500, " Hi. ", Some("s1")),
            segment(3_600_000, 3_601_250, "Late.", Some("missing")),
        ]);
        let out = build_export_content(&item, ExportFormat::Srt).unwrap();
        assert_eq!(
            out,
            "1\n00:00:00,000 --> 00:00:01,500\nAda Lovelace: Hi.\n\n2\n01:00:00,000 --> 01:00:01,250\nLate."
        );
    }

    #[test]
    fn vtt_escapes_text_and_wraps_speakers_in_voice_spans() {
        let mut item = item();
        item.speakers = Some(vec![speaker("s1", "R&D <Team>\n")]);
        item.segments = Some(vec![
            segment(0, 1_000, "a < b && c > d", Some("s1")),
            segment(1_000, 2_000, "-->", None),
        ]);
        let out = build_export_content(&item, ExportFormat::Vtt).unwrap();
        assert_eq!(
            out,
            "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<v R&D <Team>a &lt; b &amp;&amp; c &gt; d</v>\n\n00:00:01.000 --> 00:00:02.000\n--&gt;"
        );
    }

    #[test]
    fn timed_formats_require_segments() {
        let item = item();
        assert!(build_export_content(&item, ExportFormat::Srt).is_err());
        assert!(build_export_content(&item, ExportFormat::Vtt).is_err());
    }

    #[test]
    fn timed_formats_with_no_segments_are_empty_or_header_only() {
        let mut item = item();
        item.segments = Some(Vec::new());
        assert_eq!(build_export_content(&item, ExportFormat::Srt).unwrap(), "");
        assert_eq!(
            build_export_content(&item, ExportFormat::Vtt).unwrap(),
            "WEBVTT"
        );
    }

    #[test]
    fn timed_formats_skip_blank_text_segments() {
        let mut item = item();
        item.segments = Some(vec![
            segment(0, 1_000, "   ", None),
            segment(1_000, 2_000, "Hi.", None),
            segment(2_000, 3_000, "", None),
            segment(3_000, 4_000, "Bye.", None),
        ]);
        let srt = build_export_content(&item, ExportFormat::Srt).unwrap();
        assert_eq!(
            srt,
            "1\n00:00:01,000 --> 00:00:02,000\nHi.\n\n2\n00:00:03,000 --> 00:00:04,000\nBye."
        );
        let vtt = build_export_content(&item, ExportFormat::Vtt).unwrap();
        assert_eq!(
            vtt,
            "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi.\n\n00:00:03.000 --> 00:00:04.000\nBye."
        );
    }
}
