<script lang="ts">
  import StepCard from './StepCard.svelte';
  import { state, addStep } from '../lib/pipeline-state.svelte';

  const stepResults = $derived.by(() => {
    if (state.result?.status !== 'ok') return [];
    return state.result.steps;
  });
</script>

<section class="pipeline-editor">
  <div class="editor-header">
    <h2>Pipeline</h2>
    <div class="editor-actions">
      <span class="step-count">
        {state.steps.length} {state.steps.length === 1 ? 'step' : 'steps'}
      </span>
      <button type="button" class="primary" onclick={addStep}>+ Add Step</button>
    </div>
  </div>

  {#if state.steps.length === 0}
    <div class="empty-state">
      <p>No steps yet. Click <strong>+ Add Step</strong> to get started.</p>
      <p class="hint">
        Each step is a regex operation. Steps run in order, and you can click
        any step to see its input and output in the panes above.
      </p>
    </div>
  {:else}
    <div class="step-list">
      {#each state.steps as step, i (i)}
        <StepCard
          {step}
          index={i}
          totalSteps={state.steps.length}
          result={stepResults[i]}
        />
      {/each}
    </div>
  {/if}
</section>

<style>
  .pipeline-editor {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }

  .editor-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--bg-step);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .editor-header h2 {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0;
  }

  .editor-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .step-count {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .step-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .empty-state {
    padding: 32px;
    text-align: center;
    color: var(--text-muted);
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .empty-state p {
    margin: 0;
  }

  .empty-state strong {
    color: var(--text-primary);
  }

  .empty-state .hint {
    font-size: 12px;
    max-width: 400px;
  }
</style>
