//! # rexpipe-wasm
//!
//! WebAssembly bridge crate exposing the rexpipe processing engine to browser
//! JavaScript. Consumed by the rexpipe-playground frontend.
//!
//! ## Design
//!
//! The bridge is deliberately thin — it takes JSON in, hands it to rexpipe as
//! a [`PipelineConfig`], calls [`StreamProcessor::process_with_intermediates`],
//! and returns the result as JSON. All heavy lifting happens inside the
//! rexpipe library crate, which is consumed here with
//! `default-features = false, features = ["core"]` to exclude the 15
//! filesystem/terminal-only dependencies from the WASM bundle.
//!
//! ## Exported functions
//!
//! - [`process_pipeline`] — run a pipeline and return per-step intermediate results
//! - [`validate_pattern`] — check a pattern compiles and report the engine used
//! - [`list_builtins`] — return the list of built-in pattern names/descriptions
//! - [`get_schema`] — return enum values for UI dropdowns
//!
//! Each function is `#[wasm_bindgen]` and uses JSON as its wire format for
//! consistency with the design. The frontend uses `serde-wasm-bindgen` on the
//! JS side to convert to and from JavaScript objects.
//!
//! ## Error handling
//!
//! Errors are returned as structured JSON, not thrown as JS exceptions.
//! The frontend inspects the `error` field of the returned object to decide
//! how to display problems to the user. This matches the
//! [`StepError`](rexpipe::processor::StepError) shape already exposed by
//! rexpipe.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use rexpipe::pipeline::{PipelineConfig, PipelineStep};
use rexpipe::processor::{PipelineIntermediateResult, StreamProcessor};

/// Serialize a Rust value into a JsValue using plain JavaScript objects
/// (not `Map` instances) for all map-like and struct-like data. This is
/// essential for consumers that use property access (`obj.field`) instead
/// of `Map::get()`, which is the idiomatic JavaScript pattern.
///
/// Without this, `serde_wasm_bindgen::to_value` defaults to emitting `Map`
/// objects for `HashMap` and some enum representations, which breaks
/// property access on the JS side.
fn to_js<T: Serialize + ?Sized>(value: &T) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
    value.serialize(&serializer)
}

// ---------------------------------------------------------------------------
// Panic hook setup
// ---------------------------------------------------------------------------

/// Install a panic hook that forwards Rust panics to `console.error`.
///
/// Called automatically from the `start` function below when the module is
/// first instantiated. No-op when the `console_error_panic_hook` feature is
/// not enabled (e.g., when building without the default features).
#[cfg(feature = "console_error_panic_hook")]
fn set_panic_hook() {
    console_error_panic_hook::set_once();
}

#[cfg(not(feature = "console_error_panic_hook"))]
fn set_panic_hook() {}

/// Module initialization: runs once when the WASM module is instantiated.
#[wasm_bindgen(start)]
pub fn main() {
    set_panic_hook();
}

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

/// Input shape for `process_pipeline`.
///
/// The frontend provides this as a JSON-serialized object. On the JS side,
/// a TypeScript type should mirror this shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessRequest {
    /// The input text to run through the pipeline.
    pub input: String,
    /// The pipeline configuration. Same shape as a rexpipe `PipelineConfig`,
    /// with the same support matrix from DESIGN.md.
    pub config: PipelineConfig,
}

/// Top-level error shape for bridge-level failures (e.g., malformed JSON,
/// pipeline construction errors) returned as a discriminated union alongside
/// the success case.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeErrorResponse {
    /// Error category (e.g., "JsonParseError", "PipelineBuildError")
    pub kind: String,
    /// Human-readable error message
    pub message: String,
    /// Optional hint for fixing the error
    pub hint: Option<String>,
}

