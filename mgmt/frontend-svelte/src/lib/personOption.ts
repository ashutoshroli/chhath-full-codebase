// One place that turns a user row into a picker option, so every contributor/guarantor
// dropdown shows and searches the same thing.
//
// Reported from live use: the Add Collection picker showed only the name and the village, and
// a screenshot of it contained **two `Ajay Verma`** — one Gardih, one Shaharpura. Village
// separates those two. It does NOT separate two people with the same name in the SAME
// village, and that is exactly the situation in which the wrong contributor is selected and a
// contribution is recorded against the wrong person. Money on the wrong name is not a
// cosmetic bug, and the father's name was already on the row, unused.
//
// The father's name goes in the LABEL, beside the name, because that is where it disambiguates
// at a glance and because `SearchableSelect` filters on `label` and `sub` — so putting it there
// also makes it typeable: searching "Ram Kumar" finds Ram Kumar's sons.
//
// An absent father's name renders nothing rather than empty brackets. `Aarohi bharti ( )` is
// worse than `Aarohi bharti`: it looks like data that failed to load.

export interface PersonOption {
  value: string;
  label: string;
  sub?: string;
}

/** The father's name from a user row, tolerating the historical trailing-space header. */
export function fatherNameOf(u: Record<string, any> | null | undefined): string {
  if (!u) return '';
  // "Father's Name" is the mgmt alias; the trailing-space variant is what the original sheet
  // headers carried and what the public Worker still emits (see tableRegistry.js's note).
  // Reading both costs nothing and means this helper is correct against either payload.
  const raw = u["Father's Name"] ?? u["Father's Name "] ?? '';
  return raw === null || raw === undefined ? '' : raw.toString().trim();
}

export function personOption(u: Record<string, any>): PersonOption {
  const name = (u?.Name ?? '').toString().trim();
  const father = fatherNameOf(u);
  return {
    value: u?.ID,
    label: father ? `${name} (${father})` : name,
    sub: (u?.Village ?? '').toString().trim() || undefined,
  };
}

/** Options for a list of user rows, in the order given. */
export function personOptions(users: Record<string, any>[] | null | undefined): PersonOption[] {
  return (users || []).map(personOption);
}
