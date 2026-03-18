import { setup, assign, fromCallback } from "xstate";
import type { PillStatus, AudioSpectrumPayload, PillStatePayload } from "../../types";

export type PillContext = {
  spectrumBins: Uint8Array;
  lastSpectrumAt: number;
  audioReferenceLevel: number;
  audioFrameCount: number;
  isErrorFlashing: boolean;
};

export type PillEvent =
  | { type: "PILL_STATE"; payload: PillStatePayload }
  | { type: "AUDIO_SPECTRUM"; payload: AudioSpectrumPayload }
  | { type: "ERROR_FLASH_DONE" }
  | { type: "DISMISS" };

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
  },
  // Global listeners — always active regardless of state
  invoke: [
    { id: "pillStateListener", src: "pillStateListener" },
  ],
  initial: "idle",
  states: {
    idle: {
      entry: "stopErrorFlash",
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
