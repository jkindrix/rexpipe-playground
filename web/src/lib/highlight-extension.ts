// CodeMirror 6 extension for highlighting pipeline match positions.
//
// The pattern is: a StateField holds a DecorationSet, and we drive updates
// via a custom StateEffect carrying an array of {start, end} positions.
// Consumers call `setHighlights(view, positions)` to install new highlights,
// and the field automatically maps through subsequent document changes.
//
// This is the standard CM6 decoration pattern (see
// https://codemirror.net/docs/ref/#view.Decoration) and avoids the need for
// a ViewPlugin with its own lifecycle.

import { StateField, StateEffect } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { MatchPosition } from './types';

/**
 * StateEffect carrying the new match positions for the field.
 * Dispatch via the `setHighlights()` helper below.
 */
export const setHighlightsEffect = StateEffect.define<MatchPosition[]>();

/**
 * The decoration mark applied to each match. The CSS class is defined in
 * codemirror-setup.ts (the playgroundTheme) with a semi-transparent yellow
 * background.
 */
const highlightMark = Decoration.mark({ class: 'cm-match-highlight' });

/**
 * The StateField that tracks the active decoration set. Exported so it
 * can be added to a CM6 extension list. Automatically maps decorations
 * through document changes (so highlights track the text as it edits).
 */
export const highlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    // Map existing decorations through any document changes
    decorations = decorations.map(tr.changes);

    // Apply any setHighlights effects in this transaction
    for (const effect of tr.effects) {
      if (effect.is(setHighlightsEffect)) {
        const positions = effect.value;
        const docLength = tr.state.doc.length;
        // Sort by start, then build a sorted RangeSet. Clamp to doc bounds
        // in case match positions slightly exceed the doc length due to
        // stale state between processing passes.
        const sorted = [...positions]
          .filter((p) => p.start < docLength && p.end <= docLength && p.start < p.end)
          .sort((a, b) => a.start - b.start || a.end - b.end);
        const marks = sorted.map((p) => highlightMark.range(p.start, p.end));
        return Decoration.set(marks);
      }
    }

    return decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Imperative helper: replace the highlights in a given editor view.
 * Use from components with access to an EditorView instance.
 */
export function setHighlights(view: EditorView, positions: MatchPosition[]): void {
  view.dispatch({
    effects: setHighlightsEffect.of(positions),
  });
}
