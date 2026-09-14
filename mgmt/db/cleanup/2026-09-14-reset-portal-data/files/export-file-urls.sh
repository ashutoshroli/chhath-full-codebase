#!/usr/bin/env bash
# ============================================================================
# STEP 3a — export every stored file URL BEFORE the rows are deleted.
#
# The database rows are the ONLY index of the uploaded photos, signatures, popup
# images and generated PDFs. Once they are deleted those files are unreachable:
# nothing in R2 or Drive records which member or receipt they belonged to. So this
# runs first, and it is read-only.
#
#   bash mgmt/db/cleanup/2026-09-14-reset-portal-data/files/export-file-urls.sh
#
# Writes JSON into ./out/ next to this script.
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p out

echo "→ users.photo (excluding USER0001, whose photo is kept)"
npx wrangler d1 execute chhath-core --remote --json --command \
  "SELECT photo AS url FROM users WHERE photo IS NOT NULL AND TRIM(photo) <> '' AND TRIM(COALESCE(id_code,'')) <> 'USER0001'" \
  > out/core-user-photos.json

echo "→ loan_consents.photo_url + signature_url"
npx wrangler d1 execute chhath-loans-expenses --remote --json --command \
  "SELECT photo_url AS url FROM loan_consents WHERE photo_url IS NOT NULL AND TRIM(photo_url) <> '' UNION SELECT signature_url FROM loan_consents WHERE signature_url IS NOT NULL AND TRIM(signature_url) <> ''" \
  > out/consent-files.json

echo "→ generated_files.public_link + drive_path"
npx wrangler d1 execute chhath-file-index --remote --json --command \
  "SELECT public_link AS url FROM generated_files WHERE public_link IS NOT NULL AND TRIM(public_link) <> '' UNION SELECT drive_path FROM generated_files WHERE drive_path IS NOT NULL AND TRIM(drive_path) <> ''" \
  > out/generated-files.json

echo "→ popup_slides.image_url (only needed if you also run 07b)"
npx wrangler d1 execute chhath-misc --remote --json --command \
  "SELECT image_url AS url FROM popup_slides WHERE image_url IS NOT NULL AND TRIM(image_url) <> ''" \
  > out/popup-images.json

echo
echo "Exported to $(pwd)/out/. Next: node files/extract-keys.mjs"
