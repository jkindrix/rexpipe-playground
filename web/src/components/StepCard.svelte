<script lang="ts">
  import type { StepConfig, StepIntermediateResult } from '../lib/types';
  import {
    removeStep,
    moveStep,
    selectStep,
    state,
  } from '../lib/pipeline-state.svelte';

  interface Props {
    step: StepConfig;
    index: number;
    totalSteps: number;
    result: StepIntermediateResult | undefined;
  }

  let { step, index, totalSteps, result }: Props = $props();

  const isSelected = $derived(state.selectedStepIndex === index);
  const matches = $derived(result?.matches ?? 0);
  const hasError = $derived(result?.error != null);

  function onTypeChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    step.type = target.value as StepConfig['type'];
    // Reset fields that don't apply to the new type
    if (step.type !== 'substitute') step.replacement = undefined;
    if (step.type !== 'filter') step.action = undefined;
    if (step.type !== 'transform') step.transform_action = undefined;
  }

  function onModeChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    const value = target.value;
    step.mode = value === 'line' ? undefined : (value as StepConfig['mode']);
  }

  function onPatternChange(e: Event) {
    step.pattern = (e.target as HTMLInputElement).value;
  }

  function onReplacementChange(e: Event) {
    step.replacement = (e.target as HTMLInputElement).value;
  }

  function onActionChange(e: Event) {
    step.action = (e.target as HTMLSelectElement).value as StepConfig['action'];
  }

  function onHeaderClick() {
    if (isSelected) {
      selectStep(null);
    } else {
      selectStep(index);
    }
  }

  function onHeaderKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onHeaderClick();
    }
  }

  function handleMoveUp(e: Event) {
    e.stopPropagation();
    moveStep(index, -1);
  }

  function handleMoveDown(e: Event) {
    e.stopPropagation();
    moveStep(index, 1);
  }

  function handleRemove(e: Event) {
    e.stopPropagation();
    removeStep(index);
  }
</script>

<div class="step-card" class:selected={isSelected} class:error={hasError}>
  <!-- Header (clickable to select for inspection) -->
  <div
    class="step-header"
    onclick={onHeaderClick}
    onkeydown={onHeaderKeydown}
    role="button"
    tabindex="0"
    aria-pressed={isSelected}
    aria-label="Select step {index + 1} for inspection"
  >
    <div class="step-info">
      <span class="step-number">#{index + 1}</span>
      <span class="step-type-label">{step.type}</span>
      {#if result}
        {#if hasError}
          <span class="badge error-badge">error</span>
        {:else}
          <span class="badge">{matches} {matches === 1 ? 'match' : 'matches'}</span>
          <span class="badge muted">{result.lines_in} → {result.lines_out} lines</span>
        {/if}
      {/if}
    </div>
    <div class="step-actions">
      <button
        type="button"
        disabled={index === 0}
        onclick={handleMoveUp}
        aria-label="Move step up"
        title="Move up"
      >↑</button>
      <button
        type="button"
        disabled={index === totalSteps - 1}
        onclick={handleMoveDown}
        aria-label="Move step down"
        title="Move down"
      >↓</button>
      <button
        type="button"
        class="danger"
        onclick={handleRemove}
        aria-label="Delete step"
        title="Delete step"
      >×</button>
    </div>
  </div>

  <!-- Body (editable fields) -->
  <div class="step-body">
    <div class="field-row">
      <label>
        <span class="label-text">Type</span>
        <select value={step.type} onchange={onTypeChange}>
          <option value="substitute">substitute</option>
          <option value="filter">filter</option>
          <option value="extract">extract</option>
          <option value="transform">transform</option>
          <option value="validate">validate</option>
        </select>
      </label>
      <label>
        <span class="label-text">Mode</span>
        <select value={step.mode ?? 'line'} onchange={onModeChange}>
          <option value="line">line</option>
          <option value="slurp">slurp</option>
          <option value="paragraph">paragraph</option>
        </select>
      </label>
    </div>

    <label class="field-full">
      <span class="label-text">Pattern</span>
      <input
        type="text"
        value={step.pattern}
        oninput={onPatternChange}
        placeholder="regex pattern"
        spellcheck="false"
        autocomplete="off"
      />
    </label>

    {#if step.type === 'substitute'}
      <label class="field-full">
        <span class="label-text">Replacement</span>
        <input
          type="text"
          value={step.replacement ?? ''}
          oninput={onReplacementChange}
          placeholder="replacement string ($1, $2, ...)"
          spellcheck="false"
          autocomplete="off"
        />
      </label>
    {/if}

    {#if step.type === 'filter'}
      <label class="field-full">
        <span class="label-text">Action</span>
        <select value={step.action ?? 'keep_line'} onchange={onActionChange}>
          <option value="keep_line">keep_line</option>
          <option value="drop_line">drop_line</option>
          <option value="keep_match">keep_match</option>
          <option value="drop_match">drop_match</option>
          <option value="deduplicate_by_prefix">deduplicate_by_prefix</option>
        </select>
      </label>
    {/if}

    {#if result?.error}
      <div class="step-error">
        <strong>{result.error.kind}:</strong> {result.error.message}
        {#if result.error.hint}
          <div class="hint">Hint: {result.error.hint}</div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .step-card {
    background: var(--bg-step);
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
    transition: border-color 0.15s, background 0.15s;
  }

  .step-card:hover {
    background: var(--bg-step-hover);
  }

  .step-card.selected {
    border-color: var(--border-selected);
    background: var(--bg-step-selected);
  }

  .step-card.error {
    border-left: 3px solid var(--error);
  }

  .step-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    cursor: pointer;
    border-bottom: 1px solid var(--border);
    user-select: none;
  }

  .step-header:focus-visible {
    outline: 2px solid var(--accent-blue);
    outline-offset: -2px;
  }

  .step-info {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    min-width: 0;
  }

  .step-number {
    font-family: var(--font-mono);
    color: var(--text-muted);
    font-weight: 600;
  }

  .step-type-label {
    font-weight: 600;
    color: var(--text-primary);
    text-transform: capitalize;
  }

  .badge {
    display: inline-block;
    padding: 2px 8px;
    background: var(--bg-editor);
    border: 1px solid var(--border);
    border-radius: 10px;
    font-size: 11px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
  }

  .badge.muted {
    color: var(--text-muted);
  }

  .badge.error-badge {
    background: rgba(224, 120, 120, 0.15);
    border-color: var(--error);
    color: var(--error);
  }

  .step-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .step-actions button {
    padding: 2px 8px;
    font-size: 13px;
    font-family: var(--font-mono);
  }

  .step-body {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .field-row {
    display: flex;
    gap: 8px;
  }

  .field-row label {
    flex: 1;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .label-text {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .step-error {
    padding: 8px 10px;
    background: rgba(224, 120, 120, 0.1);
    border-left: 3px solid var(--error);
    border-radius: 3px;
    font-size: 12px;
    color: var(--error);
  }

  .hint {
    margin-top: 4px;
    color: var(--text-secondary);
  }
</style>
