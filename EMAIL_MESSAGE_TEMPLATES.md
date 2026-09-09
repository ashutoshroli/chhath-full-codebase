# Email Message Templates — नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह (Navyuvak Chhath Puja Samiti, Shaharpura, Gardih)

**समिति / Samiti:** नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह
(Navyuvak Chhath Puja Samiti, Shaharpura, Gardih)
**भेजने वाला / From:** `noreply@shaharpura.com`  ·  **उत्तर / Reply-To:** `shaharpura.815312@gmail.com`
**डाउनलोड / Downloads:** https://chhath.shaharpura.com/#downloads

Ready-to-use, professional **email** templates for **every** email the portal can
send via Resend. Each one is **copy-paste** into the matching template screen:
**Email → Collection** or **Email → Loan** in the management portal.

> **How this file is organised**
> - There are **11 email types** (E1–E11): 3 Collection + 8 Loan (all personal).
> - Every email has **two parts you paste separately**: a **Subject** and a **Body**.
>   Both support `{Token}` placeholders.
> - For each: where to paste it, the exact **placeholder tokens** it supports, and
>   a finished **bilingual (English + हिंदी)** subject + body.
> - Any token the system has no value for at send time is replaced with **blank**
>   (and logged) — so only use the tokens listed for that email. Casing must match.

---

## ⚠️ Rules that apply to every email template

1. **Tokens are case-sensitive.** `{Name}` works; `{name}` or `{NAME}` does not.
2. **Only use the tokens listed under each email.** A token not supplied for that
   email renders as empty text.
3. **Hindi is not automatic.** Where a Hindi token exists (`{NameHindi}`,
   `{VillageHindi}`, `{FatherNameHindi}`, `{LoanerNameHindi}`) you must place it
   yourself. `{Guarantor1..3}` and `{Role}` have **no** Hindi variant.
4. **Subject + Body are separate fields.** Keep the Subject short; the Body can be
   multi-line.
5. **Email is PERSONAL only.** Unlike WhatsApp there are **no group emails** — every
   email goes to one person's `users.email`. So the loan "group" types are not
   emailed and are not listed here.
6. **Attachment.** For Collection emails, the generated receipt/certificate is
   added to the body as a **download link** (not a binary attachment) when the
   template's document type matches. Loan emails carry an optional static file
   link only.
7. If a person has **no email on file**, that email is simply skipped (and logged)
   — WhatsApp still goes out as before.

---

# 1) COLLECTION EMAILS

**Paste in:** **Email → Collection**. Selected by **Contribution Type**
(`1` = Paisa/money, `2` = Saman/goods, `3` = Kaam/work → Certificate or Receipt
sub-type). Resell (type 4) has no contributor email, so it is not emailed.
**Goes to:** the contributor's email.

**Tokens available for ALL collection emails (E1–E3):**

| Token | Meaning |
|---|---|
| `{Name}` | Contributor name (English) |
| `{NameHindi}` | Contributor name (Hindi) |
| `{Amount}` | Contribution amount |
| `{Year}` | Festival year |
| `{PaymentMethod}` | Cash / Online / etc. |
| `{Village}` | Village (English) |
| `{VillageHindi}` | Village (Hindi) |
| `{FatherName}` | Father's name (English) |
| `{FatherNameHindi}` | Father's name (Hindi) |
| `{Detail}` | Free-text detail of the contribution |

---

## E1 — Collection receipt → CONTRIBUTOR  ·  Contribution Type `1` (Paisa / नकद)

**Attachment:** turn on "Attach the generated document" → **Receipt**.

**Subject:**
```
धन्यवाद {NameHindi} जी — {Year} छठ योगदान रसीद / Thank you, receipt for {Year}
```

**Body:**
```
🙏 धन्यवाद / Thank You 🙏
नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह

आदरणीय {NameHindi} जी,
{Year} के छठ महापर्व हेतु आपके योगदान के लिए समिति हार्दिक आभार व्यक्त करती है।

💰 प्राप्त राशि / Amount: ₹{Amount}
💳 माध्यम / Mode: {PaymentMethod}

आपकी आधिकारिक रसीद डाउनलोड लिंक नीचे दी गई है। कृपया इसे सुरक्षित रखें।
Your official receipt download link is included below. Please keep it safe.

जय छठी मैया! 🌅

— नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह
```

---

