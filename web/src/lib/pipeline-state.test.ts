// Unit tests for pipeline-state helpers.
//
// These tests exercise the pure-ish state mutation functions that sit
// between user actions in the UI and the reactive `state` object. They
// deliberately avoid mounting any components — the selector functions
// (leftPaneText/rightPaneText/rightPaneHighlights) are driven directly
// by mutating `state`, and the helpers (addStep/removeStep/moveStep/
// selectStep/toggleStepEnabled) are verified by checking `state` after
// each call.
//
// The file lives alongside the module under test (`pipeline-state.svelte.ts`)
// and uses a `.test.ts` extension so Vitest's `include` glob picks it up.
//
// Why this file matters: Phase 3 (import/export) will heavily touch the
// state layer — import merges incoming steps into existing state, URL
// deserialization reconstructs state from a hash fragment. Without this
// baseline, it's easy to introduce subtle selector-index bugs when the
// state shape changes.

import { describe, it, expect, beforeEach } from 'vitest';

import {
  state,
  addStep,
  removeStep,
  moveStep,
  selectStep,
  toggleStepEnabled,
  leftPaneText,
  rightPaneText,
  rightPaneHighlights,
  leftPaneLabel,
  rightPaneLabel,
} from './pipeline-state.svelte';
import type { ProcessOutcome } from './types';

// Reset `state` back to its initial shape before every test. Because
// `state` is module-scoped and persists across tests, one test's
// mutations would otherwise leak into the next. We mutate in place
// rather than reassigning the reference, which would break Svelte 5
// runes' reactivity tracking.
function resetState(): void {
  state.input = '';
  state.steps.length = 0;
  state.selectedStepIndex = null;
  state.result = null;
  state.isProcessing = false;
  state.wasmReady = false;
  state.wasmError = null;
  state.schema = null;
}

beforeEach(resetState);

// Helper: construct a "successful" ProcessOutcome that has N steps with
// predictable, distinguishable outputs so selectors can be tested.
function mockResult(stepOutputs: string[], finalOutput?: string): ProcessOutcome {
  return {
    status: 'ok',
    final_output: finalOutput ?? stepOutputs[stepOutputs.length - 1] ?? '',
    steps: stepOutputs.map((output, i) => ({
      output,
      matches: i + 1,
      match_positions: [],
      captures: [],
      lines_in: 10,
      lines_out: 10 - i,
      error: null,
    })),
    warnings: [],
  };
}

describe('addStep', () => {
  it('appends an empty substitute step to an empty pipeline', () => {
    addStep();
    expect(state.steps).toHaveLength(1);
    expect(state.steps[0]).toEqual({
      type: 'substitute',
      pattern: '',
      replacement: '',
    });
  });

  it('appends to the end of an existing pipeline', () => {
    state.steps.push({ type: 'filter', pattern: 'foo' });
    addStep();
    expect(state.steps).toHaveLength(2);
    // Added step sits at index 1 (end), original step unchanged at 0.
    expect(state.steps[0].type).toBe('filter');
    expect(state.steps[1].type).toBe('substitute');
  });
});

describe('removeStep', () => {
  beforeEach(() => {
    state.steps.push(
      { type: 'substitute', pattern: 'a' },
      { type: 'filter', pattern: 'b' },
      { type: 'transform', pattern: 'c' },
    );
  });

  it('removes the step at the given index', () => {
    removeStep(1);
    expect(state.steps).toHaveLength(2);
    expect(state.steps.map((s) => s.pattern)).toEqual(['a', 'c']);
  });

  it('clears selectedStepIndex when the selected step is removed', () => {
    state.selectedStepIndex = 1;
    removeStep(1);
    expect(state.selectedStepIndex).toBeNull();
  });

  it('decrements selectedStepIndex when an earlier step is removed', () => {
    // User is inspecting step 2 (transform), and we remove step 0.
    // The same physical step should stay inspected, but its new index is 1.
    state.selectedStepIndex = 2;
    removeStep(0);
    expect(state.selectedStepIndex).toBe(1);
    expect(state.steps[1].pattern).toBe('c');
  });

  it('leaves selectedStepIndex alone when a later step is removed', () => {
    state.selectedStepIndex = 0;
    removeStep(2);
    expect(state.selectedStepIndex).toBe(0);
  });
});

