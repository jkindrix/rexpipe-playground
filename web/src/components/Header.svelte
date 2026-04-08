<script lang="ts">
  import { state } from '../lib/pipeline-state.svelte';

  const statusClass = $derived.by(() => {
    if (state.wasmError) return 'error';
    if (!state.wasmReady) return 'loading';
    if (state.isProcessing) return 'busy';
    return 'ready';
  });

  const statusText = $derived.by(() => {
    if (state.wasmError) return `WASM load error: ${state.wasmError}`;
    if (!state.wasmReady) return 'Loading WASM module…';
    if (state.isProcessing) return 'Processing…';
    return 'Ready';
  });
</script>

<header>
  <div class="title-group">
    <h1>rexpipe playground</h1>
    <span class="subtitle">multi-step regex pipelines, live in your browser</span>
  </div>
  <div class="status">
    <span class="dot {statusClass}" aria-hidden="true"></span>
    <span class="status-text">{statusText}</span>
  </div>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  .title-group {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }

  h1 {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .subtitle {
    font-size: 12px;
    color: var(--text-muted);
  }

  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dot.loading {
    background: var(--accent-orange);
    animation: pulse 1s ease-in-out infinite;
  }

  .dot.ready {
    background: var(--success);
  }

  .dot.busy {
    background: var(--accent-blue);
    animation: pulse 0.6s ease-in-out infinite;
  }

  .dot.error {
    background: var(--error);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
</style>