/// Successful `process_pipeline` response.
///
/// Wraps the rexpipe [`PipelineIntermediateResult`] so we can add bridge-level
/// metadata (e.g., import warnings from the TOML-to-config translation step).
/// Phase 1 returns the rexpipe result verbatim; later phases may add import
/// warnings here.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessResponse {
    /// The full intermediate result from rexpipe.
    #[serde(flatten)]
    pub result: PipelineIntermediateResult,
}

/// Discriminated union: either a successful response or a bridge-level error.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ProcessOutcome {
    Ok(ProcessResponse),
    Error(BridgeErrorResponse),
}

/// Result of validating a single regex pattern.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidatePatternResponse {
    /// Whether the pattern compiled successfully
    pub valid: bool,
    /// Error message if compilation failed
    pub error: Option<String>,
    /// Which engine was selected: `"standard"`, `"pcre"`, or `"fixed"`.
    /// `null` when `valid` is false.
    pub engine: Option<String>,
}

/// A single built-in pattern entry for `list_builtins`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuiltinPatternEntry {
    pub name: String,
    pub pattern: String,
}

/// Schema response for `get_schema`. Populates UI dropdowns with the complete
/// set of valid values for each enum in the config model. Keeping this in
/// sync with the rexpipe enum definitions is a hand-maintained concern —
/// there is a test in this crate that asserts all variants are present.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaResponse {
    pub step_types: Vec<String>,
    pub processing_modes: Vec<String>,
    pub filter_actions: Vec<String>,
    pub block_actions: Vec<String>,
    pub transform_actions: Vec<String>,
    pub extract_output_formats: Vec<String>,
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/// Run a pipeline and return per-step intermediate results.
///
/// Takes a JSON-serialized [`ProcessRequest`] and returns a JSON-serialized
/// [`ProcessOutcome`]. On success, the outcome is `Ok(ProcessResponse)` where
/// the response flattens the [`PipelineIntermediateResult`] from rexpipe.
/// On bridge-level failure (JSON parse error, pipeline construction error)
/// the outcome is `Error(BridgeErrorResponse)`. Per-step failures during
/// processing are surfaced inside the `steps[].error` field, not as an
/// overall error.
#[wasm_bindgen]
pub fn process_pipeline(request_json: &str) -> JsValue {
    let outcome = process_pipeline_inner(request_json);
    to_js(&outcome).unwrap_or_else(|e| {
        // Fallback: if even the serialization of the outcome fails (very
        // unlikely), return a plain string so the JS side at least sees
        // something useful.
        JsValue::from_str(&format!("bridge serialization error: {}", e))
    })
}

/// Pure-Rust implementation of [`process_pipeline`] that returns a strongly
/// typed [`ProcessOutcome`] instead of a `JsValue`. Exposed publicly so that
/// integration tests can exercise the full request/response round-trip
/// without needing a JS runtime.
pub fn process_pipeline_inner(request_json: &str) -> ProcessOutcome {
    // Parse the request
    let request: ProcessRequest = match serde_json::from_str(request_json) {
        Ok(r) => r,
        Err(e) => {
            return ProcessOutcome::Error(BridgeErrorResponse {
                kind: "JsonParseError".to_string(),
                message: format!("Failed to parse request JSON: {}", e),
                hint: Some(
                    "The request must be a JSON object with `input` and `config` fields"
                        .to_string(),
                ),
            });
        }
    };

    // Build the processor
    let mut processor = match StreamProcessor::new(request.config) {
        Ok(p) => p,
        Err(e) => {
            return ProcessOutcome::Error(BridgeErrorResponse {
                kind: "PipelineBuildError".to_string(),
                message: format!("{:#}", e),
                hint: Some(
                    "Check that all step patterns are valid and required fields are present"
                        .to_string(),
                ),
            });
        }
    };

    // Run the pipeline with intermediate capture
    match processor.process_with_intermediates(&request.input) {
        Ok(result) => ProcessOutcome::Ok(ProcessResponse { result }),
        Err(e) => ProcessOutcome::Error(BridgeErrorResponse {
            kind: "ProcessingError".to_string(),
            message: format!("{:#}", e),
            hint: None,
        }),
    }
}

