//! Golden-file test: verifies that the WASM bridge produces byte-identical
//! output to the rexpipe CLI for the motivating "unwrap soft-wrapped lines"
//! use case.
//!
//! This test is the Phase 1 acceptance gate: if the bridge code compiles but
//! produces different output than the CLI for the same pipeline, something is
//! wrong at a level no unit test would catch.
//!
//! Run with:
//!
//!     cargo test --test golden
//!
//! The test compiles and runs natively (not in a browser) because it exercises
//! the rlib side of the bridge crate. The actual WASM module is verified
//! manually by loading the smoke-test HTML page.

use rexpipe_wasm::{ProcessOutcome, process_pipeline_inner};

const INPUT: &str = "  My understanding of \"done\":
  A web interface where a user makes selections across audit dimensions, and the system generates a tailored LLM prompt that effectively conducts that specific audit against a codebase.

  The riskiest assumption isn't the UI or the data model — it's whether dimension selections can actually produce good prompts. If the mapping from selections → prompt is weak, everything built on top of
   it is wasted. So I'd de-risk that first.

  Proposed sequence:

  1. Validate the dimension model — Review audit_dimensions.yaml for gaps, overlaps, and structural issues. Get it solid enough to build on (not perfect — we'll learn more as we go).
  2. Prove prompt generation works — Manually author 3-4 prompt templates from different archetypes. Test them against a real codebase. Do the generated prompts actually produce useful audit results?
  This is the make-or-break validation.
  3. Define constraint relationships — Which dimension combinations are invalid, which imply others, which are synergistic. This becomes the \"intelligence\" layer.
  4. Build the prompt template engine — A system that assembles prompt fragments based on selections. This is the core logic.
  5. Build the web UI last — The UI is just a projection of the data model. Once steps 1-4 are solid, the UI is straightforward.

  Is reverse-engineering the right approach? Partly. It's good for identifying the sequence above. But I'd combine it with a thin vertical slice early — after step 2, build a minimal end-to-end prototype
   (even if it's a CLI or a single HTML page) so we see the full pipeline working before investing heavily in any one layer.
";

/// The expected output, produced by running the rexpipe CLI with
/// `cargo run -- -c examples/unwrap.toml --text < examples/unwrap-input.txt`
/// in the sibling rexpipe repo on the wasm-prep branch.
const EXPECTED_OUTPUT: &str = "My understanding of \"done\":
A web interface where a user makes selections across audit dimensions, and the system generates a tailored LLM prompt that effectively conducts that specific audit against a codebase.

The riskiest assumption isn't the UI or the data model — it's whether dimension selections can actually produce good prompts. If the mapping from selections → prompt is weak, everything built on top of it is wasted. So I'd de-risk that first.

Proposed sequence:

1. Validate the dimension model — Review audit_dimensions.yaml for gaps, overlaps, and structural issues. Get it solid enough to build on (not perfect — we'll learn more as we go).
2. Prove prompt generation works — Manually author 3-4 prompt templates from different archetypes. Test them against a real codebase. Do the generated prompts actually produce useful audit results?
This is the make-or-break validation.
3. Define constraint relationships — Which dimension combinations are invalid, which imply others, which are synergistic. This becomes the \"intelligence\" layer.
4. Build the prompt template engine — A system that assembles prompt fragments based on selections. This is the core logic.
5. Build the web UI last — The UI is just a projection of the data model. Once steps 1-4 are solid, the UI is straightforward.

Is reverse-engineering the right approach? Partly. It's good for identifying the sequence above. But I'd combine it with a thin vertical slice early — after step 2, build a minimal end-to-end prototype (even if it's a CLI or a single HTML page) so we see the full pipeline working before investing heavily in any one layer.
";

/// The pipeline JSON that exercises both line mode and slurp mode.
/// Equivalent to examples/unwrap.toml in the rexpipe repo.
const PIPELINE_JSON: &str = r#"{
    "input": "placeholder",
    "config": {
        "step": [
            {
                "type": "substitute",
                "pattern": "^  ",
                "replacement": ""
            },
            {
                "type": "substitute",
                "mode": "slurp",
                "pattern": "([^\\r\\n\\t\\f\\v:┐┘│|]|,) ?\\n *+([^{}A-Z\\-\\n\\d└│|`#])",
                "replacement": "$1 $2"
            }
        ]
    }
}"#;

#[test]
fn test_golden_unwrap_pipeline_matches_cli_output() {
    // Build the request by substituting the placeholder input
    let request = PIPELINE_JSON.replace(
        "\"placeholder\"",
        &serde_json::to_string(INPUT).expect("should serialize input"),
    );

    let outcome = process_pipeline_inner(&request);
    let response = match outcome {
        ProcessOutcome::Ok(r) => r,
        ProcessOutcome::Error(e) => {
            panic!("Expected Ok, got bridge error: {:?}", e);
        }
    };

    // Check each step has no error
    for (i, step) in response.result.steps.iter().enumerate() {
        assert!(
            step.error.is_none(),
            "Step {} has error: {:?}",
            i,
            step.error
        );
    }

    assert_eq!(response.result.steps.len(), 2, "Expected 2 steps");

    // The core assertion: the final output matches the CLI golden output byte-for-byte
    assert_eq!(
        response.result.final_output, EXPECTED_OUTPUT,
        "WASM bridge output does not match CLI golden output"
    );
}

#[test]
fn test_golden_step1_strips_indent_correctly() {
    let request = PIPELINE_JSON.replace(
        "\"placeholder\"",
        &serde_json::to_string(INPUT).expect("should serialize input"),
    );

    let outcome = process_pipeline_inner(&request);
    let response = match outcome {
        ProcessOutcome::Ok(r) => r,
        ProcessOutcome::Error(e) => panic!("{:?}", e),
    };

    // Step 1 output should have all leading 2-space indents stripped
    let step1_output = &response.result.steps[0].output;
    assert!(
        !step1_output.contains("\n  "),
        "Step 1 should have stripped all 2-space indents, but found one"
    );
    // And the first line should no longer start with two spaces
    assert!(
        !step1_output.starts_with("  "),
        "Step 1 first line still starts with 2-space indent"
    );
    // And step 1 should have matched many times (once per indented line)
    assert!(
        response.result.steps[0].matches > 0,
        "Step 1 should report >0 matches"
    );
}

#[test]
fn test_golden_step2_rejoins_soft_wrapped_lines() {
    let request = PIPELINE_JSON.replace(
        "\"placeholder\"",
        &serde_json::to_string(INPUT).expect("should serialize input"),
    );

    let outcome = process_pipeline_inner(&request);
    let response = match outcome {
        ProcessOutcome::Ok(r) => r,
        ProcessOutcome::Error(e) => panic!("{:?}", e),
    };

    let step2_output = &response.result.steps[1].output;

    // The critical rejoin: "built on top of\n it is wasted" should become
    // "built on top of it is wasted" (one space, no newline)
    assert!(
        step2_output.contains("built on top of it is wasted"),
        "Step 2 should have rejoined 'built on top of / it is wasted'"
    );
    assert!(
        !step2_output.contains("built on top of\n it is wasted"),
        "Step 2 should NOT still contain the wrapped version"
    );

    // And the second rejoin: "minimal end-to-end prototype\n (even if..." should
    // become "minimal end-to-end prototype (even if..."
    assert!(
        step2_output.contains("minimal end-to-end prototype (even if"),
        "Step 2 should have rejoined 'minimal end-to-end prototype / (even if'"
    );

    // Slurp mode should have matched at least twice
    assert!(
        response.result.steps[1].matches >= 2,
        "Step 2 should report >=2 matches, got {}",
        response.result.steps[1].matches
    );
}

#[test]
fn test_golden_warnings_are_empty_for_this_pipeline() {
    // This pipeline doesn't use any deferred features, so warnings should be empty.
    let request = PIPELINE_JSON.replace(
        "\"placeholder\"",
        &serde_json::to_string(INPUT).expect("should serialize input"),
    );

    let outcome = process_pipeline_inner(&request);
    let response = match outcome {
        ProcessOutcome::Ok(r) => r,
        ProcessOutcome::Error(e) => panic!("{:?}", e),
    };

    assert!(
        response.result.warnings.is_empty(),
        "Expected no warnings, got: {:?}",
        response.result.warnings
    );
}
