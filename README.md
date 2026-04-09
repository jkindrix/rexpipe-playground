# rexpipe-playground

A browser-based interactive playground for building, testing, and sharing
[rexpipe](https://github.com/jkindrix/rexpipe) pipelines. Think regex101.com,
but for multi-step regex transformation pipelines.

**Live demo:** https://jkindrix.github.io/rexpipe-playground/

All processing runs client-side in a Web Worker via WebAssembly. No server,
no uploads, no latency. Your input text never leaves your browser.

## What it does

- **Three-pane layout.** Input text on top-left, output on top-right, pipeline
  editor on the bottom.
- **Live processing.** Every keystroke triggers (debounced) reprocessing in a
  Web Worker that runs the real rexpipe engine compiled to WebAssembly. The
  same code that powers the CLI produces the same output in the browser.
- **Intermediate state visibility (the killer feature).** Click any step in
  the pipeline editor. The top panes switch to show that step's *input* and
  *output* — the actual data flowing between stages. regex101 can't do this
  because it only handles one pattern at a time.
- **Match highlighting.** Pattern matches are highlighted in the output pane
  when a step is selected, driven by CodeMirror 6 decoration state fields.
- **Schema-driven UI.** Every step type, processing mode, filter action,
  transform action, and extract format dropdown is populated from the real
  rexpipe enum via `get_schema()` — no hand-maintained drift.
- **Live regex validation.** Each pattern field validates against the
  rexpipe engine as you type, showing a pass/fail indicator. Errors surface
  inline with the same helpful hints rexpipe provides on the CLI.
- **Multi-line processing modes.** Switch any step between `line` (default,
  streaming), `slurp` (buffer the whole input), and `paragraph` (split on
  blank lines). This is how you write cross-line substitutions like
  "rejoin soft-wrapped lines" that would be impossible in a pure line-by-line
  processor.
- **PCRE auto-detection.** Patterns with lookahead, lookbehind, or
  backreferences automatically use the PCRE engine. Simple patterns use the
  standard (linear-time, ReDoS-safe) engine. No flags to set.
- **Step reordering, enable/disable, delete.** Each step has up/down buttons
  and an enable checkbox. Disabled steps stay in the UI but are filtered out
  of the pipeline before processing.

## Project structure

```
rexpipe-playground/
├── DESIGN.md                      # Full design document (5 rounds of review)
├── README.md                      # This file
├── crates/
│   └── rexpipe-wasm/              # WASM bridge crate (Rust → wasm-bindgen)
│       ├── Cargo.toml
│       ├── src/lib.rs             # 4 #[wasm_bindgen] exports
│       └── tests/golden.rs        # Byte-identical-to-CLI regression test
├── web/                           # Svelte 5 + Vite + CodeMirror frontend
│   ├── index.html                 # Vite entry
│   ├── package.json
│   ├── vite.config.ts
│   ├── public/
│   │   ├── pkg/                   # Pre-built WASM (committed for
│   │   │                          #   Pages deploy reproducibility)
│   │   └── smoke-test.html        # Phase 1 throwaway smoke test, still
│   │                              #   accessible at /smoke-test.html
│   └── src/
│       ├── App.svelte             # Root layout + WASM lifecycle
│       ├── main.ts                # Mount point
│       ├── app.css                # Global styles + CSS custom properties
│       ├── components/
│       │   ├── Header.svelte      # Title + status indicator
│       │   ├── TextPane.svelte    # CodeMirror text pane (reused for input/output)
│       │   ├── PipelineEditor.svelte
│       │   ├── StepCard.svelte    # One pipeline step's UI
│       │   └── PatternField.svelte# Single-line CodeMirror for regex
│       └── lib/
│           ├── types.ts           # TS interfaces mirroring the bridge API
│           ├── pipeline-state.svelte.ts  # Shared reactive state
│           ├── wasm-worker.ts     # Worker that loads WASM
│           ├── wasm-bridge.ts     # Main-thread bridge with debounce
│           ├── codemirror-setup.ts
│           └── highlight-extension.ts
└── .github/workflows/
    ├── ci.yml                     # Build + test bridge crate + frontend
    └── deploy-pages.yml           # Deploy to GitHub Pages on push to main
```

## Architecture

**WASM bridge.** The `rexpipe-wasm` crate depends on [rexpipe](https://github.com/jkindrix/rexpipe)
as a Rust library with `default-features = false, features = ["core"]`.
The `core` feature (added on rexpipe `main`, planned for the 2.1.0
release) is a WASM-safe entry point that excludes filesystem, terminal,
and subprocess-dependent code. The bridge exposes three functions used
by the frontend plus `list_builtins()`, which is available on the WASM
module for the smoke test but not currently wired through the worker:

- `process_pipeline(request_json)` — run a pipeline and return per-step
  intermediate results
- `validate_pattern(pattern, flags_json)` — compile a single pattern,
  report whether it's valid, and which engine (standard vs PCRE) was
  selected
- `get_schema()` — return enum values for UI dropdowns
- `list_builtins()` — return the built-in regex pattern catalog (not
  currently surfaced in the playground UI)

All return values are plain JavaScript objects (not `Map` instances) for
idiomatic property access on the JS side.

**Web Worker.** All WASM processing runs off the main thread in a worker.
The main-thread `WasmBridge` class debounces processing requests (100ms
idle threshold) and dispatches them via `postMessage`. Responses are
routed back by message ID for one-shot calls and via an `onResult`
callback for the streaming processing case.

**Svelte 5 with runes.** State lives in a single module at
`src/lib/pipeline-state.svelte.ts` using `$state` for mutable values and
exported functions for derived views (Svelte 5 doesn't allow exporting
`$derived` values from a module). The derived views are how the killer
feature is implemented: `leftPaneText()` and `rightPaneText()` read from
`state.result.steps[state.selectedStepIndex]` and feed the CodeMirror
text panes.

**CodeMirror 6.** Full CM6 EditorView for text panes (with line numbers,
history, match highlighting via a `StateField<DecorationSet>` pattern)
and a stripped-down single-line variant for pattern/replacement fields
(newlines filtered via a transaction filter, no line wrapping).

See [DESIGN.md](./DESIGN.md) for the complete design, including the
three phases of prerequisite work (rexpipe library WASM prep, WASM
bridge crate, Svelte frontend) and the four sprints of Phase 2.

## Building locally

Prerequisites: Rust (1.85+), wasm-pack, Node.js 20.19+ (Vite 6), and a
local checkout of [rexpipe](https://github.com/jkindrix/rexpipe) at
`../rexpipe` (the bridge crate uses a path dependency during
development).

```bash
# From the repository root:

# 1. Build the WASM bridge
cd crates/rexpipe-wasm
wasm-pack build --target web --out-dir ../../web/public/pkg

# 2. Build and run the frontend
cd ../../web
npm install
npm run dev

# Open http://localhost:5173 in your browser.
```

To produce a production build:

```bash
cd web
npm run build
npm run preview  # serve the dist/ output locally
```

The Phase 1 smoke test lives at `web/public/smoke-test.html` and is
available at `/smoke-test.html` during `npm run dev` for quick
regression checks — it runs the same pipeline through the bridge
without the Svelte layer. It's stripped from the production bundle
(see `vite.config.ts`) so the deployed site only ships the real app.

## Testing

**Bridge crate:**

```bash
cd crates/rexpipe-wasm

# 10 unit tests + 4 golden-file tests that assert byte-identical output
# to the rexpipe CLI for the motivating "unwrap soft-wrapped lines" pipeline
cargo test
```

**Frontend:**

```bash
cd web
npm run check   # svelte-check + tsc type check
npm run build   # production build succeeds with no errors
```

**Integration (browser):** Open the live demo or a local dev server,
paste input text, build a pipeline step-by-step, and verify the output
matches what you'd get from running the equivalent pipeline through the
rexpipe CLI.

## Deployment

The playground deploys automatically to GitHub Pages on every push to
`main` via `.github/workflows/deploy-pages.yml`. The workflow:

1. Checks out rexpipe-playground and rexpipe (main branch) as siblings
2. Installs Rust + wasm-pack + Node.js
3. Runs `wasm-pack build --target web` to produce the WASM module
4. Runs `npm ci && npm run check && npm run build` to produce the Vite
   production bundle
5. Uploads `web/dist/` as a GitHub Pages artifact and deploys it

The deployed URL is https://jkindrix.github.io/rexpipe-playground/ (served
from the `/rexpipe-playground/` subpath — the Vite config sets `base`
accordingly for production builds, and the WASM worker computes paths
from `import.meta.env.BASE_URL`).

## Relationship to rexpipe

The playground is a **companion tool**, not a replacement for the CLI.
It serves two audiences:

- **New users:** discover rexpipe through interactive experimentation
  and export their pipeline as a TOML config for the CLI
- **Existing users:** debug complex multi-step pipelines visually,
  iterate on patterns faster than editing TOML files, and share
  pipelines with colleagues

The rexpipe README links to this project; this README links back. They
promote each other.

## Roadmap

**Phase 2 (complete):** Svelte + Vite + CodeMirror frontend with live
processing, intermediate state visibility, match highlighting, and
schema-driven dropdowns.

**Phase 3 (next):** Import and export. Paste a TOML config to load it;
export the current pipeline as TOML, as an equivalent CLI command, or
as a shareable URL with the pipeline state compressed into the hash
fragment. localStorage persistence for named pipelines.

**Phase 4 (later):** Debugging and diff view. Full capture-group
visualization on hover. Dropped-lines panel for filter steps. Per-step
processing time metrics.

**Phase 5 (later):** Polish. Step templates for common operations.
Keyboard shortcuts. Dark/light theme. Drag-and-drop step reordering
(currently up/down buttons only). Responsive layout for tablets.

See [DESIGN.md](./DESIGN.md) §"Implementation Phases" for full details.

## License

MIT OR Apache-2.0 (matching rexpipe).
