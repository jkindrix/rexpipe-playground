/* tslint:disable */
/* eslint-disable */

/**
 * Return the schema of valid enum values for UI dropdowns.
 *
 * The playground uses this to populate step-type selectors, mode
 * selectors, filter action dropdowns, transform action dropdowns, and
 * extract output format selectors. Keeping these synchronized with the
 * rexpipe enum definitions is a hand-maintained concern — see the test
 * `test_schema_covers_all_enum_variants` in this crate, which uses
 * exhaustive matches against the rexpipe enums so a new variant causes
 * a compile error until this list is updated.
 */
export function get_schema(): any;

/**
 * List the built-in pattern names and descriptions.
 *
 * Built-in patterns are referenced in configs via the `${builtin:name}`
 * syntax. This function returns them for autocomplete and step-template
 * UIs in the playground.
 */
export function list_builtins(): any;

/**
 * Module initialization: runs once when the WASM module is instantiated.
 */
export function main(): void;

/**
 * Run a pipeline and return per-step intermediate results.
 *
 * Takes a JSON-serialized [`ProcessRequest`] and returns a JSON-serialized
 * [`ProcessOutcome`]. On success, the outcome is `Ok(ProcessResponse)` where
 * the response flattens the [`PipelineIntermediateResult`] from rexpipe.
 * On bridge-level failure (JSON parse error, pipeline construction error)
 * the outcome is `Error(BridgeErrorResponse)`. Per-step failures during
 * processing are surfaced inside the `steps[].error` field, not as an
 * overall error.
 */
export function process_pipeline(request_json: string): any;

/**
 * Validate a regex pattern without running a full pipeline.
 *
 * Takes a pattern string and an optional JSON array of flag names (e.g.,
 * `["case_insensitive", "multiline"]`). Returns a JSON
 * [`ValidatePatternResponse`] indicating whether the pattern compiled and
 * which engine was selected.
 *
 * Used by the playground to give live feedback in the pattern editor as
 * the user types.
 */
export function validate_pattern(pattern: string, flags_json: string): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly get_schema: () => any;
    readonly list_builtins: () => any;
    readonly process_pipeline: (a: number, b: number) => any;
    readonly validate_pattern: (a: number, b: number, c: number, d: number) => any;
    readonly main: () => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
