# Testing Guide After PDF Indexing Fix

## Quick Test (2 minutes)

### 1. Save New Collection
```
1. Login to mgmt portal (admin account)
2. Home tab → Orange (+) button
3. Fill form:
   - Select contributor name
   - Amount: 100
   - Contribution Type: Cash (Money)
   - Date: today
4. Click Save
5. Wait 10 seconds
```

### 2. Check Browser Console
```
Press F12 → Console tab
Filter for: "recordGeneratedFile"

✅ Success looks like:
[recordGeneratedFile] Success: {docType: "receipt", year: 2026, recordId: "receipt-2026-26", fileName: "receipt-NCS-2026-26.pdf"}

❌ Failure looks like:
[recordGeneratedFile] Database insert failed: ...
```

### 3. Check Public Portal
```
1. Go to: https://chhath.shaharpura.com
2. Click "Downloads" tab at bottom
3. Select village → Search for contributor name
4. Click on their name
5. Look for "Receipt — 2026 — ₹100"

✅ Should show: [Download] button (green)
❌ Old bug: "Not Available" (gray)
```

---

## Detailed Test (5 minutes)

### Test Case 1: New Receipt PDF
```bash
# Expected flow:
1. Save collection (Cash/Money type)
2. Backend generates PDF → Uploads to Drive
3. Backend inserts into generated_files table ← FIX HERE
4. Returns publicLink to frontend
5. Frontend queues WhatsApp message with link
6. Public portal shows "Download" button
```

**Verification:**
```sql
-- Check database (via wrangler d1 execute or Cloudflare dashboard)
SELECT * FROM generated_files 
WHERE doc_type = 'receipt' 
  AND year = 2026 
ORDER BY generated_at DESC 
LIMIT 5;

-- Should show new row with:
-- record_id: receipt-2026-XX
-- public_link: https://drive.google.com/uc?export=download&id=XXXXX
-- generated_at: (just now timestamp)
```

---

### Test Case 2: Certificate PDF
```bash
1. Save collection with:
   - Contribution Type: Service (Work)
   - Certificate Or Receipt: Certificate
2. Check console for "[recordGeneratedFile] Success"
3. Check public portal Downloads
4. Verify "Certificate — 2026" shows Download button
```

---

### Test Case 3: Samaan (Material) PDF
```bash
1. Save collection with:
   - Contribution Type: Material (Item)
   - Detail: "Cement bags"
2. Check console
3. Check public portal
4. Verify "Material — 2026" shows Download button
```

---

### Test Case 4: Error Handling

**Simulate missing recordId:**
```javascript
// In browser console on mgmt portal:
await api.convertDocxToPdf('receipt', 2026, null, 'base64string', 'test.docx', true);

// Expected:
// Console shows: "[recordGeneratedFile] Missing required fields"
// Error logged to error_log table
// Returns: { success: true, indexFailed: true, error: "..." }
```

---

## Database Verification

### Check Indexing Success Rate
```sql
-- Total PDFs generated (Drive folder count)
-- vs
-- Total indexed (database count)

SELECT 
  doc_type,
  year,
  COUNT(*) as indexed_count
FROM generated_files
WHERE year = 2026
GROUP BY doc_type, year;

-- Expected:
-- receipt | 2026 | 25
-- certificate | 2026 | 3
-- samaan | 2026 | 2
```

### Check Error Log
```sql
SELECT 
  source,
  page,
  message,
  context,
  created_at
FROM error_log
WHERE source = 'backend-docxTemplates'
ORDER BY created_at DESC
LIMIT 10;

-- Should be EMPTY (no errors)
-- If errors exist, check context JSON for details
```

---

## WhatsApp Message Verification

### Test 1: Person Message Has PDF Link
```bash
1. Save collection for contributor with WhatsApp number
2. Go to WhatsApp → Message tab → Person
3. Find message for that contributor
4. Check message text includes PDF link

✅ Good:
"Receipt generated: https://drive.google.com/uc?export=download&id=XXXXX"

❌ Bad:
"Receipt generated: " (no link)
```

### Test 2: Group Message Has PDF Link
```bash
1. Same test as above
2. Go to WhatsApp → Message tab → Group
3. Check group message

✅ Should have: PDF link attached
```

---

## Public Portal Regression Test

