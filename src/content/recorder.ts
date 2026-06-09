import { buildElementTarget } from "../shared/selector";
import { isSensitiveField } from "../shared/sanitize";
import { t } from "../shared/i18n";
import type {
  ActionPayload,
  ActionType,
  AppResponse,
  DialogInfo,
  RecordingState,
  ValuePolicy,
  ViewportInfo
} from "../shared/types";

let recordingState: RecordingState = { status: "idle" };
const inputTimers = new WeakMap<Element, number>();
const earlyClickTargets = new WeakMap<Element, number>();
let clientSequence = 0;
let lastNavigationUrl = location.href;
let composing = false;

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

function viewportInfo(): ViewportInfo {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    devicePixelRatio: window.devicePixelRatio || 1
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
  // Never record interactions with our own REC overlay (e.g. dragging it).
  if (overlayRoot && (node === overlayRoot || overlayRoot.contains(node))) return null;
  const rawTarget = node.closest("button,a,input,textarea,select,label,[role],summary,[contenteditable='true'],svg,path,use,td,th") || node;
  return interactiveAncestor(rawTarget);
}

function isFormValueControl(element: Element) {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
}

function isContentEditable(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return element.isContentEditable;
}

function isInputtable(element: Element) {
  return isFormValueControl(element) || isContentEditable(element);
}

