import Dexie, { type Table } from "dexie";
import type { ExportRecord, RecordedAction, RecordingSession, ScreenshotRecord } from "./types";

export class RecorderDatabase extends Dexie {
  sessions!: Table<RecordingSession, string>;
  actions!: Table<RecordedAction, string>;
  screenshots!: Table<ScreenshotRecord, string>;
  exports!: Table<ExportRecord, string>;

  constructor() {
    super("browser-agent-recorder");
    this.version(1).stores({
      sessions: "id, status, createdAt, updatedAt",
      actions: "id, sessionId, stepNumber, createdAt, deleted",
      screenshots: "id, sessionId, actionId, stepNumber",
      exports: "id, sessionId, type, createdAt"
    });
  }
}

export const db = new RecorderDatabase();

export async function getSessionBundle(sessionId: string) {
  const session = await db.sessions.get(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }
  const actions = await db.actions.where("sessionId").equals(sessionId).sortBy("stepNumber");
  const screenshots = await db.screenshots.where("sessionId").equals(sessionId).sortBy("stepNumber");
  return {
    session,
    actions: actions.filter((action) => !action.deleted),
    screenshots
  };
}
