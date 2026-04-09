<script lang="ts">
  import Header from './components/Header.svelte';
  import TextPane from './components/TextPane.svelte';
  import PipelineEditor from './components/PipelineEditor.svelte';
  import {
    state,
    leftPaneText,
    rightPaneText,
    rightPaneHighlights,
    leftPaneLabel,
    rightPaneLabel,
  } from './lib/pipeline-state.svelte';
  import { bridge } from './lib/wasm-bridge';
  import type { PipelineConfig } from './lib/types';

  // Wire up WASM lifecycle callbacks once, on component mount.
  bridge.onReady = () => {
    state.wasmReady = true;
    // Fetch the schema for UI dropdowns as soon as the worker is ready.
    // This is a one-shot call that happens exactly once per session.
    bridge
      .getSchema()
      .then((schema) => {
        state.schema = schema;
      })
      .catch((e) => {
        console.error('[rexpipe-playground] Failed to fetch schema:', e);
      });
  };
  bridge.onLoadError = (message) => {
    state.wasmError = message;
    state.wasmReady = false;
  };
  bridge.onProcessingStart = () => {
    state.isProcessing = true;
  };
  bridge.onResult = (result) => {
    state.isProcessing = false;
    state.result = result;
  };

  // Warnings from the current result (deferred features, etc.)
  const warnings = $derived.by<string[]>(() => {
    if (state.result?.status === 'ok') return state.result.warnings;
    return [];
  });

  // Hard upper bound on input size. Processing larger-than-1MB inputs
  // in the browser is a recipe for pegged CPU, unresponsive tabs, and
  // angry users — the CLI is the right tool for that job. This number
  // matches DESIGN.md §"Performance Strategy".
  const INPUT_SIZE_LIMIT_BYTES = 1_048_576;

  // TextEncoder measures the actual UTF-8 byte length, not the
  // code-unit length of the string, which matters for multibyte content.
  const inputByteLength = $derived.by<number>(() =>
    new TextEncoder().encode(state.input).length,
  );

  const inputTooLarge = $derived.by<boolean>(
    () => inputByteLength > INPUT_SIZE_LIMIT_BYTES,
  );

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  // Seed with a demo pipeline so first-time visitors see the killer feature
  // immediately. This is the motivating "unwrap soft-wrapped lines" pipeline.
  if (state.steps.length === 0) {
    state.input = `  My understanding of "done":
  A web interface where a user makes selections across audit dimensions, and the system generates a tailored LLM prompt.

  The riskiest assumption isn't the UI or the data model — it's whether dimension selections can actually produce good prompts. If the mapping from selections → prompt is weak, everything built on top of
   it is wasted.
`;
    state.steps.push({
      type: 'substitute',
      pattern: '^  ',
      replacement: '',
    });
    state.steps.push({
      type: 'substitute',
      mode: 'slurp',
      pattern: '(\\w) ?\\n (\\w)',
      replacement: '$1 $2',
    });
  }

  // The live processing loop: whenever input or steps change, ask the worker
  // to reprocess (debounced in the bridge). The result lands in state.result
  // via the onResult callback above.
  //
  // $effect runs after the component mounts and re-runs whenever any
  // tracked reactive read changes. Reading state.input and state.steps
  // inside this effect registers them as dependencies.
  $effect(() => {
    if (!state.wasmReady) return;

    // Enforce the browser-side size limit. For inputs over 1 MB we
    // bypass the worker entirely and surface a result-shaped error so
    // the user sees the oversize banner above the input pane and the
    // output pane stays empty. Clearing state.result would fight the
    // reactive $derived logic that drives the panes.
    if (inputTooLarge) {
      state.result = {
        status: 'error',
        kind: 'InputTooLarge',
        message: `Input is ${formatBytes(inputByteLength)}, which exceeds the ${formatBytes(
          INPUT_SIZE_LIMIT_BYTES,
        )} browser limit. For larger inputs, use the rexpipe CLI.`,
        hint: 'Export your pipeline as TOML and run it with `rexpipe --config pipeline.toml < input.txt`.',
      };
      return;
    }

    // Only include enabled steps that have a pattern (avoid noise errors
    // from half-typed steps with empty patterns).
    const enabledSteps = state.steps.filter(
      (s) => s.enabled !== false && s.pattern.length > 0,
    );

    if (enabledSteps.length === 0) {
      // Nothing to process — show the raw input as the final output.
      state.result = {
        status: 'ok',
        final_output: state.input,
        steps: [],
        warnings: [],
      };
      return;
    }

    // Deep-clone the step array to avoid sending reactive proxies across
    // the worker boundary. JSON.stringify inside the bridge will normalize
    // everything anyway, but proxies can confuse structured clone in some
    // browsers.
    const config: PipelineConfig = {
      step: JSON.parse(JSON.stringify(enabledSteps)),
    };

    bridge.processPipeline(state.input, config);
  });

  function onInputChange(newValue: string) {
    state.input = newValue;
  }
