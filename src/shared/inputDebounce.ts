export class InputDebouncer<T extends object> {
  private timers = new WeakMap<T, ReturnType<typeof setTimeout>>();

  schedule(target: T, delayMs: number, callback: () => void) {
    const existing = this.timers.get(target);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(callback, delayMs);
    this.timers.set(target, timer);
  }
}
