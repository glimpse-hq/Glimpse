import { makeFunctionReference } from "convex/server";

const q = (name: string) => makeFunctionReference<"query">(name);
const m = (name: string) => makeFunctionReference<"mutation">(name);
const a = (name: string) => makeFunctionReference<"action">(name);

export const api = {
  checkout: {
    createCheckoutSession: a("checkout:createCheckoutSession"),
  },
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
  wallets: {
    getWallet: q("wallets:getWallet"),
  },
} as const;
