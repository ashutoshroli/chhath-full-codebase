-- ============================================================================
-- Loan consent PREVIEW page templates — DB: chhath-templates
--
-- RUN THIS FILE AGAINST **chhath-templates** ONLY:
--   wrangler d1 execute chhath-templates --remote --file=./migration/2026-09-18/01-loan-consent-preview-templates.sql
--
-- Test it locally first (safe, hits the local replica, not production):
--   wrangler d1 execute chhath-templates --local --file=./migration/2026-09-18/01-loan-consent-preview-templates.sql
--
-- WHY:
--   The public consent preview page (mgmt/frontend-svelte .../consent/[token])
--   renders the stored consent_page_templates row for 'loaner_consent' /
--   'guarantor_consent', substituting [A-Z0-9_]+ bracket tokens then running
--   marked + DOMPurify. The committee reset the templates DB, so the correct
--   current bilingual (Hindi + English) consent text must be re-established. This
--   seeds BOTH rows with the committee's exact provided text. The document body's
--   declaration checkboxes (☐) and the [ ACCEPT & CONFIRM LOAN ] /
--   [ ACCEPT CONSENT ] / [ DECLINE CONSENT ] markers contain spaces, so they do
--   NOT match the placeholder regex and render as plain display text — the real
--   accept / declaration-tick / decline controls are the page's existing
--   hard-coded checkbox + OTP + Accept/Decline buttons and are unchanged.
--
-- IDEMPOTENT / SELF-HEALING: consent_page_templates has NO UNIQUE index on
--   `type`, so ON CONFLICT is unavailable. Each type is seeded with
--   DELETE-by-type THEN INSERT, so re-running establishes exactly one row per
--   type with the intended text regardless of any prior, stale, duplicated, or
--   absent rows. updated_at is a FIXED ISO literal (not datetime('now')) so the
--   file checksum is stable and re-application produces identical rows.
--
-- NO explicit BEGIN/COMMIT/SAVEPOINT — D1 rejects them in --file scripts.
-- ============================================================================

