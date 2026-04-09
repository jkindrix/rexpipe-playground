<script lang="ts">
  import type { StepConfig, StepIntermediateResult } from '../lib/types';
  import {
    removeStep,
    moveStep,
    selectStep,
    toggleStepEnabled,
    state,
  } from '../lib/pipeline-state.svelte';
  import PatternField from './PatternField.svelte';

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
  const isDisabled = $derived(step.enabled === false);
  // `block` steps round-trip through the playground (imported from
  // TOML, exported back out intact) but aren't editable in the UI —
  // the action shape is complex enough that a dedicated editor is
  // deferred. Show an explicit "unsupported" indicator instead of
  // rendering broken default fields.
  const isBlockStep = $derived(step.type === 'block');

  // Schema-driven dropdown options (fallback to hardcoded defaults while
  // the schema is loading)
  const stepTypes = $derived(
    state.schema?.step_types.filter((t) => t !== 'block') ?? [
      'substitute', 'filter', 'extract', 'transform', 'validate',
    ],
  );
  const processingModes = $derived(
    state.schema?.processing_modes ?? ['line', 'slurp', 'paragraph'],
  );
  const filterActions = $derived(
    state.schema?.filter_actions ?? [
      'keep_line', 'drop_line', 'keep_match', 'drop_match', 'deduplicate_by_prefix',
    ],
  );
  const transformActions = $derived(
    state.schema?.transform_actions ?? [
      'uppercase', 'lowercase', 'trim', 'title_case',
    ],
  );
  const extractFormats = $derived(
    state.schema?.extract_output_formats ?? ['text', 'json', 'jsonl', 'csv'],
  );

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

  function onPatternChange(value: string) {
    step.pattern = value;
  }

  function onReplacementChange(value: string) {
    step.replacement = value;
  }

  function onActionChange(e: Event) {
    step.action = (e.target as HTMLSelectElement).value as StepConfig['action'];
  }

  function onTransformActionChange(e: Event) {
    step.transform_action = (e.target as HTMLSelectElement).value as StepConfig['transform_action'];
  }

  function onOutputFormatChange(e: Event) {
    step.output_format = (e.target as HTMLSelectElement).value as StepConfig['output_format'];
  }

  function onToggleEnabled(e: Event) {
    e.stopPropagation();
    toggleStepEnabled(index);
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

<div class="step-card" class:selected={isSelected} class:error={hasError} class:disabled={isDisabled}>
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
      <input
        type="checkbox"
        class="enable-toggle"
        checked={!isDisabled}
        onchange={onToggleEnabled}
        onclick={(e) => e.stopPropagation()}
        aria-label={isDisabled ? 'Enable step' : 'Disable step'}
        title={isDisabled ? 'Enable step' : 'Disable step'}
      />
      <span class="step-number">#{index + 1}</span>
      <span class="step-type-label">{step.type}</span>
      {#if isBlockStep}
        <span class="badge error-badge" title="Block steps aren't editable in the playground yet — they still process correctly and round-trip through import/export.">unsupported</span>
      {:else if isDisabled}
        <span class="badge muted">disabled</span>
      {:else if result}
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
    {#if isBlockStep}
      <div class="step-error">
        <strong>Block step not editable.</strong>
        The playground preserves imported block steps for round-trip
        export but doesn't yet provide an editor for them. To modify
        this step, edit the TOML config directly and re-import, or
        delete the step and rebuild using supported step types.
      </div>
    {:else}
    <div class="field-row">
      <label>
        <span class="label-text">Type</span>
        <select value={step.type} onchange={onTypeChange}>
          {#each stepTypes as t (t)}
            <option value={t}>{t}</option>
          {/each}
        </select>
      </label>
      <label>
        <span class="label-text">Mode</span>
        <select value={step.mode ?? 'line'} onchange={onModeChange}>
          {#each processingModes as m (m)}
            <option value={m}>{m}</option>
          {/each}
        </select>
      </label>
    </div>

    <div class="field-full">
      <span class="label-text">Pattern</span>
      <PatternField
        value={step.pattern}
        placeholder="regex pattern"
        onchange={onPatternChange}
      />
    </div>

    {#if step.type === 'substitute'}
      <div class="field-full">
        <span class="label-text">Replacement</span>
        <PatternField
          value={step.replacement ?? ''}
          placeholder="replacement string ($1, $2, …)"
          onchange={onReplacementChange}
          validate={false}
        />
      </div>
    {/if}

    {#if step.type === 'filter'}
      <label class="field-full">
        <span class="label-text">Action</span>
        <select value={step.action ?? 'keep_line'} onchange={onActionChange}>
          {#each filterActions as a (a)}
            <option value={a}>{a}</option>
          {/each}
        </select>
      </label>
    {/if}

    {#if step.type === 'transform'}
      <label class="field-full">
        <span class="label-text">Transform</span>
        <select value={step.transform_action ?? 'uppercase'} onchange={onTransformActionChange}>
          {#each transformActions as a (a)}
            <option value={a}>{a}</option>
          {/each}
        </select>
      </label>
    {/if}

    {#if step.type === 'extract'}
      <label class="field-full">
        <span class="label-text">Output Format</span>
        <select value={step.output_format ?? 'text'} onchange={onOutputFormatChange}>
          {#each extractFormats as f (f)}
            <option value={f}>{f}</option>
          {/each}
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

  .step-card.disabled {
    opacity: 0.55;
  }

  .step-card.disabled .step-body {
    pointer-events: none;
  }

  .enable-toggle {
    margin: 0;
    cursor: pointer;
    accent-color: var(--accent-blue);
    flex-shrink: 0;
    /* Larger checkbox so it's usable without squinting */
    width: 18px;
    height: 18px;
  }

  /* Mobile: expand the checkbox hit area with padding. The visible
   * checkbox stays the same size (so it looks normal next to the badges)
   * but the clickable zone grows to 44×44. box-shadow creates a visible
   * hit area hint on focus without changing layout. */
  @media (max-width: 767px) {
    .enable-toggle {
      width: 24px;
      height: 24px;
      /* Padding doesn't work well on checkbox itself; use min dimensions
       * via the surrounding cell. The extra space comes from the parent
       * flex gap. */
    }
  }

  .step-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    cursor: pointer;
    border-bottom: 1px solid var(--border);
    user-select: none;
    min-height: var(--touch-target-desktop);
  }

  /* Mobile: taller header for comfortable tap, also more breathing room
   * between the step info and the action buttons */
  @media (max-width: 767px) {
    .step-header {
      padding: 10px 12px;
      min-height: var(--touch-target);
      gap: 10px;
    }
  }

  .step-header:focus-visible {
    outline: 2px solid var(--accent-blue);
    outline-offset: -2px;
  }

  .step-info {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: nowrap;
    min-width: 0;
    flex: 1;
    overflow: hidden;
  }

  .step-number {
    font-family: var(--font-mono);
    color: var(--text-muted);
    font-weight: 600;
    flex-shrink: 0;
  }

  .step-type-label {
    font-weight: 600;
    color: var(--text-primary);
    text-transform: capitalize;
    flex-shrink: 0;
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
    white-space: nowrap;
    flex-shrink: 0;
  }

  /* Mobile: drop the secondary "lines" badge when space is tight.
   * The match count is the most important signal; the lines count
   * is nice-to-have and available again when the step is selected
   * because it's visible in the Stats section of the intermediate panes. */
  @media (max-width: 559px) {
    .badge.muted {
      display: none;
    }
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
    padding: 4px 8px;
    font-size: 14px;
    font-family: var(--font-mono);
    /* Desktop baseline: comfortable click target without dominating the card */
    min-width: 30px;
    min-height: 28px;
  }

  /* Mobile: 44×44 minimum per WCAG 2.5.5 */
  @media (max-width: 767px) {
    .step-actions button {
      min-width: 44px;
      min-height: 44px;
      font-size: 18px;
      padding: 0;
    }
    .step-actions {
      gap: 6px;
    }
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
