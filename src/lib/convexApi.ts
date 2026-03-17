import { makeFunctionReference } from "convex/server";

const q = (name: string) => makeFunctionReference<"query">(name);
const m = (name: string) => makeFunctionReference<"mutation">(name);

export const api = {
  sessions: {
    listUserSessions: q("sessions:listUserSessions"),
    revokeOtherSessions: m("sessions:revokeOtherSessions"),
    revokeSession: m("sessions:revokeSession"),
    upsertCurrentSessionMetadata: m("sessions:upsertCurrentSessionMetadata"),
  },
  users: {
    currentUser: q("users:currentUser"),
    updateName: m("users:updateName"),
  },
} as const;
