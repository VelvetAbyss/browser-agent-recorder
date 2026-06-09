import { db, getSessionBundle } from "../shared/db";
import { RecentActionDeduper } from "../shared/actionIntegrity";
import { generateDevtoolsRecorderJson, generateHumanGuide, generatePlaywright, generateSkillPackBase64 } from "../shared/exporters";
import { generatedDescription, generatedTitle } from "../shared/stepText";
import type { ActionPayload, AppMessage, AppResponse, ExportType, RecordedAction, RecordingSession, RecordingState, StorageEstimate } from "../shared/types";

const STATE_KEY = "recordingState";
const SCREENSHOT_MIN_INTERVAL_MS = 600;
const PAGE_HOOKS_SCRIPT_ID = "browser-agent-page-hooks";

async function registerPageHooks() {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [PAGE_HOOKS_SCRIPT_ID] });
    if (existing.length) return;
    await chrome.scripting.registerContentScripts([
      {
        id: PAGE_HOOKS_SCRIPT_ID,
        matches: ["<all_urls>"],
        js: ["page-hooks.js"],
        runAt: "document_start",
        world: "MAIN",
        allFrames: true,
        matchOriginAsFallback: true
      } as chrome.scripting.RegisteredContentScript
    ]);
  } catch {
    /* page-hooks may already be registered (race) or scripting disabled */
  }
}

async function unregisterPageHooks() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [PAGE_HOOKS_SCRIPT_ID] });
  } catch {
    /* not registered; ignore */
  }
}

async function ensurePageHooksOnTab(tabId: number | undefined) {
  if (tabId === undefined) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      files: ["page-hooks.js"]
    });
  } catch {
    /* chrome:// page or restricted; ignore */
  }
}

const RESTRICTED_URL_PATTERN = /^(chrome|chrome-extension|edge|about|view-source|devtools|chrome-search|chrome-untrusted):/i;
const WEBSTORE_PATTERN = /^https?:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i;

function tabIsInjectable(tab: chrome.tabs.Tab | undefined) {
  const url = tab?.url || tab?.pendingUrl;
  if (!url) return true; // unknown URL — try anyway and let executeScript fail loudly
  return !RESTRICTED_URL_PATTERN.test(url) && !WEBSTORE_PATTERN.test(url);
}

async function ensureContentScript(tabId: number): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Try a ping first — if the content script is already running we're done.
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: "recorder:ping" });
    if (pong && (pong as { ok?: boolean }).ok) return { ok: true };
  } catch {
    /* no listener; need to inject */
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "ISOLATED",
      files: ["assets/content.js"]
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: message };
  }
}

const actionDeduper = new RecentActionDeduper();
let actionWriteQueue: Promise<unknown> = Promise.resolve();
let screenshotQueue: Promise<unknown> = Promise.resolve();
let lastScreenshotAt = 0;

function now() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function ok<T>(data: T): AppResponse<T> {
  return { ok: true, data };
}

