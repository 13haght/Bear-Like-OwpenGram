/**
 * Bundle-local compatibility for React Native 0.83's abort-controller 3.x.
 * teleproto uses the newer reason/throwIfAborted contract. Keep native event
 * delivery and cancellation, without changing React Native's global prototypes.
 * esbuild injects this binding only into the isolated protocol bundle.
 */
export class AbortController {
  constructor() {
    this.native = new globalThis.AbortController();
    this.signal = this.native.signal;
    this.reason = undefined;
    if (!('reason' in this.signal)) {
      Object.defineProperty(this.signal, 'reason', { get: () => this.reason });
    }
    if (typeof this.signal.throwIfAborted !== 'function') {
      Object.defineProperty(this.signal, 'throwIfAborted', {
        value: () => { if (this.signal.aborted) throw this.signal.reason; },
      });
    }
  }

  abort(reason) {
    if (this.signal.aborted) return;
    this.reason = reason === undefined ? Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }) : reason;
    this.native.abort(this.reason);
  }
}
