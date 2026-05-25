import type { ActionPayload } from "./types";

export function actionFingerprint(action: ActionPayload) {
  return [
    action.type,
    action.page.url,
    action.target.selector,
    action.target.xpath,
    action.key || "",
    action.valuePolicy === "literal" ? action.value || "" : action.valuePolicy,
    action.dialog ? `${action.dialog.kind}|${action.dialog.message ?? ""}|${action.dialog.response ?? ""}|${action.dialog.accepted ?? ""}` : ""
  ].join("|");
}

export class RecentActionDeduper {
  private recent = new Map<string, number>();

  constructor(private readonly ttlMs = 900) {}

  shouldAccept(action: ActionPayload, nowMs = Date.now()) {
    const fingerprint = actionFingerprint(action);
    for (const [key, timestamp] of this.recent) {
      if (nowMs - timestamp > this.ttlMs) {
        this.recent.delete(key);
      }
    }
    const lastSeen = this.recent.get(fingerprint);
    if (lastSeen && nowMs - lastSeen <= this.ttlMs) {
      return false;
    }
    this.recent.set(fingerprint, nowMs);
    return true;
  }
}