function shouldRecordClick(target: Element) {
  if (target instanceof HTMLInputElement) {
    return ["button", "submit", "reset", "image", "checkbox", "radio"].includes(target.type);
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
  return Boolean(role && /^(button|link|menuitem|tab|option|checkbox|radio)$/i.test(role));
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

function valueLabelFor(element: Element): string | undefined {
  // <select>: surface the visible option text alongside the raw value so
  // humans can read "United States" while replay still uses "us".
  if (element instanceof HTMLSelectElement) {
    const opt = element.selectedOptions[0];
    if (opt) return (opt.label || opt.textContent || opt.value).trim() || undefined;
  }
  if (element instanceof HTMLInputElement && (element.type === "radio" || element.type === "checkbox")) {
    const label = element.labels?.[0];
    const text = label?.textContent?.trim();
    if (text) return text;
    const wrapping = element.closest("label");
    return wrapping?.textContent?.trim() || undefined;
  }
  return undefined;
}

function policyFor(element: Element, sensitive: boolean): ValuePolicy {
  if (sensitive) return "runtime";
  if (isInputtable(element)) return "literal";
  return "none";
}

interface BuildOptions {
  type: ActionType;
  target: Element;
  key?: string;
  override?: Partial<ActionPayload>;
}

function buildAction({ type, target, key, override }: BuildOptions): ActionPayload {
  const input = target as HTMLInputElement;
  const sensitive = isSensitiveField({
    type: input.getAttribute("type"),
    autocomplete: input.getAttribute("autocomplete"),
    name: input.getAttribute("name"),
    id: input.getAttribute("id"),
    placeholder: input.getAttribute("placeholder"),
    ariaLabel: input.getAttribute("aria-label")
  });
  const payload: ActionPayload = {
    clientEventId: `evt_${Date.now()}_${++clientSequence}`,
    clientSequence,
    type,
    page: pageInfo(),
    target: buildElementTarget(target),
    value: sensitive ? undefined : valueFor(target),
    valueLabel: valueLabelFor(target),
    key,
    valuePolicy: policyFor(target, sensitive),
    sensitive,
    highRisk: type === "submit",
    devicePixelRatio: window.devicePixelRatio || 1,
    viewport: viewportInfo(),
    frameUrl: window !== window.top ? location.href : undefined,
    ...override
  };
  return payload;
}

function actionFromEvent(type: ActionType, event: Event, key?: string): ActionPayload | null {
  if (!event.isTrusted) return null;
  const target = meaningfulTarget(event);
  if (!target) return null;
  return buildAction({ type, target, key });
}

async function record(payload: ActionPayload | null) {
  if (!payload || recordingState.status !== "recording") return;
  await send({ type: "action:record", payload });
}

function flushInput(target: Element) {
  const timer = inputTimers.get(target);
  if (!timer) return;
  window.clearTimeout(timer);
  inputTimers.delete(target);
  void record(buildAction({ type: "input", target, override: { composedInput: true } }));
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

function onDoubleClick(event: MouseEvent) {
  const target = meaningfulTarget(event);
  if (!target) return;
  void record(actionFromEvent("doubleclick", event));
}

function onContextMenu(event: MouseEvent) {
  const target = meaningfulTarget(event);
  if (!target) return;
  void record(actionFromEvent("rightclick", event));
}

function onInput(event: Event) {
  // Skip IME intermediate states; the post-compositionend input event will
  // catch the committed value.
  if (composing) return;
  const inputEvent = event as InputEvent;
  if (typeof inputEvent.isComposing === "boolean" && inputEvent.isComposing) return;

  const target = meaningfulTarget(event);
  if (!target || !isInputtable(target)) return;
  const existing = inputTimers.get(target);
  if (existing) window.clearTimeout(existing);
  const timer = window.setTimeout(() => {
    void record(actionFromEvent("input", event));
  }, 450);
  inputTimers.set(target, timer);
}

function onCompositionStart() {
  composing = true;
}

function onCompositionEnd(event: CompositionEvent) {
  composing = false;
  const target = meaningfulTarget(event);
  if (!target || !isInputtable(target)) return;
  // Schedule a short follow-up emit so the committed string lands as one
  // recorded action without racing the next keystroke.
  const existing = inputTimers.get(target);
  if (existing) window.clearTimeout(existing);
  const timer = window.setTimeout(() => {
    void record(buildAction({ type: "input", target }));
  }, 80);
  inputTimers.set(target, timer);
}

function onChange(event: Event) {
  if (event.target instanceof HTMLInputElement && event.target.type === "file") {
    onFileChange(event);
    return;
  }
  const target = meaningfulTarget(event);
  if (!target || !isFormValueControl(target)) return;
  void record(actionFromEvent("change", event));
}

function onSubmit(event: Event) {
  const form = event.target;
  // Flush any pending input debounces on this form's fields so the final
  // values land before the submit action.
  if (form instanceof HTMLFormElement) {
    for (const el of Array.from(form.elements)) {
      if (el instanceof Element && inputTimers.has(el)) flushInput(el);
    }
  }
  void record(actionFromEvent("submit", event));
}

function onKeydown(event: KeyboardEvent) {
  // Flush input debounce on commit-style keys so the value is recorded
  // before the key action (e.g., Enter that submits the field).
  if (["Enter", "Tab", "Escape"].includes(event.key)) {
    const target = meaningfulTarget(event);
    if (target && inputTimers.has(target)) flushInput(target);
  }

  const combo = modifierComboKey(event);
  if (combo) {
    void record(actionFromEvent("keydown", event, combo));
    return;
  }
  if (["Enter", "Tab", "Escape"].includes(event.key)) {
    void record(actionFromEvent("keydown", event, event.key));
  }
}

function onBlur(event: FocusEvent) {
  const target = event.target;
  if (target instanceof Element && inputTimers.has(target)) flushInput(target);
}

function modifierComboKey(event: KeyboardEvent) {
  if (!event.ctrlKey && !event.metaKey && !event.altKey) return null;
  const key = event.key;
  if (["Control", "Meta", "Alt", "Shift"].includes(key)) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.metaKey) parts.push("Meta");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(key.length === 1 ? key.toUpperCase() : key);
  return parts.join("+");
}

function onPaste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData("text/plain");
  if (!text) return;
  const base = actionFromEvent("paste", event);
  if (!base) return;
  void record({ ...base, value: base.sensitive ? undefined : text });
}

function describeFiles(files: FileList | null) {
  if (!files || files.length === 0) return undefined;
  return Array.from(files)
    .map((file) => `${file.name} (${file.size} bytes)`)
    .join(", ");
}

function onFileChange(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type !== "file") return;
  const summary = describeFiles(target.files);
  if (!summary) return;
  const base = actionFromEvent("upload", event);
  if (!base) return;
  void record({ ...base, value: summary, valuePolicy: "runtime" });
}

function onDragStart(event: DragEvent) {
  void record(actionFromEvent("dragstart", event));
}

function onDrop(event: DragEvent) {
  void record(actionFromEvent("drop", event));
}

function onToggle(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLDetailsElement) && !(target instanceof HTMLDialogElement)) return;
  const open = target instanceof HTMLDetailsElement ? target.open : (target as HTMLDialogElement).open;
  void record(actionFromEvent("toggle", event, open ? "open" : "close"));
}

