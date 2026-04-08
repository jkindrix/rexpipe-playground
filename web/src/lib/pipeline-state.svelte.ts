// Shared reactive state for the rexpipe-playground.
//
// Uses Svelte 5 runes ($state, $derived) at module scope. The .svelte.ts
// extension is critical — it tells the Svelte compiler to process this
// file so runes work. Regular .ts files cannot use runes.
//
// Single source of truth for: the input text, the pipeline step configs,
// the most recent processing result, which step the user has selected
// for intermediate inspection, and WASM lifecycle status.

import type { ProcessOutcome, StepConfig, MatchPosition } from './types.js';

// ---------------------------------------------------------------------------
// Mutable state
// ---------------------------------------------------------------------------

/**
 * The canonical pipeline state. Components mutate these fields directly;
 * derived values (below) recompute automatically via Svelte 5's reactivity.
 */
export const state = $state<{
  /** The input text the user is processing */
  input: string;
  /** The list of pipeline steps */
  steps: StepConfig[];
  /** Which step is currently "inspected" — null = show final output */
  selectedStepIndex: number | null;
  /** The most recent processing outcome from the WASM bridge */
  result: ProcessOutcome | null;
  /** True while the worker is processing */
  isProcessing: boolean;
  /** True once the worker reports WASM has loaded */
  wasmReady: boolean;
  /** Populated if WASM failed to load */
  wasmError: string | null;
}>({
  input: '',
  steps: [],
  selectedStepIndex: null,
  result: null,
  isProcessing: false,
  wasmReady: false,
  wasmError: null,
});

// ---------------------------------------------------------------------------
// Derived views (the "killer feature" plumbing)
// ---------------------------------------------------------------------------
//
// Svelte 5 does not allow exporting `$derived` values directly from a module
// because the compiler can't track reactive dependencies across the module
// boundary. The workaround: export plain functions that read from `$state`
// and compute the derived value each time they're called. When called from
// a component's reactive context (script body, $derived, $effect, template
// expressions), Svelte's compiler wraps the read in a dependency.
//
// Callers use these like: `leftPaneText()` instead of `leftPaneText`.

/**
 * The text shown in the left (input) pane.
 *
 * - No step selected → the raw user input
 * - Step 0 selected → the raw user input (step 0's input IS the raw input)
 * - Step N>0 selected → the output of step N-1
 */
export function leftPaneText(): string {
  if (state.selectedStepIndex === null || state.selectedStepIndex === 0) {
    return state.input;
  }
  if (state.result?.status !== 'ok') return state.input;
  const prev = state.result.steps[state.selectedStepIndex - 1];
  return prev?.output ?? state.input;
}

/**
 * The text shown in the right (output) pane.
 *
 * - No step selected → the final output of the pipeline
 * - Step N selected → the output of step N
 */
export function rightPaneText(): string {
  if (state.result?.status !== 'ok') {
    if (state.result?.status === 'error') {
      return `[${state.result.kind}] ${state.result.message}${state.result.hint ? `\n\nHint: ${state.result.hint}` : ''}`;
    }
    return '';
  }
  if (state.selectedStepIndex === null) {
    return state.result.final_output;
  }
  const step = state.result.steps[state.selectedStepIndex];
  if (!step) return state.result.final_output;
  if (step.error) {
    return `[${step.error.kind}] ${step.error.message}${step.error.hint ? `\n\nHint: ${step.error.hint}` : ''}`;
  }
  return step.output;
}

/**
 * Match positions for highlighting in the right pane. Only populated when
 * a specific step is selected and that step ran successfully.
 */
export function rightPaneHighlights(): MatchPosition[] {
  if (state.selectedStepIndex === null) return [];
  if (state.result?.status !== 'ok') return [];
  const step = state.result.steps[state.selectedStepIndex];
  return step?.match_positions ?? [];
}

/**
 * The label shown above the left pane (reflects what's being shown).
 */
export function leftPaneLabel(): string {
  if (state.selectedStepIndex === null) return 'Input';
  if (state.selectedStepIndex === 0) return 'Input (step 1 sees this)';
  return `Output of step ${state.selectedStepIndex} (step ${state.selectedStepIndex + 1} sees this)`;
}

/**
 * The label shown above the right pane.
 */
export function rightPaneLabel(): string {
  if (state.selectedStepIndex === null) return 'Final Output';
  return `After step ${state.selectedStepIndex + 1}`;
}

// ---------------------------------------------------------------------------
// State helpers (pure functions that mutate `state`)
// ---------------------------------------------------------------------------

/**
 * Add a new empty substitute step at the end of the pipeline.
 */
export function addStep(): void {
  state.steps.push({
    type: 'substitute',
    pattern: '',
    replacement: '',
  });
}

/**
 * Remove the step at the given index.
 */
export function removeStep(index: number): void {
  state.steps.splice(index, 1);
  // Adjust selection if the removed step was selected or earlier
  if (state.selectedStepIndex !== null) {
    if (state.selectedStepIndex === index) {
      state.selectedStepIndex = null;
    } else if (state.selectedStepIndex > index) {
      state.selectedStepIndex -= 1;
    }
  }
}

/**
 * Move the step at the given index up or down by one position.
 */
export function moveStep(index: number, delta: -1 | 1): void {
  const target = index + delta;
  if (target < 0 || target >= state.steps.length) return;
  const tmp = state.steps[index];
  state.steps[index] = state.steps[target];
  state.steps[target] = tmp;
  // Adjust selection to follow the moved step
  if (state.selectedStepIndex === index) {
    state.selectedStepIndex = target;
  } else if (state.selectedStepIndex === target) {
    state.selectedStepIndex = index;
  }
}

/**
 * Select a step for inspection. Pass null to clear selection and show
 * the final pipeline output.
 */
export function selectStep(index: number | null): void {
  state.selectedStepIndex = index;
}