function fail(error: unknown): AppResponse<never> {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

async function getState(): Promise<RecordingState> {
  const stored = await chrome.storage.session.get(STATE_KEY);
  return (stored[STATE_KEY] as RecordingState) ?? { status: "idle" };
}

async function setState(state: RecordingState) {
  await chrome.storage.session.set({ [STATE_KEY]: state });
}

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function startRecording(message: Extract<AppMessage, { type: "recording:start" }>) {
  const tab = message.tabId ? await chrome.tabs.get(message.tabId) : await currentTab();
  if (!tab?.id) {
    throw new Error("No active tab to record. Open a regular web page first.");
  }
  if (!tabIsInjectable(tab)) {
    throw new Error(
      "Recorder can't run on this page (chrome://, the Web Store, or another protected origin). Switch to a regular https:// page and try again."
    );
  }
  // Force-inject the content script before flipping the state to recording.
  // Manifest content_scripts only fire on future page loads, so a tab that
  // was already open at install/update time would otherwise be a no-op and
  // the user would see 0 captured steps. Guarded by __browserAgentRecorderInstalled
  // so re-injection on an already-instrumented tab is a no-op.
  const inject = await ensureContentScript(tab.id);
  if (!inject.ok) {
    throw new Error(
      `Recorder failed to attach to this page (${inject.reason}). Try reloading the page and starting again.`
    );
  }
  const timestamp = now();
  const session: RecordingSession = {
    id: id("session"),
    title: tab?.title ? `Recording: ${tab.title}` : "Untitled browser workflow",
    summary: "",
    status: "recording",
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    tabId: tab?.id,
    startUrl: tab?.url,
    actionCount: 0
  };
  await db.sessions.add(session);
  const state: RecordingState = {
    status: "recording",
    sessionId: session.id,
    startedAt: timestamp,
    tabId: tab.id,
    tabIds: [tab.id],
    actionCount: 0
  };
  await setState(state);
  // Build the REC overlay immediately rather than waiting for the content
  // script to observe storage.onChanged. The script's own refreshState() reads
  // whatever state existed at injection time (idle), so without this nudge the
  // overlay only appears once the (batched) storage event lands.
  await chrome.tabs.sendMessage(tab.id, { type: "recording:sync" }).catch(() => undefined);
  // MAIN-world hooks let us observe alert/confirm/prompt/print/beforeunload.
  // Register globally so navigations don't strip them, plus inject on the
  // active tab immediately for the current page that's already loaded.
  await registerPageHooks();
  await ensurePageHooksOnTab(tab?.id);
  // Capture the starting page as visible step 1 (URL + screenshot) so the
  // recording is self-contained and the user can verify capture is live.
  void enqueueActionWrite(() => recordInitialNavigation(tab));
  return session;
}

function recordInitialNavigation(tab: chrome.tabs.Tab) {
  const url = tab.url || tab.pendingUrl || "";
  let domain = "";
  try {
    domain = url ? new URL(url).hostname : "";
  } catch {
    /* opaque URL; leave domain blank */
  }
  const payload: ActionPayload = {
    clientEventId: `evt_initial_${Date.now()}`,
    clientSequence: 0,
    type: "navigation",
    page: { url, domain, title: tab.title || "" },
    target: {
      tagName: "document",
      selector: "html",
      xpath: "/html",
      selectorConfidence: 1,
      candidates: [{ kind: "css", value: "html", confidence: 1 }]
    },
    valuePolicy: "none",
    sensitive: false
  };
  return recordAction(payload);
}

async function stopRecording() {
  const state = await getState();
  if (state.sessionId) {
    await db.sessions.update(state.sessionId, { status: "idle", stoppedAt: now(), updatedAt: now() });
  }
  const next: RecordingState = { status: "idle" };
  await setState(next);
  await unregisterPageHooks();
  return next;
}

async function setPaused(paused: boolean) {
  const state = await getState();
  if (state.status !== "recording") return state;
  const next: RecordingState = { ...state, paused };
  await setState(next);
  // Reflect the paused state in the overlay immediately on every recorded tab.
  void broadcastOverlay(state.tabIds ?? (state.tabId ? [state.tabId] : []), {
    type: "recording:paused-changed",
    paused
  });
  return next;
}

function enqueueActionWrite<T>(operation: () => Promise<T>) {
  const next = actionWriteQueue.then(operation, operation);
  actionWriteQueue = next.catch(() => undefined);
  return next;
}

function captureWindow(windowId: number | undefined): Promise<string> {
  return windowId === undefined
    ? chrome.tabs.captureVisibleTab({ format: "png" })
    : chrome.tabs.captureVisibleTab(windowId, { format: "png" });
}

function scheduleScreenshot(windowId: number | undefined): Promise<string | undefined> {
  const task: Promise<string | undefined> = screenshotQueue.then(async () => {
    const elapsed = Date.now() - lastScreenshotAt;
    const waitFor = Math.max(0, SCREENSHOT_MIN_INTERVAL_MS - elapsed);
    if (waitFor > 0) await new Promise((resolve) => setTimeout(resolve, waitFor));
    try {
      const dataUrl = await captureWindow(windowId);
      lastScreenshotAt = Date.now();
      return dataUrl;
    } catch {
      lastScreenshotAt = Date.now();
      return undefined;
    }
  });
  screenshotQueue = task.catch(() => undefined);
  return task;
}

// Cap stored screenshots so a long recording doesn't balloon IndexedDB. Retina
// captures are 2x+ the CSS viewport; downscaling to this width plus JPEG
// encoding typically cuts each shot from hundreds of KB to a few tens of KB.
const MAX_SHOT_WIDTH = 1400;
const SHOT_QUALITY = 0.82;

interface ShotInfo {
  scale: number;
  width: number;
  height: number;
}

// Decode the raw capture, downscale to MAX_SHOT_WIDTH, let the caller paint
// annotations (coordinates scaled via info.scale), then re-encode as JPEG.
// Falls back to the original data URL on any failure so a draw/encode error
// never loses the screenshot.
async function renderScreenshot(
  dataUrl: string,
  paint?: (ctx: OffscreenCanvasRenderingContext2D, info: ShotInfo) => void
): Promise<string> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_SHOT_WIDTH / bitmap.width);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(bitmap, 0, 0, width, height);
    paint?.(ctx, { scale, width, height });
    const out = await canvas.convertToBlob({ type: "image/jpeg", quality: SHOT_QUALITY });
    const buffer = new Uint8Array(await out.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buffer.length; i += 1) binary += String.fromCharCode(buffer[i]);
    return `data:image/jpeg;base64,${btoa(binary)}`;
  } catch {
    return dataUrl;
  }
}

