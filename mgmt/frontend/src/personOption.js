// One place that turns a user row into a picker option, so every contributor /
// guarantor dropdown in the React app shows and searches the same thing.
//
// This mirrors mgmt/frontend-svelte/src/lib/personOption.ts. Reported from live use of
// THIS app: the Add Collection picker showed only the name and the village, and a
// screenshot of it contained two "Ajay Verma" — one Gardih, one Shaharpura. Village
// separates those two; it does NOT separate two people of the same name in the SAME
// village, which is exactly when the wrong contributor is picked and money is recorded
// against the wrong person. The father's name was already on the row, unused.
//
// The father's name goes in the LABEL, beside the name: that is where it disambiguates at
// a glance, and SearchableSelect filters on `label` (and `sub`), so it also becomes
// typeable — searching "Ram Kumar" finds Ram Kumar's sons.
//
// An absent father's name renders NOTHING, not empty brackets: "Aarohi bharti ( )" looks
// like data that failed to load and is worse than "Aarohi bharti".

/** The father's name from a user row, tolerating the historical trailing-space header. */
export function fatherNameOf(u) {
  if (!u) return '';
  // "Father's Name" is the mgmt alias; the trailing-space variant is what the original
  // sheet headers carried and what the public Worker still emits. Reading both costs
  // nothing and makes this correct against either payload.
  const raw = u["Father's Name"] ?? u["Father's Name "] ?? '';
  return raw === null || raw === undefined ? '' : raw.toString().trim();
}

/** Turn one user row into a { value, label, sub } picker option. */
export function personOption(u) {
  const name = (u?.Name ?? '').toString().trim();
  const father = fatherNameOf(u);
  return {
    value: u?.ID,
    label: father ? `${name} (${father})` : name,
    sub: (u?.Village ?? '').toString().trim() || undefined,
  };
}

/** Options for a list of user rows, in the order given. */
export function personOptions(users) {
  return (users || []).map(personOption);
}
