<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { EditorState } from '@codemirror/state';
  import { EditorView } from '@codemirror/view';
  import { patternFieldExtensions } from '../lib/codemirror-setup';
  import { bridge } from '../lib/wasm-bridge';
  import { state as pipelineState } from '../lib/pipeline-state.svelte';
  import type { RegexFlag, ValidatePatternResponse } from '../lib/types';

  interface Props {
    value: string;
    placeholder?: string;
    onchange?: (value: string) => void;
    /**
     * When false, skip the `validate_pattern` WASM call — use this for
     * fields that are not regex patterns (e.g., replacement strings).
     * Default: true.
     */
    validate?: boolean;
    /**
     * Regex flags that should be applied when compiling the pattern for
     * validation. Passing the step's current flags here means the
     * pass/fail indicator reflects the actual compile that will happen
     * at pipeline run time, not a flagless compile that would miss
     * flag-specific errors like `(?x)` extended syntax validation.
     *
     * Optional — defaults to no flags. Omit for non-pattern fields.
     */
    flags?: RegexFlag[];
  }

  let {
    value,
    placeholder = 'regex pattern',
    onchange,
    validate = true,
    flags = [],
  }: Props = $props();

  let editorEl: HTMLDivElement;
  let view: EditorView | null = null;
  let validation: ValidatePatternResponse | null = $state(null);
  let validationTimer: number | null = null;
  let suppressOnChange = false;

  // Validate after the user stops typing for 200ms. Re-validate only when
  // the pattern actually changes, not when the editor re-mounts.
  function scheduleValidation(pattern: string) {
    if (validationTimer !== null) {
      clearTimeout(validationTimer);
    }
    if (!validate || !pipelineState.wasmReady) {
      validation = null;
      return;
    }
    if (pattern.length === 0) {
      validation = null;
      return;
    }
    // Capture flags at scheduling time so a flag toggle mid-timer
    // doesn't cause the stale request to appear newer than the
    // replacement. The setTimeout closure uses the captured value.
    const flagsSnapshot = flags.slice();
    validationTimer = window.setTimeout(() => {
      validationTimer = null;
      bridge
        .validatePattern(pattern, flagsSnapshot)
        .then((result) => {
          validation = result;
        })
        .catch(() => {
          validation = null;
        });
    }, 200);
  }

  onMount(() => {
    if (!editorEl) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !suppressOnChange) {
        const newValue = update.state.doc.toString();
        onchange?.(newValue);
        scheduleValidation(newValue);
      }
    });

    view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          ...patternFieldExtensions(),
          updateListener,
        ],
      }),
      parent: editorEl,
    });

    // Run an initial validation so existing patterns get checked at mount
    scheduleValidation(value);

    return () => {
      view?.destroy();
      view = null;
    };
  });

  // Sync external value changes into the editor (e.g., when a step is
  // loaded from a saved pipeline or the user imports a config).
  $effect(() => {
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;

    suppressOnChange = true;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
    suppressOnChange = false;
    scheduleValidation(value);
  });

  // Re-validate when WASM finishes loading (initial mount may happen before
  // the worker is ready).
  $effect(() => {
    if (pipelineState.wasmReady && value.length > 0 && validation === null) {
      scheduleValidation(value);
    }
  });

  // Re-validate when the flags prop changes. Reading `flags.length` and
  // `flags.join(',')` inside the effect registers the flag array as a
  // dependency, so adding/removing a flag re-runs validation against
  // the new flag set. Without this, the status indicator would
  // continue to reflect the previous compile until the user next edits
  // the pattern text — misleading for flag-specific errors.
  $effect(() => {
    // Tracked reads so Svelte notices both length and content changes.
    const _len = flags.length;
    const _joined = flags.join(',');
    void _len;
    void _joined;
    if (!pipelineState.wasmReady) return;
    if (value.length === 0) return;
    scheduleValidation(value);
  });

  onDestroy(() => {
    if (validationTimer !== null) {
      clearTimeout(validationTimer);
      validationTimer = null;
    }
    view?.destroy();
    view = null;
  });

  const statusClass = $derived.by(() => {
    if (validation === null) return 'neutral';
    return validation.valid ? 'valid' : 'invalid';
  });

  const statusIcon = $derived.by(() => {
    if (validation === null) return '';
    return validation.valid ? '✓' : '✗';
  });

  const statusTitle = $derived.by(() => {
    if (validation === null) return '';
    if (validation.valid) {
      // Compact single-letter rep mirrors PCRE/Perl notation: (?ims)
      // so the tooltip reads "Pattern compiles with flags: (?ims) | engine: pcre"
      // rather than an ugly snake_case dump.
      const letters = flagLettersFromList(flags);
      const flagStr = letters.length > 0 ? ` with flags: (?${letters})` : '';
      return `Pattern compiles${flagStr} | engine: ${validation.engine ?? 'unknown'}`;
    }
    return validation.error ?? 'Invalid pattern';
  });

  // Map the subset of RegexFlag we expose in the UI to their PCRE/Perl
  // single-letter form. Unknown flags are silently skipped — they're
  // still passed through to the bridge, just not rendered in the
  // tooltip shorthand.
  function flagLettersFromList(list: RegexFlag[]): string {
    const letters: string[] = [];
    for (const f of list) {
      if (f === 'case_insensitive') letters.push('i');
      else if (f === 'multiline') letters.push('m');
      else if (f === 'dot_all') letters.push('s');
      else if (f === 'extended') letters.push('x');
    }
    return letters.join('');
  }
</script>

<div class="pattern-field">
  <div class="editor-wrap" class:invalid={validation && !validation.valid}>
    <div class="editor-host" bind:this={editorEl} data-placeholder={placeholder}></div>
    {#if validation !== null}
      <span class="status {statusClass}" role="img" title={statusTitle} aria-label={statusTitle}>
        {statusIcon}
      </span>
    {/if}
  </div>
  {#if validation && !validation.valid && validation.error}
    <div class="error-message">{validation.error}</div>
  {/if}
</div>

<style>
  .pattern-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .editor-wrap {
    position: relative;
    background: var(--bg-editor);
    border: 1px solid var(--border);
    border-radius: 3px;
    display: flex;
    align-items: stretch;
  }

  .editor-wrap:focus-within {
    border-color: var(--accent-blue);
  }

  .editor-wrap.invalid {
    border-color: var(--error);
  }

  .editor-host {
    flex: 1;
    min-width: 0;
  }

  .editor-host :global(.cm-editor) {
    background: transparent !important;
  }

  .editor-host :global(.cm-editor.cm-focused) {
    outline: none !important;
  }

  .status {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 10px;
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 700;
    border-left: 1px solid var(--border);
    cursor: help;
  }

  .status.valid {
    color: var(--success);
  }

  .status.invalid {
    color: var(--error);
  }

  .status.neutral {
    color: var(--text-muted);
  }

  .error-message {
    font-size: 11px;
    color: var(--error);
    font-family: var(--font-mono);
    padding-left: 2px;
    white-space: pre-wrap;
  }
</style>