## E2 — Collection receipt → CONTRIBUTOR  ·  Contribution Type `2` (Saman / सामान)

**Attachment:** turn on "Attach the generated document" → **Material Receipt**.

**Subject:**
```
धन्यवाद {NameHindi} जी — सामग्री सहयोग रसीद {Year} / Material contribution receipt
```

**Body:**
```
🙏 धन्यवाद / Thank You 🙏
नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह

आदरणीय {NameHindi} जी,
{Year} के छठ महापर्व हेतु आपके द्वारा दी गई सामग्री के लिए समिति आभारी है।

📦 विवरण / Detail: {Detail}

आपकी रसीद डाउनलोड लिंक नीचे संलग्न है / Your receipt link is included below.

जय छठी मैया! 🌅

— नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह
```

---

## E3 — Collection document → CONTRIBUTOR  ·  Contribution Type `3` (Kaam / कार्य)

**Document Type:** choose **Both / Receipt / Certificate** (matches what was
generated). **Attachment:** turn on "Attach the generated document" → **Work
Receipt** or **Certificate** accordingly.

**Subject:**
```
{NameHindi} जी — {Year} सेवा-सहयोग दस्तावेज़ / Your {Year} service document
```

**Body:**
```
🙏 आभार / Thank You 🙏
नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह

आदरणीय {NameHindi} जी,
{Year} के छठ महापर्व में आपके सेवा-सहयोग हेतु समिति हृदय से आभार व्यक्त करती है।

📝 विवरण / Detail: {Detail}

संबंधित दस्तावेज़ का डाउनलोड लिंक नीचे दिया गया है।
The related document download link is included below.

जय छठी मैया! 🌅

— नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह
```

---

# 2) LOAN EMAILS

**Paste in:** **Email → Loan**, then pick the **type** shown for each below.
**Goes to:** the loaner or a guarantor (their `users.email`). Email is an
independent backup channel — it is sent even if the person has no WhatsApp number.
Loan **group** notifications have no email equivalent and are omitted.

**Token groups:**

**(A) Invitation tokens (E4, E5) — the loan terms + the recipient's own link:**

| Token | Meaning |
|---|---|
| `{Name}` / `{NameHindi}` | Recipient's name |
| `{FatherName}` / `{FatherNameHindi}` | Recipient's father's name |
| `{Village}` / `{VillageHindi}` | Recipient's village |
| `{LoanerName}` / `{LoanerNameHindi}` | Loan taker's name |
| `{Amount}` `{Tenure}` `{InterestRate}` | Loan terms |
| `{Guarantor1}` `{Guarantor2}` `{Guarantor3}` | Guarantor names (English) |
| `{ConsentLink}` | **The recipient's own** consent link (use this one) |

**(B) Status tokens (E6–E11) — `notificationData`:**

| Token | Meaning |
|---|---|
| `{Name}` / `{NameHindi}` | The recipient's name |
| `{FatherName}` / `{FatherNameHindi}` | Recipient's father's name |
| `{Village}` / `{VillageHindi}` | Recipient's village |
| `{Role}` | "Loaner" or "Guarantor" (English) |
| `{LoanerName}` / `{LoanerNameHindi}` | Loan taker's name |
| `{Amount}` `{Tenure}` `{InterestRate}` `{Year}` | Loan terms |
| `{Guarantor1}` `{Guarantor2}` `{Guarantor3}` | Guarantor names |

---

## E4 — Consent invitation → LOANER  ·  type `consent_personal_loaner`

**Goes to:** the loan taker. Use **`{ConsentLink}`** for their link.
(Also re-used automatically on **Resend**.)

**Subject:**
```
सहमति आवश्यक — आपका ऋण (₹{Amount}) / Your consent is needed
```

**Body:**
```
🙏 नमस्ते {NameHindi} जी,
नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह

आपके नाम पर निम्न ऋण हेतु आपकी डिजिटल सहमति आवश्यक है:

💰 राशि / Amount: ₹{Amount}
📅 अवधि / Tenure: {Tenure} माह
📈 ब्याज दर / Interest: {InterestRate}% मासिक

कृपया नीचे दिए गए सुरक्षित लिंक पर जाकर अपनी सहमति दर्ज करें:
Please give your consent using your secure link below:

🔗 {ConsentLink}

⚠️ यह लिंक केवल आपके लिए है, कृपया किसी के साथ साझा न करें।
This link is personal to you — please do not share it.

— नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह
```

