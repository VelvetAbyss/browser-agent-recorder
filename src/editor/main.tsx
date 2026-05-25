import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/index.css";
import { isOk, sendMessage } from "../shared/messages";
import { runtimeVariableName } from "../shared/sanitize";
import { bootstrapTheme } from "../shared/theme";
import { ThemeSwitcher } from "../shared/ThemeSwitcher";
import type { RecordedAction, RecordingSession, ScreenshotRecord, SessionBundle, StorageEstimate } from "../shared/types";

bootstrapTheme();

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

type ExportResponse = {
  record: { filename: string };
  content?: string;
  base64?: string;
  mimeType?: string;
};

function download(filename: string, content: string | Blob, type = "text/markdown") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function blobFromBase64(base64: string, type: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type });
}

function Editor() {
  const initialSession = new URLSearchParams(location.search).get("session") || undefined;
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialSession);
  const [bundle, setBundle] = useState<SessionBundle | null>(null);
  const [error, setError] = useState("");
  const [storage, setStorage] = useState<StorageEstimate | null>(null);

  async function loadStorage() {
    const response = await sendMessage<StorageEstimate>({ type: "storage:estimate" });
    if (isOk(response)) setStorage(response.data);
  }

  const screenshots = useMemo(() => new Map((bundle?.screenshots || []).map((shot) => [shot.actionId, shot])), [bundle]);

  async function loadSessions() {
    const response = await sendMessage<RecordingSession[]>({ type: "session:list" });
    if (isOk(response)) {
      setSessions(response.data);
      if (!selectedId && response.data[0]) setSelectedId(response.data[0].id);
    }
  }

  async function loadBundle(sessionId: string) {
    const response = await sendMessage<SessionBundle>({ type: "session:get", sessionId });
    if (isOk(response)) setBundle(response.data);
    else setError(response.error);
  }

  useEffect(() => {
    void loadSessions();
    void loadStorage();
  }, []);

  useEffect(() => {
    if (selectedId) void loadBundle(selectedId);
  }, [selectedId]);

  async function patchStep(action: RecordedAction, patch: Partial<RecordedAction>) {
    const response = await sendMessage<RecordedAction>({ type: "session:update-step", actionId: action.id, patch });
    if (!response.ok) setError(response.error);
    if (bundle) await loadBundle(bundle.session.id);
  }

  async function deleteStep(action: RecordedAction) {
    const response = await sendMessage({ type: "session:delete-step", actionId: action.id });
    if (!response.ok) setError(response.error);
    if (bundle) await loadBundle(bundle.session.id);
  }

  async function moveStep(index: number, direction: -1 | 1) {
    if (!bundle) return;
    const ids = bundle.actions.map((action) => action.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    const response = await sendMessage<SessionBundle>({ type: "session:reorder-steps", sessionId: bundle.session.id, actionIds: ids });
    if (isOk(response)) setBundle(response.data);
  }

  async function deleteSessionAt(sessionId: string) {
    if (!confirm("Delete this recording and all of its steps and screenshots?")) return;
    const response = await sendMessage({ type: "session:delete", sessionId });
    if (!response.ok) {
      setError(response.error);
      return;
    }
    if (selectedId === sessionId) {
      setSelectedId(undefined);
      setBundle(null);
    }
    await loadSessions();
    await loadStorage();
  }

  async function exportBundle(exportType: "skill-pack" | "markdown") {
    if (!bundle) return;
    const response = await sendMessage<ExportResponse>({ type: "export:create", sessionId: bundle.session.id, exportType });
    if (!response.ok) {
      setError(response.error);
      return;
    }
    if (exportType === "markdown" && response.data.content) {
      download(response.data.record.filename, response.data.content);
    } else if (response.data.base64) {
      download(response.data.record.filename, blobFromBase64(response.data.base64, response.data.mimeType || "application/zip"), "application/zip");
    }
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="topbarTitle">
          <span className="kicker">Browser Agent · Library</span>
          <h1>{bundle ? bundle.session.title : "Guide Library"}</h1>
        </div>
        <div className="topbarActions">
          <ThemeSwitcher />
          <button disabled={!bundle} onClick={() => void exportBundle("markdown")}>Export SOP</button>
          <button className="primary" disabled={!bundle} onClick={() => void exportBundle("skill-pack")}>Export Skill Pack</button>
        </div>
      </header>
      <section className="layout">
        <aside className="sidebar">
          <strong>Recordings</strong>
          <div className="sessionList">
            {sessions.map((session) => {
              const perSession = storage?.perSession.find((entry) => entry.sessionId === session.id);
              return (
                <div key={session.id} className={`sessionRow ${session.id === selectedId ? "active" : ""}`}>
                  <button className="sessionButton" onClick={() => setSelectedId(session.id)}>
                    <span>{session.title}</span>
                    <span className="muted">
                      {session.actionCount} steps{perSession ? ` · ${formatBytes(perSession.screenshotBytes)}` : ""}
                    </span>
                  </button>
                  <button className="danger small" title="Delete recording" onClick={() => void deleteSessionAt(session.id)}>
                    ×
                  </button>
                </div>
              );
            })}
          </div>
          {storage ? (
            <div className="storageInfo muted">
              {storage.sessionCount} recordings · {formatBytes(storage.usageBytes)}
              {storage.quotaBytes ? ` / ${formatBytes(storage.quotaBytes)}` : ""}
            </div>
          ) : null}
        </aside>
        <section className="content">
          {error ? <p className="muted">{error}</p> : null}
          {!bundle ? (
            <div className="empty">
              <h1>No recording selected</h1>
              <p className="muted">Start a recording from the popup, then return here to edit and export it.</p>
            </div>
          ) : (
            <div className="steps">
              {bundle.actions.map((action, index) => (
                <StepCard
                  key={action.id}
                  action={action}
                  index={index}
                  screenshot={screenshots.get(action.id)}
                  total={bundle.actions.length}
                  onPatch={(patch) => void patchStep(action, patch)}
                  onDelete={() => void deleteStep(action)}
                  onMove={(direction) => void moveStep(index, direction)}
                />
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function StepCard({
  action,
  index,
  screenshot,
  total,
  onPatch,
  onDelete,
  onMove
}: {
  action: RecordedAction;
  index: number;
  screenshot?: ScreenshotRecord;
  total: number;
  onPatch: (patch: Partial<RecordedAction>) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const runtimeName = action.runtimeVariable?.name || runtimeVariableName(action.title, index + 1).toUpperCase();
  return (
    <article className="step">
      <div>{screenshot ? <img src={screenshot.dataUrl} alt={`Step ${index + 1}`} /> : <div className="muted">No screenshot</div>}</div>
      <div className="stepFields">
        <div className="muted">Step {index + 1} · {action.type}</div>
        <input value={action.title} onChange={(event) => onPatch({ title: event.target.value })} />
        <textarea value={action.description} onChange={(event) => onPatch({ description: event.target.value })} />
        <div className="flags">
          <label>
            <input
              type="checkbox"
              checked={action.valuePolicy === "runtime"}
              onChange={(event) =>
                onPatch({
                  valuePolicy: event.target.checked ? "runtime" : action.sensitive ? "masked" : "literal",
                  runtimeVariable: event.target.checked ? { name: runtimeName } : undefined
                })
              }
            />
            Runtime variable
          </label>
          <label>
            <input type="checkbox" checked={action.sensitive} onChange={(event) => onPatch({ sensitive: event.target.checked, valuePolicy: event.target.checked ? "masked" : action.valuePolicy })} />
            Sensitive
          </label>
          <label>
            <input type="checkbox" checked={action.highRisk} onChange={(event) => onPatch({ highRisk: event.target.checked })} />
            High risk
          </label>
        </div>
        {action.valuePolicy === "runtime" ? <input value={runtimeName} onChange={(event) => onPatch({ runtimeVariable: { name: event.target.value } })} /> : null}
        <div className="meta">
          <div>URL: {action.page.url}</div>
          <div>Selector: {action.target.selector}</div>
          <div>XPath: {action.target.xpath}</div>
          <div>Confidence: {Math.round(action.target.selectorConfidence * 100)}%</div>
        </div>
        <div className="stepActions">
          <button disabled={index === 0} onClick={() => onMove(-1)}>Move Up</button>
          <button disabled={index === total - 1} onClick={() => onMove(1)}>Move Down</button>
          <button className="danger" onClick={onDelete}>Delete</button>
        </div>
      </div>
    </article>
  );
}

createRoot(document.getElementById("root")!).render(<Editor />);