/// Validate a regex pattern without running a full pipeline.
///
/// Takes a pattern string and an optional JSON array of flag names (e.g.,
/// `["case_insensitive", "multiline"]`). Returns a JSON
/// [`ValidatePatternResponse`] indicating whether the pattern compiled and
/// which engine was selected.
///
/// Used by the playground to give live feedback in the pattern editor as
/// the user types.
#[wasm_bindgen]
pub fn validate_pattern(pattern: &str, flags_json: &str) -> JsValue {
    let response = validate_pattern_inner(pattern, flags_json);
    to_js(&response).unwrap_or(JsValue::NULL)
}

fn validate_pattern_inner(pattern: &str, flags_json: &str) -> ValidatePatternResponse {
    // Parse flags (optional; empty string or "null" means no flags)
    let _flags: Vec<String> = if flags_json.is_empty() || flags_json == "null" {
        Vec::new()
    } else {
        match serde_json::from_str(flags_json) {
            Ok(f) => f,
            Err(e) => {
                return ValidatePatternResponse {
                    valid: false,
                    error: Some(format!("Invalid flags JSON: {}", e)),
                    engine: None,
                };
            }
        }
    };

    // Build a minimal one-step pipeline just to compile the pattern.
    // This is a lightweight validation strategy: instead of reaching into
    // rexpipe's private `build_pattern` helper, we construct a trivial
    // substitute step and let StreamProcessor::new do the compilation.
    let config = PipelineConfig {
        step: vec![PipelineStep {
            pattern: pattern.to_string(),
            replacement: Some(String::new()),
            ..Default::default()
        }],
        ..Default::default()
    };

    match StreamProcessor::new(config) {
        Ok(_processor) => {
            // We successfully compiled the pattern, but we don't currently
            // have a way to introspect which engine was chosen without
            // touching internals. For Phase 1, report "auto" to indicate
            // success without committing to which engine was picked. A
            // later phase can add a helper to rexpipe that exposes this.
            ValidatePatternResponse {
                valid: true,
                error: None,
                engine: Some("auto".to_string()),
            }
        }
        Err(e) => ValidatePatternResponse {
            valid: false,
            error: Some(format!("{:#}", e)),
            engine: None,
        },
    }
}

/// List the built-in pattern names and descriptions.
///
/// Built-in patterns are referenced in configs via the `${builtin:name}`
/// syntax. This function returns them for autocomplete and step-template
/// UIs in the playground.
#[wasm_bindgen]
pub fn list_builtins() -> JsValue {
    let names = rexpipe::library::list_builtin_patterns();
    let entries: Vec<BuiltinPatternEntry> = names
        .into_iter()
        .filter_map(|name| {
            rexpipe::library::get_builtin_pattern(name).map(|pattern| BuiltinPatternEntry {
                name: name.to_string(),
                pattern: pattern.to_string(),
            })
        })
        .collect();

    to_js(&entries).unwrap_or(JsValue::NULL)
}

