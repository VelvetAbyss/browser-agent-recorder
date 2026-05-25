import type { ActionPayload, ActionType, AppResponse, RecordingState, ValuePolicy } from "../shared/types";

let recordingState: RecordingState = { status: "idle" };
const inputTimers = new WeakMap<Element, number>();
const sensitivePattern = /(password|passcode|secret|token|api[-_ ]?key|card|credit|cvv|cvc|ssn|social|otp|2fa|mfa)/i;
let clientSequence = 0;
let lastNavigationUrl = location.href;

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

function isSensitiveField(input: {
  type?: string | null;
  autocomplete?: string | null;
  name?: string | null;
  id?: string | null;
  placeholder?: string | null;
  ariaLabel?: string | null;
}) {
  if (input.type?.toLowerCase() === "password") return true;
  const combined = [input.autocomplete, input.name, input.id, input.placeholder, input.ariaLabel].filter(Boolean).join(" ");
  return sensitivePattern.test(combined);
}

function sanitizeValue(value: string | undefined, sensitive: boolean, type?: string | null) {
  if (type?.toLowerCase() === "password") return undefined;
  if (!value) return value;
  return sensitive ? "[MASKED]" : value;
}

function getXPath(element: Element) {
  if (element.id) return `//*[@id="${element.id.replace(/"/g, '\\"')}"]`;
  const segments: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === current.tagName) index += 1;
      sibling = sibling.previousElementSibling;
    }
    segments.unshift(`${current.tagName.toLowerCase()}[${index}]`);
    current = current.parentElement;
  }
  return `/${segments.join("/")}`;
}

function getStableCssSelector(element: Element) {
  if (element.id) return `#${cssEscape(element.id)}`;
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
    if (name) part += attrSelector("name", name);
    else if (aria) part += attrSelector("aria-label", aria);
    else {
      const siblings = Array.from(current.parentElement?.children || []).filter((child) => child.tagName === current?.tagName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    }
    parts.unshift(part);
    current = current.parentElement;
  }
  return parts.join(" > ");
}

function buildElementTarget(element: Element) {
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
  const candidates = [];

  if (role && (ariaLabel || text)) candidates.push({ kind: "role" as const, value: `${role}:${ariaLabel || text}`, confidence: 0.92 });
  if (ariaLabel) candidates.push({ kind: "label" as const, value: ariaLabel, confidence: 0.88 });
  if (placeholder) candidates.push({ kind: "placeholder" as const, value: placeholder, confidence: 0.82 });
  if (text && ["button", "a", "summary", "label"].includes(tagName)) candidates.push({ kind: "text" as const, value: text, confidence: 0.74 });
  candidates.push({ kind: "css" as const, value: selector, confidence: id ? 0.86 : selector.includes("data-") ? 0.84 : 0.62 });
  candidates.push({ kind: "xpath" as const, value: xpath, confidence: 0.42 });

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

function pageInfo() {
  return {
    url: location.href,
    domain: location.hostname,
    title: document.title
  };
}

function send<T>(message: unknown): Promise<AppResponse<T>> {
  return chrome.runtime.sendMessage(message);
}

async function refreshState() {
  try {
    const response = await send<RecordingState>({ type: "recording:get-state" });
    if (response.ok) recordingState = response.data;
  } catch {
    recordingState = { status: "idle" };
  }
}

function meaningfulTarget(event: Event) {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  return target.closest("button,a,input,textarea,select,label,[role],summary,[contenteditable='true']") || target;
}

function isFormValueControl(element: Element) {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
}

function shouldRecordClick(target: Element) {
  if (target instanceof HTMLInputElement) {
    return ["button", "submit", "reset", "image"].includes(target.type);
  }
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return false;
  }
  if (target.tagName.toLowerCase() === "label") {
    return false;
  }
  return true;
}

function valueFor(element: Element) {
  if (element instanceof HTMLInputElement) {
    if (element.type === "checkbox" || element.type === "radio") return String(element.checked);
    return element.value;
  }
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return element.value;
  if (element instanceof HTMLElement && element.isContentEditable) return element.innerText;
  return undefined;
}

function policyFor(element: Element, sensitive: boolean): ValuePolicy {
  if (sensitive) return "masked";
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return "literal";
  return "none";
}

function actionFromEvent(type: ActionType, event: Event, key?: string): ActionPayload | null {
  const target = meaningfulTarget(event);
  if (!target) return null;
  const input = target as HTMLInputElement;
  const sensitive = isSensitiveField({
    type: input.getAttribute("type"),
    autocomplete: input.getAttribute("autocomplete"),
    name: input.getAttribute("name"),
    id: input.getAttribute("id"),
    placeholder: input.getAttribute("placeholder"),
    ariaLabel: input.getAttribute("aria-label")
  });
  return {
    clientEventId: `evt_${Date.now()}_${++clientSequence}`,
    clientSequence,
    type,
    page: pageInfo(),
    target: buildElementTarget(target),
    value: sanitizeValue(valueFor(target), sensitive, input.getAttribute("type")),
    key,
    valuePolicy: policyFor(target, sensitive),
    sensitive,
    highRisk: type === "submit"
  };
}

async function record(payload: ActionPayload | null) {
  if (!payload || recordingState.status !== "recording") return;
  await send({ type: "action:record", payload });
}

function onClick(event: MouseEvent) {
  const target = meaningfulTarget(event);
  if (!target || !shouldRecordClick(target)) return;
  void record(actionFromEvent("click", event));
}

function onInput(event: Event) {
  const target = meaningfulTarget(event);
  if (!target || !isFormValueControl(target)) return;
  const existing = inputTimers.get(target);
  if (existing) window.clearTimeout(existing);
  const timer = window.setTimeout(() => {
    void record(actionFromEvent("input", event));
  }, 450);
  inputTimers.set(target, timer);
}

function onChange(event: Event) {
  const target = meaningfulTarget(event);
  if (!target || !isFormValueControl(target)) return;
  void record(actionFromEvent("change", event));
}

function onSubmit(event: Event) {
  void record(actionFromEvent("submit", event));
}

function onKeydown(event: KeyboardEvent) {
  if (["Enter", "Tab", "Escape"].includes(event.key)) {
    void record(actionFromEvent("keydown", event, event.key));
  }
}

function recordNavigation() {
  if (location.href === lastNavigationUrl) return;
  lastNavigationUrl = location.href;
  void refreshState().then(() =>
    record({
      clientEventId: `evt_${Date.now()}_${++clientSequence}`,
      clientSequence,
      type: "navigation",
      page: pageInfo(),
      target: {
        tagName: "document",
        selector: "html",
        xpath: "/html",
        selectorConfidence: 1,
        candidates: [{ kind: "css", value: "html", confidence: 1 }]
      },
      valuePolicy: "none",
      sensitive: false
    })
  );
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "recording:state-changed") {
    recordingState = message.state;
    sendResponse({ ok: true, data: recordingState });
  }
});

void refreshState();
document.addEventListener("click", onClick, true);
document.addEventListener("input", onInput, true);
document.addEventListener("change", onChange, true);
document.addEventListener("submit", onSubmit, true);
document.addEventListener("keydown", onKeydown, true);
window.addEventListener("popstate", recordNavigation);
window.addEventListener("hashchange", recordNavigation);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") recordNavigation();
});