describe('moveStep', () => {
  beforeEach(() => {
    state.steps.push(
      { type: 'substitute', pattern: 'a' },
      { type: 'filter', pattern: 'b' },
      { type: 'transform', pattern: 'c' },
    );
  });

  it('swaps with the previous step when delta is -1', () => {
    moveStep(1, -1);
    expect(state.steps.map((s) => s.pattern)).toEqual(['b', 'a', 'c']);
  });

  it('swaps with the next step when delta is +1', () => {
    moveStep(1, 1);
    expect(state.steps.map((s) => s.pattern)).toEqual(['a', 'c', 'b']);
  });

  it('is a no-op when moving above the start of the pipeline', () => {
    const snapshot = state.steps.map((s) => s.pattern);
    moveStep(0, -1);
    expect(state.steps.map((s) => s.pattern)).toEqual(snapshot);
  });

  it('is a no-op when moving past the end of the pipeline', () => {
    const snapshot = state.steps.map((s) => s.pattern);
    moveStep(2, 1);
    expect(state.steps.map((s) => s.pattern)).toEqual(snapshot);
  });

  it('updates selectedStepIndex to follow the moved step', () => {
    state.selectedStepIndex = 0;
    moveStep(0, 1);
    // The step the user was inspecting moved to index 1, so the selection
    // should follow it rather than stay pinned to a different step.
    expect(state.selectedStepIndex).toBe(1);
    expect(state.steps[1].pattern).toBe('a');
  });

  it('swaps selection with the step being displaced', () => {
    // The user is inspecting step 0, we move step 1 up into position 0.
    // The step at position 0 (which was the user's selection) now lives
    // at position 1 — selection should follow.
    state.selectedStepIndex = 0;
    moveStep(1, -1);
    expect(state.selectedStepIndex).toBe(1);
    expect(state.steps[1].pattern).toBe('a');
  });
});

describe('selectStep', () => {
  it('sets selectedStepIndex to the given index', () => {
    selectStep(2);
    expect(state.selectedStepIndex).toBe(2);
  });

  it('clears the selection when passed null', () => {
    state.selectedStepIndex = 0;
    selectStep(null);
    expect(state.selectedStepIndex).toBeNull();
  });
});

describe('step.flags round-trip', () => {
  it('preserves flags when the step type is mutated in place', () => {
    // Simulate a user setting flags on a substitute step, then
    // switching its type to filter. The type-change handler in
    // StepCard resets replacement/action/transform_action fields
    // but must NOT reset flags — they're valid for every step type.
    state.steps.push({
      type: 'substitute',
      pattern: '[A-Z]+',
      replacement: 'x',
      flags: ['case_insensitive', 'multiline'],
    });

    // Simulate the type change (mirrors onTypeChange in StepCard).
    const step = state.steps[0];
    step.type = 'filter';
    step.replacement = undefined;
    step.action = 'keep_line';

    expect(step.flags).toEqual(['case_insensitive', 'multiline']);
  });
});

describe('toggleStepEnabled', () => {
  beforeEach(() => {
    state.steps.push({ type: 'substitute', pattern: 'a' });
  });

  it('disables an enabled step (undefined → false)', () => {
    // When enabled is undefined it's treated as enabled; first toggle
    // should disable explicitly.
    expect(state.steps[0].enabled).toBeUndefined();
    toggleStepEnabled(0);
    expect(state.steps[0].enabled).toBe(false);
  });

  it('re-enables a disabled step (false → true)', () => {
    state.steps[0].enabled = false;
    toggleStepEnabled(0);
    expect(state.steps[0].enabled).toBe(true);
  });

  it('disables an explicitly-enabled step (true → false)', () => {
    state.steps[0].enabled = true;
    toggleStepEnabled(0);
    expect(state.steps[0].enabled).toBe(false);
  });

  it('does nothing when the index is out of range', () => {
    expect(() => toggleStepEnabled(99)).not.toThrow();
  });
});

