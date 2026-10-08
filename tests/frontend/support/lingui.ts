import { mock } from "bun:test";
import { join } from "node:path";

type Descriptor = { id?: string; message?: string };

// The Lingui macros only run under the Babel plugin, and src/i18n.ts uses
// Vite's import.meta.glob, so tests swap both for source-language passthroughs.
export function mockLingui() {
  mock.module("@lingui/core/macro", () => ({
    msg: (descriptor: Descriptor) => descriptor,
    plural: (count: number, forms: { one: string; other: string }) =>
      (count === 1 ? forms.one : forms.other).replace("#", String(count)),
  }));
  mock.module(join(import.meta.dir, "../../../src/i18n"), () => ({
    i18n: {
      _: (descriptor: Descriptor) => descriptor.message ?? descriptor.id,
    },
  }));
}
