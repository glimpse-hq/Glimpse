import { setup, assign } from "xstate";
import type { DetectedApp, TranscriptionMode } from "../../types";
import {
  getOnboardingPlatform,
  type OnboardingPlatform,
  type OnboardingStep,
} from "./platform";

export type LocalDownloadStatus = {
  status: "idle" | "downloading" | "complete" | "error" | "cancelled";
  percent: number;
  file?: string;
  message?: string;
};

export type OnboardingContext = {
  platform: OnboardingPlatform;
  selectedMode: TranscriptionMode;
  importableApps: DetectedApp[];
  localModelChoice: string;
  showLocalConfirm: boolean;
  smartShortcut: string;
  captureActive: boolean;
  capturePreview: string;
  completionError: string | null;
  isCompleting: boolean;
  showFAQModal: boolean;
  transitionDirection: 1 | -1;
  hasStepTransitioned: boolean;
  skippedLocalModel: boolean;
};

export type OnboardingEvent =
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "SELECT_MODE"; mode: TranscriptionMode }
  | { type: "SET_IMPORTABLE"; apps: DetectedApp[] }
  | { type: "SELECT_MODEL"; key: string }
  | { type: "SKIP_LOCAL_MODEL" }
  | { type: "SET_SHORTCUT"; shortcut: string }
  | { type: "CAPTURE_START" }
  | { type: "CAPTURE_END"; shortcut?: string }
  | { type: "SET_CAPTURE_PREVIEW"; preview: string }
  | { type: "SHOW_LOCAL_CONFIRM"; show: boolean }
  | { type: "COMPLETING" }
  | { type: "COMPLETE_SUCCESS" }
  | { type: "COMPLETE_ERROR"; error: string }
  | { type: "TOGGLE_FAQ"; show: boolean };

function getSteps(
  platform: OnboardingPlatform = getOnboardingPlatform(),
  hasImport: boolean = false,
): OnboardingStep[] {
  const steps: OnboardingStep[] = ["welcome"];

  if (hasImport) {
    steps.push("import");
  }

  steps.push("localModel");

  if (platform.requiresMicrophonePermission) {
    steps.push("microphone");
  }

  if (platform.requiresAccessibilityPermission) {
    steps.push("accessibility");
  }

  steps.push("ready", "license");
  return steps;
}

const hasImportStep = ({ context }: { context: OnboardingContext }) =>
  context.selectedMode === "local" && context.importableApps.length > 0;

const requiresMicrophoneStep = ({ context }: { context: OnboardingContext }) =>
  context.platform.requiresMicrophonePermission;

const requiresAccessibilityStep = ({ context }: { context: OnboardingContext }) =>
  context.platform.requiresAccessibilityPermission;

const skippedLocalModelStep = ({ context }: { context: OnboardingContext }) =>
  context.skippedLocalModel;

export const onboardingMachine = setup({
  types: {
    context: {} as OnboardingContext,
    events: {} as OnboardingEvent,
  },
}).createMachine({
  id: "onboarding",
  initial: "welcome",
  context: {
    platform: getOnboardingPlatform(),
    selectedMode: "local",
    importableApps: [],
    localModelChoice: "",
    showLocalConfirm: false,
    smartShortcut: "Control+Space",
    captureActive: false,
    capturePreview: "",
    completionError: null,
    isCompleting: false,
    showFAQModal: false,
    transitionDirection: 1,
    hasStepTransitioned: false,
    skippedLocalModel: false,
  },
  on: {
    SELECT_MODE: {
      actions: assign({ selectedMode: ({ event }) => event.mode }),
    },
    SET_IMPORTABLE: {
      actions: assign({ importableApps: ({ event }) => event.apps }),
    },
    SELECT_MODEL: {
      actions: assign({ localModelChoice: ({ event }) => event.key }),
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
            target: "import",
            guard: hasImportStep,
            actions: assign({ transitionDirection: 1, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
          },
          {
            target: "localModel",
            actions: assign({ transitionDirection: 1, hasStepTransitioned: true, showLocalConfirm: false, completionError: null, skippedLocalModel: false }),
          },
        ],
      },
    },
    import: {
      on: {
        NEXT: {
          target: "localModel",
          actions: assign({ transitionDirection: 1, hasStepTransitioned: true, showLocalConfirm: false, completionError: null, skippedLocalModel: false }),
        },
        SKIP_LOCAL_MODEL: [
          {
            target: "microphone",
            guard: requiresMicrophoneStep,
            actions: assign({ transitionDirection: 1, hasStepTransitioned: true, showLocalConfirm: false, completionError: null, skippedLocalModel: true }),
          },
          {
            target: "accessibility",
            guard: requiresAccessibilityStep,
            actions: assign({ transitionDirection: 1, hasStepTransitioned: true, showLocalConfirm: false, completionError: null, skippedLocalModel: true }),
          },
          {
            target: "ready",
            actions: assign({ transitionDirection: 1, hasStepTransitioned: true, showLocalConfirm: false, completionError: null, skippedLocalModel: true }),
          },
        ],
        BACK: {
          target: "welcome",
          actions: assign({ transitionDirection: -1 as const, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
        },
      },
    },
    localModel: {
      on: {
        NEXT: [
          {
            target: "microphone",
            guard: requiresMicrophoneStep,
            actions: assign({ transitionDirection: 1, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
          },
          {
            target: "accessibility",
            guard: requiresAccessibilityStep,
            actions: assign({ transitionDirection: 1, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
          },
          {
            target: "ready",
            actions: assign({ transitionDirection: 1, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
          },
        ],
        BACK: [
          {
            target: "import",
            guard: hasImportStep,
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
      on: {
        NEXT: [
          {
            target: "accessibility",
            guard: requiresAccessibilityStep,
            actions: assign({ transitionDirection: 1, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
          },
          {
            target: "ready",
            actions: assign({ transitionDirection: 1, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
          },
        ],
        BACK: [
          {
            target: "import",
            guard: skippedLocalModelStep,
            actions: assign({ transitionDirection: -1 as const, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
          },
          {
            target: "localModel",
            actions: assign({ transitionDirection: -1 as const, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
          },
        ],
      },
    },
    accessibility: {
      on: {
        NEXT: {
          target: "ready",
          actions: assign({ transitionDirection: 1, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
        },
        BACK: [
          {
            target: "microphone",
            guard: requiresMicrophoneStep,
            actions: assign({ transitionDirection: -1 as const, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
          },
          {
            target: "import",
            guard: skippedLocalModelStep,
            actions: assign({ transitionDirection: -1 as const, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
          },
          {
            target: "localModel",
            actions: assign({ transitionDirection: -1 as const, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
          },
        ],
      },
    },
    ready: {
      on: {
        NEXT: {
          target: "license",
          actions: assign({ transitionDirection: 1, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
        },
        BACK: [
          {
            target: "accessibility",
            guard: requiresAccessibilityStep,
            actions: assign({ transitionDirection: -1 as const, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
          },
          {
            target: "microphone",
            guard: requiresMicrophoneStep,
            actions: assign({ transitionDirection: -1 as const, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
          },
          {
            target: "import",
            guard: skippedLocalModelStep,
            actions: assign({ transitionDirection: -1 as const, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
          },
          {
            target: "localModel",
            actions: assign({ transitionDirection: -1 as const, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
          },
        ],
      },
    },
    license: {
      on: {
        BACK: {
          target: "ready",
          actions: assign({ transitionDirection: -1 as const, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
        },
      },
    },
  },
});

export { getSteps };
