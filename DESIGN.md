# rexpipe-playground

A browser-based interactive playground for building, testing, and sharing rexpipe pipelines. Think regex101.com, but for multi-step regex transformation pipelines.

## Problem

regex101.com is excellent for single regex patterns but cannot chain transformations. Real-world text processing often requires multiple sequential substitutions, filters, and extractions. Users currently have to:

1. Apply a pattern in regex101, copy the output
2. Paste it back as new input, apply the next pattern
3. Repeat until the full transformation is complete
4. Manually reconstruct the pipeline as a TOML config or shell pipeline

This is tedious, error-prone, and makes it nearly impossible to iterate on multi-step workflows.

## Solution

A client-side web application that runs rexpipe (compiled to WebAssembly) directly in the browser. No server, no uploads, no latency. Users build pipelines visually, see live results at every stage, and export working TOML configs.

## Core Experience

### The Three-Pane Layout

```
+---------------------------+---------------------------+
|                           |                           |
|       INPUT PANE          |      OUTPUT PANE          |
|                           |                           |
|  (editable text area)     |  (final transformed       |
|                           |   result, read-only)      |
|                           |                           |
+---------------------------+---------------------------+
|                                                       |
|                   PIPELINE EDITOR                     |
|                                                       |
|  +-----------------------------------------------+   |
|  | Step 1: substitute  [mode: line]         [x]  |   |
|  | pattern: ^  (2 matches)                       |   |
|  | replace:                                      |   |
|  +-----------------------------------------------+   |
|  | Step 2: substitute  [mode: slurp]        [x]  |   |
|  | pattern: (\w)\n(\w) (4 matches)               |   |
|  | replace: $1 $2                                |   |
|  +-----------------------------------------------+   |
|  | [+ Add Step]                                  |   |
|  +-----------------------------------------------+   |
|                                                       |
+-------------------------------------------------------+
```

### The Killer Feature: Intermediate State Visibility

Clicking on any step shows its **input** (the output of the previous step) and **output** side by side. This is what regex101 cannot do — you see the data flowing through the pipeline at every stage, not just the final result.

```
Step 2 selected:
+---------------------------+---------------------------+
|   STEP 2 INPUT            |   STEP 2 OUTPUT           |
|   (output of step 1)      |   (after this step runs)  |
|                           |                           |
|  My understanding...      |  My understanding...      |
|  built on top of          |  built on top of it is    |
|   it is wasted.           |  wasted.                  |
|                           |                           |
+---------------------------+---------------------------+
```

### Live Updates

Pipeline processing runs in a **Web Worker** to keep the UI thread responsive. Input changes are **debounced** (100ms idle threshold) before triggering reprocessing. A subtle processing indicator appears when computation takes >100ms.

Match counts per step update after each processing pass. Errors (invalid regex, missing replacement) appear inline next to the offending step.

## Feature Set

### Pipeline Building

- **Step types:** Substitute, Filter, Extract, Transform, Validate (Block supported for import but not editable in the playground UI)
- **Processing modes:** Line, Slurp, Paragraph — selectable per step via dropdown
- **Drag-and-drop reordering** of steps
- **Enable/disable steps** without deleting them (toggle checkbox)
- **Step templates:** Common operations as one-click starting points (trim whitespace, remove blank lines, extract emails, join continuation lines, etc.)
- **Regex flags:** Per-step toggles for global, case-insensitive, multiline, dot_all, PCRE
- **Inline aliases:** `[aliases]` section is supported and resolved at processing time

**Supported but not editable:** Block steps (complex multi-line state machine UI would be substantial work). A TOML import containing Block steps displays them as disabled/grayed with an "unsupported in playground — edit in CLI" indicator. Processing still runs them correctly.

**Explicitly unsupported (show clear error on import):**
- `extends` (references a parent config file — not available in the browser)
- `patterns_include` (references library files on disk)
- `finalize.shell` (shell command execution)
- `TransformAction::Shell` (shell command execution)
- `MaskDeterministic` with `seed_file` populated (filesystem read). **Inline `seed` variant is supported** — deterministic hashing is pure computation.
- `FpeEncrypt`/`FpeDecrypt` — both variants. These are gated behind rexpipe's separate `fpe` feature which is never enabled for the playground build, so they're not present in the bridge at all.
- `Plugin { name }` transforms — the plugin registry is populated from `~/.config/rexpipe/plugins/` at runtime; playground has no access to it
- Cross-file rules, bidirectional mappings, checkpoints, tree-sitter scoping, remote pattern fetching

On import, the playground scans the config for these and shows warnings/errors next to affected fields before processing begins.

### Pattern Editing

- **Syntax highlighting** in pattern and replacement fields via CodeMirror 6 (~150KB base)
- **Match highlighting** in the input/output panes (colored overlays showing what each pattern matches)
- **Capture group visualization:** Hover over `$1`, `$2` in the replacement to see what they reference; hover over matches in the input pane to see capture groups inline
- **Error messages** inline when a pattern fails to compile, with the same helpful hints rexpipe provides on the CLI
- **Auto-detection indicator:** Shows whether the standard or PCRE engine was selected for each pattern

### Import / Export

- **Export as TOML:** Generate a valid rexpipe pipeline config file, downloadable or copyable
- **Import from TOML:** Paste or upload an existing `.toml` config. Shorthand sections (`[[filter]]`, `[[substitute]]`, `[[extract]]`, `[[validate]]`, `[[transform]]`, `[[block]]`) are merged into the step list using rexpipe's own merging logic — the playground delegates to `rexpipe::pipeline::PipelineConfig::merge_shorthand()` (or equivalent) via the bridge API rather than re-implementing the merge order in TypeScript. This guarantees byte-identical import behavior between the browser and CLI. Unsupported fields show warnings.
- **Export as CLI command:** Generate the equivalent `rexpipe -p '...' -r '...' | rexpipe ...` shell command
- **Share via URL:** Pipeline state (input text + steps) is compressed (deflate via pako) and base64url-encoded into a URL hash fragment. Modern browsers handle ~32KB+ fragments reliably; target 16KB encoded as the practical ceiling. When exceeded, the UI shows a **Copy as JSON** fallback button — the primary path for non-trivial pipelines anyway.

