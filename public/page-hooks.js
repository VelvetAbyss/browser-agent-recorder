/*
  Browser Agent Recorder — page-world hooks.

  Runs in the MAIN world (page JS scope) when registered via
  chrome.scripting.registerContentScripts. Patches the native dialog
  APIs that the page can call but the content script in its isolated
  world cannot observe. Communicates back to the isolated world via a
  CustomEvent on window — DOM events cross worlds, structured-cloned
  detail is delivered intact.

  All work is guarded so the hook is a no-op when run twice.
*/

(function () {
  if (window.__browserAgentRecorderHooked) return;
  Object.defineProperty(window, "__browserAgentRecorderHooked", {
    value: true,
    writable: false,
    configurable: false
  });

  var EVENT_NAME = "__browser_agent_recorder_event__";

  function emit(detail) {
    try {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: detail }));
    } catch (_) {
      /* ignore */
    }
  }

  // --- alert -------------------------------------------------------
  var origAlert = window.alert;
  if (typeof origAlert === "function") {
    window.alert = function (message) {
      emit({ type: "dialog", kind: "alert", message: String(message == null ? "" : message) });
      return origAlert.apply(this, arguments);
    };
  }

  // --- confirm -----------------------------------------------------
  var origConfirm = window.confirm;
  if (typeof origConfirm === "function") {
    window.confirm = function (message) {
      var result = origConfirm.apply(this, arguments);
      emit({
        type: "dialog",
        kind: "confirm",
        message: String(message == null ? "" : message),
        accepted: Boolean(result)
      });
      return result;
    };
  }

  // --- prompt ------------------------------------------------------
  var origPrompt = window.prompt;
  if (typeof origPrompt === "function") {
    window.prompt = function (message, _defaultValue) {
      var result = origPrompt.apply(this, arguments);
      emit({
        type: "dialog",
        kind: "prompt",
        message: String(message == null ? "" : message),
        response: result == null ? undefined : String(result),
        accepted: result !== null
      });
      return result;
    };
  }

  // --- print -------------------------------------------------------
  var origPrint = window.print;
  if (typeof origPrint === "function") {
    window.print = function () {
      emit({ type: "dialog", kind: "print" });
      return origPrint.apply(this, arguments);
    };
  }

  // --- beforeunload (best-effort signal) ---------------------------
  window.addEventListener(
    "beforeunload",
    function () {
      emit({ type: "dialog", kind: "beforeunload" });
    },
    { capture: true }
  );

  // --- console marker for debugging --------------------------------
  // No-op; presence of this script is the marker. Don't log to console
  // on production pages.
})();
