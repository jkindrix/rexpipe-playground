// TypeScript interfaces mirroring the rexpipe-wasm bridge API.
//
// These types match the Rust structs in crates/rexpipe-wasm/src/lib.rs
// and rexpipe::processor. The bridge uses serde-wasm-bindgen to convert
// between Rust types and JavaScript objects, so the shapes must line up
// exactly (including field names — serde uses snake_case by default,
// which matches Rust conventions).

// ---------------------------------------------------------------------------
// Pipeline config (input side)
// ---------------------------------------------------------------------------

/** A single step in a rexpipe pipeline. */
export interface StepConfig {
  /** Step type: "substitute" | "filter" | "extract" | "transform" | "validate" | "block" */
  type: StepType;
  /** Regex pattern (required for most step types) */
  pattern: string;
  /** Replacement string (for substitute steps) */
  replacement?: string;
  /** Processing mode: "line" (default) | "slurp" | "paragraph" */
  mode?: ProcessingMode;
  /** Filter action (for filter steps) */
  action?: FilterAction;
  /** Transform action (for transform steps) */
  transform_action?: TransformAction;
  /** Regex flags */
  flags?: RegexFlag[];
  /** Output format for extract steps */
  output_format?: ExtractOutputFormat;
  /** Whether this step is enabled */
  enabled?: boolean;
  /** Optional human-readable name */
  name?: string;
}

export type StepType =
  | 'substitute'
  | 'filter'
  | 'extract'
  | 'transform'
  | 'validate'
  | 'block';

export type ProcessingMode = 'line' | 'slurp' | 'paragraph';

export type FilterAction =
  | 'keep_line'
  | 'drop_line'
  | 'keep_match'
  | 'drop_match'
  | 'deduplicate_by_prefix';

export type TransformAction =
  | 'uppercase'
  | 'lowercase'
  | 'title_case'
  | 'trim'
  | 'remove_whitespace'
  | 'normalize_whitespace'
  | 'reverse'
  | 'deduplicate'
  | 'sort_chars'
  | 'char_count'
  | 'word_count'
  | 'base64_encode'
  | 'base64_decode'
  | 'url_encode'
  | 'url_decode';

export type ExtractOutputFormat = 'text' | 'json' | 'jsonl' | 'csv';

export type RegexFlag =
  | 'case_insensitive'
  | 'multiline'
  | 'dot_all'
  | 'global'
  | 'extended'
  | 'pcre'
  | 'ignore_whitespace';

/** A rexpipe pipeline config. Matches PipelineConfig on the Rust side. */
export interface PipelineConfig {
  name?: string;
  description?: string;
  step: StepConfig[];
  settings?: PipelineSettings;
  aliases?: Record<string, string>;
}

export interface PipelineSettings {
  mode?: ProcessingMode;
  pcre_mode?: boolean;
  fixed_strings?: boolean;
  max_slurp_size?: number;
  strict_mode?: boolean;
  timeout_ms?: number;
  strip_ansi?: boolean;
  invert_match?: boolean;
  sample_limit?: number;
  preserve_line_endings?: boolean;
}

// ---------------------------------------------------------------------------
// Processing result (output side)
// ---------------------------------------------------------------------------

/** Input envelope for process_pipeline. */
export interface ProcessRequest {
  input: string;
  config: PipelineConfig;
}

/** Top-level outcome: discriminated union of success and bridge error. */
export type ProcessOutcome = ProcessOkResponse | ProcessErrorResponse;

export interface ProcessOkResponse {
  status: 'ok';
  final_output: string;
  steps: StepIntermediateResult[];
  warnings: string[];
}

export interface ProcessErrorResponse {
  status: 'error';
  kind: string;
  message: string;
  hint?: string | null;
}

/** Per-step intermediate result from StreamProcessor::process_with_intermediates. */
export interface StepIntermediateResult {
  output: string;
  matches: number;
  match_positions: MatchPosition[];
  captures: CaptureGroupResult[];
  lines_in: number;
  lines_out: number;
  error?: StepError | null;
}

export interface MatchPosition {
  start: number;
  end: number;
  text: string;
}

export interface CaptureGroupResult {
  groups: (string | null)[];
  full_match?: MatchPosition | null;
}

export interface StepError {
  kind: string;
  step_index: number;
  field?: string | null;
  message: string;
  hint?: string | null;
}

// ---------------------------------------------------------------------------
// Other API responses
// ---------------------------------------------------------------------------

/** Response from validate_pattern. */
export interface ValidatePatternResponse {
  valid: boolean;
  error: string | null;
  engine: string | null;
}

/** One entry from list_builtins. */
export interface BuiltinPatternEntry {
  name: string;
  pattern: string;
}

/** Response from get_schema — enum values for UI dropdowns. */
export interface SchemaResponse {
  step_types: StepType[];
  processing_modes: ProcessingMode[];
  filter_actions: FilterAction[];
  block_actions: string[];
  transform_actions: TransformAction[];
  extract_output_formats: ExtractOutputFormat[];
}
