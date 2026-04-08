<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { EditorState } from '@codemirror/state';
  import { EditorView } from '@codemirror/view';
  import { textPaneExtensions } from '../lib/codemirror-setup';
  import {
    highlightField,
    setHighlights,
  } from '../lib/highlight-extension';
  import type { MatchPosition } from '../lib/types';

  interface Props {
    label: string;
    value: string;
    readonly?: boolean;
    placeholder?: string;
    highlights?: MatchPosition[];
    onchange?: (value: string) => void;
  }

  let {
    label,
    value,
    readonly = false,
    placeholder = '',
    highlights = [],
    onchange,
  }: Props = $props();

  let editorEl: HTMLDivElement;
  let view: EditorView | null = null;

  // Flag to prevent re-entrant updates: when we programmatically update
  // the editor's content from an external prop change, the update handler
  // fires, but we don't want to ping onchange in that case.
  let suppressOnChange = false;

  onMount(() => {
    if (!editorEl) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !suppressOnChange) {
        const newValue = update.state.doc.toString();
        onchange?.(newValue);
      }
    });

    view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          ...textPaneExtensions({
            readonly,
            extraExtensions: [highlightField],
          }),
          updateListener,
        ],
      }),
      parent: editorEl,
    });

    // Apply any initial highlights that were passed before mount
    if (highlights.length > 0) {
      setHighlights(view, highlights);
    }

    return () => {
      view?.destroy();
      view = null;
    };
  });

  // When the highlights prop changes, dispatch the effect. This runs after
  // the content-sync effect below, so the highlights always reflect the
  // current doc.
  $effect(() => {
    if (!view) return;
    setHighlights(view, highlights);
  });

  // When the external value prop changes (e.g., after selecting a step and
  // the derived pane text updates), sync the editor content. We only do
  // this when the value actually differs from the editor's current doc
  // to avoid infinite loops with the updateListener above.
  $effect(() => {
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;

    suppressOnChange = true;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
    suppressOnChange = false;
  });

  onDestroy(() => {
    view?.destroy();
    view = null;
  });
</script>

<div class="pane">
  <div class="pane-header">
    <h2>{label}</h2>
    <span class="char-count" aria-label="character count">
      {value.length} chars
    </span>
  </div>
  <div class="editor-host" bind:this={editorEl} aria-label={label} data-placeholder={placeholder}></div>
</div>

<style>
  .pane {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }

  .pane-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background: var(--bg-step);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  h2 {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0;
  }

  .char-count {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .editor-host {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* Make the CodeMirror root fill the available space */
  .editor-host :global(.cm-editor) {
    height: 100%;
  }
</style>