function recordDialog(detail: DialogInfo) {
  if (recordingState.status !== "recording") return;
  // Dialogs have no DOM target; use document.body as a stand-in so the
  // selector machinery still produces something.
  const target = document.body;
  if (!target) return;
  const message = detail.message ? ` "${detail.message.slice(0, 80)}"` : "";
  const description = `Browser ${detail.kind} dialog${message}`;
  const payload = buildAction({
    type: "dialog",
    target,
    override: {
      dialog: detail,
      value: detail.response ?? (detail.accepted === undefined ? undefined : detail.accepted ? "accepted" : "dismissed"),
      valueLabel: description,
      valuePolicy: detail.kind === "prompt" ? "literal" : "none",
      highRisk: detail.kind === "beforeunload"
    }
  });
  void record(payload);
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
      sensitive: false,
      viewport: viewportInfo(),
      frameUrl: window !== window.top ? location.href : undefined
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
const OVERLAY_ATTR = "data-browser-agent-recorder";
let overlayRoot: HTMLDivElement | null = null;
let overlayBar: HTMLElement | null = null;
let overlayCount: HTMLSpanElement | null = null;
let overlayDot: HTMLSpanElement | null = null;
let overlayPhaseEl: HTMLSpanElement | null = null;
let overlayObserver: MutationObserver | null = null;
let overlayResetTimer: number | null = null;
let overlayPos: { left: number; top: number } | null = null;

// Always go through the DOM, never trust JS refs alone. Zombies are common
// because (1) extension reloads kill the old content script's isolated
// world but leave the overlay node in the page's main DOM, (2) some sites
// move/remove nodes via MutationObserver, (3) SPAs occasionally replace
// document.body wholesale.
function findOverlayHosts(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`[${OVERLAY_ATTR}="overlay"]`));
}

function removeAllOverlays() {
  for (const host of findOverlayHosts()) host.remove();
  overlayRoot = null;
  overlayBar = null;
  overlayCount = null;
  overlayDot = null;
  overlayPhaseEl = null;
  overlayObserver?.disconnect();
  overlayObserver = null;
  if (overlayResetTimer !== null) {
    window.clearTimeout(overlayResetTimer);
    overlayResetTimer = null;
  }
}

// Clamp a stored position into the current viewport and apply it (switching
// the host from the default top-right anchor to absolute left/top).
function applyOverlayPosition() {
  if (!overlayRoot || !overlayPos) return;
  const w = overlayRoot.offsetWidth || 120;
  const h = overlayRoot.offsetHeight || 32;
  const left = Math.max(4, Math.min(window.innerWidth - w - 4, overlayPos.left));
  const top = Math.max(4, Math.min(window.innerHeight - h - 4, overlayPos.top));
  overlayRoot.style.left = `${left}px`;
  overlayRoot.style.top = `${top}px`;
  overlayRoot.style.right = "auto";
}

function startOverlayDrag(event: PointerEvent) {
  if (event.button !== 0 || !overlayRoot) return;
  event.preventDefault();
  const rect = overlayRoot.getBoundingClientRect();
  const offsetX = event.clientX - rect.left;
  const offsetY = event.clientY - rect.top;
  overlayBar?.setPointerCapture(event.pointerId);
  const move = (e: PointerEvent) => {
    if (!overlayRoot) return;
    const w = overlayRoot.offsetWidth;
    const h = overlayRoot.offsetHeight;
    const left = Math.max(4, Math.min(window.innerWidth - w - 4, e.clientX - offsetX));
    const top = Math.max(4, Math.min(window.innerHeight - h - 4, e.clientY - offsetY));
    overlayRoot.style.left = `${left}px`;
    overlayRoot.style.top = `${top}px`;
    overlayRoot.style.right = "auto";
  };
  const up = () => {
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", up, true);
    if (!overlayRoot) return;
    const r = overlayRoot.getBoundingClientRect();
    overlayPos = { left: Math.round(r.left), top: Math.round(r.top) };
    try {
      void chrome.storage.local.set({ overlayPos });
    } catch {
      /* storage unavailable; position is still applied for this session */
    }
  };
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", up, true);
}

