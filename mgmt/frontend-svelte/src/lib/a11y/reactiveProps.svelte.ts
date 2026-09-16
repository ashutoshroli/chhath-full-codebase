// A `$state` props bag for component tests.
//
// Svelte 5's `mount()` takes a plain props object, and mutating that object afterwards does
// nothing — so a test cannot simulate the parent handing the component NEW props. Runes only
// work inside `.svelte.ts` modules, hence this one-function file.
//
// Needed because `SearchableSelect` clamps its highlighted index against the current option
// list, and the only way that clamp can matter is the parent replacing `options` while a
// highlight is active — exactly what Home and Loans do after the "+ add new" button creates a
// member and the contributor list is reloaded. Without this harness that clamp was untested,
// and a mutation removing it passed the suite.
export function reactiveProps<T extends object>(initial: T): T {
  // `$state(...)` has to be a variable-declaration initializer — it cannot be returned
  // directly from an expression.
  const bag = $state(initial);
  return bag;
}