---

## E5 — Consent invitation → GUARANTOR (×3)  ·  type `consent_personal_guarantor`

**Goes to:** each guarantor. `{Name}` is the guarantor's; `{ConsentLink}` is that
guarantor's own link; `{LoanerName}` is who they are guaranteeing.
(Also re-used automatically on **Resend** and **Replace Guarantor**.)

**Subject:**
```
गारंटर सहमति — {LoanerNameHindi} का ऋण / Guarantor consent needed
```

**Body:**
```
🙏 नमस्ते {NameHindi} जी,
नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह

आपको {LoanerNameHindi} ({LoanerName}) के निम्न ऋण हेतु *गारंटर* के रूप में नामित किया गया है:

💰 राशि / Amount: ₹{Amount}
📅 अवधि / Tenure: {Tenure} माह
📈 ब्याज दर / Interest: {InterestRate}% मासिक

गारंटर के रूप में अपनी सहमति देने हेतु कृपया अपने व्यक्तिगत लिंक पर जाएँ:
Please provide your consent as a guarantor via your personal link:

🔗 {ConsentLink}

⚠️ यह लिंक केवल आपके लिए है। कृपया साझा न करें।
This link is personal to you — please do not share it.

— नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह
```

---

## E6 — Consent OTP → PERSON  ·  type `otp`

**Goes to:** the person opening their consent link — the **email backup** for the
OTP (useful when WhatsApp does not reach them). **Only two tokens:** `{OTP}` and
`{Name}`.

**Subject:**
```
आपका OTP / Your OTP: {OTP}
```

**Body:**
```
🔐 आपका OTP / Your OTP: {OTP}

नमस्ते {Name}, नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह की सहमति प्रक्रिया पूर्ण करने हेतु यह OTP दर्ज करें।
Enter this OTP to verify your loan consent.

यह OTP 10 मिनट के लिए मान्य है। किसी के साथ साझा न करें।
Valid for 10 minutes. Never share this code with anyone.

— नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह
```

---

## E7 — Consent accepted → LOANER  ·  type `consent_accepted_loaner_personal`

