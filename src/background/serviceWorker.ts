import { db, getSessionBundle } from "../shared/db";
import { RecentActionDeduper } from "../shared/actionIntegrity";
import { generateHumanGuide, generateSkillPackBase64 } from "../shared/exporters";
import { generatedDescription, generatedTitle } from "../shared/stepText";
import type { ActionPayload, AppMessage, AppResponse, RecordedAction, RecordingSession, RecordingState } from "../shared/types";

let recordingState: RecordingState = { status: "idle" };
const actionDeduper = new RecentActionDeduper();
let actionWriteQueue: Promise<unknown> = Promise.resolve();

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

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function broadcastState() {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.filter((tab) => tab.id).map((tab) => chrome.tabs.sendMessage(tab.id!, { type: "recording:state-changed", state: recordingState })));
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
  recordingState = { status: "recording", sessionId: session.id, startedAt: timestamp, tabId: tab?.id };
  await broadcastState();
  return session;
}

async function stopRecording() {
  if (recordingState.sessionId) {
    await db.sessions.update(recordingState.sessionId, { status: "idle", stoppedAt: now(), updatedAt: now() });
  }
  recordingState = { status: "idle" };
  await broadcastState();
  return recordingState;
}

function enqueueActionWrite<T>(operation: () => Promise<T>) {
  const next = actionWriteQueue.then(operation, operation);
  actionWriteQueue = next.catch(() => undefined);
  return next;
}

async function captureVisibleScreenshot(actionId: string, sessionId: string, stepNumber: number) {
  try {
    const tab = recordingState.tabId ? await chrome.tabs.get(recordingState.tabId) : await currentTab();
    const dataUrl = await chrome.tabs.captureVisibleTab(tab?.windowId, { format: "png" });
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
  } catch {
    return undefined;
  }
}

async function recordAction(payload: ActionPayload) {
  if (recordingState.status !== "recording" || !recordingState.sessionId) {
    return null;
  }
  if (!actionDeduper.shouldAccept(payload)) {
    return null;
  }
  const session = await db.sessions.get(recordingState.sessionId);
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
    key: payload.key,
    valuePolicy: payload.valuePolicy,
    sensitive: payload.sensitive,
    highRisk: Boolean(payload.highRisk),
    title: generatedTitle(payload, stepNumber),
    description: generatedDescription(payload),
    createdAt: now()
  };
  await db.actions.add(action);
  const screenshotId = await captureVisibleScreenshot(actionId, session.id, stepNumber);
  if (screenshotId) await db.actions.update(actionId, { screenshotId });
  await db.sessions.update(session.id, { actionCount: stepNumber, updatedAt: now() });
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
    await Promise.all(actionIds.map((actionId, index) => db.actions.update(actionId, { stepNumber: index + 1 })));
    await db.sessions.update(sessionId, { updatedAt: now() });
  });
  return getSessionBundle(sessionId);
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

async function handleMessage(message: AppMessage): Promise<AppResponse> {
  try {
    if (message.type === "recording:start") return ok(await startRecording(message));
    if (message.type === "recording:stop") return ok(await stopRecording());
    if (message.type === "recording:get-state") return ok(recordingState);
    if (message.type === "action:record") return ok(await enqueueActionWrite(() => recordAction(message.payload)));
    if (message.type === "session:list") return ok(await listSessions());
    if (message.type === "session:get") return ok(await getSessionBundle(message.sessionId));
    if (message.type === "session:update-step") return ok(await updateStep(message));
    if (message.type === "session:delete-step") return ok(await deleteStep(message.actionId));
    if (message.type === "session:reorder-steps") return ok(await reorderSteps(message.sessionId, message.actionIds));
    if (message.type === "export:create") return ok(await createExport(message));
    return fail("Unknown message");
  } catch (error) {
    return fail(error);
  }
}

chrome.runtime.onMessage.addListener((message: AppMessage, _sender, sendResponse) => {
  void handleMessage(message).then(sendResponse);
  return true;
});
