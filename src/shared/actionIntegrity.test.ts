import { describe, expect, it } from "vitest";
import { RecentActionDeduper, actionFingerprint } from "./actionIntegrity";
import type { ActionPayload } from "./types";

const action: ActionPayload = {
  clientEventId: "evt_1",
  clientSequence: 1,
  type: "click",
  page: { url: "https://example.com", domain: "example.com", title: "Example" },
  target: {
    tagName: "button",
    text: "Start",
    selector: "button",
    xpath: "/html/body/button[1]",
    selectorConfidence: 0.7,
    candidates: [{ kind: "text", value: "Start", confidence: 0.7 }]
  },
  valuePolicy: "none",
  sensitive: false
};

describe("action integrity", () => {
  it("creates stable fingerprints for equivalent actions", () => {
    expect(actionFingerprint(action)).toBe(actionFingerprint({ ...action, clientEventId: "evt_2" }));
  });

  it("rejects duplicate actions inside the TTL", () => {
    const deduper = new RecentActionDeduper(900);
    expect(deduper.shouldAccept(action, 1000)).toBe(true);
    expect(deduper.shouldAccept({ ...action, clientEventId: "evt_2" }, 1200)).toBe(false);
    expect(deduper.shouldAccept({ ...action, clientEventId: "evt_3" }, 2000)).toBe(true);
  });
});
