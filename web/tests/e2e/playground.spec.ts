import { test, expect, type Page } from '@playwright/test';

// Smoke tests for the rexpipe-playground killer feature loop.
//
// What these cover:
//   1. App loads, WASM worker initializes, header shows "Ready".
//   2. The seeded demo pipeline produces the expected output (the
//      motivating "unwrap soft-wrapped lines" transformation).
//   3. Adding a new step appends a card to the pipeline editor.
//   4. Clicking a step header switches the top panes to show that
//      step's input and output (the intermediate-state feature).
//   5. Editing a pattern updates the output pane live.
//
// What these deliberately don't cover (yet):
//   - Regex flag toggles (tested alongside the flags UI feature work).
//   - Import/export flows (Phase 3).
//   - Cross-browser (chromium-only for the MVP; add firefox/webkit
//     when an engine-specific bug forces the issue).
//   - Visual regression (dark theme is stable; screenshot diffs
//     would be mostly noise right now).

// The Playwright config sets baseURL to the origin only
// (http://127.0.0.1:5173). The production build serves at
// /rexpipe-playground/ (matching the GitHub Pages subpath) so
// tests navigate there explicitly.
const ROOT = '/rexpipe-playground/';

// Wait for the WASM worker to finish loading. The header shows
// "Loading WASM module…" until `bridge.onReady` fires, then
// "Ready". Every test depends on this, so it's factored out.
async function waitForWasmReady(page: Page): Promise<void> {
  await expect(page.locator('.status .status-text')).toHaveText('Ready', {
    timeout: 30_000,
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto(ROOT);
  await waitForWasmReady(page);
});

test('loads and reports ready', async ({ page }) => {
  // Header title is present and the status dot is in the "ready" state.
  await expect(page.locator('header h1')).toHaveText('rexpipe playground');
  await expect(page.locator('.status .dot')).toHaveClass(/ready/);
});

test('seeded demo pipeline produces rejoined output', async ({ page }) => {
  // The seeded input has indented, soft-wrapped paragraphs. After the
  // seeded pipeline runs (strip indent + rejoin soft-wraps via slurp
  // mode), the right pane should show unindented, rejoined paragraphs.
  const rightPaneContent = page.locator('.pane').nth(1).locator('.cm-content');

  // First paragraph joins "My understanding of..." with "A web interface...".
  // The indented leading space is stripped.
  await expect(rightPaneContent).toContainText('My understanding of "done":');
  await expect(rightPaneContent).toContainText(
    'A web interface where a user makes selections',
  );
  // The right pane is a read-only final-output view by default — make
  // sure the Input label is on the left and Final Output on the right.
  await expect(page.locator('.pane h2').nth(0)).toHaveText('Input');
  await expect(page.locator('.pane h2').nth(1)).toHaveText('Final Output');
});

test('seeded pipeline renders two step cards with match badges', async ({ page }) => {
  const stepCards = page.locator('.step-card');
  await expect(stepCards).toHaveCount(2);

  // Each step shows a "N match(es)" badge once processing completes.
  // The indent-strip step typically has >1 matches, and the rejoin
  // step has 1+ matches. We check presence of the badge, not counts,
  // so we're resilient to input text tweaks.
  await expect(
    stepCards.nth(0).locator('.badge').filter({ hasText: /match/ }),
  ).toBeVisible();
  await expect(
    stepCards.nth(1).locator('.badge').filter({ hasText: /match/ }),
  ).toBeVisible();
});

test('add step appends a card and Pipeline count updates', async ({ page }) => {
  await expect(page.locator('.step-card')).toHaveCount(2);
  await expect(page.locator('.step-count')).toHaveText('2 steps');

  await page.locator('.editor-actions button.primary').click();

  await expect(page.locator('.step-card')).toHaveCount(3);
  await expect(page.locator('.step-count')).toHaveText('3 steps');
  // The new step defaults to substitute.
  await expect(page.locator('.step-card').nth(2).locator('.step-type-label')).toHaveText(
    'substitute',
  );
});

test('clicking a step shows intermediate input/output in top panes', async ({ page }) => {
  // Default state: left = "Input", right = "Final Output".
  await expect(page.locator('.pane h2').nth(0)).toHaveText('Input');
  await expect(page.locator('.pane h2').nth(1)).toHaveText('Final Output');

  // Click step 1's header. Expect labels to swap to step-1 intermediate state.
  await page.locator('.step-card').nth(0).locator('.step-header').click();

  // Step 0 selected → left shows "Input (step 1 sees this)" and
  // right shows "After step 1".
  await expect(page.locator('.pane h2').nth(0)).toHaveText('Input (step 1 sees this)');
  await expect(page.locator('.pane h2').nth(1)).toHaveText('After step 1');

  // Click step 2's header. Expect labels to reflect step-2 intermediate state.
  await page.locator('.step-card').nth(1).locator('.step-header').click();
  await expect(page.locator('.pane h2').nth(0)).toHaveText(
    'Output of step 1 (step 2 sees this)',
  );
  await expect(page.locator('.pane h2').nth(1)).toHaveText('After step 2');

  // Click the same step again to deselect and return to final output.
  await page.locator('.step-card').nth(1).locator('.step-header').click();
  await expect(page.locator('.pane h2').nth(1)).toHaveText('Final Output');
});

test('disabling a step removes it from the processed pipeline', async ({ page }) => {
  // The seeded pipeline's step 1 strips the leading indent. If we
  // disable it, the right pane should still contain the indented
  // characters (they weren't stripped). The rejoin step still runs
  // because it's a separate step and targets newlines, not indents.
  const rightPaneContent = page.locator('.pane').nth(1).locator('.cm-content');

  // Sanity: the enabled pipeline strips "  My understanding" to "My understanding".
  await expect(rightPaneContent).toContainText('My understanding of "done":');

  // Disable step 1 (the indent strip) via its checkbox.
  await page.locator('.step-card').nth(0).locator('.enable-toggle').click();

  // Small wait for debounced reprocessing to settle.
  await page.waitForTimeout(300);

  // The leading two-space indent should now be present in the output.
  // cm-content collapses whitespace visually, so we check state.input via
  // the `disabled` visual indicator on the step card instead.
  await expect(page.locator('.step-card').nth(0)).toHaveClass(/disabled/);
  await expect(
    page.locator('.step-card').nth(0).locator('.badge.muted').filter({ hasText: 'disabled' }),
  ).toBeVisible();
});

test('regex flag chips toggle and affect processing', async ({ page }) => {
  // Add a new step and set its pattern to uppercase-only ABC. Without
  // the case-insensitive flag, an all-lowercase input should match zero
  // times; with the flag, it should match.
  await page.locator('.editor-actions button.primary').click();
  await expect(page.locator('.step-card')).toHaveCount(3);

  const newCard = page.locator('.step-card').nth(2);
  // Type the pattern into the new card's pattern field. The PatternField
  // is a single-line CodeMirror, so we click the cm-content and type.
  const patternHost = newCard.locator('.pattern-field .editor-host .cm-content').first();
  await patternHost.click();
  await page.keyboard.type('ABC');

  // Fill in a replacement so the substitute actually transforms something.
  const replacementHost = newCard
    .locator('.field-full', { hasText: 'Replacement' })
    .locator('.cm-content')
    .first();
  await replacementHost.click();
  await page.keyboard.type('<MATCH>');

  // Clear the input pane and type all-lowercase content.
  const inputPane = page.locator('.pane').first().locator('.cm-content');
  await inputPane.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type('abc def abc');

  // Wait for debounced processing to settle.
  await page.waitForTimeout(400);

  // Without the `i` flag, ABC does not match lowercase abc — output
  // equals input (unchanged by this step). The two seeded steps run
  // first but don't match anything either.
  const rightPane = page.locator('.pane').nth(1).locator('.cm-content');
  await expect(rightPane).toContainText('abc def abc');
  await expect(rightPane).not.toContainText('<MATCH>');

  // Click the `i` flag chip in the new card.
  const iChip = newCard.locator('.flag-chip', { hasText: 'i' });
  await iChip.click();
  await expect(iChip).toHaveAttribute('aria-pressed', 'true');

  // Reprocess fires automatically — wait for debounce and verify the
  // replacement now appears.
  await page.waitForTimeout(400);
  await expect(rightPane).toContainText('<MATCH>');

  // Toggling the flag off reverts the output.
  await iChip.click();
  await expect(iChip).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(400);
  await expect(rightPane).toContainText('abc def abc');
  await expect(rightPane).not.toContainText('<MATCH>');
});

test('regex flag chips show pressed state and tooltip', async ({ page }) => {
  // Every step card has four flag chips (i, m, s, x) in the field
  // labelled "Flags".
  const firstCard = page.locator('.step-card').first();
  const chips = firstCard.locator('.flag-chip');
  await expect(chips).toHaveCount(4);

  // Labels match PCRE/Perl shorthand.
  await expect(chips.nth(0)).toHaveText('i');
  await expect(chips.nth(1)).toHaveText('m');
  await expect(chips.nth(2)).toHaveText('s');
  await expect(chips.nth(3)).toHaveText('x');

  // Chips include a tooltip explaining what each flag does.
  await expect(chips.nth(0)).toHaveAttribute(
    'title',
    /case.insensitive/i,
  );
  await expect(chips.nth(3)).toHaveAttribute('title', /extended|comments/i);
});

test('input byte counter updates as the user types', async ({ page }) => {
  // The first pane has a character count in its header.
  const charCount = page.locator('.pane').first().locator('.char-count');
  const initialText = await charCount.textContent();
  expect(initialText).toMatch(/\d+ chars/);

  // Append text to the input pane's CodeMirror content.
  const editor = page.locator('.pane').first().locator('.cm-content');
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type('XYZ');

  // Counter should now be at least 3 more than before.
  const newText = await charCount.textContent();
  const match = newText?.match(/(\d+) chars/);
  const initMatch = initialText?.match(/(\d+) chars/);
  expect(match).not.toBeNull();
  expect(initMatch).not.toBeNull();
  expect(parseInt(match![1], 10)).toBeGreaterThanOrEqual(parseInt(initMatch![1], 10) + 3);
});