**Goes to:** the loaner on every acceptance (own or a guarantor's).

**Subject:**
```
सहमति दर्ज हुई — आपका ऋण / A consent was recorded
```

**Body:**
```
🙏 नमस्ते {NameHindi} जी,
नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह

आपके ऋण (₹{Amount}) की प्रक्रिया में एक सहमति दर्ज हुई है।
A consent has just been recorded for your loan.

हम प्रक्रिया पूरी होने पर आपको सूचित करते रहेंगे।
We will keep you updated as the process continues.

जय छठी मैया! 🌅

— नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह
```

---

## E8 — All guarantors accepted → LOANER  ·  type `all_guarantors_accepted_loaner`

**Goes to:** the loaner, only when all 3 guarantors have accepted.

**Subject:**
```
शुभ समाचार — तीनों गारंटरों की सहमति मिली / All guarantors accepted
```

**Body:**
```
🎉 नमस्ते {NameHindi} जी,
नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह

शुभ समाचार! आपके ऋण (₹{Amount}) हेतु *तीनों गारंटरों* ने अपनी सहमति दे दी है।
Good news! All three guarantors have given their consent for your loan.

🤝 गारंटर / Guarantors: {Guarantor1}, {Guarantor2}, {Guarantor3}

अब समिति द्वारा अंतिम सत्यापन किया जाएगा। आगे की सूचना शीघ्र दी जाएगी।
The committee will now complete the final verification.

— नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह
```

---

## E9 — Consent verified → PERSON  ·  type `consent_verified_personal`

**Goes to:** the person whose consent an admin has verified.

**Subject:**
```
आपकी सहमति सत्यापित हुई / Your consent is verified
```

**Body:**
```
✅ नमस्ते {NameHindi} जी,
नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह

{LoanerNameHindi} ({LoanerName}) के ऋण हेतु आपकी {Role} सहमति समिति द्वारा *सत्यापित* कर दी गई है।
Your consent has been verified by the committee.

आपके सहयोग हेतु धन्यवाद।
Thank you for your cooperation.

— नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह
```

---

## E10 — Loan passed → LOANER  ·  type `loan_passed_personal`

**Goes to:** the loaner, only when every consent on the loan is verified.

**Subject:**
```
बधाई — आपका ऋण स्वीकृत / Congratulations, your loan is approved
```

**Body:**
```
🎉 बधाई / Congratulations 🎉
नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह

आदरणीय {NameHindi} जी,
आपके ऋण (₹{Amount}) की सभी सहमतियाँ सत्यापित हो चुकी हैं और ऋण *स्वीकृत* कर दिया गया है।
All consents are verified and your loan has been APPROVED.

📅 अवधि / Tenure: {Tenure} माह
📈 ब्याज दर / Interest: {InterestRate}% मासिक

वितरण (disbursement) की सूचना शीघ्र दी जाएगी।
Disbursement details will follow shortly.

— नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह
```

---

## E11 — Disbursement confirmation → LOANER  ·  type `disbursement`

**Goes to:** the loaner when a Superadmin marks the loan disbursed. In addition to
the status tokens, three extra tokens are available:

| Token | Meaning |
|---|---|
| `{CashAmount}` | Amount paid in cash |
| `{OnlineAmount}` | Amount paid online |
| `{TotalAmount}` | Total disbursed |

**Subject:**
```
ऋण वितरित — ₹{TotalAmount} / Loan disbursed
```

**Body:**
```
💸 ऋण वितरण / Loan Disbursed
नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह

आदरणीय {NameHindi} जी,
आपका स्वीकृत ऋण वितरित कर दिया गया है।
Your approved loan has been disbursed.

💵 नकद / Cash: ₹{CashAmount}
🏦 ऑनलाइन / Online: ₹{OnlineAmount}
💰 कुल / Total: ₹{TotalAmount}
📅 अवधि / Tenure: {Tenure} माह
📈 ब्याज दर / Interest: {InterestRate}% मासिक

कृपया समय पर किश्तों का भुगतान सुनिश्चित करें।
Kindly ensure timely repayment of instalments.

जय छठी मैया! 🌅

— नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह
```

---

# Quick reference — which tokens each email supports

| # | Email | Type | Supported tokens |
|---|-------|------|------------------|
| E1 | Collection receipt (Paisa) | Collection · type 1 | `{Name}` `{NameHindi}` `{Amount}` `{Year}` `{PaymentMethod}` `{Village}` `{VillageHindi}` `{FatherName}` `{FatherNameHindi}` `{Detail}` |
| E2 | Collection receipt (Saman) | Collection · type 2 | same as E1 |
| E3 | Collection document (Kaam) | Collection · type 3 (+ sub-type) | same as E1 |
| E4 | Consent invite → loaner | `consent_personal_loaner` | invitation tokens + `{ConsentLink}` |
| E5 | Consent invite → guarantor | `consent_personal_guarantor` | invitation tokens + `{ConsentLink}` |
| E6 | OTP | `otp` | `{OTP}` `{Name}` |
| E7 | Accepted → loaner | `consent_accepted_loaner_personal` | notificationData |
| E8 | All guarantors accepted | `all_guarantors_accepted_loaner` | notificationData |
| E9 | Verified → person | `consent_verified_personal` | notificationData |
| E10 | Loan passed | `loan_passed_personal` | notificationData |
| E11 | Disbursement | `disbursement` | notificationData + `{CashAmount}` `{OnlineAmount}` `{TotalAmount}` |

_notificationData = `{Name}` `{NameHindi}` `{FatherName}` `{FatherNameHindi}`
`{Village}` `{VillageHindi}` `{Role}` `{LoanerName}` `{LoanerNameHindi}`
`{Amount}` `{Tenure}` `{InterestRate}` `{Year}` `{Guarantor1..3}`_

> **Not emailed (personal-only):** the loan *group* notifications
> (`consent_group`, `consent_accepted_group`) and the WhatsApp collection *group*
> announcements have **no email equivalent** — email always goes to one person.

---

*Generated for नवयुवक छठ पूजा समिति, शहरपुरा, गरडीह (Navyuvak Chhath Puja Samiti,
Shaharpura, Gardih). From: noreply@shaharpura.com · Reply-To:
shaharpura.815312@gmail.com · Downloads: https://chhath.shaharpura.com/#downloads.
Tokens verified against `email.js` (triggerCollectionEmail + queueLoanEmail),
`whatsapp.js` and `loans.js`.*