### Persistence

- **Local storage:** Pipelines auto-save to browser localStorage
- **Named pipelines:** Save multiple pipelines with names, switch between them
- **History:** Undo/redo for the entire editor state

### Diff View

- Toggle a diff view showing what changed between input and output (character-level or line-level diff with additions/deletions highlighted)
- Per-step diffs available when clicking individual steps

### Stats and Debugging

- **Match count per step** displayed in the step header
- **Lines in / lines out** per step
- **Processing time per step** (see "WASM time source" under Technical Architecture for how this works in the browser)
- **Dropped lines indicator** for filter steps — click to see what was filtered out

## Technical Architecture

### WASM Bridge

rexpipe is compiled to WebAssembly using `wasm-pack`. A thin bridge crate (`rexpipe-wasm`) exposes the necessary API:

```
rexpipe (Rust library crate, with features = ["core"])
    |
    v
rexpipe-wasm (bridge crate, in rexpipe-playground repo)
    |  - depends on rexpipe with default-features = false, features = ["core"]
    |  - exposes #[wasm_bindgen] functions
    |  - [lib] crate-type = ["cdylib", "rlib"]
    |  - compiled with wasm-pack build --target web
    |
    v
Web Worker (wasm-worker.ts)
    |  - dynamically imports the WASM glue module
    |  - receives processing requests via postMessage
    |  - returns results asynchronously
    |
    v
rexpipe-playground (web frontend, main thread)
    - renders the UI
    - sends pipeline + input to the worker on each (debounced) edit
    - updates panes with results
```

### WASM Time Source

**This is a hard blocker for naive "compile rexpipe to WASM".** rexpipe uses `std::time::Instant::now()` and `std::time::SystemTime::now()` in multiple places. On `wasm32-unknown-unknown` the std clock implementation panics — there is no system clock in the WASM sandbox.

Affected files in rexpipe:
- `src/processor.rs` — `Instant::now()` at lines 2079, 2615, 2636 (processing time stats)
- `src/testing.rs` — `Instant::now()` at lines 393, 463 (test timing)
- `src/plugin.rs` — `SystemTime::now()` at line 421 (timestamp builtin transform), `Instant::now()` at line 766
- `src/bidirectional.rs` — `SystemTime::now()` at line 467
- `src/checkpoint.rs` — `Instant::now()` and `SystemTime::now()` at multiple sites

**Solution:** Add the `web-time` crate as an unconditional dependency. It re-exports `Instant` and `SystemTime` mapped to `performance.now()` / `Date.now()` on WASM and falls through to `std::time` on native targets. Change the imports in the affected files from `use std::time::{Instant, SystemTime}` to `use web_time::{Instant, SystemTime}`.

`processor.rs`, `testing.rs`, and `plugin.rs` (the timestamp builtin) must be fixed because they're reachable from `core`. `bidirectional.rs` and `checkpoint.rs` are CLI-only and can keep `std::time`, but fixing them uniformly avoids divergence and costs nothing.

### Bridge Crate Cargo.toml

The `rexpipe-wasm` bridge crate needs:

```toml
[package]
name = "rexpipe-wasm"
version = "0.1.0"
edition = "2024"
rust-version = "1.85"

[lib]
crate-type = ["cdylib", "rlib"]  # required by wasm-pack

[dependencies]
rexpipe = { path = "../../../rexpipe", default-features = false, features = ["core"] }
wasm-bindgen = "0.2.95"      # pinned to minor for reproducibility with edition 2024
serde = { version = "1", features = ["derive"] }
serde_json = "1"
serde-wasm-bindgen = "0.6"

# Note: getrandom with wasm_js is NOT added here. rand is not used in the rexpipe
# library (only in main.rs which is cli-gated). If Phase 1 reveals a transitive
# dep that needs it, add it then with documentation of which crate requires it.
```

**Dependency on rexpipe strategy:**
- **Development:** `path = "../../../rexpipe"` — assumes rexpipe is checked out as a sibling directory. Simple for local iteration.
- **CI / deployed build:** GitHub Actions workflow rewrites the path dependency to a git dependency pinned to a specific commit, or to a published crates.io version once Phase 0 has been released. This avoids the fragility of path deps across environments.
- **Published releases:** once rexpipe 2.x ships with the `core` feature on crates.io, switch to `rexpipe = { version = "2", default-features = false, features = ["core"] }`.

`wasm-bindgen` version should be pinned compatible with rexpipe's `rust-version = 1.85` and `edition = 2024`. Version 0.2.x is current at this writing.

### WASM API Surface

The bridge crate exposes a JSON-based API.

