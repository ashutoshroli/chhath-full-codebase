#!/usr/bin/env bash
# ============================================================================
# Row count for EVERY table in EVERY database, in one run.
#
#   bash mgmt/db/cleanup/2026-09-14-reset-portal-data/files/table-counts.sh
#
# Read-only. Use it before the reset to see what is there, and after to confirm
# the result. Drop --remote (set LOCAL=1) to look at the local dev copy instead.
#
# The table list is read from each database's own sqlite_master rather than
# hardcoded here, so this keeps telling the truth after a future migration adds
# or renames a table.
# ============================================================================
set -uo pipefail

cd "$(dirname "$0")/../../../../.." || exit 1   # repo root

REMOTE="--remote"
[[ "${LOCAL:-0}" == "1" ]] && REMOTE=""

DATABASES=(
  chhath-core
  chhath-collections
  chhath-loans-expenses
  chhath-templates
  chhath-file-index
  chhath-whatsapp-index
  chhath-logs
  chhath-misc
  chhath-audit
)

# Tables the reset leaves alone. Everything else should read 0 afterwards, except
# users and login_users which should read 1.
KEEP=" dropdown_lists journey_entries portal_settings certificate_templates consent_page_templates doc_pdf_templates docx_templates pdf_templates receipt_templates samaan_templates loan_email_templates loan_message_templates email_message_templates group_message_templates person_message_templates official_emails whatsapp_groups ai_providers "
ONE=" users login_users "

for db in "${DATABASES[@]}"; do
  echo
  echo "════════════════ $db ════════════════"

  tables=$(npx wrangler d1 execute "$db" $REMOTE --json --command \
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const i=s.indexOf("[");if(i<0)process.exit(0);const b=JSON.parse(s.slice(i));console.log((Array.isArray(b)?b:[b]).flatMap(x=>x.results||[]).map(x=>x.name).join(" "))})')

  if [[ -z "${tables// /}" ]]; then
    echo "  ! could not read the table list (is the database name right?)"
    continue
  fi

  # UNION ALL, tagging each row with what the reset should have left behind.
  #
  # Chunked at 4 terms per query on purpose. D1 caps the number of terms in a
  # compound SELECT far below stock SQLite's 500 -- a 6-term UNION ALL already
  # comes back as "too many terms in compound SELECT" (SQLITE_ERROR 7500), while
  # 4 is accepted. So a database with 10 tables becomes 3 queries rather than one.
  q=""
  terms=0
  flush() {
    [[ -z "$q" ]] && return 0
    npx wrangler d1 execute "$db" $REMOTE --command "$q ORDER BY tbl"
    q=""
    terms=0
  }

  for t in $tables; do
    if   [[ "$KEEP" == *" $t "* ]]; then expect="KEEP"
    elif [[ "$ONE"  == *" $t "* ]]; then expect="1"
    else                                 expect="0"
    fi
    [[ -n "$q" ]] && q="$q UNION ALL "
    q="$q SELECT '$t' tbl, COUNT(*) n, '$expect' expect FROM $t"
    terms=$((terms + 1))
    [[ "$terms" -ge 4 ]] && flush
  done
  flush
done

echo
echo "expect column:  0 = should be empty   1 = one row (USER0001)   KEEP = configuration, left alone"
