import { invoke } from "@tauri-apps/api/core";
import { setup, assign, fromCallback } from "xstate";
import type { ModelInfo, ModelStatus, TranscriptionMode } from "../../types";

export type OnboardingStep =
  | "welcome"
  | "localModel"
  | "localSignin"
  | "microphone"
  | "accessibility"
  | "ready";

export type LocalDownloadStatus = {
  status: "idle" | "downloading" | "complete" | "error" | "cancelled";
  percent: number;
  file?: string;
  message?: string;
};

export type OnboardingContext = {
  selectedMode: TranscriptionMode;
  localModelChoice: string;
  persistedLocalModel: string;
  downloadStatus: Record<string, LocalDownloadStatus>;
  modelStatus: Record<string, ModelStatus>;
  modelCatalog: ModelInfo[];
  isLoadingModelCatalog: boolean;
  modelCatalogUnavailable: boolean;
  showLocalConfirm: boolean;
  micPermission: boolean;
  accessibilityPermission: boolean;
  isCheckingMic: boolean;
  isCheckingAccessibility: boolean;
  smartShortcut: string;
  captureActive: boolean;
  capturePreview: string;
  completionError: string | null;
  isCompleting: boolean;
  showFAQModal: boolean;
  transitionDirection: 1 | -1;
  hasStepTransitioned: boolean;
};

export type OnboardingEvent =
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "SELECT_MODE"; mode: TranscriptionMode }
  | { type: "SELECT_MODEL"; key: string }
  | { type: "SET_DOWNLOAD_STATUS"; key: string; status: LocalDownloadStatus }
  | { type: "SET_MODEL_STATUS"; key: string; status: ModelStatus }
  | { type: "SET_MODEL_CATALOG"; catalog: ModelInfo[]; persistedModel: string }
  | { type: "SET_CATALOG_LOADING"; loading: boolean }
  | { type: "SET_CATALOG_UNAVAILABLE"; unavailable: boolean }
  | { type: "MIC_PERMISSION_CHANGED"; granted: boolean; checking: boolean }
  | { type: "ACCESSIBILITY_PERMISSION_CHANGED"; granted: boolean; checking: boolean }
  | { type: "SET_SHORTCUT"; shortcut: string }
  | { type: "CAPTURE_START" }
  | { type: "CAPTURE_END"; shortcut?: string }
  | { type: "SET_CAPTURE_PREVIEW"; preview: string }
  | { type: "SHOW_LOCAL_CONFIRM"; show: boolean }
  | { type: "COMPLETING" }
  | { type: "COMPLETE_SUCCESS" }
  | { type: "COMPLETE_ERROR"; error: string }
  | { type: "TOGGLE_FAQ"; show: boolean };

function getSteps(mode: TranscriptionMode): OnboardingStep[] {
  if (mode === "cloud") {
    return ["welcome", "localSignin", "localModel", "microphone", "accessibility", "ready"];
  }
  return ["welcome", "localModel", "microphone", "accessibility", "ready"];
}

// These helpers are available but most logic is handled by the machine's state transitions

// Actors for permission polling
const micPermissionPoller = fromCallback(({ sendBack }: { sendBack: (event: { type: "MIC_PERMISSION_CHANGED"; granted: boolean; checking: boolean }) => void }) => {
  let active = true;
  const check = async () => {
    try {
      const granted = await invoke<boolean>("check_microphone_permission");
      sendBack({ type: "MIC_PERMISSION_CHANGED", granted, checking: false });
    } catch {
      sendBack({ type: "MIC_PERMISSION_CHANGED", granted: false, checking: false });
    }
  };

  check();
  const interval = setInterval(() => {
    if (active) check();
  }, 1500);

  return () => {
    active = false;
    clearInterval(interval);
  };
});

const accessibilityPermissionPoller = fromCallback(({ sendBack }: { sendBack: (event: { type: "ACCESSIBILITY_PERMISSION_CHANGED"; granted: boolean; checking: boolean }) => void }) => {
  let active = true;
  const check = async () => {
    try {
      const { checkAccessibilityPermission } = await import("tauri-plugin-macos-permissions-api");
      const granted = await checkAccessibilityPermission();
      sendBack({ type: "ACCESSIBILITY_PERMISSION_CHANGED", granted, checking: false });
    } catch {
      sendBack({ type: "ACCESSIBILITY_PERMISSION_CHANGED", granted: false, checking: false });
    }
  };

  check();
  const interval = setInterval(() => {
    if (active) check();
  }, 800);

  return () => {
    active = false;
    clearInterval(interval);
  };
});

