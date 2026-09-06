# WhatsApp Message Templates — Chhath Puja Samiti (नवयुवक चौक छठ पूजा समिति, शहरपुरा)

Ready-to-use, professional WhatsApp templates for **every** message the portal
can send. Each one is **copy-paste** into the matching template screen in the
management portal.

> **How this file is organised**
> - There are **15 message types** (W1–W15) grouped by area: Collections, Loan
>   Consent, and System.
> - For each: where to paste it, the exact **placeholder tokens** it supports,
>   and a finished **bilingual (English + हिंदी)** template.
> - Placeholders use `{Token}` syntax. Any token the system does not have a value
>   for at send time is replaced with **blank** (and logged) — so only use the
>   tokens listed for that message. Casing must match exactly.

---

## ⚠️ Rules that apply to every template

1. **Tokens are case-sensitive.** `{Name}` works; `{name}` or `{NAME}` does not.
2. **Only use the tokens listed under each message.** A token not supplied for
   that message renders as empty text.
3. **Hindi is not automatic.** There is no auto-translation. Where a Hindi
   variant token exists (e.g. `{NameHindi}`, `{VillageHindi}`, `{FatherNameHindi}`,
   `{LoanerNameHindi}`) you must place it yourself. `{Guarantor1..3}` and `{Role}`
   have **no** Hindi variant.
4. **Do not type literal `{` or `}`** anywhere except around a real token.
5. These are the **WhatsApp** tokens. The consent **PDF/DOCX** documents use a
   completely different `UPPER_SNAKE_CASE` set — do not mix them up.

---

# 1) COLLECTION MESSAGES

Triggered when a staff member saves a **Collection** entry. Category is the
**Contribution Type**:
`1` = Paisa / money, `2` = Saman / goods, `3` = Kaam / work (Certificate or
Receipt sub-type), `4` = Resell.

**Tokens available for ALL collection messages (W1 & W2):**

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
| `{ItemName}` | Item name (only populated for **Resell**, type 4) |

---

## W1 — Collection announcement → GROUP

**Paste in:** WhatsApp → Templates → **Group** → Contribution Type `1` / `2` / `3`
(and for type 3, the Certificate/Receipt sub-type) / `4`.
**Goes to:** every active WhatsApp group.

### Type 1 — Paisa / नकद योगदान (Group)

```
🪔 *छठ महापर्व — योगदान की सूचना* 🪔
नवयुवक चौक छठ पूजा समिति, शहरपुरा

आदरणीय सदस्यगण,
हमें यह बताते हुए हर्ष है कि निम्न श्रद्धालु ने {Year} के छठ महापर्व हेतु सहयोग राशि प्रदान की है:

🙏 योगदानकर्ता / Contributor: {NameHindi} ({Name})
👨‍👦 पिता / Father: {FatherNameHindi}
🏡 गाँव / Village: {VillageHindi}
💰 राशि / Amount: ₹{Amount}
💳 माध्यम / Mode: {PaymentMethod}

समिति आपके इस सहयोग के लिए हृदय से आभार व्यक्त करती है।
जय छठी मैया! 🌅

_This is an official update from the Samiti._
```

### Type 2 — Saman / सामान का योगदान (Group)

```
🪔 *छठ महापर्व — सामग्री सहयोग की सूचना* 🪔
नवयुवक चौक छठ पूजा समिति, शहरपुरा

निम्न श्रद्धालु द्वारा {Year} के छठ महापर्व हेतु सामग्री का सहयोग प्राप्त हुआ है:

🙏 योगदानकर्ता / Contributor: {NameHindi} ({Name})
🏡 गाँव / Village: {VillageHindi}
📦 विवरण / Detail: {Detail}

समिति इस उदार सहयोग के लिए आभारी है।
जय छठी मैया! 🌅
```

### Type 3 — Kaam / कार्य सहयोग (Group)