function createOverlay() {
  if (!isTopFrame || !document.body) return;
  // Clear any zombies from a previous content script before adding ours.
  removeAllOverlays();
  const host = document.createElement("div");
  host.setAttribute(OVERLAY_ATTR, "overlay");
  // Host ignores pointer events so the page stays clickable; only the bar
  // re-enables them so it can be grabbed and dragged.
  host.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647;pointer-events:none;";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      .bar { display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:999px;
             background:rgba(15,15,15,0.85); color:#fff; font:600 12px/1 system-ui,-apple-system,sans-serif;
             box-shadow:0 4px 12px rgba(0,0,0,0.25); white-space:nowrap;
             pointer-events:auto; cursor:move; user-select:none; touch-action:none; }
      .dot { width:9px; height:9px; border-radius:50%; background:#ef4444; flex:none;
             animation: bar-pulse 1.2s ease-in-out infinite; }
      .dot.capturing { background:#f59e0b; }
      .dot.complete { background:#22c55e; animation:none; }
      .dot.paused { background:#a1a1aa; animation:none; }
      .phase { opacity:0.85; }
      .phase.complete { color:#86efac; opacity:1; }
      .phase.capturing { color:#fcd34d; }
      .phase.paused { color:#d4d4d8; opacity:1; }
      @keyframes bar-pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
    </style>
    <div class="bar"><span class="dot"></span><span>REC</span><span class="count"></span><span class="phase"></span></div>
  `;
  document.body.appendChild(host);
  overlayRoot = host;
  overlayBar = shadow.querySelector(".bar");
  overlayCount = shadow.querySelector(".count");
  overlayDot = shadow.querySelector(".dot");
  overlayPhaseEl = shadow.querySelector(".phase");
  overlayBar?.addEventListener("pointerdown", startOverlayDrag);
  applyOverlayPosition();
  // Defend against site scripts that scrub unknown nodes from the body.
  overlayObserver = new MutationObserver(() => {
    if (recordingState.status !== "recording") return;
    if (!overlayRoot || !overlayRoot.isConnected) {
      // Recreate on the next animation frame to avoid fighting the site's
      // own observer in the same tick.
      requestAnimationFrame(() => {
        if (recordingState.status === "recording") createOverlay();
      });
    }
  });
  overlayObserver.observe(document.body, { childList: true, subtree: false });
}

function syncOverlay() {
  if (!isTopFrame) return;
  if (recordingState.status === "recording") {
    // Refuse to trust a stale JS ref — if the node was detached, rebuild.
    if (!overlayRoot || !overlayRoot.isConnected) {
      createOverlay();
    }
    if (overlayCount) {
      const n = recordingState.actionCount ?? 0;
      overlayCount.textContent = t("overlay.steps", { n });
    }
    const paused = Boolean(recordingState.paused);
    if (overlayDot) overlayDot.className = `dot${paused ? " paused" : ""}`;
    if (overlayPhaseEl) {
      overlayPhaseEl.className = `phase${paused ? " paused" : ""}`;
      overlayPhaseEl.textContent = paused ? t("overlay.paused") : "";
    }
  } else {
    removeAllOverlays();
  }
}

// Hide the overlay host for the duration of a screenshot capture without
// tearing it down (so the self-healing observer doesn't fight us).
function setOverlayHidden(hidden: boolean) {
  if (!isTopFrame || !overlayRoot) return;
  overlayRoot.style.visibility = hidden ? "hidden" : "visible";
}

// Drive the three-state overlay feedback. "capturing" tells the user a step is
// being saved (wait); "complete" flashes a confirmation that the step — screenshot
// included — is fully recorded and they can proceed; then it reverts to idle.
function setOverlayPhase(phase: "idle" | "capturing" | "complete", n: number) {
  if (!isTopFrame) return;
  if (recordingState.status !== "recording") return;
  if (!overlayRoot || !overlayRoot.isConnected) createOverlay();
  if (overlayResetTimer !== null) {
    window.clearTimeout(overlayResetTimer);
    overlayResetTimer = null;
  }
  if (overlayCount) overlayCount.textContent = t("overlay.steps", { n });
  if (overlayDot) overlayDot.className = `dot${phase === "idle" ? "" : ` ${phase}`}`;
  if (overlayPhaseEl) {
    overlayPhaseEl.className = `phase${phase === "idle" ? "" : ` ${phase}`}`;
    if (phase === "capturing") overlayPhaseEl.textContent = t("overlay.capturing");
    else if (phase === "complete") overlayPhaseEl.textContent = t("overlay.complete", { n });
    else overlayPhaseEl.textContent = "";
  }
  if (phase === "complete") {
    overlayResetTimer = window.setTimeout(() => {
      overlayResetTimer = null;
      setOverlayPhase("idle", recordingState.actionCount ?? n);
    }, 1200);
  }
}

// At injection time, immediately scrub any zombie overlay left over from a
// previous content script execution (most often after an extension reload
// during a recording session).
if (isTopFrame) {
  if (document.body) {
    for (const host of findOverlayHosts()) host.remove();
  } else {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        for (const host of findOverlayHosts()) host.remove();
      },
      { once: true }
    );
  }
}

// Idempotency: the service worker may re-inject this content script into a
// tab that was loaded before the extension was installed/updated. Without a
// guard we'd attach every listener twice and emit each user event twice.
interface RecorderWindow extends Window {
  __browserAgentRecorderInstalled?: boolean;
}
const installFlag = window as RecorderWindow;
if (!installFlag.__browserAgentRecorderInstalled) {
  installFlag.__browserAgentRecorderInstalled = true;

  // Restore the user's preferred overlay position (O), then re-apply in case
  // the overlay was already created before this resolved.
  if (isTopFrame) {
    try {
      void chrome.storage.local.get("overlayPos").then((result) => {
        const pos = result?.overlayPos;
        if (pos && typeof pos.left === "number" && typeof pos.top === "number") {
          overlayPos = pos;
          applyOverlayPosition();
        }
      });
    } catch {
      /* storage unavailable */
    }
  }

  chrome.storage.session.onChanged.addListener((changes) => {
    const next = changes.recordingState?.newValue as RecordingState | undefined;
    if (!next) return;
    if (next.status === "recording") {
      // Never let a delayed storage event roll the local count backwards
      // — direct tabs.sendMessage from the SW may have already pushed a
      // higher value.
      const localCount = recordingState.actionCount ?? 0;
      const nextCount = next.actionCount ?? 0;
      recordingState = { ...next, actionCount: Math.max(localCount, nextCount) };
    } else {
      recordingState = next;
    }
    syncOverlay();
  });

  // MAIN-world hooks dispatch a CustomEvent we can pick up here.
  window.addEventListener("__browser_agent_recorder_event__", (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (!detail || typeof detail !== "object") return;
    if (detail.type === "dialog") {
      recordDialog(detail as DialogInfo);
    }
  });

  // Lightweight ping used by the service worker to confirm injection worked,
  // plus a direct step-count broadcast that bypasses storage.onChanged
  // throttling so the overlay always reflects the real count.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "recorder:ping") {
      sendResponse({ ok: true, data: { installed: true, href: location.href } });
      return true;
    }
    // Direct nudge from the service worker at recording start so the overlay
    // appears without waiting for the batched storage.onChanged event.
    if (message?.type === "recording:sync") {
      void refreshState();
      sendResponse({ ok: true });
      return false;
    }
    // Hide/show the REC overlay around a screenshot capture so it never appears
    // in the stored image. Respond after a paint frame so the visibility change
    // is composited before the service worker captures.
    if (message?.type === "recording:overlay-visibility") {
      setOverlayHidden(!message.visible);
      requestAnimationFrame(() => requestAnimationFrame(() => sendResponse({ ok: true })));
      return true; // async response
    }
    if (message?.type === "recording:paused-changed") {
      recordingState = { ...recordingState, status: "recording", paused: Boolean(message.paused) };
      syncOverlay();
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "recording:step-capturing" || message?.type === "recording:step-complete") {
      const incoming = typeof message.actionCount === "number" ? message.actionCount : undefined;
      if (incoming !== undefined) {
        // Take the max so an out-of-order delivery never rolls the count
        // backwards.
        const current = recordingState.actionCount ?? 0;
        const nextCount = Math.max(current, incoming);
        recordingState = { ...recordingState, status: "recording", actionCount: nextCount };
        setOverlayPhase(message.type === "recording:step-complete" ? "complete" : "capturing", nextCount);
      }
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  void refreshState();
  patchHistory();
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("dblclick", onDoubleClick, true);
  document.addEventListener("contextmenu", onContextMenu, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("change", onChange, true);
  document.addEventListener("submit", onSubmit, true);
  document.addEventListener("keydown", onKeydown, true);
  document.addEventListener("blur", onBlur, true);
  document.addEventListener("paste", onPaste, true);
  document.addEventListener("compositionstart", onCompositionStart, true);
  document.addEventListener("compositionend", onCompositionEnd, true);
  document.addEventListener("dragstart", onDragStart, true);
  document.addEventListener("drop", onDrop, true);
  document.addEventListener("toggle", onToggle, true);
  window.addEventListener("popstate", recordNavigation);
  window.addEventListener("hashchange", recordNavigation);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      recordNavigation();
      // Resync overlay state — background tabs occasionally miss the
      // storage onChanged callback during BFCache or extension reloads.
      void refreshState();
    }
  });
}
