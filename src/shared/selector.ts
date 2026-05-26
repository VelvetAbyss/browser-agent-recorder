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

function getDirectChildText(element: Element, selector: string) {
  const child = element.querySelector(selector);
  return cleanText(child?.textContent);
}

function ownVisibleText(element: Element) {
  // Only the element's direct text (Text node children), not descendants.
  // Used to decide whether an element is icon-only — descendant text from
  // a card's whole body would otherwise drown out the signal.
  let buffer = "";
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) buffer += child.nodeValue ?? "";
  }
  return buffer.trim();
}

function inferIconLabel(element: Element) {
  // Only attempt icon inference when the element actually looks like an
  // icon-only control. We gate on (a) total text content being short
  // enough to be a label and (b) the element's own (direct-child) text
  // being trivial. Otherwise descendant SVGs and utility classes
  // ("overflow-hidden", "box-shadow", "task-card--priority-high")
  // trigger false positives like labelling an entire task card as
  // "Close" because "x" appears in "overflow" or "box", or labelling a
  // whole article as "Download" because it wraps a download icon.
  const fullText = (
    (element instanceof HTMLElement ? element.innerText : "") ||
    element.textContent ||
    ""
  ).trim();
  if (fullText.length > 24) return undefined;
  const ownText = ownVisibleText(element);
  if (ownText.length > 6) return undefined;

  const ownClass = element.getAttribute("class") ?? "";
  // Only consider a single direct-line icon child, not anything reached
  // through descendant traversal.
  const directSvg = element.querySelector(":scope > svg") || element.querySelector(":scope > * > svg");
  const directUse =
    directSvg?.querySelector(":scope > use") ||
    element.querySelector(":scope > use");
  const directSvgTitle = directSvg?.querySelector(":scope > title")?.textContent ?? undefined;

  const iconText = [
    element.getAttribute("title"),
    element.getAttribute("aria-label"),
    element.getAttribute("data-icon"),
    element.getAttribute("icon"),
    getDirectChildText(element, ":scope > title"),
    directSvgTitle,
    directUse?.getAttribute("href"),
    directUse?.getAttribute("xlink:href"),
    // Skip long utility class lists; they're noise.
    ownClass.length < 80 ? ownClass : null,
    directSvg?.getAttribute("class")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!iconText) return undefined;

  // Word-boundaried matches so bare letters in unrelated class names
  // (overflow-hidden, box-shadow, max-width, etc.) cannot trip these.
  if (/\b(download|arrow[-_]?down|file[-_]?download|save[-_]?alt|cloud[-_]?download)\b/.test(iconText)) {
    return "Download";
  }
  if (/\b(calendar|date[-_]?range|datepicker|event)\b/.test(iconText)) return "Date picker";
  if (/\b(close|dismiss|xmark|x[-_]close|close[-_]icon|icon[-_]close)\b/.test(iconText)) return "Close";
  if (/\b(menu|hamburger|burger)\b/.test(iconText)) return "Menu";
  if (/\b(search|magnifier|loupe|magnifying)\b/.test(iconText)) return "Search";
  if (/\b(settings|gear|cog)\b/.test(iconText)) return "Settings";
  if (/\b(edit|pencil|pen[-_]?icon)\b/.test(iconText)) return "Edit";
  if (/\b(delete|trash|bin)\b/.test(iconText)) return "Delete";
  if (/\b(plus|add|create)\b/.test(iconText)) return "Add";
  return undefined;
}

function isGenericAccessibleName(value?: string) {
  return Boolean(value && /^(title|icon|button|link|image|svg|download icon)$/i.test(value.trim()));
}

function accessibleName(element: Element) {
  const labelledBy = element.getAttribute("aria-labelledby");
  const labelledText = labelledBy
    ?.split(/\s+/)
    .map((id) => cleanText(document.getElementById(id)?.textContent))
    .filter(Boolean)
    .join(" ");
  const ariaLabel = cleanText(element.getAttribute("aria-label"));
  const iconLabel = inferIconLabel(element);
  if (isGenericAccessibleName(ariaLabel) && iconLabel) return iconLabel;
  return cleanText(ariaLabel || labelledText || element.getAttribute("title") || element.getAttribute("alt") || element.getAttribute("data-testid") || element.getAttribute("data-test") || iconLabel);
}