export const onboardingMachine = setup({
  types: {
    context: {} as OnboardingContext,
    events: {} as OnboardingEvent,
  },
  actors: {
    micPermissionPoller,
    accessibilityPermissionPoller,
  },
}).createMachine({
  id: "onboarding",
  initial: "welcome",
  context: {
    selectedMode: "local",
    localModelChoice: "",
    persistedLocalModel: "",
    downloadStatus: {},
    modelStatus: {},
    modelCatalog: [],
    isLoadingModelCatalog: true,
    modelCatalogUnavailable: false,
    showLocalConfirm: false,
    micPermission: false,
    accessibilityPermission: false,
    isCheckingMic: true,
    isCheckingAccessibility: true,
    smartShortcut: "Control+Space",
    captureActive: false,
    capturePreview: "",
    completionError: null,
    isCompleting: false,
    showFAQModal: false,
    transitionDirection: 1,
    hasStepTransitioned: false,
  },
  on: {
    SELECT_MODE: {
      actions: assign({ selectedMode: ({ event }) => event.mode }),
    },
    SELECT_MODEL: {
      actions: assign({ localModelChoice: ({ event }) => event.key }),
    },
    SET_DOWNLOAD_STATUS: {
      actions: assign({
        downloadStatus: ({ context, event }) => ({
          ...context.downloadStatus,
          [event.key]: event.status,
        }),
      }),
    },
    SET_MODEL_STATUS: {
      actions: assign({
        modelStatus: ({ context, event }) => ({
          ...context.modelStatus,
          [event.key]: event.status,
        }),
      }),
    },
    SET_MODEL_CATALOG: {
      actions: assign({
        modelCatalog: ({ event }) => event.catalog,
        persistedLocalModel: ({ event }) => event.persistedModel,
        isLoadingModelCatalog: false,
        modelCatalogUnavailable: false,
      }),
    },
    SET_CATALOG_LOADING: {
      actions: assign({ isLoadingModelCatalog: ({ event }) => event.loading }),
    },
    SET_CATALOG_UNAVAILABLE: {
      actions: assign({
        modelCatalogUnavailable: ({ event }) => event.unavailable,
        isLoadingModelCatalog: false,
      }),
    },
    MIC_PERMISSION_CHANGED: {
      actions: assign({
        micPermission: ({ event }) => event.granted,
        isCheckingMic: ({ event }) => event.checking,
      }),
    },
    ACCESSIBILITY_PERMISSION_CHANGED: {
      actions: assign({
        accessibilityPermission: ({ event }) => event.granted,
        isCheckingAccessibility: ({ event }) => event.checking,
      }),
    },
    SET_SHORTCUT: {
      actions: assign({ smartShortcut: ({ event }) => event.shortcut }),
    },
    CAPTURE_START: {
      actions: assign({ captureActive: true, capturePreview: "" }),
    },
    CAPTURE_END: {
      actions: assign({
        captureActive: false,
        capturePreview: "",
        smartShortcut: ({ context, event }) => event.shortcut ?? context.smartShortcut,
      }),
    },
    SET_CAPTURE_PREVIEW: {
      actions: assign({ capturePreview: ({ event }) => event.preview }),
    },
    SHOW_LOCAL_CONFIRM: {
      actions: assign({ showLocalConfirm: ({ event }) => event.show }),
    },
    COMPLETING: {
      actions: assign({ isCompleting: true, completionError: null }),
    },
    COMPLETE_SUCCESS: {
      actions: assign({ isCompleting: false }),
    },
    COMPLETE_ERROR: {
      actions: assign({
        isCompleting: false,
        completionError: ({ event }) => event.error,
      }),
    },
    TOGGLE_FAQ: {
      actions: assign({ showFAQModal: ({ event }) => event.show }),
    },
  },
  states: {
    welcome: {
      on: {
        NEXT: [
          {
            target: "localSignin",
            guard: ({ context }) => context.selectedMode === "cloud",
            actions: assign({ transitionDirection: 1, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
          },
          {
            target: "localModel",
            actions: assign({ transitionDirection: 1, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
          },
        ],
      },
    },
    localSignin: {
      on: {
        NEXT: {
          target: "localModel",
          actions: assign({ transitionDirection: 1, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
        },
        BACK: {
          target: "welcome",
          actions: assign({ transitionDirection: -1 as const, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
        },
      },
    },
    localModel: {
      on: {
        NEXT: {
          target: "microphone",
          actions: assign({ transitionDirection: 1, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
        },
        BACK: [
          {
            target: "localSignin",
            guard: ({ context }) => context.selectedMode === "cloud",
            actions: assign({ transitionDirection: -1 as const, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
          },
          {
            target: "welcome",
            actions: assign({ transitionDirection: -1 as const, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
          },
        ],
      },
    },
    microphone: {
      invoke: {
        src: "micPermissionPoller",
        id: "micPoller",
        input: {},
      },
      on: {
        NEXT: {
          target: "accessibility",
          actions: assign({ transitionDirection: 1, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
        },
        BACK: {
          target: "localModel",
          actions: assign({ transitionDirection: -1 as const, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
        },
      },
    },
    accessibility: {
      invoke: {
        src: "accessibilityPermissionPoller",
        id: "accessibilityPoller",
        input: {},
      },
      on: {
        NEXT: {
          target: "ready",
          actions: assign({ transitionDirection: 1, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
        },
        BACK: {
          target: "microphone",
          actions: assign({ transitionDirection: -1 as const, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
        },
      },
    },
    ready: {
      on: {
        BACK: {
          target: "accessibility",
          actions: assign({ transitionDirection: -1 as const, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
        },
      },
    },
  },
});

export { getSteps };
