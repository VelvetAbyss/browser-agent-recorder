import type { ActionPayload, RecordedAction } from "./types";

function targetName(action: Pick<RecordedAction | ActionPayload, "target">) {
  return action.target.ariaLabel || action.target.placeholder || action.target.text || action.target.name || action.target.id || action.target.selector;
}

export function generatedTitle(action: ActionPayload, stepNumber: number) {
  const target = targetName(action);
  if (action.type === "input") return `Enter value in ${target}`;
  if (action.type === "change") return `Change ${target}`;
  if (action.type === "submit") return `Submit ${target}`;
  if (action.type === "keydown") return `Press ${action.key || "key"} on ${target}`;
  if (action.type === "navigation") return `Navigate to ${action.page.domain}`;
  return `Click ${target || `step ${stepNumber}`}`;
}

export function generatedDescription(action: ActionPayload) {
  const target = targetName(action);
  if (action.type === "input") return `Type the required value into ${target}.`;
  if (action.type === "change") return `Set ${target} to the recorded state.`;
  if (action.type === "submit") return `Submit the form from ${action.page.title || action.page.url}.`;
  if (action.type === "keydown") return `Press ${action.key || "the recorded key"} while focused on ${target}.`;
  if (action.type === "navigation") return `Open ${action.page.url}.`;
  return `Select ${target}.`;
}