describe('selector functions (the killer-feature plumbing)', () => {
  beforeEach(() => {
    state.input = 'RAW INPUT';
    state.steps.push(
      { type: 'substitute', pattern: 'a' },
      { type: 'substitute', pattern: 'b' },
      { type: 'substitute', pattern: 'c' },
    );
    state.result = mockResult(['after-step-0', 'after-step-1', 'after-step-2'], 'FINAL');
  });

  it('leftPaneText returns raw input when no step is selected', () => {
    state.selectedStepIndex = null;
    expect(leftPaneText()).toBe('RAW INPUT');
  });

  it('leftPaneText returns raw input when step 0 is selected (step 0 sees raw input)', () => {
    state.selectedStepIndex = 0;
    expect(leftPaneText()).toBe('RAW INPUT');
  });

  it('leftPaneText returns the output of step N-1 when step N is selected', () => {
    state.selectedStepIndex = 1;
    expect(leftPaneText()).toBe('after-step-0');
    state.selectedStepIndex = 2;
    expect(leftPaneText()).toBe('after-step-1');
  });

  it('rightPaneText returns the final output when no step is selected', () => {
    state.selectedStepIndex = null;
    expect(rightPaneText()).toBe('FINAL');
  });

  it('rightPaneText returns the output of step N when step N is selected', () => {
    state.selectedStepIndex = 0;
    expect(rightPaneText()).toBe('after-step-0');
    state.selectedStepIndex = 2;
    expect(rightPaneText()).toBe('after-step-2');
  });

  it('rightPaneText surfaces bridge-level errors', () => {
    state.result = {
      status: 'error',
      kind: 'PipelineBuildError',
      message: 'step 1 pattern is invalid',
      hint: 'check the regex',
    };
    state.selectedStepIndex = null;
    const out = rightPaneText();
    expect(out).toContain('PipelineBuildError');
    expect(out).toContain('step 1 pattern is invalid');
    expect(out).toContain('check the regex');
  });

  it('rightPaneText surfaces per-step errors', () => {
    state.result = {
      status: 'ok',
      final_output: '',
      steps: [
        {
          output: '',
          matches: 0,
          match_positions: [],
          captures: [],
          lines_in: 0,
          lines_out: 0,
          error: {
            kind: 'MemoryLimit',
            step_index: 0,
            message: 'slurp buffer exceeded',
            hint: null,
            field: null,
          },
        },
      ],
      warnings: [],
    };
    state.selectedStepIndex = 0;
    const out = rightPaneText();
    expect(out).toContain('MemoryLimit');
    expect(out).toContain('slurp buffer exceeded');
  });

  it('rightPaneHighlights is empty when no step is selected', () => {
    state.selectedStepIndex = null;
    expect(rightPaneHighlights()).toEqual([]);
  });

  it('rightPaneHighlights returns the selected step match positions', () => {
    const positions = [{ start: 0, end: 3, text: 'foo' }];
    if (state.result?.status === 'ok') {
      state.result.steps[1].match_positions = positions;
    }
    state.selectedStepIndex = 1;
    expect(rightPaneHighlights()).toEqual(positions);
  });

  it('labels reflect which step is being inspected', () => {
    state.selectedStepIndex = null;
    expect(leftPaneLabel()).toBe('Input');
    expect(rightPaneLabel()).toBe('Final Output');

    state.selectedStepIndex = 0;
    expect(leftPaneLabel()).toBe('Input (step 1 sees this)');
    expect(rightPaneLabel()).toBe('After step 1');

    state.selectedStepIndex = 1;
    expect(leftPaneLabel()).toBe('Output of step 1 (step 2 sees this)');
    expect(rightPaneLabel()).toBe('After step 2');
  });
});
