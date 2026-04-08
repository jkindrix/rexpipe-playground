// CodeMirror 6 setup utilities for the rexpipe-playground.
//
// CodeMirror 6 is a modular editor — you assemble a working instance from
// individual extension packages. This module centralizes the extension
// choices so both the large text panes and the single-line pattern fields
// get consistent behavior and theming.
//
// Design goals:
// - Dark theme that matches the app's color tokens
// - No language syntax highlighting (we edit raw text)
// - Monospace font
// - Word wrap OFF (preserve horizontal scroll so users can see long lines)
// - Line numbers OFF for pattern fields, ON for text panes

import { EditorState } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightActiveLine,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
} from '@codemirror/view';
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';

/**
 * A custom theme that blends CodeMirror's one-dark palette with the
 * app's color tokens so the editors visually belong to the surrounding UI.
 */
const playgroundTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      color: 'var(--text-primary)',
      backgroundColor: 'var(--bg-editor)',
      fontFamily: 'var(--font-mono)',
      fontSize: '13px',
    },
    '.cm-content': {
      caretColor: 'var(--accent-blue)',
      padding: '10px 0',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--accent-blue)',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--bg-editor)',
      color: 'var(--text-muted)',
      border: 'none',
      borderRight: '1px solid var(--border)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--bg-step)',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(96, 150, 255, 0.05)',
    },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(96, 150, 255, 0.25) !important',
    },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor: 'rgba(96, 150, 255, 0.35) !important',
    },
    '.cm-scroller': {
      overflow: 'auto',
      lineHeight: '1.5',
    },
    '.cm-match-highlight': {
      backgroundColor: 'var(--match-highlight)',
      borderRadius: '2px',
    },
  },
  { dark: true },
);

interface SetupOptions {
  /** Whether the editor is read-only */
  readonly?: boolean;
  /** Whether to show line numbers */
  lineNumbers?: boolean;
  /** Extra extensions to append (e.g., highlight field) */
  extraExtensions?: import('@codemirror/state').Extension[];
}

/**
 * Build the extension set for a full text-pane CodeMirror instance.
 * Includes line numbers, history, bracket matching, the one-dark theme,
 * and the playground's color overrides.
 */
export function textPaneExtensions(opts: SetupOptions = {}) {
  const extensions = [
    history(),
    drawSelection(),
    dropCursor(),
    bracketMatching(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    oneDark,
    playgroundTheme,
    EditorView.lineWrapping,
  ];

  if (opts.lineNumbers !== false) {
    extensions.push(lineNumbers());
  }

  if (opts.readonly) {
    extensions.push(EditorState.readOnly.of(true));
  }

  if (opts.extraExtensions) {
    extensions.push(...opts.extraExtensions);
  }

  return extensions;
}

/**
 * Build the extension set for a single-line pattern field CodeMirror
 * instance. No line numbers, no line wrapping, newlines stripped on input.
 */
export function patternFieldExtensions(opts: SetupOptions = {}) {
  // Transaction filter: reject any changes that would insert a newline.
  // This makes the field behave as single-line while still letting users
  // use CodeMirror's editing features (undo, cursor movement, selection).
  const singleLineFilter = EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr;

    // Fast path: check if the new doc contains a newline at all by
    // reading the whole document as a string. Pattern fields are bounded
    // at ~200 chars in practice, so this is cheap.
    if (!tr.newDoc.toString().includes('\n')) {
      return tr;
    }

    // Rebuild the transaction with newlines in inserted text replaced
    // by spaces. Keep the original changes' from/to bounds so undo/redo
    // history and selection handling remain correct.
    const changes: { from: number; to: number; insert: string }[] = [];
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      const cleaned = inserted.toString().replace(/\n/g, ' ');
      changes.push({ from: fromA, to: toA, insert: cleaned });
    });
    return [{ changes, selection: tr.selection }];
  });

  const extensions = [
    history(),
    drawSelection(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    oneDark,
    playgroundTheme,
    EditorView.theme({
      '&': {
        fontSize: '13px',
      },
      '.cm-content': {
        padding: '6px 8px',
      },
      '.cm-scroller': {
        overflow: 'auto',
        whiteSpace: 'pre',
      },
      '.cm-line': {
        padding: 0,
      },
    }),
    singleLineFilter,
  ];

  if (opts.readonly) {
    extensions.push(EditorState.readOnly.of(true));
  }

  if (opts.extraExtensions) {
    extensions.push(...opts.extraExtensions);
  }

  return extensions;
}
