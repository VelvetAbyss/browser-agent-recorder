import { buildElementTarget } from "../shared/selector";
import { isSensitiveField } from "../shared/sanitize";
import type { ActionPayload, ActionType, AppResponse, RecordingState, ValuePolicy } from "../shared/types";

let recordingState: RecordingState = { status: "idle" };
const inputTimers = new WeakMap<Element, number>();
const earlyClickTargets = new WeakMap<Element, number>();
let clientSequence = 0;
let lastNavigationUrl = location.href;

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
  syncOverlay();
}

function pageInfo() {
  return {
    url: location.href,
    domain: location.hostname,
    title: document.title
  };
}

function interactiveAncestor(element: Element) {
  return (
    element.closest("button,a,[role='button'],[role='link'],input[type='button'],input[type='submit']") || element
  );
}

function meaningfulTarget(event: Event): Element | null {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  const node = (path.find((entry) => entry instanceof Element) as Element | undefined) || (event.target instanceof Element ? event.target : null);
  if (!node) return null;
  const rawTarget = node.closest("button,a,input,textarea,select,label,[role],summary,[contenteditable='true'],svg,path,use") || node;
  return interactiveAncestor(rawTarget);
}

function isFormValueControl(element: Element) {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
}

function shouldRecordClick(target: Element) {
  if (target instanceof HTMLInputElement) {
    return ["button", "submit", "reset", "image"].includes(target.type);
  }
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return false;
  if (target.tagName.toLowerCase() === "label") return false;
  return true;
}

function looksLikeInteractive(target: Element) {
  const tag = target.tagName.toLowerCase();
  if (tag === "a" || tag === "button") return true;
  if (target instanceof HTMLInputElement) return ["button", "submit", "reset", "image"].includes(target.type);
  const role = target.getAttribute("role");
  return Boolean(role && /^(button|link|menuitem|tab|option)$/i.test(role));
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
  if (sensitive) return "runtime";
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return "literal";
  return "none";
}

function actionFromEvent(type: ActionType, event: Event, key?: string): ActionPayload | null {
  if (!event.isTrusted) return null;
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
    value: sensitive ? undefined : valueFor(target),
    key,
    valuePolicy: policyFor(target, sensitive),
    sensitive,
    highRisk: type === "submit",
    devicePixelRatio: window.devicePixelRatio || 1
  };
}

async function record(payload: ActionPayload | null) {
  if (!payload || recordingState.status !== "recording") return;
  await send({ type: "action:record", payload });
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  const target = meaningfulTarget(event);
  if (!target || !shouldRecordClick(target) || !looksLikeInteractive(target)) return;
  earlyClickTargets.set(target, Date.now());
  void record(actionFromEvent("click", event));
}

function onClick(event: MouseEvent) {
  const target = meaningfulTarget(event);
  if (!target || !shouldRecordClick(target)) return;
  const earlyClickAt = earlyClickTargets.get(target);
  if (earlyClickAt && Date.now() - earlyClickAt < 1500) return;
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

function patchHistory() {
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...args) {
    const result = origPush.apply(this, args as Parameters<typeof history.pushState>);
    queueMicrotask(recordNavigation);
    return result;
  };
  history.replaceState = function (...args) {
    const result = origReplace.apply(this, args as Parameters<typeof history.replaceState>);
    queueMicrotask(recordNavigation);
    return result;
  };
}

const isTopFrame = window.top === window;
let overlayRoot: HTMLDivElement | null = null;
let overlayCount: HTMLSpanElement | null = null;

function ensureOverlay() {
  if (!isTopFrame || overlayRoot || !document.body) return;
  const host = document.createElement("div");
  host.setAttribute("data-browser-agent-recorder", "overlay");
  host.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647;pointer-events:none;";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      .bar { display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:999px;
             background:rgba(15,15,15,0.85); color:#fff; font:600 12px/1 system-ui,-apple-system,sans-serif;
             box-shadow:0 4px 12px rgba(0,0,0,0.25); }
      .dot { width:9px; height:9px; border-radius:50%; background:#ef4444;
             animation: bar-pulse 1.2s ease-in-out infinite; }
      @keyframes bar-pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
    </style>
    <div class="bar"><span class="dot"></span><span>REC</span><span class="count">0 steps</span></div>
  `;
  document.body.appendChild(host);
  overlayRoot = host;
  overlayCount = shadow.querySelector(".count");
}

function removeOverlay() {
  overlayRoot?.remove();
  overlayRoot = null;
  overlayCount = null;
}

function syncOverlay() {
  if (!isTopFrame) return;
  if (recordingState.status === "recording") {
    ensureOverlay();
    if (overlayCount) {
      const n = recordingState.actionCount ?? 0;
      overlayCount.textContent = `${n} step${n === 1 ? "" : "s"}`;
    }
  } else {
    removeOverlay();
  }
}

chrome.storage.session.onChanged.addListener((changes) => {
  const next = changes.recordingState?.newValue as RecordingState | undefined;
  if (next) {
    recordingState = next;
    syncOverlay();
  }
});

void refreshState();
patchHistory();
document.addEventListener("pointerdown", onPointerDown, true);
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
