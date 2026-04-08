<script lang="ts">
  // Sprint 1: simple textarea-based text pane.
  // Sprint 2 will swap this out for a CodeMirror 6 EditorView.

  interface Props {
    label: string;
    value: string;
    readonly?: boolean;
    placeholder?: string;
    onchange?: (value: string) => void;
  }

  let {
    label,
    value,
    readonly = false,
    placeholder = '',
    onchange,
  }: Props = $props();

  function handleInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    onchange?.(target.value);
  }
</script>

<div class="pane">
  <div class="pane-header">
    <h2>{label}</h2>
    <span class="char-count" aria-label="character count">
      {value.length} chars
    </span>
  </div>
  <textarea
    {value}
    {readonly}
    {placeholder}
    oninput={handleInput}
    spellcheck="false"
    autocomplete="off"
    autocapitalize="off"
  ></textarea>
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

  textarea {
    flex: 1;
    min-height: 0;
    background: var(--bg-editor);
    color: var(--text-primary);
    border: none;
    border-radius: 0;
    padding: 10px 12px;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.5;
    resize: none;
    white-space: pre;
    overflow: auto;
    tab-size: 4;
  }

  textarea:focus {
    outline: none;
  }

  textarea[readonly] {
    cursor: default;
  }
</style>