function interactiveAncestor(element: Element) {
  return element.closest("button,a,[role='button'],[role='link'],input[type='button'],input[type='submit']") || element;
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

function isUnique(root: ParentNode, selector: string, target: Element) {
  try {
    const matches = root.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === target;
  } catch {
    return false;
  }
}

const UNSTABLE_CLASS_PATTERN = /(^|[-_])([0-9a-f]{5,}|css-[a-z0-9]+|sc-[a-z0-9]+|jsx-[0-9]+|emotion-[0-9]+)($|[-_])/i;

function stableClasses(element: Element) {
  return Array.from(element.classList).filter((klass) => klass.length > 0 && klass.length < 40 && !UNSTABLE_CLASS_PATTERN.test(klass));
}

function nthOfTypeIndex(element: Element) {
  const parent = element.parentElement;
  if (!parent) return 1;
  const siblings = Array.from(parent.children).filter((child) => child.tagName === element.tagName);
  return siblings.indexOf(element) + 1;
}

function localCandidates(element: Element): string[] {
  const tag = element.tagName.toLowerCase();
  const out: string[] = [];
  const dataAttrs = ["data-testid", "data-test", "data-qa", "data-cy"];
  for (const attr of dataAttrs) {
    const value = element.getAttribute(attr);
    if (value) {
      // Bare attribute selector tends to be the most stable form for test ids.
      out.push(attrSelector(attr, value));
      out.push(`${tag}${attrSelector(attr, value)}`);
    }
  }
  const name = element.getAttribute("name");
  if (name) out.push(`${tag}${attrSelector("name", name)}`);
  const aria = element.getAttribute("aria-label");
  if (aria && aria.length < 80) out.push(`${tag}${attrSelector("aria-label", aria)}`);
  const role = element.getAttribute("role");
  if (role) out.push(`${tag}${attrSelector("role", role)}`);
  const type = element.getAttribute("type");
  if (type && tag === "input") out.push(`${tag}${attrSelector("type", type)}`);
  const classes = stableClasses(element);
  if (classes.length) {
    out.push(`${tag}.${classes.map(cssEscape).join(".")}`);
    if (classes.length > 1) out.push(`${tag}.${cssEscape(classes[0])}`);
  }
  out.push(`${tag}:nth-of-type(${nthOfTypeIndex(element)})`);
  out.push(tag);
  return out;
}

export function getStableCssSelector(element: Element) {
  const doc = element.ownerDocument || document;
  if (element.id) {
    const idSelector = `#${cssEscape(element.id)}`;
    if (isUnique(doc, idSelector, element)) return idSelector;
  }

  // Try short locally-unique selectors that don't need ancestor context.
  for (const candidate of localCandidates(element)) {
    if (isUnique(doc, candidate, element)) return candidate;
  }

  // Walk up: prepend ancestor selectors until the chain is globally unique.
  // At each level try every local candidate and keep the one that makes the
  // resulting chain unique; otherwise fall back to nth-of-type to disambiguate.
  const chain: string[] = [];
  let current: Element | null = element;
  let depth = 0;
  while (current && current !== doc.documentElement && depth < 8) {
    const localList = localCandidates(current);
    let chosen = localList[localList.length - 1] ?? current.tagName.toLowerCase();
    for (const candidate of localList) {
      const tentative = [candidate, ...chain].join(" > ");
      if (isUnique(doc, tentative, element)) {
        chosen = candidate;
        break;
      }
    }
    chain.unshift(chosen);
    if (isUnique(doc, chain.join(" > "), element)) return chain.join(" > ");
    current = current.parentElement;
    depth += 1;
  }
  return chain.join(" > ") || element.tagName.toLowerCase();
}

export function buildElementTarget(element: Element): ElementTarget {
  const target = interactiveAncestor(element);
  const htmlElement = target as HTMLElement;
  const rect = htmlElement.getBoundingClientRect();
  const tagName = target.tagName.toLowerCase();
  const role = target.getAttribute("role") || (tagName === "button" ? "button" : tagName === "a" ? "link" : undefined);
  const text = cleanText(htmlElement.innerText || target.textContent);
  const ariaLabel = accessibleName(target);
  const placeholder = target.getAttribute("placeholder") || undefined;
  const name = target.getAttribute("name") || undefined;
  const id = target.id || undefined;
  const selector = getStableCssSelector(target);
  const xpath = getXPath(target);
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
  if (text && ["button", "a", "summary", "label"].includes(tagName) && text !== ariaLabel) {
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
