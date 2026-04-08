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
    gap: 12px;
    padding: 10px 16px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 4px;
    /* On mobile the header is sticky so the status indicator stays
     * visible while the user scrolls through long pipelines. On desktop
     * this has no effect because the layout doesn't scroll. */
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .title-group {
    display: flex;
    align-items: baseline;
    gap: 12px;
    min-width: 0;
    flex: 1;
  }

  h1 {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .subtitle {
    font-size: 12px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .status-text {
    white-space: nowrap;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  /* Mobile: compact header. Subtitle hides below 560px to make room
   * for the title + status on one line. Padding shrinks to recover
   * vertical space for the actual app. */
  @media (max-width: 767px) {
    header {
      padding: 10px 12px;
    }
  }

  @media (max-width: 559px) {
    .subtitle {
      display: none;
    }
    h1 {
      font-size: 16px;
    }
    .status-text {
      /* At really narrow widths, the status dot is enough — label drops */
      display: none;
    }
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