```rust
/// Process an entire pipeline, returning output and per-step intermediate state.
///
/// Input: JSON { input: string, steps: [StepConfig, ...], settings: Settings }
/// Returns: JSON {
///   output: string,
///   steps: [{
///     output: string,
///     matches: number,            // u32 to avoid f64 precision loss in JS
///     match_positions: [{ start, end, text }, ...],
///     captures: [{                // Phase 4 feature, API ready from day one
///       groups: [string | null, ...],
///       full_match: { start, end, text }
///     }, ...],
///     lines_in: number,
///     lines_out: number,
///     error: string | null,
///   }, ...],
///   import_warnings: [string, ...], // Populated when input uses unsupported features
///   error: string | null,
/// }
///
/// On mid-pipeline errors, steps before the failure still return their results.
/// The failed step has error set, and subsequent steps have output = null.
#[wasm_bindgen]
pub fn process_pipeline(config_json: &str) -> JsValue;

/// Validate a pattern and report which engine was selected.
///
/// Returns: JSON { valid: bool, error: string | null, engine: "standard" | "pcre" }
#[wasm_bindgen]
pub fn validate_pattern(pattern: &str, flags: &str) -> JsValue;

/// List available builtin patterns for autocomplete / step templates.
/// Sourced from rexpipe::library::BUILTIN_PATTERNS — requires internal gating
/// in library.rs so this constant is available without the cli feature.
///
/// Returns: JSON [{ name: string, pattern: string, description: string }, ...]
#[wasm_bindgen]
pub fn list_builtins() -> JsValue;

/// Return available enum values for UI dropdowns.
///
/// Returns: JSON {
///   step_types: ["substitute", "filter", "extract", "transform", "validate", "block"],
///   processing_modes: ["line", "slurp", "paragraph"],
///   filter_actions: [
///     "keep_line", "drop_line", "keep_match", "drop_match",
///     "deduplicate_by_prefix"
///   ],
///   block_actions: [
///     "keep_block", "drop_block", "collect_block", "deduplicate",
///     "mark_block", "substitute_in_block"
///   ],
///   transform_actions: [
///     "uppercase", "lowercase", "title_case", "trim",
///     "remove_whitespace", "normalize_whitespace",
///     "reverse", "deduplicate", "sort_chars",
///     "char_count", "word_count",
///     "base64_encode", "base64_decode", "url_encode", "url_decode"
///     // "shell", "plugin", "mask_deterministic", "fpe_encrypt", "fpe_decrypt"
///     // are intentionally excluded — they require filesystem/subprocess access
///   ],
///   extract_output_formats: ["text", "json", "jsonl", "csv"],
/// }
#[wasm_bindgen]
pub fn get_schema() -> JsValue;
```

**Supported PipelineConfig fields:**

| Field | Support level |
|---|---|
| `name`, `description`, `version` | Metadata, preserved on export |
| `step` | Fully supported |
| `settings` (subset) | `mode`, `max_slurp_size`, `pcre_mode`, `fixed_strings`, `context_before`, `context_after`, `timeout_ms`, `strict_mode`, `preserve_line_endings`, `max_line_length`, `max_line_action`, `regex_size_limit`, `invert_match`, `sample_limit`, `strip_ansi` |
| `settings.allow_shell`, `shell_timeout_secs` | Preserved on export (round-trip fidelity) but has no effect on playground processing — shell transforms are physically unavailable in the WASM sandbox regardless of this flag |
| `aliases` | Fully supported — resolved at processing time |
| `[[filter]]`, `[[substitute]]`, `[[extract]]`, `[[validate]]`, `[[transform]]`, `[[block]]` shorthand | Merged into step list on import |
| `extends` | **Import error** — file not accessible from browser |
| `patterns_include` | **Import error** — file not accessible from browser |
| `tests` | Ignored silently (test runner is a CLI concept) |
| `finalize.template`, `finalize.counters` | Supported (pure aggregation) |
| `finalize.shell` | **Import warning** — shell execution unavailable |
| `bidirectional`, `checkpoint`, `cross_file` | Ignored silently with warning |

Key design decisions:
- **All-JSON API** — the frontend naturally works with JS objects; constructing TOML strings on every keystroke adds unnecessary serialization overhead
- **Per-step intermediate results** returned by `process_pipeline` — enables intermediate state visibility without separate per-step calls
- **Partial failure support** — steps before a failure return their results; the UI shows exactly where the pipeline broke
- **Match positions include matched text** — enables match highlighting without the frontend needing to slice the input
- **Capture groups included from day one** — Phase 4 capture-group visualization doesn't require API changes; the frontend just starts rendering data that was already there
- **u32 for counts** — avoids silent precision loss when crossing the JS boundary
- **Import warnings as a first-class field** — users see exactly which parts of an imported config weren't supported
- **Structured errors** — errors are serialized as `{ kind, step_index, field, message, hint }` matching the variant structure of `rexpipe::error::{PatternError, ValidationError, ConfigError}`. The bridge preserves error category and field-level context rather than `.to_string()`-ing and throwing away structure. This enables the UI to highlight the exact field that failed and surface rexpipe's CLI-quality error hints inline.

### Performance Strategy

- **Web Worker** — all WASM processing runs off the main thread to prevent UI jank
- **Debouncing** — input changes are debounced at 100ms before triggering reprocessing
- **Processing indicator** — a subtle spinner appears when computation takes >100ms
- **Input size limit** — 1MB hard limit with a clear message directing users to the CLI for larger inputs

### Bundle Size and Load Budget

Realistic estimates for a rexpipe WASM bundle built with `features = ["core"]`:

- **Before optimization:** 3–5 MB uncompressed
- **After `wasm-opt -Oz`:** ~1.5–2 MB uncompressed
- **After brotli compression on the host:** ~500–800 KB transferred

The WASM bundle is the dominant load cost, not the JS framework. Targets:

| Budget | Target | Notes |
|---|---|---|
| UI shell first paint | <2 seconds | HTML + CSS + Svelte + CodeMirror |
| WASM ready | <5 seconds | On typical broadband |
| Bundle size (compressed) | <1 MB | wasm-opt -Oz + brotli |