// Map a viewport-space bounding box into the (downscaled) screenshot's pixels.
function boxInImage(payload: ActionPayload, scale: number) {
  const box = payload.target.boundingBox;
  if (!box) return undefined;
  const factor = (payload.devicePixelRatio || 1) * scale;
  return { x: box.x * factor, y: box.y * factor, width: box.width * factor, height: box.height * factor };
}

// Finalize a freshly captured screenshot: always downscale + JPEG-encode, and
// either redact a sensitive field or ring the acted-on element. The capture is
// taken at action time (pre-change), so the element is present and its recorded
// box maps onto this frame. Full-page targets (e.g. dialog stand-ins) and
// navigation steps have no meaningful element box, so they're left unringed.
function annotateScreenshot(dataUrl: string, payload: ActionPayload): Promise<string> {
  return renderScreenshot(dataUrl, (ctx, info) => {
    const box = boxInImage(payload, info.scale);
    if (payload.sensitive) {
      if (!box) return;
      const padding = 4;
      ctx.fillStyle = "#000";
      ctx.fillRect(
        Math.max(0, box.x - padding),
        Math.max(0, box.y - padding),
        Math.max(0, box.width + padding * 2),
        Math.max(0, box.height + padding * 2)
      );
      return;
    }
    if (payload.type === "navigation") return;
    if (!box || box.width < 2 || box.height < 2) return;
    // Skip full-page targets (e.g. dialog stand-ins on document.body).
    if (box.width * box.height >= 0.9 * info.width * info.height) return;
    const pad = 6;
    const x = Math.max(0, box.x - pad);
    const y = Math.max(0, box.y - pad);
    const w = Math.min(info.width - x, box.width + pad * 2);
    const h = Math.min(info.height - y, box.height + pad * 2);
    const radius = Math.min(12, w / 2, h / 2);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fillStyle = "rgba(4, 120, 87, 0.14)";
    ctx.fill();
    // White halo first for contrast on dark UIs, then the emerald ring.
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#047857";
    ctx.stroke();
  });
}

