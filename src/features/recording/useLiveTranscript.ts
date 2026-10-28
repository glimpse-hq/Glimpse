import { useCallback, useEffect, useRef, useState } from "react";
import { useTauriEvent } from "../../shared/hooks/useTauriEvent";
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

  const refetch = useCallback(() => {
    recordingApi
      .getLiveTranscript()
      .then((snapshot) => {
        if (snapshot.revision >= current.current.revision) {
          current.current = snapshot;
          setTranscript(snapshot);
        }
      })
      .catch(() => {});
  }, []);

  // Events carry only the changed tail; a gap in revisions means one was
  // missed, so take a full snapshot.
  useTauriEvent<LiveTranscript>(recordingApi.LIVE_TRANSCRIPT_EVENT, (next) => {
    const prev = current.current;
    if (next.from_index === 0) {
      current.current = next;
    } else if (next.revision === prev.revision + 1) {
      current.current = {
        ...next,
        segments: [
          ...prev.segments.slice(0, next.from_index),
          ...next.segments,
        ],
      };
    } else {
      refetch();
      return;
    }
    setTranscript(current.current);
  });

  useEffect(() => {
    refetch();
  }, [refetch]);

  return transcript;
}