**Mitigation strategy:**
- `wasm-opt -Oz` in the build pipeline (enabled by default in `wasm-pack`)
- Brotli compression on GitHub Pages (automatic via CDN)
- Deferred WASM initialization: UI shell loads first, WASM streams in afterward; pipeline editor is interactive immediately but processing waits for WASM-ready
- Streaming compilation via `WebAssembly.instantiateStreaming` (wasm-bindgen's default)
- Consider evaluating `regex-lite` as a smaller alternative if `regex`'s Unicode tables dominate the bundle
- Consider evaluating disabling `regex`'s Unicode features if the playground doesn't need them (trade-off: some patterns behave differently)

### Frontend Stack

Recommended: **CodeMirror 6 + Svelte + Vite**.

- **CodeMirror 6** (~150KB) for pattern/replacement editors and text panes — syntax highlighting, bracket matching, match overlay decorations. Start with CodeMirror from Phase 2 rather than plain inputs; it's central to the experience and avoids rebuilding the editing UX later.
- **Svelte** — small bundle, no virtual DOM, inherently reactive (input changes drive output updates).
- **Vite** — fast dev server, optimized production builds, native TypeScript support.

### Hosting

Static site on **GitHub Pages** (free, automatic deploys from CI):

- On push to main: build WASM with `wasm-pack build --target web`, build frontend with Vite, deploy to Pages
- Brotli compression enabled
- Custom domain optional: `playground.rexpipe.dev` or similar

## Project Structure

```
rexpipe-playground/
  DESIGN.md              # This document
  README.md              # User-facing docs

  crates/
    rexpipe-wasm/        # WASM bridge crate
      Cargo.toml         # depends on rexpipe with features = ["core"]
      src/
        lib.rs           # #[wasm_bindgen] exports

  web/
    package.json
    tsconfig.json
    vite.config.ts
    index.html
    src/
      main.ts            # Entry point
      wasm-worker.ts     # Web Worker that loads and runs WASM
      pipeline-editor.ts # Step list UI, drag-and-drop
      text-panes.ts      # Input/output/intermediate panes
      wasm-bridge.ts     # Main-thread wrapper: postMessage to worker, debounce
      export.ts          # TOML/CLI/URL export logic
      storage.ts         # localStorage persistence
      url-sharing.ts     # deflate + base64url encode/decode for URL fragments
      import-validation.ts # Detect unsupported TOML features, produce warnings
      styles/
        main.css
    public/
      favicon.ico

  .github/
    workflows/
      deploy.yml         # Build WASM + frontend, deploy to Pages
```

## rexpipe Library Requirements

The playground depends on rexpipe as a Rust library crate. Several substantial changes are needed in the rexpipe repo before the playground can work. **This is the hardest prerequisite.** Phase 0 touches 7+ modules, 50–100 `#[cfg]` sites, introduces a new public API, and rewrites the lib.rs re-export structure. Budget it as focused work, not incidental.

### 1. Add explicit `[lib]` section to Cargo.toml

rexpipe's `Cargo.toml` defines `[[bin]]` but has no `[lib]` section. While Rust auto-discovers `src/lib.rs`, an explicit entry is needed for reliable cross-crate dependency:

```toml
[lib]
name = "rexpipe"
path = "src/lib.rs"
```

### 2. Replace std::time with web-time

**Hard blocker without this.** Add `web-time` as an unconditional dependency and rewrite imports in:

- `src/processor.rs`: `use std::time::Instant;` → `use web_time::Instant;`
- `src/testing.rs`: `use std::time::{Duration, Instant};` → `use web_time::{Duration, Instant};`
- `src/plugin.rs`: `std::time::SystemTime::now()` → `web_time::SystemTime::now()` at the timestamp builtin (line 421); `std::time::Instant::now()` → `web_time::Instant::now()` at line 766

`bidirectional.rs` and `checkpoint.rs` are CLI-only modules but should be migrated for consistency.

### 3. Feature-gate WASM-incompatible dependencies

The current `Cargo.toml` has `default = []` (no default features). The changes:

- Add a `core` feature that gates nothing — it's the "WASM-safe library" entry point
- Add a `cli` feature that pulls in all WASM-incompatible deps
- Change `default = ["cli"]` so existing `cargo build` behavior is unchanged
- Keep existing optional features (`async`, `fpe`, `tree-sitter`, `remote`, `watch`) as-is — they're separate axes and should work with either `core` or `cli`
- Note: `fpe`, `remote`, and `watch` are WASM-incompatible on their own; the playground build uses only `core`

**Dependencies to make optional and gate behind `cli`:**

| Dependency | Currently | Used in | Action |
|---|---|---|---|
| clap | hard | main.rs | optional, gate behind cli |
| clap_complete | hard | main.rs | optional, gate behind cli |
| clap_mangen | hard | main.rs | optional, gate behind cli |
| ctrlc | hard | main.rs | optional, gate behind cli |
| env_logger | hard | main.rs | optional, gate behind cli |
| termcolor | hard | inspector.rs | optional, gate behind cli |
| indicatif | hard | files.rs | optional, gate behind cli |
| rayon | hard | files.rs | optional, gate behind cli |
| ignore | hard | files.rs | optional, gate behind cli |
| dirs | hard | library.rs, plugin.rs, main.rs | optional, gate behind cli (used in internal-gated sections) |
| glob | hard | crossfile.rs, main.rs | optional, gate behind cli |
| globset | hard | crossfile.rs | optional, gate behind cli |
| chrono | hard | learn.rs (production, not just tests) | optional, gate behind cli |
| rand | hard | main.rs | optional, gate behind cli |
| diffy | hard | files.rs (NOT main.rs) | optional, gate behind cli |

**Dependencies to keep unconditional:**

| Dependency | Used in |
|---|---|
| regex, fancy-regex | processor.rs |
| serde, serde_json | everywhere |
| toml | pipeline.rs |
| anyhow, thiserror | error.rs, everywhere |
| log | everywhere |
| web-time (NEW) | processor.rs, testing.rs, plugin.rs |

**Resulting Cargo.toml `[features]`:**

```toml
[features]
default = ["cli"]
core = []
cli = [
    "core",
    "dep:clap", "dep:clap_complete", "dep:clap_mangen",
    "dep:ctrlc", "dep:env_logger", "dep:termcolor",
    "dep:indicatif", "dep:rayon", "dep:ignore",
    "dep:dirs", "dep:glob", "dep:globset",
    "dep:chrono", "dep:rand", "dep:diffy",
]

# Existing features preserved unchanged:
async = ["tokio"]
fpe = ["dep:fpe", "dep:aes"]
tree-sitter = ["dep:tree-sitter", "dep:streaming-iterator", ...]
remote = ["ureq"]
watch = ["notify"]
```

### 4. Internal gating (not whole-module gating) for most modules

**This is the critical correction from earlier drafts of this design.** Several modules can't be whole-module-gated because `pipeline.rs` unconditionally imports from them:

```rust
// pipeline.rs:81-84
use crate::bidirectional::BidirectionalConfig;
use crate::checkpoint::CheckpointConfig;
use crate::crossfile::CrossFileConfig;
use crate::testing::TestCase;
```

And `PipelineConfig` embeds all four `*Config` types as fields. If those modules were whole-module-gated, `pipeline.rs` (which is core) would fail to compile.

**Additionally:** `processor.rs` has 11 reference sites to `BidirectionalManager` and embeds `bidirectional_manager: Option<BidirectionalManager>` as a field on `StreamProcessor`. Whole-module-gating `bidirectional` would require cfg-gating every one of those sites.

**The strategy: internal gating within each module.** Keep the data types (`*Config`, `BidirectionalManager`) always compiled, but gate their file I/O and runtime methods behind `cli`. Under WASM, the types exist but their filesystem-dependent methods are stubs that return an error (or are simply unavailable).

**Per-module strategy:**

| Module | Strategy | What stays in core | What gates to cli |
|---|---|---|---|
| `error` | Unconditional | Everything | Nothing |
| `pipeline` | Internal gating | Data structures, serde impls, shorthand merging, validation | `from_file()`, `extends` resolution, `patterns_include` loading |
| `processor` | Internal gating | Core processing, `StreamProcessor`, `CompiledPattern`, segment execution, `BidirectionalManager` field (stub) | Stats that require `Instant::now` (use web-time), context tracking is core |
| `plugin` | Internal gating | `PluginRegistry` types, built-in transforms, timestamp builtin (via web-time) | `Shell { command }` execution, plugin loading from `~/.config/rexpipe/plugins/` |
| `library` | Internal gating | `BUILTIN_PATTERNS` constant, `get_builtin_pattern`, `list_builtin_patterns`, alias resolution, `ResolvedLibrary` type | `load_from_file()`, `dirs::home_dir()` path lookups |
| `bidirectional` | Internal gating | `BidirectionalConfig` struct, `BidirectionalManager` type (with stub file I/O), `Direction` enum, `generate_reverse_pipeline` | File I/O in `save()`/`load()` — stubs return Ok or an error under WASM |
| `checkpoint` | Internal gating | `CheckpointConfig` struct, state types | All file I/O, git subprocess, `Checkpoint` runtime |
| `crossfile` | Internal gating | `CrossFileConfig` struct, `CrossFileRule` data | `use globset::{Glob, GlobMatcher};` at line 25 (top-level import — must be moved inside `#[cfg(feature = "cli")]`), `compile_glob()` at line 64, all `CrossFileManager` methods using `GlobMatcher`, all std::fs operations. Rule patterns are stored as `String`, so data types don't need globset. |
| `testing` | Unconditional (with web-time swap) | `TestCase` struct, in-memory test runner | Nothing — no filesystem ops |
| `json_schema` | Unconditional | Everything | Nothing |
| `files` | Whole-module gate | — | Entire module — pure filesystem/parallel |
| `inspector` | Whole-module gate | — | Entire module — pure terminal output |
| `learn` | Whole-module gate | — | Entire module — uses chrono, interactive |
| `syntax` | Unchanged | Already behind `tree-sitter` feature | — |

**Resulting `lib.rs` structure:**

```rust
// Always available (WASM-safe core)
pub mod error;
pub mod pipeline;        // with internal cfg on from_file, extends, patterns_include
pub mod processor;       // with internal cfg on cli-only stats; uses web-time
pub mod plugin;          // with internal cfg on shell execution, plugin loading
pub mod library;         // with internal cfg on load_from_file and dirs lookup
pub mod bidirectional;   // with internal cfg on file I/O; types stay available
pub mod checkpoint;      // with internal cfg on runtime; Config stays available
pub mod crossfile;       // with internal cfg on runtime; Config stays available
pub mod testing;         // unconditional (no filesystem ops; uses web-time)
pub mod json_schema;

// Gate behind cli (purely filesystem/terminal dependent)
#[cfg(feature = "cli")]
pub mod files;
#[cfg(feature = "cli")]
pub mod inspector;
#[cfg(feature = "cli")]
pub mod learn;

// Unchanged
#[cfg(feature = "tree-sitter")]
pub mod syntax;

// Re-exports — MUST be split between always-available and cli-gated
pub use error::{ConfigError, LibraryError, PatternError, RexpipeError, ValidationError};
pub use bidirectional::{BidirectionalConfig, Direction, MappingStore};
pub use testing::{TestCase, TestConfig, TestRunner, TestSummary};
pub use pipeline::{CounterConfig, FinalizeConfig, FinalizeOutputFormat};
pub use processor::{CompiledCounter, FinalizeState};

// Config types stay in core; runtime types are cli-gated
pub use checkpoint::CheckpointConfig;
pub use crossfile::{CrossFileConfig, CrossFileRule};

#[cfg(feature = "cli")]
pub use files::{BinaryMode, ShutdownInterrupted, ShutdownSignal, is_binary_file};

#[cfg(feature = "cli")]
pub use checkpoint::{Checkpoint, GitDiff};

#[cfg(feature = "cli")]
pub use crossfile::CrossFileManager;

#[cfg(feature = "cli")]
pub use learn::{LearnConfig, LearnedPattern, PatternLearner};
```

**Critical:** the current `lib.rs` has four unconditional re-exports that reference cli-gated content:

- Line 114: `pub use files::{BinaryMode, ShutdownInterrupted, ShutdownSignal, is_binary_file};` — must be `#[cfg(feature = "cli")]`
- Line 120: `pub use checkpoint::{Checkpoint, CheckpointConfig, GitDiff};` — must be split (only `CheckpointConfig` stays in core)
- Line 123: `pub use crossfile::{CrossFileConfig, CrossFileManager, CrossFileRule};` — must be split (only `CrossFileManager` is cli-gated)
- Line 126: `pub use learn::{LearnConfig, LearnedPattern, PatternLearner};` — must be `#[cfg(feature = "cli")]`

Without these splits, `cargo check --no-default-features --features core` fails with "module/type not found" errors.

**Doctest blocker:** `lib.rs:65` contains a doctest that imports `rexpipe::inspector::Inspector`. Since `inspector` is whole-module-gated to `cli`, this doctest fails under `cargo test --no-default-features --features core`. Fix options:

1. Add `#[cfg(feature = "cli")]` to the doctest via `#[cfg_attr(not(feature = "cli"), ignore)]` on the containing item, or
2. Rewrite the module-level docs to use examples that don't reference gated modules, or
3. Skip inspector-dependent doctests under core-only testing

Option 2 (rewrite to use always-available types like `StreamProcessor` or `PipelineConfig`) is cleanest. A full audit of `lib.rs` doctests is part of Phase 0.

### 5. BidirectionalManager integration in StreamProcessor

`StreamProcessor` has `bidirectional_manager: Option<BidirectionalManager>` as a field and 11 reference sites. Three possible fixes:

- **(a) Stub file I/O** — `BidirectionalManager::save()` and `load()` become no-ops returning `Ok(())` under WASM. All other methods (mapping recording/replay) work normally since they're in-memory. Smallest change.
- **(b) Cfg-gate every reference site** — wrap all 11 references in `#[cfg(feature = "cli")]` plus stub fields under non-cli. Substantial code churn.
- **(c) Trait-based integration** — extract into a trait with a default no-op implementation. Cleaner but biggest refactor.

**Chosen approach: (a) stub file I/O.** It's the smallest change, preserves the current code shape, and mappings still work in-memory in the playground (which is fine — the playground is a design tool, not a persistence layer). The file I/O methods become:

```rust
impl BidirectionalManager {
    #[cfg(feature = "cli")]
    pub fn save(&self) -> Result<()> { /* existing file I/O */ }

    #[cfg(not(feature = "cli"))]
    pub fn save(&self) -> Result<()> { Ok(()) } // no-op under WASM

    #[cfg(feature = "cli")]
    pub fn load(path: &Path) -> Result<Self> { /* existing file I/O */ }

    #[cfg(not(feature = "cli"))]
    pub fn load(_path: &Path) -> Result<Self> {
        Err(anyhow::anyhow!("Loading mappings from files is not supported in WASM builds"))
    }
}
```

`Checkpoint` and `CrossFileManager` (used only in `files.rs` which is whole-module-gated) don't need this treatment — they're behind the `cli` gate already.

### 6. Expose per-step processing as a public API

**This is a new code path, not a refactor of `process_stream()`.**

Why it can't be a refactor: `process_stream()` is a streaming API (`BufRead` → `Write`) that writes output as it processes. It cannot return intermediate per-step results because it doesn't buffer them. The intermediates API fundamentally requires buffering all input and all intermediate outputs in memory.

**Segment architecture interaction:** The processor groups steps into `PipelineSegment`s (Line, Slurp, Paragraph). The intermediates API must handle segment boundaries correctly. When a Line segment feeds into a Slurp step, the "intermediate input" to the Slurp step is the entire accumulated output of all prior line-mode steps joined together. This mirrors the internal logic of `process_stream_segmented()`.

`PipelineSegment` is currently a private enum (`enum PipelineSegment` without `pub`) in `processor.rs`. It stays internal — the new API doesn't need to expose it; it operates on the already-compiled steps.

**Proposed API:**

```rust
use serde::{Serialize, Deserialize};

/// Process a pipeline and return per-step intermediate results.
/// Suitable for interactive/playground use with bounded input sizes.
/// For large files, use process_stream instead.
pub fn process_with_intermediates(
    &mut self,
    input: &str,
) -> Result<PipelineIntermediateResult>

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineIntermediateResult {
    pub final_output: String,
    pub steps: Vec<StepIntermediateResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepIntermediateResult {
    pub output: String,
    pub matches: u32,
    pub match_positions: Vec<MatchPosition>,
    pub captures: Vec<CaptureGroupResult>,
    pub lines_in: u32,
    pub lines_out: u32,
    pub error: Option<StepError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchPosition {
    pub start: usize,
    pub end: usize,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureGroupResult {
    pub groups: Vec<Option<String>>,  // index 0 is full match, 1+ are capture groups
    pub full_match: Option<MatchPosition>,
}

/// Structured error with category and location for UI display.
/// Preserves the variant structure of rexpipe::error::* rather than
/// flattening to a string.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepError {
    pub kind: String,          // e.g., "PatternError", "ValidationError", "ConfigError"
    pub step_index: usize,
    pub field: Option<String>, // e.g., "pattern", "replacement"
    pub message: String,
    pub hint: Option<String>,  // matches rexpipe's CLI error hints
}
```

The implementation shares internal helpers (`apply_step_to_content`, `process_line_with_range`) and reuses `CompiledPattern::captures_iter()` (which already exists and returns `Vec<CaptureGroup>` with exactly the shape needed).

All intermediate result types must derive `Serialize`, `Deserialize`, `Debug`, and `Clone` for serde-wasm-bindgen round-tripping across the JS boundary.

**Phase 0 scope for `process_with_intermediates`:** Reproducing the full semantics of `process_stream_segmented()` is substantial work — it handles segment boundaries, `BidirectionalManager` recording, `FinalizeState` accumulation, context tracking, and a dozen `ProcessorSettings` knobs. Phase 0 takes the pragmatic approach: build a naive per-step implementation that handles the common cases, explicitly scoping which settings are honored on day one.

| Setting | Phase 0 support | Rationale |
|---|---|---|
| `mode` (line/slurp/paragraph) | ✅ Supported | Core to pipeline semantics |
| `pcre_mode`, `fixed_strings` | ✅ Supported | Pattern compilation concerns |
| `max_slurp_size` | ✅ Supported | Memory safety |
| `regex_size_limit`, `strict_mode` | ✅ Supported | Pattern compilation concerns |
| `max_line_length`, `max_line_action` | ✅ Supported | Input handling |
| `strip_ansi` | ✅ Supported | Pre-processing |
| `invert_match` | ✅ Supported | Filter semantics |
| `sample_limit` | ✅ Supported | Input bounding |
| `timeout_ms` | ✅ Supported | Per-step timeout (via web-time) |
| `preserve_line_endings` | ✅ Supported | Output fidelity |
| `context_before`/`context_after` | ⚠️ Deferred | Context tracking is orthogonal to segment model; deferred to Phase 4 |
| `BidirectionalManager` recording | ⚠️ Deferred | Playground doesn't persist mappings; in-memory recording deferred |
| `FinalizeState`/counters | ⚠️ Deferred | `finalize.counters` support deferred to Phase 4 (Debugging) |
| `allow_shell`/`shell_timeout_secs` | ❌ Unsupported | Shell transforms physically unavailable in WASM sandbox |

This is option (b) from the architecture analysis: a naive correct implementation that handles common cases, with exotic edges deferred. Option (a) — extracting segment-processing helpers from `process_stream_segmented()` into a buffer-based internal API — is a real refactor that can happen later if needed.

### 7. Summary of rexpipe changes needed

| Change | Scope | Risk |
|---|---|---|
| Add `[lib]` to Cargo.toml | 1 line | None |
| Add `web-time` dep and rewrite Instant/SystemTime imports | ~6 files, ~15 sites | Low — mechanical |
| Add `core`/`cli` features, mark 15 deps optional | Cargo.toml | None |
| Set `default = ["cli"]` | 1 line | None — behavior unchanged |
| Internal gating in pipeline.rs, processor.rs, plugin.rs, library.rs, bidirectional.rs, checkpoint.rs, crossfile.rs | `#[cfg]` across 7 modules, ~50-100 sites | Medium — touches many files |
| BidirectionalManager file I/O stubbed under !cli | ~2 methods | Low |
| Whole-module gate: files, inspector, learn | 3 lines in lib.rs | Low |
| Add `process_with_intermediates()` + result types | New public API in processor.rs | Low — additive |
| Add CI jobs: `cargo check --no-default-features --features core` and `--target wasm32-unknown-unknown` | CI config | None |

### 8. Phase 0 acceptance criteria

Phase 0 is done when **all** of these pass:

1. `cargo build` (default features = `cli`) — existing behavior completely unchanged
2. `cargo test` (default features = `cli`) — all 504+ existing tests still pass
3. `cargo build --release` (default features) — release profile with `strip`/`lto` still produces a working binary
4. `cargo check --no-default-features --features core --target wasm32-unknown-unknown` — library compiles for WASM with only core features
5. `cargo test --no-default-features --features core` — library tests (including doctests) pass under core-only. This is how the inspector-doctest blocker surfaces.
6. `cargo check --no-default-features --features "core fpe"` and `--features "core async"` — verify the new feature split composes cleanly with existing optional feature axes

Criterion 6 is especially important: the design assumes `fpe`, `async`, `tree-sitter`, `remote`, and `watch` "work with either core or cli" — but this is untested until CI jobs exercise those combinations explicitly. `fpe`, `remote`, and `watch` are WASM-incompatible on their own, so only `core + fpe`, `core + async`, `core + tree-sitter` need to work (the other axes stay out of the WASM build).

All six criteria must be CI jobs. The hardest one is #4; adding it to CI is what makes the feature split real.

## Implementation Phases

### Phase 0: rexpipe Library Preparation

This phase is the highest-risk: it touches most of the codebase, introduces a feature-split that must preserve existing behavior exactly, and the WASM compile target is the acceptance gate.

Work in the rexpipe repo:

- Add explicit `[lib]` section to `Cargo.toml`
- Add `web-time` dependency; rewrite `Instant`/`SystemTime` imports in processor.rs, testing.rs, plugin.rs (and optionally bidirectional.rs, checkpoint.rs for consistency)
- Mark 15 dependencies as optional; create `core` and `cli` features with `default = ["cli"]`
- Apply internal `#[cfg(feature = "cli")]` gates in pipeline.rs (`from_file`, extends/patterns_include resolution), processor.rs (cli-only stats if any remain), plugin.rs (shell execution, plugin loading), library.rs (file loading, dirs lookup), bidirectional.rs (file I/O stubs), checkpoint.rs (runtime), crossfile.rs (runtime)
- Apply whole-module `#[cfg(feature = "cli")]` gates in lib.rs for files, inspector, learn
- Add `process_with_intermediates()` public API with result types
- Add CI jobs for both default (`cli`) and core-only builds, including `--target wasm32-unknown-unknown`
- **Acceptance:** both CI jobs green, existing tests still pass

### Phase 1: WASM Proof of Concept

Phase 1's HTML page is a **throwaway smoke test** — its only purpose is to prove that `wasm-pack build --target web` produces a loadable module and that `process_pipeline()` returns correct results. Phase 2 starts the real frontend from scratch with Svelte/Vite/CodeMirror. None of Phase 1's HTML/JS is preserved.

- Create `rexpipe-wasm` bridge crate with path dependency on rexpipe (rewritten to git/crates.io for deployed builds)
- Implement `process_pipeline()` and `validate_pattern()` bridge functions
- Compile with `wasm-pack build --target web`
- Throwaway HTML page: textareas for input, pipeline JSON, and output — just enough to verify the WASM module loads and runs
- Measure bundle size with and without `wasm-opt -Oz`
- Run a **smoke-test pipeline**: pick one of `rexpipe/examples/*.toml` (e.g., `unwrap.toml`) and verify the playground produces byte-identical output to the CLI on the same input
- Produce a **golden-file test** that feeds known inputs through the WASM API and asserts exact output JSON structure — this prevents silent API drift in later phases
- **Goal:** Prove the WASM build works end-to-end; measure real bundle size; establish regression baselines

### Phase 2: Core Playground with Intermediate State

- Three-pane layout (input, output, pipeline editor)
- Add/remove/reorder steps with drag-and-drop
- Step type and processing mode selection dropdowns (Substitute, Filter, Extract, Transform, Validate)
- Live processing via Web Worker with debounced input
- **Intermediate state:** Click any step to see its input/output in the top panes
- Match count per step in step headers
- Match position highlighting in text panes
- CodeMirror 6 for pattern/replacement fields
- Validate steps with pass/fail indicator
- **Goal:** The core differentiator — a pipeline builder with full intermediate visibility

### Phase 3: Import/Export and Persistence

- Export as TOML config
- Import from TOML config with comprehensive warning system for unsupported fields (extends, patterns_include, shell transforms, etc.)
- Merging of shorthand sections (`[[filter]]`, `[[substitute]]`, etc.) on import
- Export as CLI command
- Share via URL (deflate + base64url in hash fragment, ~16KB practical limit)
- **Copy as JSON** fallback button (primary path for non-trivial pipelines)
- localStorage auto-save with named pipeline management
- Undo/redo history
- **Goal:** Complete workflow from experimentation to production use

### Phase 4: Debugging and Diff

- Diff view (input vs output, per-step diffs)
- Capture group visualization on hover (data already available from Phase 1 API)
- Dropped lines view for filter steps
- Processing time per step
- Import warnings panel
- **Goal:** Full debugging visibility into pipeline behavior

### Phase 5: Polish

- Step templates / presets
- Keyboard shortcuts
- Dark/light theme
- Responsive layout for tablets (desktop-first)
- Performance optimization for inputs approaching the 1MB limit
- Documentation, examples, and guided tour
- **Goal:** Production-quality tool ready for public use

## Design Principles

1. **Client-side only.** No server, no uploads, no accounts. Everything runs in the browser via WASM.

2. **Pipeline-first.** The UI is designed around multi-step workflows, not single patterns.

3. **Live feedback.** Every change triggers reprocessing (debounced, in a Web Worker). No "Run" button.

4. **Export as first-class.** The playground is a design tool, not a runtime.

5. **Minimal footprint.** Small bundle size, fast load (within the constraints of a WASM-based tool).

6. **Honest about limitations.** Unsupported TOML features produce clear warnings, not silent failures.

## Relationship to rexpipe

The playground is a **companion tool**, not a replacement for the CLI. It serves two audiences:

- **New users:** Discover rexpipe through the playground, learn by experimenting, export configs to use with the CLI
- **Existing users:** Debug complex pipelines visually, iterate on patterns faster than editing TOML files, share pipelines with colleagues

The playground links back to the rexpipe repo and documentation. The rexpipe README links to the playground.

## Upstream Coordination

Phase 0 is a large PR against the rexpipe repo. Coordination details:

- **Ownership:** Same author as the playground (single-maintainer project currently)
- **Branch strategy:** Phase 0 work happens on a long-lived `wasm-prep` branch in rexpipe. All six acceptance-criteria CI jobs must be green before merge to main.
- **Phase 1 parallelism:** Phase 1 does NOT wait for the Phase 0 PR to merge. The `rexpipe-wasm` bridge crate uses a **path dependency against the `wasm-prep` branch's local checkout** during Phase 1 development. Once Phase 0 merges to rexpipe main, the path dep switches to a git dep pinned to the merge commit. Once a rexpipe release ships with the `core` feature, the git dep switches to a crates.io version.
- **Rollback:** Phase 0 changes are purely additive (new feature flag, new API). If Phase 1 reveals a fundamental issue with the feature split, the rexpipe main branch can stay on the Phase 0 changes without impact — default builds are unaffected.

## Suggested Next Steps

1. **Revise and commit this design** (done)
2. **Open a draft PR against rexpipe for Phase 0** covering: Cargo.toml rework, web-time swap, internal gating across 7 modules, whole-module gating for 3 modules, lib.rs re-export splits, doctest fixes, BidirectionalManager stub, `process_with_intermediates()` API, six CI jobs for acceptance criteria
3. **Do not merge Phase 0** until all six acceptance criteria pass in CI
4. **Start the `rexpipe-wasm` bridge in parallel** (Phase 1) against the unmerged Phase 0 branch via path dependency

## Open Questions

1. **Bundle size Plan B.** If Phase 1 measures the WASM bundle at >2MB brotli-compressed, the concrete fallback sequence is:
   - First: disable regex's `unicode-case` feature (preserves ASCII case-insensitivity; breaks `(?i)[Α-Ω]` on non-ASCII)
   - If still too large: disable all `unicode-*` features in regex (more patterns behave differently; document the delta)
   - Last resort: evaluate `regex-lite` as a replacement — but this drops PCRE entirely and is a significant feature regression for the playground (auto-detection of lookahead/lookbehind stops working, rexpipe's own `fancy-regex` path still needs bundling)
   This becomes a real decision only after Phase 1 measurements.

2. **Mobile support.** Desktop-first. Tablet stacked layout is a reasonable Phase 5 stretch goal.

3. **`finalize` support depth.** `finalize.template` and `finalize.counters` are pure in-memory aggregation and would work in the playground. The `process_with_intermediates` scope table defers them to Phase 4.

4. **In-browser test runner (Phase 5 stretch).** Since `testing.rs` stays in core (with web-time swap), `TestCase`/`TestRunner` are available in the playground bridge. Currently the design ignores `[[tests]]` sections on import. A Phase 5 stretch goal: actually run embedded tests in the browser and show pass/fail feedback. This would be a genuine differentiator over regex101 — no other regex tool lets you write assertions alongside your patterns.