// Toggle the on-page REC overlay so it never appears in stored screenshots.
// Targets the top frame and awaits a paint frame (the content script responds
// after rAF) so the change is composited before captureVisibleTab runs.
async function setOverlayVisibility(tabIds: number[], visible: boolean) {
  await Promise.allSettled(
    tabIds.map((tabId) =>
      chrome.tabs
        .sendMessage(tabId, { type: "recording:overlay-visibility", visible }, { frameId: 0 })
        .catch(() => undefined)
    )
  );
}

async function persistScreenshot(dataUrl: string | undefined, actionId: string, sessionId: string, stepNumber: number) {
  if (!dataUrl) return undefined;
  const screenshot = {
    id: id("shot"),
    sessionId,
    actionId,
    stepNumber,
    dataUrl,
    path: `screenshots/step-${String(stepNumber).padStart(3, "0")}.jpg`,
    createdAt: now()
  };
  await db.screenshots.add(screenshot);
  return screenshot.id;
}

async function recordAction(payload: ActionPayload) {
  const state = await getState();
  if (state.status !== "recording" || !state.sessionId) return null;
  if (state.paused) return null;
  if (!actionDeduper.shouldAccept(payload)) return null;

  const tab = state.tabId ? await chrome.tabs.get(state.tabId).catch(() => undefined) : await currentTab();
  const targetTabs = state.tabIds ?? (state.tabId ? [state.tabId] : []);

  const session = await db.sessions.get(state.sessionId);
  if (!session) throw new Error("No active session");
  const stepNumber = session.actionCount + 1;

  // Capture FIRST, at action time — the action is recorded on pointerdown, so
  // the page hasn't navigated/re-rendered yet and the element the user is
  // acting on is still present (and maps to its recorded bounding box). Waiting
  // for the page to settle would screenshot the *result* page, where a click
  // that navigated has already made the target disappear.
  void broadcastOverlay(targetTabs, { type: "recording:step-capturing", actionCount: stepNumber });
  await setOverlayVisibility(targetTabs, false);
  const rawDataUrl = await scheduleScreenshot(tab?.windowId);
  void setOverlayVisibility(targetTabs, true);
  const dataUrl = rawDataUrl ? await annotateScreenshot(rawDataUrl, payload) : undefined;

  const actionId = id("action");
  const action: RecordedAction = {
    id: actionId,
    sessionId: session.id,
    stepNumber,
    clientEventId: payload.clientEventId,
    clientSequence: payload.clientSequence,
    type: payload.type,
    page: payload.page,
    target: payload.target,
    value: payload.value,
    valueLabel: payload.valueLabel,
    key: payload.key,
    valuePolicy: payload.valuePolicy,
    sensitive: payload.sensitive,
    highRisk: Boolean(payload.highRisk),
    title: generatedTitle(payload, stepNumber),
    description: generatedDescription(payload),
    createdAt: now(),
    viewport: payload.viewport,
    dialog: payload.dialog,
    frameUrl: payload.frameUrl
  };
  await db.actions.add(action);
  await db.sessions.update(session.id, { actionCount: stepNumber, updatedAt: now() });
  // Re-read state before writing back so concurrent updates (e.g. tabs.onCreated
  // appending a new tabId) aren't clobbered by a stale spread.
  const latestState = await getState();
  await setState({ ...latestState, actionCount: stepNumber });
  const screenshotId = await persistScreenshot(dataUrl, actionId, session.id, stepNumber);
  if (screenshotId) await db.actions.update(actionId, { screenshotId });
  // Step is fully persisted (including screenshot) — signal the user can proceed.
  void broadcastOverlay(latestState.tabIds ?? targetTabs, { type: "recording:step-complete", actionCount: stepNumber });
  return { ...action, screenshotId };
}