```
🪔 *छठ महापर्व — सेवा/कार्य सहयोग* 🪔
नवयुवक चौक छठ पूजा समिति, शहरपुरा

{Year} के छठ महापर्व हेतु निम्न श्रद्धालु का सेवा-सहयोग सादर स्वीकार किया गया है:

🙏 सहयोगी / Contributor: {NameHindi} ({Name})
🏡 गाँव / Village: {VillageHindi}
📝 विवरण / Detail: {Detail}

आपके सहयोग हेतु समिति आभार व्यक्त करती है।
जय छठी मैया! 🌅
```

### Type 4 — Resell / पुनर्विक्रय (Group)

```
🪔 *छठ महापर्व — पुनर्विक्रय सूचना* 🪔
नवयुवक चौक छठ पूजा समिति, शहरपुरा

निम्न सामग्री का पुनर्विक्रय {Year} में दर्ज किया गया है:

📦 वस्तु / Item: {ItemName}
📝 विवरण / Detail: {Detail}
💰 राशि / Amount: ₹{Amount}

जय छठी मैया! 🌅
```

---

## W2 — Collection receipt → CONTRIBUTOR (person)

**Paste in:** WhatsApp → Templates → **Person** → Contribution Type `1` / `2` / `3`
(+ sub-type).
**Goes to:** the contributor. Not sent for Resell (type 4).
**File attachment:** the generated receipt/certificate PDF is attached
automatically when the template's document type matches.

### Type 1 — Paisa / नकद रसीद (Person)

```
🙏 *धन्यवाद / Thank You* 🙏
नवयुवक चौक छठ पूजा समिति, शहरपुरा

आदरणीय {NameHindi} जी,
{Year} के छठ महापर्व हेतु आपके योगदान के लिए समिति हार्दिक आभार व्यक्त करती है।

💰 प्राप्त राशि / Amount: ₹{Amount}
💳 माध्यम / Mode: {PaymentMethod}

आपकी रसीद इस संदेश के साथ संलग्न है। कृपया इसे सुरक्षित रखें।
Your official receipt is attached with this message.

जय छठी मैया! 🌅
```

### Type 2 — Saman / सामान रसीद (Person)

```
🙏 *धन्यवाद / Thank You* 🙏
नवयुवक चौक छठ पूजा समिति, शहरपुरा

आदरणीय {NameHindi} जी,
{Year} के छठ महापर्व हेतु आपके द्वारा दी गई सामग्री के लिए समिति आभारी है।

📦 विवरण / Detail: {Detail}

आपकी रसीद संलग्न है / Your receipt is attached.
जय छठी मैया! 🌅
```

### Type 3 — Kaam / प्रमाण-पत्र या रसीद (Person)

```
🙏 *आभार / Thank You* 🙏
नवयुवक चौक छठ पूजा समिति, शहरपुरा

आदरणीय {NameHindi} जी,
{Year} के छठ महापर्व में आपके सेवा-सहयोग हेतु समिति हृदय से आभार व्यक्त करती है।

📝 विवरण / Detail: {Detail}

संबंधित दस्तावेज़ इस संदेश के साथ संलग्न है।
The related document is attached with this message.

जय छठी मैया! 🌅
```

---

# 2) LOAN CONSENT MESSAGES

The committee runs an interest-based loan program. Each loan needs the loaner and
**3 guarantors** to give digital consent through a personal link. These templates
go in **WhatsApp → Templates → Loan Templates**, selected by the `type` shown.

**Two token groups are used across these messages:**

**(A) `baseData` — used by the invitation messages (W3, and the base of W4/W5):**

| Token | Meaning |
|---|---|
| `{LoanerName}` / `{LoanerNameHindi}` | Loan taker's name |
| `{Amount}` | Loan amount |
| `{Tenure}` | Tenure (months) |
| `{InterestRate}` | Monthly interest rate |
| `{Guarantor1}` `{Guarantor2}` `{Guarantor3}` | Guarantor names (English only) |
| `{LoanerConsentLink}` | Loaner's consent link |
| `{Guarantor1ConsentLink}` `{Guarantor2ConsentLink}` `{Guarantor3ConsentLink}` | Each guarantor's link |

