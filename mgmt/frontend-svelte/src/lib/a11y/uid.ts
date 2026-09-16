// ============ UNIQUE IDS FOR LABEL ASSOCIATION (audit PR-40 / carry-over C7) ============
//
// 142 of this app's 160 svelte-check warnings were
//   "A form label must be associated with a control"
// i.e. `<label>Year</label>` sitting next to an `<input>` with nothing tying them together.
//
// That is not a lint nicety. An unassociated label means: a screen reader announces the input
// with no name at all, and clicking the label text does not focus or toggle the field — which
// on a phone, where the labels are the only large targets, is most of the usability of a form.
//
// The association needs an id, and a HARD-CODED id is a trap: several of these components are
// mounted more than once on a screen (TransliterateInput, VillageInput, the list rows), and
// duplicate ids in one document make `for=` ambiguous — the browser binds to the first match,
// so every copy after the first points at the wrong field. That is worse than no label,
// because it looks correct and silently mis-targets.
//
// So each component instance takes one short prefix from here and derives its field ids from
// it. Svelte 5.20 has `$props.id()` for exactly this; this project is on 5.2, so it is a
// counter — deterministic within a page load, which is all an id needs to be.
let n = 0;

/** A short prefix unique to one component instance, e.g. `u7`. */
export function newUid(): string {
  n += 1;
  return `u${n}`;
}

/** Test-only: makes ids predictable across test cases. */
export function _resetUid(): void {
  n = 0;
}
