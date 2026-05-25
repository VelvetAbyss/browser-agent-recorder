import { db, getSessionBundle } from "../shared/db";
import { RecentActionDeduper } from "../shared/actionIntegrity";
import { generateHumanGuide, generateSkillPackBase64 } from "../shared/exporters";
import { generatedDescription, generatedTitle } from "../shared/stepText";
import type { ActionPayload, AppMessage, AppResponse, RecordedAction, RecordingSession, RecordingState, StorageEstimate } from "../shared/types";

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
  const state: RecordingState = { status: "recording", sessionId: session.id, startedAt: timestamp, tabId: tab?.id, actionCount: 0 };
  await setState(state);
  // MAIN-world hooks let us observe alert/confirm/prompt/print/beforeunload.
  // Register globally so navigations don't strip them, plus inject on the
  // active tab immediately for the current page that's already loaded.
  await registerPageHooks();
  await ensurePageHooksOnTab(tab?.id);
  return session;
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

async function redactScreenshot(dataUrl: string, payload: ActionPayload): Promise<string> {
  if (!payload.sensitive || !payload.target.boundingBox) return dataUrl;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(bitmap, 0, 0);
    const dpr = payload.devicePixelRatio || 1;
    const { x, y, width, height } = payload.target.boundingBox;
    const padding = 4;
    ctx.fillStyle = "#000";
    ctx.fillRect(
      Math.max(0, x * dpr - padding),
      Math.max(0, y * dpr - padding),
      Math.max(0, width * dpr + padding * 2),
      Math.max(0, height * dpr + padding * 2)
    );
    const out = await canvas.convertToBlob({ type: "image/png" });
    const buffer = new Uint8Array(await out.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buffer.length; i += 1) binary += String.fromCharCode(buffer[i]);
    return `data:image/png;base64,${btoa(binary)}`;
  } catch {
    return dataUrl;
  }
}

async function persistScreenshot(dataUrl: string | undefined, actionId: string, sessionId: string, stepNumber: number) {
  if (!dataUrl) return undefined;
  const screenshot = {
    id: id("shot"),
    sessionId,
    actionId,
    stepNumber,
    dataUrl,
    path: `screenshots/step-${String(stepNumber).padStart(3, "0")}.png`,
    createdAt: now()
  };
  await db.screenshots.add(screenshot);
  return screenshot.id;
}

async function recordAction(payload: ActionPayload) {
  const state = await getState();
  if (state.status !== "recording" || !state.sessionId) return null;
  if (!actionDeduper.shouldAccept(payload)) return null;

  // Start screenshot immediately — it races the page's reaction to the click
  // (e.g. navigation). Even when the page begins to navigate, the visible-tab
  // capture API resolves with the frame Chrome can still snapshot.
  const tab = state.tabId ? await chrome.tabs.get(state.tabId).catch(() => undefined) : await currentTab();
  const screenshotPromise = scheduleScreenshot(tab?.windowId);

  const session = await db.sessions.get(state.sessionId);
  if (!session) throw new Error("No active session");
  const stepNumber = session.actionCount + 1;
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
  await setState({ ...state, actionCount: stepNumber });
  const rawDataUrl = await screenshotPromise;
  const dataUrl = rawDataUrl ? await redactScreenshot(rawDataUrl, payload) : undefined;
  const screenshotId = await persistScreenshot(dataUrl, actionId, session.id, stepNumber);
  if (screenshotId) await db.actions.update(actionId, { screenshotId });
  return { ...action, screenshotId };
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

async function deleteStep(actionId: string) {
  const action = await db.actions.get(actionId);
  if (!action) return null;
  await db.actions.update(actionId, { deleted: true });
  await db.sessions.update(action.sessionId, { updatedAt: now() });
  return actionId;
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

async function createExport(message: Extract<AppMessage, { type: "export:create" }>) {
  const bundle = await getSessionBundle(message.sessionId);
  const exportRecord = {
    id: id("export"),
    sessionId: message.sessionId,
    type: message.exportType,
    filename: `${bundle.session.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "browser-agent-recording"}.${message.exportType === "skill-pack" ? "zip" : "md"}`,
    createdAt: now()
  };
  await db.exports.add(exportRecord);
  if (message.exportType === "markdown") {
    return { record: exportRecord, content: generateHumanGuide(bundle) };
  }
  const base64 = await generateSkillPackBase64(bundle);
  return { record: exportRecord, base64, mimeType: "application/zip" };
}

async function handleMessage(message: AppMessage, sender: chrome.runtime.MessageSender): Promise<AppResponse> {
  try {
    if (message.type === "recording:start") return ok(await startRecording(message));
    if (message.type === "recording:stop") return ok(await stopRecording());
    if (message.type === "recording:get-state") return ok(await getState());
    if (message.type === "action:record") {
      // Tab gate: refuse events from any tab other than the recording one.
      // sender.tab is undefined for messages from the extension UI; those
      // can also call action:record (none today, but keep the path safe).
      const state = await getState();
      if (sender.tab?.id !== undefined && state.tabId !== undefined && sender.tab.id !== state.tabId) {
        return ok(null);
      }
      return ok(await enqueueActionWrite(() => recordAction(message.payload)));
    }
    if (message.type === "session:list") return ok(await listSessions());
    if (message.type === "session:get") return ok(await getSessionBundle(message.sessionId));
    if (message.type === "session:update-step") return ok(await updateStep(message));
    if (message.type === "session:delete-step") return ok(await deleteStep(message.actionId));
    if (message.type === "session:reorder-steps") return ok(await reorderSteps(message.sessionId, message.actionIds));
    if (message.type === "session:delete") return ok(await deleteSession(message.sessionId));
    if (message.type === "storage:estimate") return ok(await storageEstimate());
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

// Re-attach page hooks every time the recording tab finishes loading so
// post-navigation pages stay instrumented. registerContentScripts already
// covers future page loads, but executeScript on completion handles the
// race where the initial load fires before registration completes.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== "complete") return;
  const state = await getState();
  if (state.status !== "recording" || state.tabId !== tabId) return;
  await ensurePageHooksOnTab(tabId);
});