### Before vs After
```
BEFORE FIX:
Kaushal Verma
  Receipt — 2026 — ₹45     [Not Available]  ❌
  Receipt — 2025 — ₹301    [Not Available]  ❌

AFTER FIX:
Kaushal Verma
  Receipt — 2026 — ₹45     [Download]  ✅
  Receipt — 2025 — ₹301    [Not Available]  ⚠️ (old data before fix)
  Receipt — 2026 — ₹100    [Download]  ✅ (new test entry)
```

**Note:** Old "Not Available" entries won't auto-fix. You'd need to regenerate those PDFs manually from Download Center.

---

## Performance Test

### Check PDF Generation Speed
```bash
# Time from "Save" click to "Download" available on public portal

✅ Target: < 10 seconds
⚠️  Acceptable: 10-30 seconds (first time, cold start)
❌ Problem: > 30 seconds (check Drive API rate limits)
```

**Test:**
1. Start timer when clicking Save
2. Refresh public portal Downloads page
3. Stop timer when "Download" button appears

---

## Edge Cases

### Case 1: Duplicate PDF Generation
```bash
# User clicks Download button twice quickly

Expected behavior:
1st click: Generates PDF → Indexes
2nd click: Checks isFileGenerated() → Returns existing link (skipped: true)

✅ No duplicate database entries
✅ No "UNIQUE constraint" error
```

### Case 2: Edit Existing Collection
```bash
# User edits collection and saves again

Expected:
- New __rowIndex generated
- New recordId: receipt-2026-NEW_INDEX
- New PDF generated
- New database entry (different recordId)

✅ Old PDF still available on public portal
✅ New PDF also available
```

### Case 3: Resell Item (No PDF)
```bash
# Resell items don't have PDFs (by design)

1. Save collection with "Is Resell" checked
2. Check console: NO "[recordGeneratedFile]" log
3. Public portal: No entry in Downloads (expected)

✅ This is correct behavior
```

---

## Rollback Plan (If Fix Fails)

### Symptoms of Failure:
- Collections stop saving altogether
- Error 500 on every collection save
- All PDFs showing "Not Available" (worse than before)

### Rollback Steps:
```bash
# 1. Revert backend
cd mgmt/backend
git revert HEAD
wrangler deploy

# 2. Revert frontend
cd mgmt/frontend
git revert HEAD
npm run build
vercel --prod

# 3. Notify team
# PDF indexing fix rolled back, investigating...
```

---

## Success Metrics (24 Hours After Deploy)

### Quantitative
- ✅ 100% of new PDFs indexed (error_log empty)
- ✅ 0 "Not Available" for new entries
- ✅ Average indexing time: < 10 seconds
- ✅ WhatsApp messages: 100% have PDF links

### Qualitative
- ✅ No user complaints about "Not Available"
- ✅ No admin complaints about missing PDFs
- ✅ Public portal working smoothly

---

## Monitoring Commands

### Check Last 10 Generated Files
```sql
SELECT 
  doc_type,
  year,
  record_id,
  file_name,
  SUBSTR(public_link, 1, 50) || '...' as link_preview,
  generated_at
FROM generated_files
ORDER BY generated_at DESC
LIMIT 10;
```

### Check Indexing Failures
```sql
SELECT * FROM error_log
WHERE source = 'backend-docxTemplates'
  AND created_at > datetime('now', '-24 hours');
```

### Check Public Portal Access
```sql
-- From Public backend logs (if available)
-- Count "Not Available" vs "Download" ratio
```

---

## Final Checklist

**Before declaring fix successful:**

- [ ] Test Case 1: New receipt PDF → Shows on public portal ✅
- [ ] Test Case 2: New certificate PDF → Shows on public portal ✅
- [ ] Test Case 3: New samaan PDF → Shows on public portal ✅
- [ ] Test Case 4: Error handling works (logs to error_log) ✅
- [ ] Database has all new entries ✅
- [ ] Error log is empty (no failures) ✅
- [ ] WhatsApp messages have PDF links ✅
- [ ] Public portal Downloads tab working ✅
- [ ] No regression in collection save flow ✅
- [ ] Browser console shows success logs ✅

---

**Ready to test!** 🚀

Run through Quick Test first (2 min), then Detailed Test if anything looks wrong.
