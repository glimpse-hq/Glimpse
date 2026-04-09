import { setup, assign, fromCallback } from "xstate";
import type { PillStatus, AudioSpectrumPayload, PillStatePayload, PillModePayload } from "../../types";

export type PillContext = {
  spectrumBins: Uint8Array;
  lastSpectrumAt: number;
  audioReferenceLevel: number;
  audioFrameCount: number;
  isErrorFlashing: boolean;
  isExpanded: boolean;
  expandedText: string;
};

export type PillEvent =
  | { type: "PILL_STATE"; payload: PillStatePayload }
  | { type: "AUDIO_SPECTRUM"; payload: AudioSpectrumPayload }
  | { type: "ERROR_FLASH_DONE" }
  | { type: "DISMISS" }
  | { type: "EXPAND"; text?: string }
  | { type: "COLLAPSE" };

const pillStateListener = fromCallback<PillEvent>(({ sendBack }) => {
  let unlisten: (() => void) | undefined;

  import("@tauri-apps/api/event").then(({ listen }) => {
    listen<PillStatePayload>("pill:state", (e) => {
      sendBack({ type: "PILL_STATE", payload: e.payload });
    }).then((fn) => {
      unlisten = fn;
    });
  });

  return () => {
    unlisten?.();
  };
});

const spectrumListener = fromCallback<PillEvent>(({ sendBack }) => {
  let unlisten: (() => void) | undefined;

  import("@tauri-apps/api/event").then(({ listen }) => {
    listen<AudioSpectrumPayload>("audio:spectrum", (e) => {
      sendBack({ type: "AUDIO_SPECTRUM", payload: e.payload });
    }).then((fn) => {
      unlisten = fn;
    });
  });

  return () => {
    unlisten?.();
  };
});

const expandListener = fromCallback<PillEvent>(({ sendBack }) => {
  let unlisten: (() => void) | undefined;

  import("@tauri-apps/api/event").then(({ listen }) => {
    listen<PillModePayload>("pill:mode", (e) => {
      if (e.payload.expanded) {
        sendBack({ type: "EXPAND", text: e.payload.text });
      } else {
        sendBack({ type: "COLLAPSE" });
      }
    }).then((fn) => {
      unlisten = fn;
    });
  });

  return () => {
    unlisten?.();
  };
});

const errorFlashTimer = fromCallback<PillEvent>(({ sendBack }) => {
  const id = setTimeout(() => sendBack({ type: "ERROR_FLASH_DONE" }), 1200);
  return () => clearTimeout(id);
});

const EMPTY_SPECTRUM = new Uint8Array(256);

export const pillMachine = setup({
  types: {
    context: {} as PillContext,
    events: {} as PillEvent,
  },
  actors: {
    pillStateListener,
    spectrumListener,
    errorFlashTimer,
    expandListener,
  },
  actions: {
    resetAudioState: assign({
      spectrumBins: () => new Uint8Array(EMPTY_SPECTRUM),
      lastSpectrumAt: 0,
      audioReferenceLevel: 0,
      audioFrameCount: 0,
    }),
    updateSpectrum: assign({
      spectrumBins: ({ event }) => {
        if (event.type !== "AUDIO_SPECTRUM") return new Uint8Array(EMPTY_SPECTRUM);
        return new Uint8Array(event.payload.bins);
      },
      lastSpectrumAt: () => performance.now(),
    }),
    startErrorFlash: assign({ isErrorFlashing: true }),
    stopErrorFlash: assign({ isErrorFlashing: false }),
    setExpanded: assign({
      isExpanded: true,
      expandedText: ({ event }) =>
        event.type === "EXPAND" ? (event.text ?? "") : "",
    }),
    clearExpanded: assign({
      isExpanded: false,
      expandedText: "",
    }),
  },
  guards: {
    isListening: (_, params: { status: PillStatus }) => params.status === "listening",
    isProcessing: (_, params: { status: PillStatus }) => params.status === "processing",
    isError: (_, params: { status: PillStatus }) => params.status === "error",
    isIdle: (_, params: { status: PillStatus }) => params.status === "idle",
  },
}).createMachine({
  id: "pill",
  context: {
    spectrumBins: new Uint8Array(EMPTY_SPECTRUM),
    lastSpectrumAt: 0,
    audioReferenceLevel: 0,
    audioFrameCount: 0,
    isErrorFlashing: false,
    isExpanded: false,
    expandedText: "",
  },
  // Global listeners — always active regardless of state
  invoke: [
    { id: "pillStateListener", src: "pillStateListener" },
    { id: "expandListener", src: "expandListener" },
  ],
  // Expand/collapse works in any state (orthogonal to pill status)
  on: {
    EXPAND: { actions: "setExpanded" },
    COLLAPSE: { actions: "clearExpanded" },
  },
  initial: "idle",
  states: {
    idle: {
      entry: ["stopErrorFlash", "clearExpanded"],
      on: {
        PILL_STATE: [
          {
            guard: { type: "isListening", params: ({ event }) => ({ status: event.payload.status }) },
            target: "listening",
          },
          {
            guard: { type: "isProcessing", params: ({ event }) => ({ status: event.payload.status }) },
            target: "processing",
          },
          {
            guard: { type: "isError", params: ({ event }) => ({ status: event.payload.status }) },
            target: "error",
          },
        ],
      },
    },

    listening: {
      entry: "resetAudioState",
      invoke: {
        id: "spectrumListener",
        src: "spectrumListener",
      },
      on: {
        AUDIO_SPECTRUM: {
          actions: "updateSpectrum",
        },
        PILL_STATE: [
          {
            guard: { type: "isProcessing", params: ({ event }) => ({ status: event.payload.status }) },
            target: "processing",
          },
          {
            guard: { type: "isError", params: ({ event }) => ({ status: event.payload.status }) },
            target: "error",
          },
          {
            guard: { type: "isIdle", params: ({ event }) => ({ status: event.payload.status }) },
            target: "idle",
          },
        ],
      },
    },

    processing: {
      on: {
        PILL_STATE: [
          {
            guard: { type: "isIdle", params: ({ event }) => ({ status: event.payload.status }) },
            target: "idle",
          },
          {
            guard: { type: "isError", params: ({ event }) => ({ status: event.payload.status }) },
            target: "error",
          },
          {
            guard: { type: "isListening", params: ({ event }) => ({ status: event.payload.status }) },
            target: "listening",
          },
        ],
      },
    },

    error: {
      entry: "startErrorFlash",
      invoke: {
        id: "errorFlashTimer",
        src: "errorFlashTimer",
      },
      on: {
        ERROR_FLASH_DONE: {
          actions: "stopErrorFlash",
        },
        DISMISS: {
          target: "idle",
        },
        PILL_STATE: [
          {
            guard: { type: "isIdle", params: ({ event }) => ({ status: event.payload.status }) },
            target: "idle",
          },
          {
            guard: { type: "isListening", params: ({ event }) => ({ status: event.payload.status }) },
            target: "listening",
          },
        ],
      },
    },
  },
});
