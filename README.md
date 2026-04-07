# rexpipe-playground

A browser-based interactive playground for building, testing, and sharing [rexpipe](https://github.com/jkindrix/rexpipe) pipelines. Think regex101.com, but for multi-step regex transformation pipelines.

## Status

**Phase 1 (WASM proof-of-concept)** — the `rexpipe-wasm` bridge crate compiles rexpipe to WebAssembly and exposes the core processing API to JavaScript. A throwaway HTML smoke test verifies that pipelines produce byte-identical output to the CLI.

See [DESIGN.md](./DESIGN.md) for the full project design, phase breakdown, and architecture.

## Project structure

```
rexpipe-playground/
├── DESIGN.md                  # Full design document
├── crates/
│   └── rexpipe-wasm/          # WASM bridge crate (Rust → wasm-bindgen)
│       ├── Cargo.toml
│       └── src/lib.rs
└── web/                       # Frontend (Phase 2 onward)
    ├── public/
    └── src/
```

## Building the WASM bridge

The bridge crate depends on rexpipe via a path dependency during local development. By default it points at a sibling `rexpipe/` checkout at `../../rexpipe` on the `main` branch (which contains the Phase 0 core/cli feature split).

```bash
cd crates/rexpipe-wasm
wasm-pack build --target web --out-dir ../../web/public/pkg
```

This produces a `pkg/` directory containing the compiled WASM module and JS glue code.

## Running the smoke test

From the repository root:

```bash
cd web/public
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Paste input text, edit the pipeline JSON, and verify that the output matches what the rexpipe CLI produces for the same pipeline.

## Relationship to rexpipe

This project is a companion tool, not a replacement for the CLI. It serves:

- **New users** discovering rexpipe through interactive experimentation
- **Existing users** debugging complex pipelines visually

All processing runs client-side in the browser via WebAssembly. No server, no uploads, no latency.

## License

MIT OR Apache-2.0 (matching rexpipe).
