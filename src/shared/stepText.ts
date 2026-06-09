import type { ActionPayload, RecordedAction } from "./types";

function targetName(action: Pick<RecordedAction | ActionPayload, "target">) {
  return action.target.ariaLabel || action.target.placeholder || action.target.text || action.target.name || action.target.id || action.target.selector;
}

export function generatedTitle(action: ActionPayload, stepNumber: number) {
  const target = targetName(action);
  if (action.type === "input") return `Enter value in ${target}`;
  if (action.type === "change") {
    const label = action.valueLabel ? ` to ${action.valueLabel}` : "";
    return `Change ${target}${label}`;
  }
  if (action.type === "submit") return `Submit ${target}`;
  if (action.type === "keydown") return `Press ${action.key || "key"} on ${target}`;
  if (action.type === "navigation") return `Navigate to ${action.page.domain}`;
  if (action.type === "note") return action.value?.trim() || "Manual note";
  if (action.type === "wait") return `Wait ${action.value || "2"}s`;
  if (action.type === "paste") return `Paste content into ${target}`;
  if (action.type === "upload") return `Upload file into ${target}`;
  if (action.type === "rightclick") return `Right-click ${target}`;
  if (action.type === "doubleclick") return `Double-click ${target}`;
  if (action.type === "dragstart") return `Begin dragging ${target}`;
  if (action.type === "drop") return `Drop onto ${target}`;
  if (action.type === "toggle") return `${action.key === "close" ? "Close" : "Open"} ${target}`;
  if (action.type === "dialog") {
    const kind = action.dialog?.kind ?? "alert";
    if (kind === "prompt") return `Respond to browser prompt`;
    if (kind === "confirm") return `${action.dialog?.accepted ? "Accept" : "Dismiss"} browser confirm`;
    if (kind === "print") return `Open print dialog`;
    if (kind === "beforeunload") return `Page tried to navigate away`;
    return `Browser alert appeared`;
  }
  return `Click ${target || `step ${stepNumber}`}`;
}

export function generatedDescription(action: ActionPayload) {
  const target = targetName(action);
  if (action.type === "input") return `Type the required value into ${target}.`;
  if (action.type === "change") {
    const label = action.valueLabel ? ` (${action.valueLabel})` : "";
    return `Set ${target}${label} to the recorded state.`;
  }
  if (action.type === "submit") return `Submit the form from ${action.page.title || action.page.url}.`;
  if (action.type === "keydown") return `Press ${action.key || "the recorded key"} while focused on ${target}.`;
  if (action.type === "navigation") return `Open ${action.page.url}.`;
  if (action.type === "note") return action.value?.trim() || "Manual note for the operator.";
  if (action.type === "wait") return `Pause for ${action.value || "2"} seconds before continuing.`;
  if (action.type === "paste") return `Paste the required content into ${target}.`;
  if (action.type === "upload") return `Provide the file(s) for ${target}.`;
  if (action.type === "rightclick") return `Open the context menu for ${target}.`;
  if (action.type === "doubleclick") return `Double-click ${target}.`;
  if (action.type === "dragstart") return `Start a drag from ${target}.`;
  if (action.type === "drop") return `Drop the dragged item onto ${target}.`;
  if (action.type === "toggle") return `${action.key === "close" ? "Collapse" : "Expand"} ${target}.`;
  if (action.type === "dialog") {
    const kind = action.dialog?.kind ?? "alert";
    const message = action.dialog?.message ? ` "${action.dialog.message}"` : "";
    if (kind === "prompt") return `Provide the prompt response${message}.`;
    if (kind === "confirm") return `${action.dialog?.accepted ? "Accept" : "Dismiss"} the browser confirm${message}.`;
    if (kind === "print") return `Open the browser print dialog.`;
    if (kind === "beforeunload") return `Confirm leaving the page.`;
    return `Acknowledge the browser alert${message}.`;
  }
  return `Select ${target}.`;
}
