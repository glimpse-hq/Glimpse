import { describe, expect, test } from "bun:test";
import { openLayer } from "../../src/shared/hooks/useFocusTrap";

describe("key layers", () => {
  test("only the newest open layer is on top", () => {
    const modal = openLayer();
    expect(modal.isTop()).toBe(true);

    const menu = openLayer();
    expect(menu.isTop()).toBe(true);
    expect(modal.isTop()).toBe(false);

    menu.close();
    expect(modal.isTop()).toBe(true);
    modal.close();
  });

  test("closing a lower layer leaves the top one in place", () => {
    const modal = openLayer();
    const menu = openLayer();

    modal.close();
    expect(menu.isTop()).toBe(true);
    expect(modal.isTop()).toBe(false);

    menu.close();
    expect(menu.isTop()).toBe(false);
  });

  test("closing twice does not remove another layer", () => {
    const modal = openLayer();
    const menu = openLayer();

    menu.close();
    menu.close();
    expect(modal.isTop()).toBe(true);
    modal.close();
  });
});
