// Main-thread WASM bridge for rexpipe-playground.
//
// Wraps the Web Worker in a typed API. Handles three patterns:
//
// 1. Fire-and-forget with debouncing: processPipeline() is called on every
//    keystroke and only the latest result matters. A 100ms debounce prevents
//    runaway worker traffic.
//
// 2. One-shot promise: validatePattern(), getSchema(), listBuiltins() return
//    promises that resolve when the worker sends back a response with the
//    matching request ID.
//
// 3. Lifecycle event: onReady fires once when the worker signals that the
//    WASM module has finished loading.

import type {
  ProcessRequest,
  ProcessOutcome,
  ValidatePatternResponse,
  BuiltinPatternEntry,
  SchemaResponse,
  PipelineConfig,
} from './types';

// Messages from worker → main thread. Must match wasm-worker.ts exactly.
type WorkerResponse =
  | { type: 'ready' }
  | { type: 'load-error'; message: string }
  | { type: 'process-result'; id: number; payload: ProcessOutcome }
  | { type: 'validate-result'; id: number; payload: ValidatePatternResponse }
  | { type: 'schema-result'; id: number; payload: SchemaResponse }
  | { type: 'builtins-result'; id: number; payload: BuiltinPatternEntry[] };

export class WasmBridge {
  private worker: Worker;
  private nextId = 0;

  // One-shot requests waiting for their response
  private pending = new Map<number, (payload: unknown) => void>();

  // Debounce timer for processPipeline
  private debounceTimer: number | null = null;

  // Lifecycle and result callbacks
  onReady: (() => void) | null = null;
  onLoadError: ((message: string) => void) | null = null;
  onResult: ((result: ProcessOutcome) => void) | null = null;
  onProcessingStart: (() => void) | null = null;

  constructor() {
    // Vite's worker import syntax: creates a separate ES module bundle
    // for the worker at build time.
    this.worker = new Worker(new URL('./wasm-worker.ts', import.meta.url), {
      type: 'module',
      name: 'rexpipe-wasm-worker',
    });

    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) =>
      this.handleMessage(event.data);

    this.worker.onerror = (event: ErrorEvent) => {
      console.error('[WasmBridge] Worker error:', event.message, event);
      this.onLoadError?.(event.message || 'Unknown worker error');
    };
  }

  private handleMessage(message: WorkerResponse): void {
    switch (message.type) {
      case 'ready':
        this.onReady?.();
        return;
      case 'load-error':
        this.onLoadError?.(message.message);
        return;
      case 'process-result':
        this.onResult?.(message.payload);
        return;
      case 'validate-result':
      case 'schema-result':
      case 'builtins-result': {
        const resolve = this.pending.get(message.id);
        if (resolve) {
          this.pending.delete(message.id);
          resolve(message.payload);
        }
        return;
      }
    }
  }

  /**
   * Run a pipeline, debounced. Only the latest call in a 100ms window
   * actually dispatches to the worker. Result delivered via onResult.
   */
  processPipeline(input: string, config: PipelineConfig, debounceMs = 100): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      const request: ProcessRequest = { input, config };
      this.onProcessingStart?.();
      this.worker.postMessage({
        type: 'process',
        id: this.nextId++,
        payload: request,
      });
    }, debounceMs);
  }

  /**
   * Flush the debounce timer and dispatch immediately. Useful for tests
   * and for cases where you need the result synchronously with a user action.
   */
  flushPendingProcess(input: string, config: PipelineConfig): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    const request: ProcessRequest = { input, config };
    this.onProcessingStart?.();
    this.worker.postMessage({
      type: 'process',
      id: this.nextId++,
      payload: request,
    });
  }

  /** Validate a regex pattern. */
  validatePattern(pattern: string, flags: string[] = []): Promise<ValidatePatternResponse> {
    return this.sendOneShot<ValidatePatternResponse>({
      type: 'validate',
      payload: { pattern, flags_json: JSON.stringify(flags) },
    });
  }

  /** Get the enum schema for UI dropdowns. */
  getSchema(): Promise<SchemaResponse> {
    return this.sendOneShot<SchemaResponse>({ type: 'schema' });
  }

  /** List the built-in regex patterns. */
  listBuiltins(): Promise<BuiltinPatternEntry[]> {
    return this.sendOneShot<BuiltinPatternEntry[]>({ type: 'builtins' });
  }

  private sendOneShot<T>(message: { type: string; payload?: unknown }): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve) => {
      this.pending.set(id, resolve as (payload: unknown) => void);
      this.worker.postMessage({ ...message, id });
    });
  }

  /** Terminate the worker. For teardown or tests. */
  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}

// Singleton instance used throughout the app. Import this to talk to WASM.
export const bridge = new WasmBridge();