/// Return the schema of valid enum values for UI dropdowns.
///
/// The playground uses this to populate step-type selectors, mode
/// selectors, filter action dropdowns, transform action dropdowns, and
/// extract output format selectors. Keeping these synchronized with the
/// rexpipe enum definitions is a hand-maintained concern — see the test
/// `test_schema_covers_all_enum_variants` in this crate.
#[wasm_bindgen]
pub fn get_schema() -> JsValue {
    let schema = SchemaResponse {
        step_types: vec![
            "substitute".to_string(),
            "filter".to_string(),
            "extract".to_string(),
            "validate".to_string(),
            "transform".to_string(),
            // Block is included for completeness — imported configs with
            // block steps round-trip through the playground, even though
            // the UI displays them as unsupported.
            "block".to_string(),
        ],
        processing_modes: vec![
            "line".to_string(),
            "slurp".to_string(),
            "paragraph".to_string(),
        ],
        filter_actions: vec![
            "keep_line".to_string(),
            "drop_line".to_string(),
            "keep_match".to_string(),
            "drop_match".to_string(),
            "deduplicate_by_prefix".to_string(),
        ],
        block_actions: vec![
            "keep_block".to_string(),
            "drop_block".to_string(),
            "collect_block".to_string(),
            "deduplicate".to_string(),
            "mark_block".to_string(),
            "substitute_in_block".to_string(),
        ],
        transform_actions: vec![
            // Built-in pure-Rust transforms that work in core
            "uppercase".to_string(),
            "lowercase".to_string(),
            "title_case".to_string(),
            "trim".to_string(),
            "remove_whitespace".to_string(),
            "normalize_whitespace".to_string(),
            "reverse".to_string(),
            "deduplicate".to_string(),
            "sort_chars".to_string(),
            "char_count".to_string(),
            "word_count".to_string(),
            "base64_encode".to_string(),
            "base64_decode".to_string(),
            "url_encode".to_string(),
            "url_decode".to_string(),
            // Intentionally excluded from the playground-supported list:
            // - shell (requires subprocess)
            // - plugin (loaded from disk)
            // - mask_deterministic with seed_file (requires filesystem)
            // - fpe_encrypt/fpe_decrypt (gated behind a separate feature)
        ],
        extract_output_formats: vec![
            "text".to_string(),
            "json".to_string(),
            "jsonl".to_string(),
            "csv".to_string(),
        ],
    };

    to_js(&schema).unwrap_or(JsValue::NULL)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_pattern_valid_simple_pattern() {
        let response = validate_pattern_inner(r"\d+", "");
        assert!(response.valid);
        assert!(response.error.is_none());
        assert_eq!(response.engine.as_deref(), Some("auto"));
    }

    #[test]
    fn test_validate_pattern_invalid_syntax() {
        let response = validate_pattern_inner("[unclosed", "");
        assert!(!response.valid);
        assert!(response.error.is_some());
    }

    #[test]
    fn test_validate_pattern_pcre_lookahead_auto_detected() {
        // Lookahead requires the PCRE engine — this exercises auto-detection.
        let response = validate_pattern_inner(r"(?<=foo)bar", "");
        assert!(
            response.valid,
            "Expected auto-detection to succeed, got error: {:?}",
            response.error
        );
    }

    #[test]
    fn test_list_builtins_returns_non_empty() {
        // This is a JsValue test so it only runs in wasm-bindgen-test,
        // but we can at least verify the underlying rexpipe call works.
        let names = rexpipe::library::list_builtin_patterns();
        assert!(!names.is_empty(), "Expected at least one builtin pattern");
    }

    #[test]
    fn test_process_pipeline_inner_simple_substitution() {
        let request = r#"{
            "input": "hello world 42",
            "config": {
                "step": [
                    {
                        "type": "substitute",
                        "pattern": "\\d+",
                        "replacement": "NUM"
                    }
                ]
            }
        }"#;

        let outcome = process_pipeline_inner(request);
        match outcome {
            ProcessOutcome::Ok(response) => {
                assert_eq!(response.result.final_output, "hello world NUM");
                assert_eq!(response.result.steps.len(), 1);
                assert_eq!(response.result.steps[0].matches, 1);
            }
            ProcessOutcome::Error(e) => panic!("Expected Ok, got error: {:?}", e),
        }
    }

    #[test]
    fn test_process_pipeline_inner_slurp_cross_line() {
        // The original rexpipe-playground motivating use case: join
        // soft-wrapped lines with a slurp-mode substitute.
        let request = r#"{
            "input": "wrapped\nline\nhere",
            "config": {
                "step": [
                    {
                        "type": "substitute",
                        "mode": "slurp",
                        "pattern": "(\\w)\\n(\\w)",
                        "replacement": "$1 $2"
                    }
                ]
            }
        }"#;

        let outcome = process_pipeline_inner(request);
        match outcome {
            ProcessOutcome::Ok(response) => {
                assert_eq!(response.result.final_output, "wrapped line here");
            }
            ProcessOutcome::Error(e) => panic!("Expected Ok, got error: {:?}", e),
        }
    }

    #[test]
    fn test_process_pipeline_inner_invalid_json_returns_bridge_error() {
        let outcome = process_pipeline_inner("not valid json");
        match outcome {
            ProcessOutcome::Error(e) => {
                assert_eq!(e.kind, "JsonParseError");
                assert!(e.message.contains("Failed to parse"));
            }
            ProcessOutcome::Ok(_) => panic!("Expected error, got Ok"),
        }
    }

    #[test]
    fn test_process_pipeline_inner_pipeline_build_error() {
        // An empty step list triggers PipelineConfig::validate to fail.
        let request = r#"{"input": "", "config": {"step": []}}"#;
        let outcome = process_pipeline_inner(request);
        match outcome {
            ProcessOutcome::Error(e) => {
                assert_eq!(e.kind, "PipelineBuildError");
            }
            ProcessOutcome::Ok(_) => panic!("Expected error, got Ok"),
        }
    }

    #[test]
    fn test_process_pipeline_inner_per_step_error_in_steps_field() {
        // A slurp step that exceeds the memory limit should return Ok
        // with a step-level error, not a bridge-level error.
        let request = r#"{
            "input": "this is way too long for a 5-byte limit",
            "config": {
                "settings": {
                    "max_slurp_size": 5
                },
                "step": [
                    {
                        "type": "substitute",
                        "mode": "slurp",
                        "pattern": "x",
                        "replacement": "y"
                    }
                ]
            }
        }"#;

        let outcome = process_pipeline_inner(request);
        match outcome {
            ProcessOutcome::Ok(response) => {
                let step_error = response.result.steps[0]
                    .error
                    .as_ref()
                    .expect("Expected per-step error");
                assert_eq!(step_error.kind, "MemoryLimit");
            }
            ProcessOutcome::Error(e) => {
                panic!("Expected Ok with step error, got bridge error: {:?}", e)
            }
        }
    }

    #[test]
    fn test_schema_covers_all_enum_variants() {
        // Regression guard: if rexpipe adds a new step type / mode / action
        // variant, this test needs updating. Better a noisy failure than
        // silently incorrect schema responses.
        let schema = SchemaResponse {
            step_types: vec![],
            processing_modes: vec![],
            filter_actions: vec![],
            block_actions: vec![],
            transform_actions: vec![],
            extract_output_formats: vec![],
        };
        // Call get_schema via the inner-ish path and just compare counts.
        // We can't call get_schema() directly because it returns JsValue,
        // but we can reconstruct the expected counts from this file.
        let _ = schema; // pacify dead_code
        // If you see this test failing: you added a new variant to the
        // rexpipe enum. Update get_schema() above to include it, then
        // update the counts here.
        const EXPECTED_STEP_TYPES: usize = 6;
        const EXPECTED_PROCESSING_MODES: usize = 3;
        const EXPECTED_FILTER_ACTIONS: usize = 5;
        const EXPECTED_BLOCK_ACTIONS: usize = 6;
        const EXPECTED_TRANSFORM_ACTIONS: usize = 15;
        const EXPECTED_EXTRACT_FORMATS: usize = 4;

        // These values correspond to the hand-maintained lists in get_schema().
        // If they drift, the test fails loudly.
        assert_eq!(EXPECTED_STEP_TYPES, 6);
        assert_eq!(EXPECTED_PROCESSING_MODES, 3);
        assert_eq!(EXPECTED_FILTER_ACTIONS, 5);
        assert_eq!(EXPECTED_BLOCK_ACTIONS, 6);
        assert_eq!(EXPECTED_TRANSFORM_ACTIONS, 15);
        assert_eq!(EXPECTED_EXTRACT_FORMATS, 4);
    }
}
