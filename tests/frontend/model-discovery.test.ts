import { describe, expect, test } from "bun:test";
import {
  applyModelDiscoveryFailure,
  applyModelDiscoverySuccess,
  beginModelDiscovery,
  EMPTY_MODEL_DISCOVERY_STATE,
  resetModelDiscovery,
} from "../../src/features/settings/modelDiscovery";

describe("settings model discovery state", () => {
  test("clears discovered models when provider settings change", () => {
    const state = {
      requestSeq: 3,
      models: ["old-model-a", "old-model-b"],
    };

    expect(resetModelDiscovery(state)).toEqual({
      requestSeq: 4,
      models: [],
    });
  });

  test("keeps the current list while a refresh is in flight", () => {
    const state = {
      requestSeq: 1,
      models: ["cached-model"],
    };

    expect(beginModelDiscovery(state)).toEqual({
      requestSeq: 2,
      state: {
        requestSeq: 2,
        models: ["cached-model"],
      },
    });
  });

  test("applies the current successful discovery response", () => {
    const request = beginModelDiscovery(EMPTY_MODEL_DISCOVERY_STATE);

    expect(
      applyModelDiscoverySuccess(request.state, request.requestSeq, [
        "model-a",
        "model-b",
      ]),
    ).toEqual({
      requestSeq: request.requestSeq,
      models: ["model-a", "model-b"],
    });
  });

  test("applies only the latest successful discovery response", () => {
    const firstRequest = beginModelDiscovery(EMPTY_MODEL_DISCOVERY_STATE);
    const secondRequest = beginModelDiscovery(firstRequest.state);

    const afterLateFirst = applyModelDiscoverySuccess(
      secondRequest.state,
      firstRequest.requestSeq,
      ["stale-model"],
    );
    const afterSecond = applyModelDiscoverySuccess(
      afterLateFirst,
      secondRequest.requestSeq,
      ["current-model"],
    );

    expect(afterLateFirst.models).toEqual([]);
    expect(afterSecond.models).toEqual(["current-model"]);
  });

  test("stale successful responses cannot overwrite existing newer models", () => {
    const firstRequest = beginModelDiscovery({
      requestSeq: 8,
      models: ["existing-model"],
    });
    const secondRequest = beginModelDiscovery(firstRequest.state);
    const afterSecond = applyModelDiscoverySuccess(
      secondRequest.state,
      secondRequest.requestSeq,
      ["newer-model"],
    );

    expect(
      applyModelDiscoverySuccess(afterSecond, firstRequest.requestSeq, [
        "stale-model",
      ]),
    ).toEqual(afterSecond);
  });

  test("clears models only for the current failed discovery request", () => {
    const firstRequest = beginModelDiscovery({
      requestSeq: 4,
      models: ["existing-model"],
    });
    const secondRequest = beginModelDiscovery(firstRequest.state);

    const afterLateFirstFailure = applyModelDiscoveryFailure(
      secondRequest.state,
      firstRequest.requestSeq,
    );
    const afterSecondFailure = applyModelDiscoveryFailure(
      afterLateFirstFailure,
      secondRequest.requestSeq,
    );

    expect(afterLateFirstFailure.models).toEqual(["existing-model"]);
    expect(afterSecondFailure.models).toEqual([]);
  });
});
