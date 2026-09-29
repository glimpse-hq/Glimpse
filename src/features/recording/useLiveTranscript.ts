import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import * as recordingApi from "./api";
import type { LiveTranscript } from "../../types";

const EMPTY: LiveTranscript = {
  revision: 0,
  from_index: 0,
  segments: [],
  speakers: [],
  active_speaker_id: null,
  status: "starting",
};

// Mirrors the backend's live transcript.
export function useLiveTranscript() {
  const [transcript, setTranscript] = useState<LiveTranscript>(EMPTY);
  const current = useRef(EMPTY);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    const commit = (next: LiveTranscript) => {
      current.current = next;
      setTranscript(next);
    };

    const refetch = () => {
      recordingApi
        .getLiveTranscript()
        .then((snapshot) => {
          if (!cancelled && snapshot.revision >= current.current.revision) {
            commit(snapshot);
          }
        })
        .catch(() => {});
    };

    // Events carry only the changed tail; a gap in revisions means one was
    // missed, so take a full snapshot.
    const apply = (next: LiveTranscript) => {
      if (cancelled) return;
      const prev = current.current;
      if (next.from_index === 0) {
        commit(next);
      } else if (next.revision === prev.revision + 1) {
        commit({
          ...next,
          segments: [
            ...prev.segments.slice(0, next.from_index),
            ...next.segments,
          ],
        });
      } else {
        refetch();
      }
    };

    listen<LiveTranscript>(recordingApi.LIVE_TRANSCRIPT_EVENT, (event) =>
      apply(event.payload),
    )
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    refetch();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return transcript;
}