async function broadcastOverlay(tabIds: number[], message: { type: string } & Record<string, unknown>) {
  await Promise.allSettled(
    tabIds.map((tabId) => chrome.tabs.sendMessage(tabId, message).catch(() => undefined))
  );
}

async function listSessions() {
  return db.sessions.orderBy("updatedAt").reverse().toArray();
}

async function updateStep(message: Extract<AppMessage, { type: "session:update-step" }>) {
  await db.actions.update(message.actionId, message.patch);
  const action = await db.actions.get(message.actionId);
  if (action) await db.sessions.update(action.sessionId, { updatedAt: now() });
  return action;
}

async function updateMeta(message: Extract<AppMessage, { type: "session:update-meta" }>) {
  await db.sessions.update(message.sessionId, { ...message.patch, updatedAt: now() });
  return db.sessions.get(message.sessionId);
}

async function deleteStep(actionId: string) {
  const action = await db.actions.get(actionId);
  if (!action) return null;
  await db.actions.update(actionId, { deleted: true });
  await db.sessions.update(action.sessionId, { updatedAt: now() });
  return actionId;
}

async function restoreStep(actionId: string) {
  const action = await db.actions.get(actionId);
  if (!action) return null;
  await db.actions.update(actionId, { deleted: false });
  await db.sessions.update(action.sessionId, { updatedAt: now() });
  return db.actions.get(actionId);
}

async function deletedSteps(sessionId: string) {
  const all = await db.actions.where("sessionId").equals(sessionId).sortBy("stepNumber");
  return all.filter((action) => action.deleted);
}

// Insert a manual, non-DOM step (a free-text note or a timed wait). It appends
// at the end of the live steps; the user drags it into position. Manual steps
// use a synthetic document target so the selector/exporter machinery still has
// something to work with.
async function insertStep(message: Extract<AppMessage, { type: "session:insert-step" }>) {
  const session = await db.sessions.get(message.sessionId);
  if (!session) throw new Error("Session not found");
  const live = (await db.actions.where("sessionId").equals(message.sessionId).toArray()).filter((a) => !a.deleted);
  const stepNumber = live.length + 1;
  const last = await db.actions.where("sessionId").equals(message.sessionId).sortBy("stepNumber");
  const page = last[last.length - 1]?.page ?? {
    url: session.startUrl ?? "",
    domain: session.startUrl ? new URL(session.startUrl).hostname : "",
    title: session.title
  };
  const isWait = message.kind === "wait";
  const value = message.value ?? (isWait ? "2" : "");
  const title = isWait ? `Wait ${value || "2"}s` : value || "Manual note";
  const description = isWait ? `Pause for ${value || "2"} seconds before continuing.` : value || "Manual note for the operator.";
  const action: RecordedAction = {
    id: id("action"),
    sessionId: message.sessionId,
    stepNumber,
    type: message.kind,
    page,
    target: {
      tagName: "document",
      selector: "html",
      xpath: "/html",
      selectorConfidence: 1,
      candidates: [{ kind: "css", value: "html", confidence: 1 }]
    },
    value,
    valuePolicy: "none",
    sensitive: false,
    highRisk: false,
    title,
    description,
    createdAt: now(),
    manual: true
  };
  await db.actions.add(action);
  await db.sessions.update(message.sessionId, { actionCount: stepNumber, updatedAt: now() });
  return getSessionBundle(message.sessionId);
}

async function reorderSteps(sessionId: string, actionIds: string[]) {
  await db.transaction("rw", db.actions, db.sessions, async () => {
    for (let index = 0; index < actionIds.length; index += 1) {
      await db.actions.update(actionIds[index], { stepNumber: index + 1 });
    }
    await db.sessions.update(sessionId, { updatedAt: now() });
  });
  return getSessionBundle(sessionId);
}

