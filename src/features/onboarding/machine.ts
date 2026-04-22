import { setup, assign } from "xstate";
import type { TranscriptionMode } from "../../types";
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
};

export type OnboardingEvent =
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "SELECT_MODE"; mode: TranscriptionMode }
  | { type: "SELECT_MODEL"; key: string }
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
  mode: TranscriptionMode,
  platform: OnboardingPlatform = getOnboardingPlatform(),
): OnboardingStep[] {
  const steps: OnboardingStep[] =
    mode === "cloud"
      ? ["welcome", "localSignin", "localModel"]
      : ["welcome", "localModel"];

  if (platform.requiresMicrophonePermission) {
    steps.push("microphone");
  }

  if (platform.requiresAccessibilityPermission) {
    steps.push("accessibility");
  }

  steps.push("ready");
  return steps;
}

const requiresMicrophoneStep = ({ context }: { context: OnboardingContext }) =>
  context.platform.requiresMicrophonePermission;

const requiresAccessibilityStep = ({ context }: { context: OnboardingContext }) =>
  context.platform.requiresAccessibilityPermission;

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
  },
  on: {
    SELECT_MODE: {
      actions: assign({ selectedMode: ({ event }) => event.mode }),
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
        BACK: {
          target: "localModel",
          actions: assign({ transitionDirection: -1 as const, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
        },
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
            target: "localModel",
            actions: assign({ transitionDirection: -1 as const, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
          },
        ],
      },
    },
    ready: {
      on: {
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
            target: "localModel",
            actions: assign({ transitionDirection: -1 as const, hasStepTransitioned: true, showLocalConfirm: false, completionError: null }),
          },
        ],
      },
    },
  },
});

export { getSteps };
