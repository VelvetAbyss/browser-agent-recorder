import type { AppMessage, AppResponse } from "./types";

export function sendMessage<T>(message: AppMessage): Promise<AppResponse<T>> {
  return chrome.runtime.sendMessage(message);
}

export function isOk<T>(response: AppResponse<T>): response is { ok: true; data: T } {
  return response?.ok === true;
}