async function deleteSession(sessionId: string) {
  await db.transaction("rw", db.sessions, db.actions, db.screenshots, db.exports, async () => {
    await db.actions.where("sessionId").equals(sessionId).delete();
    await db.screenshots.where("sessionId").equals(sessionId).delete();
    await db.exports.where("sessionId").equals(sessionId).delete();
    await db.sessions.delete(sessionId);
  });
  const state = await getState();
  if (state.sessionId === sessionId) await setState({ status: "idle" });
  return sessionId;
}

async function storageEstimate(): Promise<StorageEstimate> {
  const estimate = await navigator.storage.estimate().catch(() => ({ usage: 0, quota: 0 }));
  const sessions = await db.sessions.toArray();
  const actions = await db.actions.toArray();
  const screenshots = await db.screenshots.toArray();
  const bySession = new Map<string, { screenshotBytes: number; actionCount: number; screenshotCount: number }>();
  for (const session of sessions) bySession.set(session.id, { screenshotBytes: 0, actionCount: 0, screenshotCount: 0 });
  for (const action of actions) {
    const entry = bySession.get(action.sessionId);
    if (entry) entry.actionCount += 1;
  }
  for (const shot of screenshots) {
    const entry = bySession.get(shot.sessionId);
    if (!entry) continue;
    entry.screenshotCount += 1;
    // base64 → bytes ≈ length * 0.75
    entry.screenshotBytes += Math.round((shot.dataUrl.length - (shot.dataUrl.indexOf(",") + 1)) * 0.75);
  }
  return {
    usageBytes: estimate.usage ?? 0,
    quotaBytes: estimate.quota ?? 0,
    sessionCount: sessions.length,
    actionCount: actions.length,
    screenshotCount: screenshots.length,
    perSession: Array.from(bySession.entries()).map(([sessionId, entry]) => ({ sessionId, ...entry }))
  };
}

const EXPORT_EXTENSION: Record<ExportType, string> = {
  "skill-pack": "zip",
  markdown: "md",
  playwright: "ts",
  devtools: "json"
};

async function createExport(message: Extract<AppMessage, { type: "export:create" }>) {
  const bundle = await getSessionBundle(message.sessionId);
  const slug = bundle.session.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "browser-agent-recording";
  const exportRecord = {
    id: id("export"),
    sessionId: message.sessionId,
    type: message.exportType,
    filename: `${slug}.${EXPORT_EXTENSION[message.exportType]}`,
    createdAt: now()
  };
  await db.exports.add(exportRecord);
  if (message.exportType === "markdown") return { record: exportRecord, content: generateHumanGuide(bundle) };
  if (message.exportType === "playwright") return { record: exportRecord, content: generatePlaywright(bundle) };
  if (message.exportType === "devtools") return { record: exportRecord, content: generateDevtoolsRecorderJson(bundle) };
  const base64 = await generateSkillPackBase64(bundle);
  return { record: exportRecord, base64, mimeType: "application/zip" };
}

// Wipe every recording and screenshot. Refused while a recording is live so we
// never orphan the active session's state.
async function clearStorage() {
  const state = await getState();
  if (state.status === "recording") {
    throw new Error("Stop the active recording before clearing all data.");
  }
  await db.transaction("rw", db.sessions, db.actions, db.screenshots, db.exports, async () => {
    await db.actions.clear();
    await db.screenshots.clear();
    await db.exports.clear();
    await db.sessions.clear();
  });
  return true;
}