**(B) `notificationData` — used by the status messages (W7–W14):**

| Token | Meaning |
|---|---|
| `{Name}` / `{NameHindi}` | The recipient's name |
| `{FatherName}` / `{FatherNameHindi}` | Recipient's father's name |
| `{Village}` / `{VillageHindi}` | Recipient's village |
| `{Role}` | "Loaner" or "Guarantor" (English) |
| `{LoanerName}` / `{LoanerNameHindi}` | Loan taker's name |
| `{Amount}` `{Tenure}` `{InterestRate}` `{Year}` | Loan terms |
| `{Guarantor1}` `{Guarantor2}` `{Guarantor3}` | Guarantor names |

Individual-invite messages (W4, W5, W12, W13) also supply `{Name}`, `{NameHindi}`,
`{FatherName}`, `{FatherNameHindi}`, `{Village}`, `{VillageHindi}` and
**`{ConsentLink}`** (the recipient's own link — use this one in personal invites).

---

## W3 — Loan consent invitation → GROUP  ·  type `consent_group`

**Goes to:** every active group. Tokens: **baseData** set only.

```
🔔 *ऋण सहमति प्रक्रिया आरंभ / Loan Consent Initiated*
नवयुवक चौक छठ पूजा समिति, शहरपुरा

निम्न ऋण हेतु सहमति प्रक्रिया आरंभ की गई है:

👤 ऋण लेने वाले / Loaner: {LoanerNameHindi} ({LoanerName})
💰 राशि / Amount: ₹{Amount}
📅 अवधि / Tenure: {Tenure} माह
📈 ब्याज दर / Interest: {InterestRate}% मासिक
🤝 गारंटर / Guarantors: {Guarantor1}, {Guarantor2}, {Guarantor3}

संबंधित सदस्यों को व्यक्तिगत सहमति लिंक भेज दिए गए हैं।
Consent links have been sent to the concerned members.
```

---

## W4 — Consent invitation → LOANER  ·  type `consent_personal_loaner`

**Goes to:** the loan taker. Use **`{ConsentLink}`** for their link.

```
🙏 नमस्ते {NameHindi} जी,
नवयुवक चौक छठ पूजा समिति, शहरपुरा

आपके नाम पर निम्न ऋण हेतु आपकी डिजिटल सहमति आवश्यक है:

💰 राशि / Amount: ₹{Amount}
📅 अवधि / Tenure: {Tenure} माह
📈 ब्याज दर / Interest: {InterestRate}% मासिक

कृपया नीचे दिए गए सुरक्षित लिंक पर जाकर अपनी सहमति दर्ज करें:
Please give your consent using your secure link below:

🔗 {ConsentLink}

⚠️ यह लिंक केवल आपके लिए है, कृपया इसे किसी के साथ साझा न करें।
This link is personal to you — please do not share it.
```

---

## W5 — Consent invitation → GUARANTOR (×3)  ·  type `consent_personal_guarantor`

**Goes to:** each of the 3 guarantors. `{Name}`/`{Village}` are the guarantor's;
`{ConsentLink}` is that guarantor's own link; `{LoanerName}` is who they are
guaranteeing.

```
🙏 नमस्ते {NameHindi} जी,
नवयुवक चौक छठ पूजा समिति, शहरपुरा

आपको {LoanerNameHindi} ({LoanerName}) के निम्न ऋण हेतु *गारंटर* के रूप में नामित किया गया है:

💰 राशि / Amount: ₹{Amount}
📅 अवधि / Tenure: {Tenure} माह
📈 ब्याज दर / Interest: {InterestRate}% मासिक

गारंटर के रूप में अपनी सहमति देने हेतु कृपया अपने व्यक्तिगत लिंक पर जाएँ:
Please provide your consent as a guarantor via your personal link:

🔗 {ConsentLink}

⚠️ यह लिंक केवल आपके लिए है। कृपया साझा न करें।
This link is personal to you — please do not share it.
```

---

## W6 — Consent OTP → PERSON  ·  type `otp`

**Goes to:** the person opening their consent link. **Only two tokens:** `{OTP}`
and `{Name}`. Keep it short and unambiguous.

```
🔐 आपका OTP / Your OTP: *{OTP}*

नमस्ते {Name}, नवयुवक चौक छठ पूजा समिति की सहमति प्रक्रिया पूर्ण करने हेतु यह OTP दर्ज करें।
Enter this OTP to verify your consent.

यह OTP 10 मिनट के लिए मान्य है। किसी के साथ साझा न करें।
Valid for 10 minutes. Never share this code with anyone.
```

---

## W7 — Consent accepted → GROUP  ·  type `consent_accepted_group`

**Goes to:** every active group. Tokens: **notificationData** set.

```
✅ *सहमति प्राप्त / Consent Received*
नवयुवक चौक छठ पूजा समिति, शहरपुरा

{LoanerNameHindi} ({LoanerName}) के ऋण हेतु निम्न द्वारा सहमति दर्ज की गई है:

👤 नाम / Name: {NameHindi} ({Name})
🎭 भूमिका / Role: {Role}
💰 ऋण राशि / Loan Amount: ₹{Amount}

प्रक्रिया अद्यतन (updated) कर दी गई है।
```

---

## W8 — Consent accepted → LOANER  ·  type `consent_accepted_loaner_personal`

**Goes to:** the loaner on every acceptance (own or a guarantor's).

```
🙏 नमस्ते {NameHindi} जी,
नवयुवक चौक छठ पूजा समिति, शहरपुरा

आपके ऋण (₹{Amount}) की प्रक्रिया में एक सहमति दर्ज हुई है।
A consent has just been recorded for your loan.

हम प्रक्रिया पूरी होने पर आपको सूचित करते रहेंगे।
We will keep you updated as the process continues.

जय छठी मैया! 🌅
```

---

## W9 — All guarantors accepted → LOANER  ·  type `all_guarantors_accepted_loaner`

**Goes to:** the loaner, only when all 3 guarantors have accepted.

```
🎉 नमस्ते {NameHindi} जी,
नवयुवक चौक छठ पूजा समिति, शहरपुरा

शुभ समाचार! आपके ऋण (₹{Amount}) हेतु *तीनों गारंटरों* ने अपनी सहमति दे दी है।
Good news! All three guarantors have given their consent for your loan.

🤝 गारंटर / Guarantors: {Guarantor1}, {Guarantor2}, {Guarantor3}

अब समिति द्वारा अंतिम सत्यापन किया जाएगा। आगे की सूचना शीघ्र दी जाएगी।
The committee will now complete the final verification.
```

---

## W10 — Consent verified → PERSON  ·  type `consent_verified_personal`

**Goes to:** the person whose consent an admin has verified.

```
✅ नमस्ते {NameHindi} जी,
नवयुवक चौक छठ पूजा समिति, शहरपुरा

{LoanerNameHindi} ({LoanerName}) के ऋण हेतु आपकी {Role} सहमति समिति द्वारा *सत्यापित* कर दी गई है।
Your consent has been verified by the committee.

आपके सहयोग हेतु धन्यवाद।
Thank you for your cooperation.
```

---

## W11 — Loan passed → LOANER  ·  type `loan_passed_personal`

**Goes to:** the loaner, only when every consent on the loan is verified.

```
🎉 *बधाई / Congratulations* 🎉
नवयुवक चौक छठ पूजा समिति, शहरपुरा

आदरणीय {NameHindi} जी,
आपके ऋण (₹{Amount}) की सभी सहमतियाँ सत्यापित हो चुकी हैं और ऋण *स्वीकृत* कर दिया गया है।
All consents are verified and your loan has been APPROVED.

📅 अवधि / Tenure: {Tenure} माह
📈 ब्याज दर / Interest: {InterestRate}% मासिक

वितरण (disbursement) की सूचना शीघ्र दी जाएगी।
Disbursement details will follow shortly.
```

---

## W12 — Resend consent invitation → PERSON  ·  reuses `consent_personal_loaner` / `consent_personal_guarantor`

**Note:** W12 **reuses the W4/W5 templates**. No separate template needed — when
Superadmin clicks *Resend*, the loaner template (for a loaner) or guarantor
template (for a guarantor) is re-sent with a fresh `{ConsentLink}`. Design W4 and
W5 well and this is covered automatically. (Capped at 5 resends.)

---

## W13 — Invitation to replacement guarantor → PERSON  ·  reuses `consent_personal_guarantor`

**Note:** W13 also **reuses the W5 guarantor template**. When a guarantor is
swapped, the new guarantor receives the W5 message with their new `{ConsentLink}`.
No separate template needed.

---

## W14 — Disbursement confirmation → LOANER  ·  type `disbursement`

**Goes to:** the loaner when a Superadmin marks the loan disbursed. In addition to
the **notificationData** tokens, three extra tokens are available:

| Token | Meaning |
|---|---|
| `{CashAmount}` | Amount paid in cash |
| `{OnlineAmount}` | Amount paid online |
| `{TotalAmount}` | Total disbursed |

```
💸 *ऋण वितरण / Loan Disbursed*
नवयुवक चौक छठ पूजा समिति, शहरपुरा

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
```

---

# 3) SYSTEM MESSAGES

## W15 — Error alert → SUPERADMIN(s)

**This is NOT template-editable.** The body is generated by the system
(`errorLog.js`) and sent as a `priority` message to every Superadmin when someone
taps *"Report to Superadmin"* (rate-limited to 10/hour). It is shown here only for
reference — you cannot change it from the portal:

```
⚠️ Error Report
Page: {page}
Source: {source}
Message: {message}
Time: {created_at}
Ref: {error_id}
```

> If you want this wording changed, it must be edited in code
> (`mgmt/backend/src/errorLog.js`), not in a template screen.

---

# Quick reference — which tokens each message supports

| # | Message | Supported tokens |
|---|---------|------------------|
| W1/W2 | Collections | `{Name}` `{NameHindi}` `{Amount}` `{Year}` `{PaymentMethod}` `{Village}` `{VillageHindi}` `{FatherName}` `{FatherNameHindi}` `{Detail}` `{ItemName}`(resell) |
| W3 | Consent group | `{LoanerName}` `{LoanerNameHindi}` `{Amount}` `{Tenure}` `{InterestRate}` `{Guarantor1..3}` `{LoanerConsentLink}` `{Guarantor1..3ConsentLink}` |
| W4/W5 | Consent invite (loaner/guarantor) | baseData + `{Name}` `{NameHindi}` `{FatherName}` `{FatherNameHindi}` `{Village}` `{VillageHindi}` `{ConsentLink}` |
| W6 | OTP | `{OTP}` `{Name}` |
| W7 | Accepted → group | notificationData |
| W8 | Accepted → loaner | notificationData |
| W9 | All guarantors accepted | notificationData |
| W10 | Verified → person | notificationData |
| W11 | Loan passed | notificationData |
| W12 | Resend (reuses W4/W5) | as W4/W5 + `{ConsentLink}` |
| W13 | Replacement guarantor (reuses W5) | as W5 + `{ConsentLink}` |
| W14 | Disbursement | notificationData + `{CashAmount}` `{OnlineAmount}` `{TotalAmount}` |
| W15 | Error alert (system, not editable) | — |

_notificationData = `{Name}` `{NameHindi}` `{FatherName}` `{FatherNameHindi}`
`{Village}` `{VillageHindi}` `{Role}` `{LoanerName}` `{LoanerNameHindi}`
`{Amount}` `{Tenure}` `{InterestRate}` `{Year}` `{Guarantor1..3}`_

---

*Generated for नवयुवक चौक छठ पूजा समिति, शहरपुरा. Tokens verified against
`whatsapp.js`, `loans.js`, `consentPlaceholders.js` and `errorLog.js`.*
