import { describe, expect, test } from "bun:test";
import { createActor } from "xstate";
import {
  getSteps,
  onboardingMachine,
  type OnboardingContext,
} from "../../src/features/onboarding/machine";

const mac = {
  id: "macos" as const,
  requiresMicrophonePermission: true,
  requiresAccessibilityPermission: true,
};
const windows = {
  id: "windows" as const,
  requiresMicrophonePermission: false,
  requiresAccessibilityPermission: false,
};
const importable = [
  { id: "superwhisper" },
] as OnboardingContext["importableApps"];

function start(platform: OnboardingContext["platform"]) {
  const actor = createActor(onboardingMachine, {
    snapshot: onboardingMachine.resolveState({
      value: "welcome",
      context: {
        ...onboardingMachine.config.context,
        platform,
      } as OnboardingContext,
    }),
  });
  actor.start();
  return actor;
}

function walk(
  actor: ReturnType<typeof start>,
  type: "NEXT" | "BACK",
  times: number,
) {
  const visited: string[] = [];
  for (let i = 0; i < times; i += 1) {
    actor.send({ type });
    visited.push(String(actor.getSnapshot().value));
  }
  return visited;
}

describe("onboarding steps", () => {
  test("permissions only appear where the platform needs them", () => {
    expect(getSteps(mac)).toEqual([
      "model",
      "source",
      "permissions",
      "license",
    ]);
    expect(getSteps(windows)).toEqual(["model", "source", "license"]);
    expect(getSteps(windows, true)).toEqual([
      "import",
      "model",
      "source",
      "license",
    ]);
  });
});

describe("onboarding machine", () => {
  test("walks forward and back through every macOS step", () => {
    const actor = start(mac);
    expect(walk(actor, "NEXT", 5)).toEqual([
      "model",
      "source",
      "permissions",
      "license",
      "done",
    ]);
    expect(actor.getSnapshot().context).toMatchObject({
      transitionDirection: 1,
      hasStepTransitioned: true,
    });
    expect(walk(actor, "BACK", 5)).toEqual([
      "license",
      "permissions",
      "source",
      "model",
      "welcome",
    ]);
    expect(actor.getSnapshot().context.transitionDirection).toBe(-1);
  });

  test("skips permissions on Windows in both directions", () => {
    const actor = start(windows);
    expect(walk(actor, "NEXT", 4)).toEqual([
      "model",
      "source",
      "license",
      "done",
    ]);
    expect(walk(actor, "BACK", 2)).toEqual(["license", "source"]);
  });

  test("the import step only shows for local mode with importable apps", () => {
    const actor = start(windows);
    actor.send({ type: "SET_IMPORTABLE", apps: importable });
    expect(walk(actor, "NEXT", 2)).toEqual(["import", "model"]);
    expect(walk(actor, "BACK", 2)).toEqual(["import", "welcome"]);

    actor.send({ type: "SELECT_MODE", mode: "cloud" });
    expect(walk(actor, "NEXT", 1)).toEqual(["model"]);
    expect(walk(actor, "BACK", 1)).toEqual(["welcome"]);
  });

  test("practice is reachable only from done", () => {
    const actor = start(windows);
    actor.send({ type: "START_PRACTICE" });
    expect(actor.getSnapshot().value).toBe("welcome");
    walk(actor, "NEXT", 4);
    actor.send({ type: "START_PRACTICE" });
    expect(actor.getSnapshot().value).toBe("practice");
    actor.send({ type: "NEXT" });
    expect(actor.getSnapshot().value).toBe("practice");
    expect(walk(actor, "BACK", 1)).toEqual(["done"]);
  });

  test("completion errors clear on the next step", () => {
    const actor = start(windows);
    actor.send({ type: "COMPLETING" });
    expect(actor.getSnapshot().context.isCompleting).toBe(true);
    actor.send({ type: "COMPLETE_ERROR", error: "disk full" });
    expect(actor.getSnapshot().context).toMatchObject({
      isCompleting: false,
      completionError: "disk full",
    });
    actor.send({ type: "NEXT" });
    expect(actor.getSnapshot().context.completionError).toBeNull();
  });

  test("records choices from any step", () => {
    const actor = start(mac);
    actor.send({ type: "SELECT_MODEL", key: "parakeet_v3" });
    actor.send({ type: "SET_MICROPHONE_DEVICE", device: "USB Mic" });
    actor.send({ type: "SET_AUTO_LAUNCH", value: true });
    actor.send({ type: "SET_SHORTCUT", shortcut: "Control+Space" });
    actor.send({ type: "TOGGLE_FAQ", show: true });
    expect(actor.getSnapshot().context).toMatchObject({
      localModelChoice: "parakeet_v3",
      microphoneDevice: "USB Mic",
      autoLaunch: true,
      smartShortcut: "Control+Space",
      showFAQModal: true,
    });
  });
});