-- ---------------------------------------------------------------- loaner_consent
DELETE FROM consent_page_templates WHERE type = 'loaner_consent';
INSERT INTO consent_page_templates (type, text, updated_at)
VALUES ('loaner_consent', 'नवयुवक छठ पूजा समिति

NAVYUVAK CHHATH PUJA SAMITI

ऋण प्राप्ति एवं Final Consent

LOAN RECEIPT & FINAL CONSENT

1. ऋण संबंधी विवरण / Loan Details

ऋण प्राप्तकर्ता / Loaner: "[LOANER_NAME]"

मूलधन / ऋण राशि / Principal Loan Amount:
"₹[LOAN_AMOUNT]"

मासिक ब्याज दर / Monthly Interest Rate:
"[MONTHLY_INTEREST_RATE]% प्रति माह / per month"

न्यूनतम ब्याज अवधि / Minimum Interest Period:
"[MINIMUM_TENURE_MONTHS] माह / months"

अधिकतम भुगतान तिथि / Maximum Repayment Date:
"[FINAL_REPAYMENT_DATE]"

Loan Consent Reference ID:
"[LOAN_CONSENT_ID]"

---

2. महत्वपूर्ण तिथियां एवं अवसर

IMPORTANT DATES & OCCASIONS

दीपावली के अगले दिन / Day After Diwali:
"[DIWALI_NEXT_DAY_DATE]" — "[DIWALI_NEXT_DAY_DAY_NAME]"

नहाय-खाय का दिन / Nahay-Khay Day:
"[NAHAY_KHAY_DATE]" — "[NAHAY_KHAY_DAY_NAME]"

अधिकतम भुगतान का अंतिम दिन / Final Repayment Day:
"[FINAL_REPAYMENT_DATE]" — "[FINAL_REPAYMENT_DAY_NAME]"

छठ पूजा के सुबह अर्घ्य का दिन / Chhath Morning Arghya Day:
"[CHHATH_MORNING_ARGHYA_DATE]" — "[CHHATH_MORNING_ARGHYA_DAY_NAME]"

«इन तिथियों का उपयोग ऋण की अवधि, भुगतान की अंतिम सीमा और गारंटर संबंधी जिम्मेदारी को स्पष्ट करने के लिए किया गया है।

These dates are provided to clearly define the loan period, final repayment deadline, and guarantor-related responsibility.»

---

3. गारंटर Consent Status

GUARANTOR CONSENT STATUS

गारंटर 1 / Guarantor 1

नाम / Name: "[GUARANTOR_1_NAME]"
Status: "[GUARANTOR_1_STATUS]"

गारंटर 2 / Guarantor 2

नाम / Name: "[GUARANTOR_2_NAME]"
Status: "[GUARANTOR_2_STATUS]"

गारंटर 3 / Guarantor 3

नाम / Name: "[GUARANTOR_3_NAME]"
Status: "[GUARANTOR_3_STATUS]"

---

4. Final Acceptance की शर्त

FINAL ACCEPTANCE CONDITION

मैं, "[LOANER_NAME]", समझता/समझती हूँ कि मेरा Final Loan Acceptance तभी उपलब्ध होगा जब तीनों गारंटर अपनी Consent स्वीकार कर चुके हों।

I, "[LOANER_NAME]", understand that my Final Loan Acceptance will only become available after all three guarantors have accepted their consent.

आवश्यक स्थिति / Required Status

"[GUARANTOR_1_NAME]" → Accepted
"[GUARANTOR_2_NAME]" → Accepted
"[GUARANTOR_3_NAME]" → Accepted

"3 / 3 GUARANTORS ACCEPTED"

यदि किसी भी गारंटर का Status Pending या Declined है, तो मेरा Final Acceptance Locked रहेगा।

If any guarantor''s status is Pending or Declined, my Final Acceptance will remain locked.

---

5. ऋण का विवरण

LOAN DETAILS

मैं, [LOANER_NAME], यह स्वीकार करता/करती हूँ कि नवयुवक छठ पूजा समिति के वर्ष "[FUND_YEAR]" की बची हुई राशि में से ₹[LOAN_AMOUNT]/- की राशि मुझे [MONTHLY_INTEREST_RATE]% प्रति माह की ब्याज दर पर दी गई है।

I, [LOANER_NAME], acknowledge that an amount of ₹[LOAN_AMOUNT]/- from the remaining funds of Navyuvak Chhath Puja Samiti for the year "[FUND_YEAR]" has been provided to me at an interest rate of [MONTHLY_INTEREST_RATE]% per month.

मैंने ऋण राशि, ब्याज दर, न्यूनतम ब्याज अवधि, अधिकतम भुगतान अवधि, अंतिम भुगतान तिथि और गारंटरों से संबंधित सभी शर्तों को पढ़कर और समझकर स्वीकार किया है।

I have read and understood all terms relating to the loan amount, interest rate, minimum interest period, maximum repayment period, final repayment date, and guarantors.

---

6. न्यूनतम ब्याज अवधि

MINIMUM INTEREST PERIOD

इस ऋण की न्यूनतम ब्याज अवधि "[MINIMUM_TENURE_MONTHS] माह" होगी।

The minimum interest period for this loan shall be "[MINIMUM_TENURE_MONTHS] months".

यदि मैं "[MINIMUM_TENURE_MONTHS] माह" पूरे होने से पहले मूलधन वापस कर देता/देती हूँ, तब भी पूरे "[MINIMUM_TENURE_MONTHS] माह" का निर्धारित ब्याज देना अनिवार्य होगा।

If I repay the principal before completion of "[MINIMUM_TENURE_MONTHS] months", I shall still be required to pay the full prescribed interest for "[MINIMUM_TENURE_MONTHS] months".

अर्थात समय से पहले भुगतान करने पर भी न्यूनतम अवधि के ब्याज में कोई कमी नहीं की जाएगी।

Therefore, early repayment shall not reduce the minimum interest payable.

---

7. अधिकतम भुगतान अवधि

MAXIMUM REPAYMENT PERIOD

इस ऋण की अधिकतम भुगतान तिथि:

"[FINAL_REPAYMENT_DATE]"

होगी।

The maximum repayment date for this loan shall be:

"[FINAL_REPAYMENT_DATE]"

मुझे इस तिथि तक मूलधन एवं उस समय तक देय ब्याज की पूरी राशि वापस करनी होगी।

I shall repay the complete principal amount along with all interest due up to this date.

---

8. अंतिम तिथि तक भुगतान न होने पर

FAILURE TO REPAY BY THE FINAL DATE

यदि मैं "[FINAL_REPAYMENT_DATE]" तक ऋण की पूरी राशि वापस नहीं करता/करती हूँ, तो समझौते में निर्धारित गारंटर संबंधी जिम्मेदारी लागू होगी।

If I fail to repay the complete loan amount by "[FINAL_REPAYMENT_DATE]", the guarantor-related responsibility specified in this agreement shall apply.

यदि "[CHHATH_MORNING_ARGHYA_DATE]" की सुबह तक भी ऋण की देय राशि वापस नहीं की जाती है, तो तीनों गारंटरों की निर्धारित जिम्मेदारी के अनुसार समिति की देय राशि की भरपाई की जाएगी।

If the amount due is still not repaid by the morning of "[CHHATH_MORNING_ARGHYA_DATE]", the three guarantors shall be responsible for fulfilling the committee''s due amount as per the agreed terms.

---

9. देय राशि

AMOUNT PAYABLE

समय से पहले भुगतान करने पर भी न्यूनतम "[MINIMUM_TENURE_MONTHS] माह" का पूरा ब्याज देय रहेगा।

Even in case of early repayment, the full minimum interest for "[MINIMUM_TENURE_MONTHS] months" shall remain payable.

मूलधन / Principal: "₹[LOAN_AMOUNT]"

ब्याज दर / Interest Rate: "[MONTHLY_INTEREST_RATE]% प्रति माह / per month"

न्यूनतम ब्याज अवधि / Minimum Interest Period: "[MINIMUM_TENURE_MONTHS] माह / months"

अतः न्यूनतम देय राशि मूलधन एवं "[MINIMUM_TENURE_MONTHS] माह" के ब्याज के आधार पर निर्धारित होगी।

Therefore, the minimum amount payable shall be determined based on the principal amount plus interest for "[MINIMUM_TENURE_MONTHS] months".

---

10. गारंटरों की जानकारी

GUARANTOR INFORMATION

इस ऋण के लिए निर्धारित गारंटर हैं:

The designated guarantors for this loan are:

1. "[GUARANTOR_1_NAME]"
2. "[GUARANTOR_2_NAME]"
3. "[GUARANTOR_3_NAME]"

मैं स्वीकार करता/करती हूँ कि इन सभी गारंटरों को ऋण की राशि, ब्याज, अवधि, अंतिम भुगतान तिथि तथा उनकी गारंटर संबंधी जिम्मेदारियों की जानकारी दी गई है।

I acknowledge that all guarantors have been informed about the loan amount, interest, tenure, final repayment date, and their responsibilities as guarantors.

---

11. Final Loan Confirmation

सभी तीनों गारंटरों द्वारा Consent स्वीकार किए जाने के बाद ही मैं Final Loan Acceptance कर सकूँगा/सकूँगी।

I will be able to provide Final Loan Acceptance only after all three guarantors have accepted their consent.

Final Acceptance के समय मैं यह पुष्टि करता/करती हूँ कि:

At the time of Final Acceptance, I confirm that:

- मैंने ऋण राशि समझ ली है।
  I understand the loan amount.

- मैंने "[MONTHLY_INTEREST_RATE]%" मासिक ब्याज दर समझ ली है।
  I understand the "[MONTHLY_INTEREST_RATE]%" monthly interest rate.

- मैंने न्यूनतम "[MINIMUM_TENURE_MONTHS] माह" की ब्याज शर्त समझ ली है।
  I understand the minimum "[MINIMUM_TENURE_MONTHS] months" interest condition.

- मैंने समय से पहले भुगतान करने पर भी पूरे न्यूनतम अवधि के ब्याज की शर्त स्वीकार की है।
  I accept that the full minimum-period interest remains payable even in case of early repayment.

- मैंने "[FINAL_REPAYMENT_DATE]" को अंतिम भुगतान तिथि के रूप में स्वीकार किया है।
  I accept "[FINAL_REPAYMENT_DATE]" as the final repayment date.

- मैंने अंतिम समय तक भुगतान न होने पर गारंटर संबंधी व्यवस्था समझ ली है।
  I understand the guarantor arrangement applicable if payment is not made by the final deadline.

- मैंने सभी नियम एवं शर्तें पढ़ ली हैं।
  I have read all the terms and conditions.

---

12. मेरी अंतिम घोषणा

FINAL DECLARATION

☐ मैं, "[LOANER_NAME]", घोषणा करता/करती हूँ कि मैंने इस ऋण से संबंधित सभी विवरण, राशि, ब्याज दर, न्यूनतम अवधि, अधिकतम भुगतान अवधि, अंतिम भुगतान तिथि तथा गारंटर संबंधी सभी नियम एवं शर्तें पढ़ ली हैं और समझ ली हैं। मैं अपनी स्वेच्छा से इस ऋण को स्वीकार करता/करती हूँ।

☐ I, "[LOANER_NAME]", declare that I have read and understood all details related to this loan, including the loan amount, interest rate, minimum period, maximum repayment period, final repayment date, and all terms and conditions relating to the guarantors. I voluntarily accept this loan.

Final Loan Acceptance

[ ACCEPT & CONFIRM LOAN ]

---

13. यदि सभी गारंटरों ने अभी Consent स्वीकार नहीं किया है

IF ALL GUARANTORS HAVE NOT ACCEPTED

⚠️ FINAL ACCEPTANCE LOCKED

"[ACCEPTED_COUNT] / 3" Guarantors Accepted

Final Loan Acceptance तभी उपलब्ध होगा जब तीनों गारंटरों का Status:

🟢 ACCEPTED

हो जाएगा।

Final Loan Acceptance will become available only when all three guarantors have the status:

🟢 ACCEPTED

Pending: "[PENDING_COUNT]"
Declined: "[DECLINED_COUNT]"

---

14. Final Consent Record

Loaner Name: "[LOANER_NAME]"
Role: "Loaner / Borrower"
Status: "[LOAN_STATUS]"
Consent Date & Time: "[LOAN_CONSENT_DATETIME]"
Reference ID: "[LOAN_CONSENT_ID]"

Guarantor 1: "[GUARANTOR_1_NAME]" — "[GUARANTOR_1_STATUS]"

Guarantor 2: "[GUARANTOR_2_NAME]" — "[GUARANTOR_2_STATUS]"

Guarantor 3: "[GUARANTOR_3_NAME]" — "[GUARANTOR_3_STATUS]"
', '2026-09-18T00:00:00.000Z');

-- ------------------------------------------------------------- guarantor_consent
DELETE FROM consent_page_templates WHERE type = 'guarantor_consent';
INSERT INTO consent_page_templates (type, text, updated_at)
VALUES ('guarantor_consent', 'नवयुवक छठ पूजा समिति

NAVYUVAK CHHATH PUJA SAMITI

ऋण गारंटर Consent एवं नियम एवं शर्तें

LOAN GUARANTOR CONSENT & TERMS AND CONDITIONS

1. ऋण संबंधी विवरण / Loan Details

Consent देने वाले गारंटर / Consenting Guarantor:
"[GUARANTOR_NAME]"

ऋण प्राप्तकर्ता / Loaner:
"[LOANER_NAME]"

मूलधन / ऋण राशि / Principal Loan Amount:
"₹[LOAN_AMOUNT]"

मासिक ब्याज दर / Monthly Interest Rate:
"[MONTHLY_INTEREST_RATE]% प्रति माह / per month"

न्यूनतम ब्याज अवधि / Minimum Interest Period:
"[MINIMUM_TENURE_MONTHS] माह / months"

अधिकतम भुगतान तिथि / Maximum Repayment Date:
"[FINAL_REPAYMENT_DATE]"

Consent Reference ID:
"[CONSENT_ID]"

---

2. महत्वपूर्ण तिथियां एवं अवसर

IMPORTANT DATES & OCCASIONS

दीपावली के अगले दिन / Day After Diwali:
"[DIWALI_NEXT_DAY_DATE]" — "[DIWALI_NEXT_DAY_DAY_NAME]"

नहाय-खाय का दिन / Nahay-Khay Day:
"[NAHAY_KHAY_DATE]" — "[NAHAY_KHAY_DAY_NAME]"

अधिकतम भुगतान का अंतिम दिन / Final Repayment Day:
"[FINAL_REPAYMENT_DATE]" — "[FINAL_REPAYMENT_DAY_NAME]"

छठ पूजा के सुबह अर्घ्य का दिन / Chhath Morning Arghya Day:
"[CHHATH_MORNING_ARGHYA_DATE]" — "[CHHATH_MORNING_ARGHYA_DAY_NAME]"

«उपरोक्त तिथियां ऋण की अवधि, भुगतान की अंतिम सीमा तथा गारंटर संबंधी जिम्मेदारी को स्पष्ट करने के लिए दर्ज की गई हैं।

The above dates are recorded to clearly define the loan period, final repayment deadline, and guarantor-related responsibility.»

---

3. ऋण का विवरण

LOAN DETAILS

नवयुवक छठ पूजा समिति के वर्ष "[FUND_YEAR]" की बची हुई राशि में से ₹[LOAN_AMOUNT]/- की राशि [LOANER_NAME] को [MONTHLY_INTEREST_RATE]% प्रति माह की ब्याज दर पर दी गई है।

An amount of ₹[LOAN_AMOUNT]/- from the remaining funds of Navyuvak Chhath Puja Samiti for the year "[FUND_YEAR]" has been provided to [LOANER_NAME] at an interest rate of [MONTHLY_INTEREST_RATE]% per month.

इस राशि के लिए मुझे गारंटर के रूप में नामित किया गया है।

I have been designated as a Guarantor for this loan.

---

4. ऋण अवधि एवं ब्याज की शर्तें

LOAN TENURE & INTEREST TERMS

4.1 न्यूनतम ब्याज अवधि / Minimum Interest Period

इस ऋण की न्यूनतम ब्याज अवधि "[MINIMUM_TENURE_MONTHS] माह" निर्धारित है।

The minimum interest period for this loan is `[MINIMUM_TENURE_MONTHS] months.

यदि "[LOANER_NAME]" न्यूनतम अवधि पूरी होने से पहले मूलधन वापस करता/करती है, तब भी पूरे "[MINIMUM_TENURE_MONTHS] माह" का निर्धारित ब्याज देना अनिवार्य होगा।

If "[LOANER_NAME]" repays the principal before completion of the minimum period, the full interest for "[MINIMUM_TENURE_MONTHS] months" shall still be payable.

अर्थात समय से पहले भुगतान करने पर भी न्यूनतम अवधि के ब्याज में कोई कमी नहीं की जाएगी।

Therefore, early repayment shall not reduce the minimum interest payable.

---

4.2 अधिकतम भुगतान अवधि / Maximum Repayment Period

इस ऋण की अधिकतम भुगतान अवधि "[FINAL_REPAYMENT_DATE]" तक निर्धारित है।

The maximum repayment period for this loan is up to "[FINAL_REPAYMENT_DATE]".

यह ऋण की निर्धारित अंतिम भुगतान तिथि होगी।

This shall be the prescribed final repayment deadline.

---

4.3 अंतिम भुगतान दिवस / Final Repayment Day

"[LOANER_NAME]" को "[FINAL_REPAYMENT_DATE]" तक मूलधन एवं उस समय तक देय ब्याज की पूरी राशि वापस करनी होगी।

"[LOANER_NAME]" shall repay the complete principal amount along with all interest due up to "[FINAL_REPAYMENT_DATE]".

---

4.4 अंतिम तिथि तक भुगतान न होने की स्थिति

FAILURE TO REPAY BY THE FINAL DATE

यदि "[LOANER_NAME]" द्वारा "[FINAL_REPAYMENT_DATE]" तक पूरी राशि वापस नहीं की जाती है, तो समझौते के अनुसार गारंटर की भुगतान संबंधी जिम्मेदारी लागू होगी।

If "[LOANER_NAME]" fails to repay the complete amount by "[FINAL_REPAYMENT_DATE]", the guarantor''s payment responsibility shall apply as per this agreement.

यदि "[CHHATH_MORNING_ARGHYA_DATE]" की सुबह तक भी भुगतान नहीं किया जाता है, तो तीनों गारंटरों की निर्धारित जिम्मेदारी के अनुसार समिति की देय राशि की भरपाई की जाएगी।

If the payment is still not made by the morning of "[CHHATH_MORNING_ARGHYA_DATE]", the three guarantors shall be responsible for fulfilling the committee''s due amount as per the agreed terms.

---

5. गारंटर की जिम्मेदारी

GUARANTOR RESPONSIBILITY

मैं, "[GUARANTOR_NAME]", यह स्वीकार करता/करती हूँ कि मैं "[LOANER_NAME]" के उक्त ऋण के लिए गारंटर हूँ।

I, "[GUARANTOR_NAME]", acknowledge that I am a guarantor for the above-mentioned loan of "[LOANER_NAME]".

यदि निर्धारित अंतिम समय तक ऋण की देय राशि वापस नहीं की जाती है, तो समझौते के अनुसार मेरी गारंटर संबंधी भुगतान जिम्मेदारी लागू होगी।

If the amount due under the loan is not repaid within the prescribed time, my payment responsibility as a guarantor shall apply according to this agreement.

इसमें कम-से-कम मूलधन "₹[LOAN_AMOUNT]" तथा "[MINIMUM_TENURE_MONTHS] माह" का न्यूनतम निर्धारित ब्याज शामिल होगा।

This shall include, at minimum, the principal amount of "₹[LOAN_AMOUNT]" and the prescribed minimum interest for "[MINIMUM_TENURE_MONTHS] months".

---

6. तीनों गारंटर

THREE GUARANTORS

1. "[GUARANTOR_1_NAME]"
2. "[GUARANTOR_2_NAME]"
3. "[GUARANTOR_3_NAME]"

प्रत्येक गारंटर अपनी Consent स्वतंत्र रूप से स्वीकार या अस्वीकार करेगा।

Each guarantor shall independently accept or decline their consent.

---

7. Loaner की Final Acceptance

LOANER FINAL ACCEPTANCE

"[LOANER_NAME]" तब तक इस ऋण का Final Acceptance नहीं कर सकेगा/सकेगी जब तक सभी तीनों गारंटर अपनी Consent Accepted स्थिति में दर्ज नहीं कर देते।

"[LOANER_NAME]" shall not be able to provide Final Acceptance until all three guarantors have marked their consent as Accepted.

आवश्यक स्थिति / Required Status

Guarantor 1: "[GUARANTOR_1_STATUS]"
Guarantor 2: "[GUARANTOR_2_STATUS]"
Guarantor 3: "[GUARANTOR_3_STATUS]"

"3 / 3 GUARANTORS ACCEPTED"

यदि किसी भी गारंटर का Status Pending या Declined है, तो Loaner''s Final Acceptance Locked रहेगा।

If any guarantor''s status is Pending or Declined, the Loaner''s Final Acceptance shall remain locked.

---

8. Consent की स्वतंत्रता

VOLUNTARY CONSENT

मैं पुष्टि करता/करती हूँ कि मैंने सभी शर्तें पढ़ी और समझी हैं तथा अपनी इच्छा से यह Consent स्वीकार करने का निर्णय लिया है।

I confirm that I have read and understood all the terms and have voluntarily decided to provide this consent.

मुझ पर किसी प्रकार का अनुचित दबाव डालकर Consent स्वीकार नहीं कराया गया है।

I have not been forced or subjected to undue pressure to provide this consent.

---

9. डिजिटल Consent Record

DIGITAL CONSENT RECORD

मैं सहमत हूँ कि मेरे द्वारा दिया गया Consent डिजिटल रूप से रिकॉर्ड और सुरक्षित किया जा सकता है।

I agree that my consent may be digitally recorded and securely stored.

Consent Record में निम्न जानकारी रखी जा सकती है:

The Consent Record may contain:

- नाम / Name
- भूमिका / Role
- Consent Status
- Consent Date & Time
- Consent Reference ID
- ऋण संबंधी विवरण / Loan Details
- डिजिटल/तकनीकी रिकॉर्ड / Digital & Technical Record

---

10. मेरी अंतिम घोषणा

FINAL DECLARATION

☐ मैंने ऊपर दिए गए ऋण संबंधी सभी विवरण, नियम एवं शर्तें तथा गारंटर के रूप में अपनी जिम्मेदारियां ध्यानपूर्वक पढ़ ली हैं और समझ ली हैं। मैं अपनी स्वेच्छा से इस ऋण के लिए गारंटर के रूप में Consent स्वीकार करता/करती हूँ।

☐ I have carefully read and understood all the above loan details, terms and conditions, and my responsibilities as a guarantor. I voluntarily provide my consent as a guarantor for this loan.

Consent विकल्प / Consent Options

[ ACCEPT CONSENT ]

[ DECLINE CONSENT ]

---

Consent Record

नाम / Name: "[GUARANTOR_NAME]"
भूमिका / Role: "Guarantor"
Status: "[CONSENT_STATUS]"
Consent Date & Time: "[CONSENT_DATETIME]"
Reference ID: "[CONSENT_ID]"
', '2026-09-18T00:00:00.000Z');
