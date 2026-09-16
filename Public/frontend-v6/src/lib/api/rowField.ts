// Reads a field from a payload row, tolerating the header spellings this data has actually
// carried.
//
// The portal's column headers originate in the spreadsheet this system replaced, and some of
// them ended with a TRAILING SPACE. The public Worker's reverse map still emits them that way:
//
//     fathers_name: "Father's Name "        // <- note the space
//     mobile:       'Mobile '
//
// while this app read `user["Father's Name"]` without one. The result was silent: `fatherName`
// was always `''`, so `ContributorDetail`'s `{#if displayFather}` never rendered, and **no
// contributor on the public site ever showed a father's name.** Nothing errored; a row simply
// was not there.
//
// The fix belongs on the READ side. Renaming the wire key would be a one-line change here and
// a breaking change for every other reader of that payload — the older frontends, the chatbot's
// context builder, anything holding a cached copy. `mgmt/backend/src/tableRegistry.js` already
// solved the same problem the same way for its INBOUND lookups, and documents why.
//
// Tries the exact key first (the overwhelmingly common case, and free), then the trailing-space
// variant, then a normalised scan — trimmed, inner whitespace collapsed, and the curly
// apostrophe (U+2019) folded onto the ASCII one, because "Father’s Name" has been seen too.

function normalizeHeader(k: string): string {
  return k.replace(/\u2019/g, "'").trim().replace(/\s+/g, ' ').toLowerCase();
}

export function rowField(row: Record<string, any> | null | undefined, key: string): string {
  if (!row) return '';

  const exact = row[key];
  if (exact !== undefined && exact !== null) return exact.toString();

  const spaced = row[`${key} `];
  if (spaced !== undefined && spaced !== null) return spaced.toString();

  const want = normalizeHeader(key);
  for (const k of Object.keys(row)) {
    if (normalizeHeader(k) === want) {
      const v = row[k];
      return v === undefined || v === null ? '' : v.toString();
    }
  }
  return '';
}
