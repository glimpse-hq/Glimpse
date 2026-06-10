import { setup, assign } from "xstate";
import type { DetectedApp, TranscriptionMode } from "../../types";
import {
  getOnboardingPlatform,
  type OnboardingPlatform,
  type OnboardingStep,
} from "./platform";

export type OnboardingLanguagePreference = "english" | "multilingual";
export type OnboardingModelPriority = "quality" | "balanced" | "compact";

export type OnboardingContext = {
  platform: OnboardingPlatform;
  selectedMode: TranscriptionMode;
  importableApps: DetectedApp[];
  localModelChoice: string;
  languagePreference: OnboardingLanguagePreference | null;
  modelPriority: OnboardingModelPriority | null;
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
  | { type: "SET_IMPORTABLE"; apps: DetectedApp[] }
  | { type: "SELECT_MODEL"; key: string }
  | { type: "SELECT_LANGUAGE"; language: OnboardingLanguagePreference }
  | { type: "SELECT_PRIORITY"; priority: OnboardingModelPriority }
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

  steps.push("setup");

  if (
    platform.requiresMicrophonePermission ||
    platform.requiresAccessibilityPermission
  ) {
    steps.push("permissions");
  }

  steps.push("license");
  return steps;
}

const hasImportStep = ({ context }: { context: OnboardingContext }) =>
  context.selectedMode === "local" && context.importableApps.length > 0;

const requiresPermissionsStep = ({ context }: { context: OnboardingContext }) =>
  context.platform.requiresMicrophonePermission ||
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
    importableApps: [],
    localModelChoice: "",
    languagePreference: null,
    modelPriority: null,
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
    SET_IMPORTABLE: {
      actions: assign({ importableApps: ({ event }) => event.apps }),
    },
    SELECT_MODEL: {
      actions: assign({ localModelChoice: ({ event }) => event.key }),
    },
    SELECT_LANGUAGE: {
      actions: assign({
        languagePreference: ({ event }) => event.language,
        localModelChoice: "",
      }),
    },
    SELECT_PRIORITY: {
      actions: assign({
        modelPriority: ({ event }) => event.priority,
        localModelChoice: "",
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
        smartShortcut: ({ context, event }) =>
          event.shortcut ?? context.smartShortcut,
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
            actions: assign({
              transitionDirection: 1,
              hasStepTransitioned: true,
              showLocalConfirm: false,
              completionError: null,
            }),
          },
          {
            target: "setup",
            actions: assign({
              transitionDirection: 1,
              hasStepTransitioned: true,
              showLocalConfirm: false,
              completionError: null,
            }),
          },
        ],
      },
    },
    import: {
      on: {
        NEXT: {
          target: "setup",
          actions: assign({
            transitionDirection: 1,
            hasStepTransitioned: true,
            showLocalConfirm: false,
            completionError: null,
          }),
        },
        BACK: {
          target: "welcome",
          actions: assign({
            transitionDirection: -1 as const,
            hasStepTransitioned: true,
            showLocalConfirm: false,
            completionError: null,
          }),
        },
      },
    },
    setup: {
      on: {
        NEXT: [
          {
            target: "permissions",
            guard: requiresPermissionsStep,
            actions: assign({
              transitionDirection: 1,
              hasStepTransitioned: true,
              showLocalConfirm: false,
              completionError: null,
            }),
          },
          {
            target: "license",
            actions: assign({
              transitionDirection: 1,
              hasStepTransitioned: true,
              showLocalConfirm: false,
              completionError: null,
            }),
          },
        ],
        BACK: [
          {
            target: "import",
            guard: hasImportStep,
            actions: assign({
              transitionDirection: -1 as const,
              hasStepTransitioned: true,
              showLocalConfirm: false,
              completionError: null,
            }),
          },
          {
            target: "welcome",
            actions: assign({
              transitionDirection: -1 as const,
              hasStepTransitioned: true,
              showLocalConfirm: false,
              completionError: null,
            }),
          },
        ],
      },
    },
    permissions: {
      on: {
        NEXT: {
          target: "license",
          actions: assign({
            transitionDirection: 1,
            hasStepTransitioned: true,
            showLocalConfirm: false,
            completionError: null,
          }),
        },
        BACK: {
          target: "setup",
          actions: assign({
            transitionDirection: -1 as const,
            hasStepTransitioned: true,
            showLocalConfirm: false,
            completionError: null,
          }),
        },
      },
    },
    license: {
      on: {
        BACK: [
          {
            target: "permissions",
            guard: requiresPermissionsStep,
            actions: assign({
              transitionDirection: -1 as const,
              hasStepTransitioned: true,
              showLocalConfirm: false,
              completionError: null,
            }),
          },
          {
            target: "setup",
            actions: assign({
              transitionDirection: -1 as const,
              hasStepTransitioned: true,
              showLocalConfirm: false,
              completionError: null,
            }),
          },
        ],
      },
    },
  },
});

export { getSteps };