async function handleMessage(message: AppMessage, sender: chrome.runtime.MessageSender): Promise<AppResponse> {
  try {
    if (message.type === "recording:start") return ok(await startRecording(message));
    if (message.type === "recording:stop") return ok(await stopRecording());
    if (message.type === "recording:pause") return ok(await setPaused(true));
    if (message.type === "recording:resume") return ok(await setPaused(false));
    if (message.type === "recording:get-state") return ok(await getState());
    if (message.type === "action:record") {
      // Tab gate: refuse events from any tab that wasn't started or opened
      // from the recording tab. Without this, a different tab's content
      // script could leak events into the active session. sender.tab is
      // undefined for messages from the extension UI; those can also call
      // action:record (none today, but keep the path safe).
      const state = await getState();
      const senderTabId = sender.tab?.id;
      if (senderTabId !== undefined && state.tabIds && state.tabIds.length > 0) {
        if (!state.tabIds.includes(senderTabId)) {
          return ok(null);
        }
      }
      return ok(await enqueueActionWrite(() => recordAction(message.payload)));
    }
    if (message.type === "session:list") return ok(await listSessions());
    if (message.type === "session:get") return ok(await getSessionBundle(message.sessionId));
    if (message.type === "session:update-step") return ok(await updateStep(message));
    if (message.type === "session:update-meta") return ok(await updateMeta(message));
    if (message.type === "session:delete-step") return ok(await deleteStep(message.actionId));
    if (message.type === "session:restore-step") return ok(await restoreStep(message.actionId));
    if (message.type === "session:deleted-steps") return ok(await deletedSteps(message.sessionId));
    if (message.type === "session:insert-step") return ok(await insertStep(message));
    if (message.type === "session:reorder-steps") return ok(await reorderSteps(message.sessionId, message.actionIds));
    if (message.type === "session:delete") return ok(await deleteSession(message.sessionId));
    if (message.type === "storage:estimate") return ok(await storageEstimate());
    if (message.type === "storage:clear") return ok(await clearStorage());
    if (message.type === "export:create") return ok(await createExport(message));
    return fail("Unknown message");
  } catch (error) {
    return fail(error);
  }
}

chrome.runtime.onMessage.addListener((message: AppMessage, sender, sendResponse) => {
  void handleMessage(message, sender).then(sendResponse);
  return true;
});

// Keyboard shortcut (default Alt+Shift+R): toggle recording without opening the
// popup. Start uses the active tab, mirroring the popup's Start button.
chrome.commands?.onCommand.addListener(async (command) => {
  if (command !== "toggle-recording") return;
  try {
    const state = await getState();
    if (state.status === "recording") await stopRecording();
    else await startRecording({ type: "recording:start" });
  } catch {
    /* e.g. active tab is a restricted page; surfaced next time the popup opens */
  }
});

// Re-attach page hooks every time a recording tab finishes loading so
// post-navigation pages stay instrumented. registerContentScripts already
// covers future page loads, but executeScript on completion handles the
// race where the initial load fires before registration completes.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== "complete") return;
  const state = await getState();
  if (state.status !== "recording") return;
  if (!state.tabIds?.includes(tabId)) return;
  await ensurePageHooksOnTab(tabId);
  // Also re-confirm the content script is alive after navigation. Chrome
  // tears down and re-creates the content world on cross-origin navigation;
  // manifest scripts will re-inject, but this protects the rare race.
  await ensureContentScript(tabId);
});

// Track child tabs opened during recording (target=_blank, middle-click,
// window.open). They should be part of the same session so the user can
// click through into a new tab without silently losing events.
chrome.tabs.onCreated.addListener(async (tab) => {
  if (!tab.id) return;
  const state = await getState();
  if (state.status !== "recording" || !state.tabIds) return;
  const opener = tab.openerTabId;
  if (opener === undefined || !state.tabIds.includes(opener)) return;
  if (state.tabIds.includes(tab.id)) return;
  const nextTabIds = [...state.tabIds, tab.id];
  await setState({ ...state, tabIds: nextTabIds });
  // Best-effort eager injection. If the new tab is still loading,
  // executeScript will succeed once document_start fires.
  await ensureContentScript(tab.id);
  await ensurePageHooksOnTab(tab.id);
});

// Drop closed tabs from the gate set.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState();
  if (state.status !== "recording" || !state.tabIds) return;
  if (!state.tabIds.includes(tabId)) return;
  const next = state.tabIds.filter((id) => id !== tabId);
  await setState({ ...state, tabIds: next });
});
