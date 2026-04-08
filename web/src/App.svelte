<script lang="ts">
  import Header from './components/Header.svelte';
  import TextPane from './components/TextPane.svelte';
  import PipelineEditor from './components/PipelineEditor.svelte';
  import {
    state,
    leftPaneText,
    rightPaneText,
    leftPaneLabel,
    rightPaneLabel,
  } from './lib/pipeline-state.svelte';
  import { bridge } from './lib/wasm-bridge';
  import type { PipelineConfig } from './lib/types';

  // Wire up WASM lifecycle callbacks once, on component mount.
  bridge.onReady = () => {
    state.wasmReady = true;
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
      readonly
    />
  </section>

  <PipelineEditor />
</div>

<style>
  .app-layout {
    display: grid;
    grid-template-rows: auto 1fr 1fr;
    gap: 8px;
    padding: 8px;
    height: 100vh;
    background: var(--bg-primary);
  }

  .top-panes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    min-height: 0;
  }
</style>
