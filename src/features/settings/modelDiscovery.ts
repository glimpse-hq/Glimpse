export type ModelDiscoveryState = {
  requestSeq: number;
  models: string[];
};

export const EMPTY_MODEL_DISCOVERY_STATE: ModelDiscoveryState = {
  requestSeq: 0,
  models: [],
};

export function resetModelDiscovery(
  state: ModelDiscoveryState,
): ModelDiscoveryState {
  return {
    requestSeq: state.requestSeq + 1,
    models: [],
  };
}

export function beginModelDiscovery(state: ModelDiscoveryState): {
  state: ModelDiscoveryState;
  requestSeq: number;
} {
  const nextState = {
    ...state,
    requestSeq: state.requestSeq + 1,
  };
  return {
    state: nextState,
    requestSeq: nextState.requestSeq,
  };
}

export function applyModelDiscoverySuccess(
  state: ModelDiscoveryState,
  requestSeq: number,
  models: string[],
): ModelDiscoveryState {
  if (requestSeq !== state.requestSeq) return state;
  return {
    ...state,
    models,
  };
}

export function applyModelDiscoveryFailure(
  state: ModelDiscoveryState,
  requestSeq: number,
): ModelDiscoveryState {
  if (requestSeq !== state.requestSeq) return state;
  return {
    ...state,
    models: [],
  };
}
