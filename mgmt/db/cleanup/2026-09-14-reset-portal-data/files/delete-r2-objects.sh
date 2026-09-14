#!/usr/bin/env bash
# ============================================================================
# STEP 5 — delete the orphaned R2 objects listed in out/r2-keys.txt.
#
#   bash mgmt/db/cleanup/2026-09-14-reset-portal-data/files/delete-r2-objects.sh
#
# Run this AFTER the SQL steps. It asks for confirmation and prints the count
# first. Deleting an R2 object is permanent -- there is no recycle bin.
#
# wrangler has no bulk/recursive delete, so this is one call per object. A few
# hundred files takes a couple of minutes. Failures are collected and reported at
# the end rather than aborting the run, so one bad key cannot strand the rest.
# ============================================================================
set -uo pipefail

cd "$(dirname "$0")"
BUCKET="chhath-files"
LIST="out/r2-keys.txt"

if [[ ! -s "$LIST" ]]; then
  echo "Nothing to do: $LIST is missing or empty."
  echo "Run export-file-urls.sh then extract-keys.mjs first."
  exit 0
fi

TOTAL=$(grep -c . "$LIST")
echo "About to PERMANENTLY delete $TOTAL object(s) from the '$BUCKET' bucket."
echo "First few:"
head -5 "$LIST" | sed 's/^/    /'
echo
read -r -p "Type DELETE to continue: " CONFIRM
[[ "$CONFIRM" == "DELETE" ]] || { echo "Aborted."; exit 1; }

mkdir -p out
FAILED="out/r2-delete-failed.txt"
: > "$FAILED"
n=0

while IFS= read -r key; do
  [[ -z "$key" ]] && continue
  n=$((n + 1))
  printf '[%d/%d] %s\n' "$n" "$TOTAL" "$key"
  if ! npx wrangler r2 object delete "$BUCKET/$key" --remote >/dev/null 2>&1; then
    echo "$key" >> "$FAILED"
    echo "    ! failed"
  fi
done < "$LIST"

echo
if [[ -s "$FAILED" ]]; then
  echo "Done, but $(grep -c . "$FAILED") object(s) failed — see $FAILED."
  echo "Common cause: the file was already moved to Drive, so the R2 object is"
  echo "already gone. Cross-check those keys against out/drive-links.txt."
else
  echo "Done: all $TOTAL object(s) deleted."
fi

if [[ -s out/drive-links.txt ]]; then
  echo
  echo "STILL TO DO — $(grep -c . out/drive-links.txt) file(s) live on Google Drive."
  echo "wrangler cannot delete those. Open out/drive-links.txt and remove them"
  echo "from the Drive UI (then empty Drive's trash)."
fi