</script>

<div class="app-layout">
  <Header />

  {#if inputTooLarge}
    <aside class="size-limit" aria-label="Input size limit exceeded" role="alert">
      <span class="warning-icon" aria-hidden="true">⚠</span>
      <div class="warning-list">
        <div class="warning-item">
          <strong>Input too large for the browser:</strong>
          {formatBytes(inputByteLength)} exceeds the {formatBytes(INPUT_SIZE_LIMIT_BYTES)} limit.
        </div>
        <div class="warning-item">
          For larger inputs, use the rexpipe CLI:
          <code>rexpipe --config pipeline.toml &lt; input.txt</code>.
        </div>
      </div>
    </aside>
  {/if}

  <section class="top-panes">
    <TextPane
      label={leftPaneLabel()}
      value={leftPaneText()}
      placeholder="Type or paste your input text here…"
      onchange={onInputChange}
      readonly={state.selectedStepIndex !== null}
    />
    <TextPane
      label={rightPaneLabel()}
      value={rightPaneText()}
      highlights={rightPaneHighlights()}
      readonly
    />
  </section>

  <PipelineEditor />

  {#if warnings.length > 0}
    <aside class="warnings" aria-label="Pipeline warnings">
      <span class="warning-icon" aria-hidden="true">⚠</span>
      <div class="warning-list">
        {#each warnings as warning (warning)}
          <div class="warning-item">{warning}</div>
        {/each}
      </div>
    </aside>
  {/if}
</div>

<style>
  /* Desktop: grid layout that fills the viewport. The pipeline editor
   * gets slightly more vertical weight than the text panes (3fr vs 2fr)
   * because users spend most of their time in the editor — seeing step
   * type/mode/pattern/replacement fields matters more than a tall text
   * preview. minmax() floors prevent the regions from collapsing when
   * warnings appear. */
  .app-layout {
    display: grid;
    /* Header | size-limit (collapses to 0 when absent) | top panes | editor | warnings. */
    grid-template-rows: auto auto minmax(200px, 2fr) minmax(280px, 3fr) auto;
    gap: 8px;
    padding: 8px;
    padding: max(8px, env(safe-area-inset-top))
             max(8px, env(safe-area-inset-right))
             max(8px, env(safe-area-inset-bottom))
             max(8px, env(safe-area-inset-left));
    height: 100vh;
    background: var(--bg-primary);
  }

  .top-panes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    min-height: 0;
  }

  .size-limit {
    display: flex;
    gap: 10px;
    padding: 8px 12px;
    background: rgba(224, 120, 120, 0.1);
    border: 1px solid var(--error);
    border-radius: 4px;
    font-size: 12px;
    color: var(--error);
  }

  .size-limit code {
    background: var(--bg-editor);
    padding: 1px 6px;
    border-radius: 3px;
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .warnings {
    display: flex;
    gap: 10px;
    padding: 8px 12px;
    background: var(--warning-bg);
    border: 1px solid var(--warning-border);
    border-radius: 4px;
    font-size: 12px;
    color: var(--warning-text);
  }

  .warning-icon {
    font-size: 14px;
    line-height: 1.4;
    flex-shrink: 0;
  }

  .warning-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .warning-item {
    line-height: 1.4;
  }

  /* Mobile: stack everything vertically and let the page scroll.
   * At widths below 768px, trying to split the horizontal space across
   * two panes leaves each with ~140px of usable content — too narrow
   * to be legible. Stacking gives each pane the full width. */
  @media (max-width: 767px) {
    .app-layout {
      display: flex;
      flex-direction: column;
      height: auto;
      min-height: 100vh;
      padding: max(8px, env(safe-area-inset-top))
               max(8px, env(safe-area-inset-right))
               max(8px, env(safe-area-inset-bottom))
               max(8px, env(safe-area-inset-left));
    }

    .top-panes {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    /* Each text pane gets a minimum height so it's usable but can grow
     * when users click through the pipeline and the content is larger.
     * 42vh × 2 panes leaves room for the compact header and some of the
     * pipeline editor in the initial viewport. */
    :global(.top-panes > .pane) {
      min-height: 42vh;
      max-height: 60vh;
    }
  }

  /* Very small phones (iPhone SE, older Androids): smaller min-heights
   * because 42vh × 2 = 84vh leaves almost no room for the pipeline editor
   * header without scrolling. */
  @media (max-width: 400px) and (max-height: 700px) {
    :global(.top-panes > .pane) {
      min-height: 32vh;
      max-height: 50vh;
    }
  }
</style>
