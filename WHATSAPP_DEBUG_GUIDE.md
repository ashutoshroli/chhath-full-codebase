# WhatsApp Message Not Sending - Debug Guide

## Problem
PDF generate and download ho raha hai ✅, but WhatsApp message nahi ja raha hai ❌

## Root Cause Analysis
WhatsApp message queue **silently fails** when:
1. ❌ **No active templates configured** for that contribution type
2. ❌ **Contributor's WhatsApp/Mobile number missing or invalid** 
3. ❌ **Template contribution_type mismatch**
4. ❌ **WhatsApp groups not configured or inactive**

## Fix Applied
✅ Added **comprehensive error logging** to `mgmt/backend/src/whatsapp.js`:
- Logs when no group template found
- Logs when no person template found  
- Logs when WhatsApp number is missing/invalid
- Logs actual errors to `error_log` table

## How to Debug (After Deploying Fix)

### Step 1: Check Error Log Table
```sql
-- Check recent WhatsApp errors
SELECT * FROM error_log 
WHERE category LIKE 'whatsapp%' 
ORDER BY timestamp DESC 
LIMIT 20;
```

### Step 2: Check Templates Configuration

#### Person Message Templates
```sql
-- Check active person templates
SELECT template_id, contribution_type, doc_sub_type, active, message_type
FROM person_message_templates 
WHERE active = 1;

-- Expected: At least one active template for contribution_type='1' (Receipt)
```

#### Group Message Templates
```sql
-- Check active group templates
SELECT template_id, contribution_type, doc_sub_type, active, message_type
FROM group_message_templates 
WHERE active = 1;

-- Expected: At least one active template for each contribution type
```

**Common Issue**: No templates marked as `active=1` ❌

### Step 3: Check WhatsApp Groups
```sql
-- Check active groups
SELECT group_id, group_name, groupid, active
FROM whatsapp_groups
WHERE active = 1;

-- Expected: At least one active group for broadcasting
```

**Common Issue**: Groups not added or `active=0` ❌

### Step 4: Check Contributor Data
```sql
-- Check if contributor has valid WhatsApp/Mobile
SELECT ID, Name, Mobile, WhatsApp 
FROM users 
WHERE ID = 'CONTRIBUTOR_ID_HERE';

-- Expected: 10-digit mobile number in WhatsApp or Mobile column
```

**Common Issue**: 
- Mobile number missing ❌
- Mobile number not 10 digits ❌
- Special characters in number ❌

### Step 5: Check Message Queue Tables

#### Person Messages
```sql
-- Check recent person messages
SELECT message_id, mobileno, LEFT(message, 50) as message_preview, 
       status, created_at, "from"
FROM person_messages 
ORDER BY created_at DESC 
LIMIT 10;

-- Expected status: 'pending' or 'sent'
-- If no rows = messages not being queued ❌
```

#### Group Messages
```sql
-- Check recent group messages  
SELECT message_id, groupid, LEFT(message, 50) as message_preview,
       status, created_at, "from"
FROM group_messages
ORDER BY created_at DESC
LIMIT 10;

-- Expected status: 'pending' or 'sent'
-- If no rows = messages not being queued ❌
```

## Most Likely Issues (Priority Order)

### Issue #1: Templates Not Configured ⚠️
**Symptom**: Error log shows "No active template found"

**Fix**:
1. Go to WhatsApp → Template tab in mgmt portal
2. Add at least one **Person Message Template**:
   - Contribution Type: `1` (for Receipt)
   - Active: ✅ (checked)
   - Text: `नमस्ते {Name}, आपका ₹{Amount} का योगदान प्राप्त हुआ। धन्यवाद!`
3. Add at least one **Group Message Template**:
   - Contribution Type: `1`
   - Active: ✅ (checked)  
   - Text: `नया योगदान: {Name} - ₹{Amount}`

### Issue #2: WhatsApp Groups Not Added ⚠️
**Symptom**: Error log shows group messages being skipped

**Fix**:
1. Go to WhatsApp → Group Info tab
2. Add WhatsApp group with:
   - Group Name: `Chhath Committee 2026`
   - Group ID: `120363045378292567@g.us` (from WhatsApp Web)
   - Active: ✅ (checked)

### Issue #3: Contributor Mobile Number Missing ⚠️
**Symptom**: Error log shows "Invalid or missing WhatsApp number"

**Fix**:
1. Go to Users tab
2. Find the contributor
3. Add their 10-digit mobile number in **Mobile** or **WhatsApp** field
4. Format: `9172820321` (no +91, no spaces, no dashes)

### Issue #4: Contribution Type Mismatch ⚠️
**Symptom**: Messages queue for some contributions but not others

**Fix**: 
Check template `contribution_type` matches the collection's type:
- `1` = Cash Receipt (₹ contribution)
- `2` = Samaan (item donation)
- `3` = Certificate/Receipt (can specify doc_sub_type)
- `4` = Resell (auto-set, not user-selectable)

## Testing After Fix

### Test Scenario 1: New Cash Collection
1. Login to mgmt portal
2. Add new collection:
   - Name: Select any contributor with valid mobile
   - Amount: ₹100
   - Contribution Type: Cash (1)
3. Save
4. Check error_log table for any warnings
5. Check person_messages and group_messages for new pending entries

### Test Scenario 2: Check Message was Queued
```sql
-- Find latest message for a specific contributor
SELECT * FROM person_messages
WHERE mobileno LIKE '%9172820321%'
ORDER BY created_at DESC
LIMIT 1;

-- Check the message text and file_link
```

### Test Scenario 3: External Automation Picks Up Message
The external WhatsApp automation script should:
1. Call `/api/getPendingMessages` (polls every 30 seconds)
2. Get messages with `status='pending'`
3. Send via WhatsApp API
4. Call `/api/updateMessageStatus` with `status='sent'`

## Deployment Steps

1. **Commit and push these changes**:
```bash
cd ~/chhath-full-codebase
git add mgmt/backend/src/whatsapp.js WHATSAPP_DEBUG_GUIDE.md
git commit -m "Fix: Add comprehensive WhatsApp queue error logging"
git push origin main
```

2. **Deploy backend** (Cloudflare Worker):
```bash
cd mgmt/backend
npm install
wrangler deploy
```

3. **Test immediately**: Add a new collection and check error_log

## Expected Behavior After Fix

✅ **Success Case**:
- Collection saved
- PDF generated and indexed
- WhatsApp message queued to `person_messages` (status=pending)
- WhatsApp message queued to `group_messages` (status=pending)
- External automation picks up and sends messages
- Status updated to 'sent'

❌ **Failure Case (Now Visible)**:
- Error logged to `error_log` table with specific reason:
  - "No active group template found"
  - "No active person template found"
  - "Invalid or missing WhatsApp number"
  - Actual error with stack trace

## Next Steps

1. Deploy this fix
2. Add a new test collection
3. Run SQL queries above to check error_log
4. Share the error_log results with me
5. I'll help you fix the specific configuration issue

---

**Key Point**: Before this fix, errors were **completely silent**. Now they're logged and debuggable! 🔍
