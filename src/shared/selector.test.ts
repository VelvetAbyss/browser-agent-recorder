import { describe, expect, it } from "vitest";
import { getStableCssSelector, getXPath } from "./selector";

describe("selectors", () => {
  it("prefers id selectors", () => {
    document.body.innerHTML = '<button id="save">Save</button>';
    const button = document.querySelector("button")!;
    expect(getStableCssSelector(button)).toBe("#save");
    expect(getXPath(button)).toBe('//*[@id="save"]');
  });

  it("uses data attributes when available", () => {
    document.body.innerHTML = '<button data-testid="submit">Save</button>';
    const button = document.querySelector("button")!;
    expect(getStableCssSelector(button)).toBe('[data-testid="submit"]');
  });
});
