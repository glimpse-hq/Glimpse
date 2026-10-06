import { describe, expect, test } from "bun:test";
import {
  classifyActivationInput,
  looksLikeDiscountCode,
} from "../../src/features/license/licenseKeyShape";
import {
  mulberry32,
  seedFromLicenseKey,
  seededDotField,
} from "../../src/features/license/licenseFingerprint";
import { editionFromLicenseState } from "../../src/shared/lib/licenseEdition";

const UUID = "3f2b8c1a-9d4e-4b7a-8c2d-1e5f6a7b8c9d";

describe("activation input shapes", () => {
  test("recognizes Creem and Polar keys, even inside pasted text", () => {
    expect(classifyActivationInput("ABCDE-12345-FGHIJ-67890-KLMNO")).toBe(
      "key",
    );
    expect(
      classifyActivationInput(
        "Your key: abcde-12345-fghij-67890-klmno. Thanks!",
      ),
    ).toBe("key");
    expect(classifyActivationInput(`GLIMPSE-${UUID}`)).toBe("key");
    expect(classifyActivationInput(`glimpse_pro_${UUID.toUpperCase()}`)).toBe(
      "key",
    );
  });

  test("a bare UUID is an order id, not a key", () => {
    expect(classifyActivationInput(`  ${UUID}  `)).toBe("order_id");
  });

  test("masked keys and discount codes get their own explanation", () => {
    expect(classifyActivationInput("ABCDE-*****-*****-*****-KLMNO")).toBe(
      "masked_key",
    );
    expect(classifyActivationInput("LAUNCH20")).toBe("discount_code");
    expect(classifyActivationInput("hello there")).toBe("unknown");
    expect(classifyActivationInput("")).toBe("unknown");
  });

  test("a six-character group is not a Creem key", () => {
    expect(classifyActivationInput("ABCDEF-12345-FGHIJ-67890-KLMNO")).not.toBe(
      "key",
    );
  });

  test("discount codes are one short uppercase token with at most one dash", () => {
    expect(looksLikeDiscountCode("SAVE-10")).toBe(true);
    expect(looksLikeDiscountCode(" BF_2026 ")).toBe(true);
    expect(looksLikeDiscountCode("AB")).toBe(false);
    expect(looksLikeDiscountCode("save10")).toBe(false);
    expect(looksLikeDiscountCode("A-B-C")).toBe(false);
    expect(looksLikeDiscountCode("A".repeat(25))).toBe(false);
  });
});

describe("license fingerprint", () => {
  test("seeds only from the last eight alphanumerics", () => {
    expect(seedFromLicenseKey("XXXXX-ABCD-EFGH")).toBe(
      seedFromLicenseKey("ABCDEFGH"),
    );
    expect(seedFromLicenseKey("ABCDEFGH")).not.toBe(
      seedFromLicenseKey("ABCDEFGI"),
    );
    expect(seedFromLicenseKey("---")).toBe(seedFromLicenseKey("glimpse"));
    expect(seedFromLicenseKey("ABCDEFGH")).toBeGreaterThan(0);
  });

  test("the generator is deterministic and stays in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 200; i += 1) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  test("dot fields are stable per key and bounded by the grid", () => {
    const field = seededDotField("ABCDE-12345", 10, 20);
    expect([...field]).toEqual([...seededDotField("ABCDE-12345", 10, 20)]);
    expect([...field].every((index) => index >= 0 && index < 200)).toBe(true);
    expect(field.size).toBeGreaterThan(30);
    expect(field.size).toBeLessThan(110);
    expect([...seededDotField(null, 4, 4)]).toEqual([
      ...seededDotField("glimpse", 4, 4),
    ]);
    expect(seededDotField("key", 5, 5, 0).size).toBe(0);
    expect(seededDotField("key", 5, 5, 1).size).toBe(25);
  });
});

describe("license edition", () => {
  test("only an active license shows its edition", () => {
    const state = { edition: "founder" } as Parameters<
      typeof editionFromLicenseState
    >[0];
    expect(editionFromLicenseState(state, true)).toBe("founder");
    expect(editionFromLicenseState(state, false)).toBe("personal");
    expect(editionFromLicenseState(null, true)).toBe("personal");
  });
});
