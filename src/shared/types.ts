export type ActionType =
  | "click"
  | "rightclick"
  | "doubleclick"
  | "input"
  | "change"
  | "submit"
  | "keydown"
  | "navigation"
  | "paste"
  | "upload"
  | "dragstart"
  | "drop"
  | "dialog"
  | "toggle";

export type RecordingStatus = "idle" | "recording";

export type SelectorKind = "role" | "label" | "placeholder" | "text" | "css" | "xpath";

export type ValuePolicy = "none" | "masked" | "runtime" | "literal";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageInfo {
  url: string;
  domain: string;
  title: string;
}

export interface SelectorCandidate {
  kind: SelectorKind;
  value: string;
  confidence: number;
}

export interface ElementTarget {
  tagName: string;
  role?: string;
  text?: string;
  ariaLabel?: string;
  placeholder?: string;
  name?: string;
  id?: string;
  selector: string;
  xpath: string;
  selectorConfidence: number;
  candidates: SelectorCandidate[];
  boundingBox?: BoundingBox;
}

export interface RuntimeVariable {
  name: string;
  description?: string;
}

export interface RecordingSession {
  id: string;
  title: string;
  summary: string;
  status: RecordingStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  stoppedAt?: string;
  tabId?: number;
  startUrl?: string;
  actionCount: number;
}

export interface RecordedAction {
  id: string;
  sessionId: string;
  stepNumber: number;
  clientEventId?: string;
  clientSequence?: number;
  type: ActionType;
  page: PageInfo;
  target: ElementTarget;
  value?: string;
  valueLabel?: string;
  key?: string;
  valuePolicy: ValuePolicy;
  runtimeVariable?: RuntimeVariable;
  sensitive: boolean;
  highRisk: boolean;
  title: string;
  description: string;
  screenshotId?: string;
  createdAt: string;
  deleted?: boolean;
  viewport?: ViewportInfo;
  dialog?: DialogInfo;
  frameUrl?: string;
}

export interface ScreenshotRecord {
  id: string;
  sessionId: string;
  actionId: string;
  stepNumber: number;
  dataUrl: string;
  path: string;
  createdAt: string;
}

export interface ExportRecord {
  id: string;
  sessionId: string;
  type: "skill-pack" | "markdown";
  filename: string;
  createdAt: string;
}

export interface RecordingState {
  status: RecordingStatus;
  sessionId?: string;
  startedAt?: string;
  tabId?: number;
  tabIds?: number[];
  actionCount?: number;
}

export interface DialogInfo {
  kind: "alert" | "confirm" | "prompt" | "print" | "beforeunload";
  message?: string;
  response?: string;
  accepted?: boolean;
}

export interface ViewportInfo {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  devicePixelRatio: number;
}

export interface ActionPayload {
  clientEventId?: string;
  clientSequence?: number;
  type: ActionType;
  page: PageInfo;
  target: ElementTarget;
  value?: string;
  valueLabel?: string;
  key?: string;
  valuePolicy: ValuePolicy;
  sensitive: boolean;
  highRisk?: boolean;
  devicePixelRatio?: number;
  viewport?: ViewportInfo;
  dialog?: DialogInfo;
  composedInput?: boolean;
  frameUrl?: string;
}

export interface SessionBundle {
  session: RecordingSession;
  actions: RecordedAction[];
  screenshots: ScreenshotRecord[];
}

export type AppMessage =
  | { type: "recording:start"; tabId?: number; url?: string; title?: string }
  | { type: "recording:stop" }
  | { type: "recording:get-state" }
  | { type: "action:record"; payload: ActionPayload }
  | { type: "session:list" }
  | { type: "session:get"; sessionId: string }
  | { type: "session:update-step"; actionId: string; patch: Partial<Pick<RecordedAction, "title" | "description" | "sensitive" | "runtimeVariable" | "valuePolicy" | "highRisk">> }
  | { type: "session:delete-step"; actionId: string }
  | { type: "session:reorder-steps"; sessionId: string; actionIds: string[] }
  | { type: "session:delete"; sessionId: string }
  | { type: "storage:estimate" }
  | { type: "export:create"; sessionId: string; exportType: "skill-pack" | "markdown" };

export interface StorageEstimate {
  usageBytes: number;
  quotaBytes: number;
  sessionCount: number;
  actionCount: number;
  screenshotCount: number;
  perSession: { sessionId: string; screenshotBytes: number; actionCount: number; screenshotCount: number }[];
}

export type AppResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
