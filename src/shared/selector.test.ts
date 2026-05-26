import { describe, expect, it } from "vitest";
import { buildElementTarget, getStableCssSelector, getXPath } from "./selector";

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

  it("normalizes icon-only download buttons", () => {
    document.body.innerHTML = `
      <button aria-label="title" class="download-button">
        <svg class="arrow-down"><title>download</title><path /></svg>
      </button>
    `;
    const path = document.querySelector("path")!;
    const target = buildElementTarget(path);
    expect(target.tagName).toBe("button");
    expect(target.role).toBe("button");
    expect(target.ariaLabel).toBe("Download");
    expect(target.selector).toBe('button[aria-label="title"]');
    expect(target.candidates[0]).toMatchObject({ kind: "role", value: "button:Download" });
  });

  it("falls back to ancestor chain when local selectors are not unique", () => {
    document.body.innerHTML = `
      <ul>
        <li data-testid="row"><span class="value">a</span></li>
        <li data-testid="row"><span class="value">b</span></li>
      </ul>
    `;
    const spans = document.querySelectorAll("span.value");
    const second = spans[1] as Element;
    const selector = getStableCssSelector(second);
    expect(document.querySelectorAll(selector).length).toBe(1);
    expect(document.querySelector(selector)).toBe(second);
  });

  it("skips IDs that are not actually unique on the page", () => {
    document.body.innerHTML = '<div id="dup"></div><div id="dup"></div>';
    const second = document.querySelectorAll("#dup")[1] as Element;
    const selector = getStableCssSelector(second);
    expect(document.querySelectorAll(selector)).toHaveLength(1);
  });

  it("does not mislabel content-rich containers as 'Close' just because their class list contains 'x'", () => {
    document.body.innerHTML = `
      <div class="task-card-shell group relative overflow-hidden cursor-pointer bg-card shadow-[0_2px_6px] hover:-translate-y-[2px] rounded-md task-card--priority-high">
        <h3>Ship the new dashboard</h3>
        <p>Due tomorrow · assigned to Mia</p>
      </div>
    `;
    const heading = document.querySelector("h3")!;
    const target = buildElementTarget(heading);
    expect(target.ariaLabel).toBeUndefined();
    // text should come through and become the recognisable name.
    expect(target.text).toContain("Ship the new dashboard");
  });

  it("does not mislabel a container that wraps a download icon as the container", () => {
    document.body.innerHTML = `
      <article class="card">
        <h2>Quarterly report</h2>
        <p>Final draft</p>
        <button class="download-button" aria-label="Download report"><svg><title>download</title></svg></button>
      </article>
    `;
    const article = document.querySelector("article")!;
    const target = buildElementTarget(article);
    // The article has too much text to be considered an icon — no false label.
    expect(target.ariaLabel).toBeUndefined();
  });

  it("infers download labels for unlabeled icon controls", () => {
    document.body.innerHTML = `
      <a class="download-link">
        <svg><title>Download report</title><path /></svg>
      </a>
    `;
    const path = document.querySelector("path")!;
    const target = buildElementTarget(path);
    expect(target.tagName).toBe("a");
    expect(target.role).toBe("link");
    expect(target.ariaLabel).toBe("Download");
    expect(target.candidates[0]).toMatchObject({ kind: "role", value: "link:Download" });
  });
});
