import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import { isOk, sendMessage } from "../shared/messages";
import type { RecordingSession, RecordingState } from "../shared/types";

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
  const stepCount = state.actionCount ?? 0;

  return (
    <main className="popup">
      <header className="popupHeader">
        <span className="popupKicker">Browser Agent · Recorder</span>
        <h1>
          Record it. <span className="accent">Replay it.</span>
        </h1>
      </header>

      <div className="status">
        <span className={`dot ${isRecording ? "active" : ""}`} />
        <span className="label">
          {isRecording ? `Recording · ${stepCount} step${stepCount === 1 ? "" : "s"}` : "Ready when you are."}
        </span>
      </div>

      <div className="buttonStack">
        {isRecording ? (
          <button onClick={stop}>Stop recording</button>
        ) : (
          <button className="primary" onClick={start}>Start recording</button>
        )}
        <button disabled={!lastSession} onClick={() => openEditor(lastSession?.id)}>
          Open last recording
        </button>
        <button onClick={() => openEditor()}>Open guide library</button>
      </div>

      {error ? <p className="muted">{error}</p> : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Popup />);
