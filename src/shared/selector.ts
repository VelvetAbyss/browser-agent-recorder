import type { ElementTarget, SelectorCandidate } from "./types";

function cssEscape(value: string) {
  if (typeof CSS !== "undefined" && "escape" in CSS) {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function cleanText(value?: string | null) {
  return value?.replace(/\s+/g, " ").trim().slice(0, 120) || undefined;
}

function attrSelector(name: string, value?: string | null) {
  return value ? `[${name}="${value.replace(/"/g, '\\"')}"]` : "";
}

export function getXPath(element: Element) {
  if (element.id) {
    return `//*[@id="${element.id.replace(/"/g, '\\"')}"]`;
  }
  const segments: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === current.tagName) {
        index += 1;
      }
      sibling = sibling.previousElementSibling;
    }
    segments.unshift(`${current.tagName.toLowerCase()}[${index}]`);
    current = current.parentElement;
  }
  return `/${segments.join("/")}`;
}

export function getStableCssSelector(element: Element) {
  if (element.id) {
    return `#${cssEscape(element.id)}`;
  }
  const dataTest = element.getAttribute("data-testid") || element.getAttribute("data-test") || element.getAttribute("data-qa");
  if (dataTest) {
    return attrSelector(element.hasAttribute("data-testid") ? "data-testid" : element.hasAttribute("data-test") ? "data-test" : "data-qa", dataTest);
  }

  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.body && parts.length < 4) {
    let part = current.tagName.toLowerCase();
    const name = current.getAttribute("name");
    const aria = current.getAttribute("aria-label");
    if (name) {
      part += attrSelector("name", name);
    } else if (aria) {
      part += attrSelector("aria-label", aria);
    } else {
      const siblings = Array.from(current.parentElement?.children || []).filter((child) => child.tagName === current?.tagName);
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
    }
    parts.unshift(part);
    current = current.parentElement;
  }
  return parts.join(" > ");
}

export function buildElementTarget(element: Element): ElementTarget {
  const htmlElement = element as HTMLElement;
  const rect = htmlElement.getBoundingClientRect();
  const tagName = element.tagName.toLowerCase();
  const role = element.getAttribute("role") || undefined;
  const text = cleanText(htmlElement.innerText || element.textContent);
  const ariaLabel = element.getAttribute("aria-label") || undefined;
  const placeholder = element.getAttribute("placeholder") || undefined;
  const name = element.getAttribute("name") || undefined;
  const id = element.id || undefined;
  const selector = getStableCssSelector(element);
  const xpath = getXPath(element);
  const candidates: SelectorCandidate[] = [];

  if (role && (ariaLabel || text)) {
    candidates.push({ kind: "role", value: `${role}:${ariaLabel || text}`, confidence: 0.92 });
  }
  if (ariaLabel) {
    candidates.push({ kind: "label", value: ariaLabel, confidence: 0.88 });
  }
  if (placeholder) {
    candidates.push({ kind: "placeholder", value: placeholder, confidence: 0.82 });
  }
  if (text && ["button", "a", "summary", "label"].includes(tagName)) {
    candidates.push({ kind: "text", value: text, confidence: 0.74 });
  }
  candidates.push({ kind: "css", value: selector, confidence: id ? 0.86 : selector.includes("data-") ? 0.84 : 0.62 });
  candidates.push({ kind: "xpath", value: xpath, confidence: 0.42 });

  return {
    tagName,
    role,
    text,
    ariaLabel,
    placeholder,
    name,
    id,
    selector,
    xpath,
    selectorConfidence: Math.max(...candidates.map((candidate) => candidate.confidence)),
    candidates,
    boundingBox: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }
  };
}
