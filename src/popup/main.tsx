import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/index.css";
import { isOk, sendMessage } from "../shared/messages";
import { bootstrapTheme } from "../shared/theme";
import { ThemeSwitcher } from "../shared/ThemeSwitcher";
import type { RecordingSession, RecordingState } from "../shared/types";

bootstrapTheme();

function Popup() {
  const [state, setState] = useState<RecordingState>({ status: "idle" });
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [error, setError] = useState("");

  async function refresh() {
    const [stateResponse, sessionsResponse] = await Promise.all([
      sendMessage<RecordingState>({ type: "recording:get-state" }),
      sendMessage<RecordingSession[]>({ type: "session:list" })
    ]);
    if (isOk(stateResponse)) setState(stateResponse.data);
    if (isOk(sessionsResponse)) setSessions(sessionsResponse.data);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function start() {
    setError("");
    const response = await sendMessage({ type: "recording:start" });
    if (!response.ok) setError(response.error);
    await refresh();
  }

  async function stop() {
    setError("");
    const response = await sendMessage<RecordingState>({ type: "recording:stop" });
    if (!response.ok) setError(response.error);
    await refresh();
  }

  function openEditor(sessionId?: string) {
    const url = chrome.runtime.getURL(`editor.html${sessionId ? `?session=${sessionId}` : ""}`);
    void chrome.tabs.create({ url });
  }

  const lastSession = sessions[0];
  const isRecording = state.status === "recording";

  return (
    <main className="popup">
      <header className="popupHeader">
        <div className="popupKicker">Browser Agent</div>
        <h1>Recorder</h1>
      </header>
      <div className="status">
        <span className={`dot ${isRecording ? "active" : ""}`} />
        <span className="label">{isRecording ? `Recording · ${state.actionCount ?? 0} steps` : "Idle"}</span>
      </div>
      <div className="buttonStack">
        <button className="primary" disabled={isRecording} onClick={start}>Start Recording</button>
        <button disabled={!isRecording} onClick={stop}>Stop Recording</button>
        <button disabled={!lastSession} onClick={() => openEditor(lastSession?.id)}>Open Last Recording</button>
        <button onClick={() => openEditor()}>Open Guide Library</button>
      </div>
      {error ? <p className="muted">{error}</p> : null}
      <ThemeSwitcher compact />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Popup />);
