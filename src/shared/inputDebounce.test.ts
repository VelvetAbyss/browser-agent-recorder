import { describe, expect, it, vi } from "vitest";
import { InputDebouncer } from "./inputDebounce";

describe("InputDebouncer", () => {
  it("debounces repeated events for the same target", () => {
    vi.useFakeTimers();
    const debouncer = new InputDebouncer<object>();
    const target = {};
    const callback = vi.fn();

    debouncer.schedule(target, 450, callback);
    debouncer.schedule(target, 450, callback);
    vi.advanceTimersByTime(449);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
