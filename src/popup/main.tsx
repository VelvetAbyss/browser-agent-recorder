import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import { isOk, sendMessage } from "../shared/messages";
import { t } from "../shared/i18n";
import type { RecordingSession, RecordingState } from "../shared/types";

const ONBOARDED_KEY = "onboarded";

function Popup() {
  const [state, setState] = useState<RecordingState>({ status: "idle" });
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [error, setError] = useState("");
  const [showOnboarding, setShowOnboarding] = useState(false);

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
    // First-run onboarding (J): show once, then remember the dismissal.
    chrome.storage.local.get(ONBOARDED_KEY).then((result) => {
      if (!result[ONBOARDED_KEY]) setShowOnboarding(true);
    });
  }, []);

  function dismissOnboarding() {
    setShowOnboarding(false);
    void chrome.storage.local.set({ [ONBOARDED_KEY]: true });
  }

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

  async function togglePause() {
    setError("");
    const response = await sendMessage<RecordingState>({ type: state.paused ? "recording:resume" : "recording:pause" });
    if (!response.ok) setError(response.error);
    await refresh();
  }

  function openEditor(sessionId?: string) {
    const url = chrome.runtime.getURL(`editor.html${sessionId ? `?session=${sessionId}` : ""}`);
    void chrome.tabs.create({ url });
  }

  const lastSession = sessions[0];
  const isRecording = state.status === "recording";
  const isPaused = isRecording && Boolean(state.paused);
  const stepCount = state.actionCount ?? 0;

  return (
    <main className="popup">
      <header className="popupHeader">
        <span className="popupKicker">{t("popup.kicker")}</span>
        <h1>
          {t("popup.title.a")} <span className="accent">{t("popup.title.b")}</span>
        </h1>
      </header>

      {showOnboarding ? (
        <section className="onboarding">
          <strong>{t("onboard.title")}</strong>
          <ol>
            <li>{t("onboard.s1")}</li>
            <li>{t("onboard.s2")}</li>
            <li>{t("onboard.s3")}</li>
          </ol>
          <button className="primary" onClick={dismissOnboarding}>{t("onboard.dismiss")}</button>
        </section>
      ) : null}

      <div className="status">
        <span className={`dot ${isRecording && !isPaused ? "active" : ""}`} />
        <span className="label">
          {isPaused
            ? t("popup.status.paused", { n: stepCount })
            : isRecording
              ? t("popup.status.recording", { n: stepCount })
              : t("popup.status.ready")}
        </span>
      </div>

      <div className="buttonStack">
        {isRecording ? (
          <>
            <button onClick={togglePause}>{isPaused ? t("popup.resume") : t("popup.pause")}</button>
            <button onClick={stop}>{t("popup.stop")}</button>
          </>
        ) : (
          <button className="primary" onClick={start}>{t("popup.start")}</button>
        )}
        <button disabled={!lastSession} onClick={() => openEditor(lastSession?.id)}>
          {t("popup.openLast")}
        </button>
        <button onClick={() => openEditor()}>{t("popup.openLibrary")}</button>
      </div>

      {isRecording && stepCount === 0 ? <p className="muted hint">{t("popup.hint")}</p> : null}
      {!isRecording ? <p className="muted shortcutHint">{t("popup.shortcut")}</p> : null}

      {error ? <p className="errorBanner">{error}</p> : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Popup />);
