-- Data migration for D1 database: templates
-- Run with: wrangler d1 execute templates --remote --file=./migration/templates.sql

-- 1 rows from sheet "SAMAAN_TEMPLATES" -> samaan_templates
INSERT INTO samaan_templates (year, template_text, page_size, created_at, updated_at) VALUES (2026.0, '## नवयुवक छठ पूजा समिति / NAVYUVAK CHHATH PUJA SAMITI
### सामान रसीद / ITEM RECEIPT

---

**Receipt No / रसीद संख्या:** [SAMAAN_NO]
**Date / दिनांक:** [DATE]

---

**दानकर्ता / Donor:** [NAME]
{{#IF FATHER_NAME}}
**पिता का नाम / Father''s Name:** [FATHER_NAME]
{{/IF}}
{{#IF VILLAGE}}
**गाँव / Village:** [VILLAGE]
{{/IF}}

**दिया गया सामान / Item Given:** [ITEM_DETAIL]

छठ पूजा वर्ष [YEAR] में आपके योगदान के लिए हार्दिक धन्यवाद!

*Thank you for your contribution to the [YEAR] Chhath Puja celebration!*

---

*Generated at / जनरेट किया गया: [GENERATED_AT]*', 'A5', '2026-08-21 01:25:56', '2026-08-21 01:25:56');

-- 6 rows from sheet "DOCX_TEMPLATES" -> docx_templates
INSERT INTO docx_templates (doc_type, year, drive_file_id, file_name, created_at, updated_at) VALUES ('certificate', 2026.0, '16WVsDP47vj0mv4GcO2zfi9sPh8N_IRBh', 'certificate-sample.docx', '2026-08-18 10:05:55', '2026-08-18 10:05:55');
INSERT INTO docx_templates (doc_type, year, drive_file_id, file_name, created_at, updated_at) VALUES ('receipt', 2017.0, '1TQPj2wfOHbdwPt7d9jOAqIi4zTDgv8Xm', 'receipt-sample (1).docx', '2026-08-21 11:07:44', '2026-08-21 11:07:44');
INSERT INTO docx_templates (doc_type, year, drive_file_id, file_name, created_at, updated_at) VALUES ('receipt', 2018.0, '1EgmANqfROxxxGJ8ifZ1KC0o1uZHj1Ejk', 'receipt-sample (2).docx', '2026-08-21 12:14:42', '2026-08-21 12:14:42');
INSERT INTO docx_templates (doc_type, year, drive_file_id, file_name, created_at, updated_at) VALUES ('receipt', 2019.0, '1pBBZJZy_4FT0e4tYWoaHM_S8HdA1ZSn1', 'receipt-sample (3).docx', '2026-08-21 12:19:50', '2026-08-21 12:19:50');
INSERT INTO docx_templates (doc_type, year, drive_file_id, file_name, created_at, updated_at) VALUES ('receipt', 2025.0, '1QYsZlsev7Ir3XXadAc9IKnbkkEE98c2r', 'receipt-sample (4).docx', '2026-08-22 12:25:55', '2026-08-22 12:25:55');
INSERT INTO docx_templates (doc_type, year, drive_file_id, file_name, created_at, updated_at) VALUES ('report_en', 2025.0, '1MPzvKTmCkEERMdvV1l8jCFtlXt3YWpXt', 'report-en-sample (1).docx', '2026-08-22 13:24:02', '2026-08-22 13:24:02');

-- 5 rows from sheet "DOC_PDF_TEMPLATES" -> doc_pdf_templates
INSERT INTO doc_pdf_templates (doc_type, year, schema_json, created_at, updated_at) VALUES ('receipt', 2026.0, '{"basePdf":{"width":148,"height":210,"padding":[8,8,8,8]},"schemas":[[{"name":"title1","type":"text","position":{"x":10,"y":10},"width":128,"height":7,"fontSize":14,"fontName":"NotoDevanagari","fontColor":"#F27A1A","alignment":"center","content":"नवयुवक छठ पूजा समिति"},{"name":"title2","type":"text","position":{"x":10,"y":17},"width":128,"height":7,"fontSize":9,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"center","content":"NAVYUVAK CHHATH PUJA SAMITI"},{"name":"title3","type":"text","position":{"x":10,"y":24},"width":128,"height":7,"fontSize":11,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"center","content":"Donation Receipt / दान रसीद"},{"name":"lbl_no","type":"text","position":{"x":10,"y":36},"width":30,"height":7,"fontSize":11,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Receipt No:"},{"name":"RECEIPT_NO","type":"text","position":{"x":42,"y":36},"width":60,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_date","type":"text","position":{"x":10,"y":44},"width":30,"height":7,"fontSize":11,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Date:"},{"name":"DATE","type":"text","position":{"x":42,"y":44},"width":60,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_name","type":"text","position":{"x":10,"y":56},"width":30,"height":7,"fontSize":11,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Received From:"},{"name":"NAME","type":"text","position":{"x":42,"y":56},"width":96,"height":7,"fontSize":11,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_father","type":"text","position":{"x":10,"y":66},"width":30,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Father''s Name:"},{"name":"FATHER_NAME","type":"text","position":{"x":42,"y":66},"width":96,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_village","type":"text","position":{"x":10,"y":74},"width":30,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Village:"},{"name":"VILLAGE","type":"text","position":{"x":42,"y":74},"width":96,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_designation","type":"text","position":{"x":10,"y":82},"width":30,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Designation:"},{"name":"DESIGNATION","type":"text","position":{"x":42,"y":82},"width":96,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_mobile","type":"text","position":{"x":10,"y":90},"width":30,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Mobile:"},{"name":"MOBILE","type":"text","position":{"x":42,"y":90},"width":96,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_detail","type":"text","position":{"x":10,"y":100},"width":30,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Detail:"},{"name":"DETAIL","type":"text","position":{"x":42,"y":100},"width":96,"height":14,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_amount","type":"text","position":{"x":10,"y":122},"width":30,"height":7,"fontSize":13,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Amount:"},{"name":"AMOUNT","type":"text","position":{"x":42,"y":121},"width":96,"height":7,"fontSize":15,"fontName":"NotoDevanagari","fontColor":"#F27A1A","alignment":"left","content":""},{"name":"thanks","type":"text","position":{"x":10,"y":145},"width":128,"height":7,"fontSize":9,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"center","content":"धन्यवाद! आपके योगदान से छठ पूजा का आयोजन सफल होगा।"},{"name":"GENERATED_AT","type":"text","position":{"x":10,"y":195},"width":128,"height":7,"fontSize":7,"fontName":"NotoDevanagari","fontColor":"#888888","alignment":"center","content":""}]]}', '2026-08-14 05:12:21', '2026-08-14 05:12:21');
INSERT INTO doc_pdf_templates (doc_type, year, schema_json, created_at, updated_at) VALUES ('certificate', 2026.0, '{"basePdf":{"width":210,"height":297,"padding":[10,10,10,10]},"schemas":[[{"name":"title1","type":"text","position":{"x":15,"y":20},"width":180,"height":7,"fontSize":20,"fontName":"NotoDevanagari","fontColor":"#F27A1A","alignment":"center","content":"नवयुवक छठ पूजा समिति"},{"name":"title2","type":"text","position":{"x":15,"y":30},"width":180,"height":7,"fontSize":12,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"center","content":"NAVYUVAK CHHATH PUJA SAMITI"},{"name":"title3","type":"text","position":{"x":15,"y":42},"width":180,"height":7,"fontSize":15,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"center","content":"प्रमाण पत्र / CERTIFICATE OF APPRECIATION"},{"name":"lbl_no","type":"text","position":{"x":15,"y":60},"width":40,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Certificate No:"},{"name":"CERT_NO","type":"text","position":{"x":55,"y":60},"width":70,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_date","type":"text","position":{"x":130,"y":60},"width":25,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Date:"},{"name":"DATE","type":"text","position":{"x":155,"y":60},"width":40,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"body1","type":"text","position":{"x":15,"y":90},"width":180,"height":7,"fontSize":12,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"center","content":"यह प्रमाणित किया जाता है कि"},{"name":"NAME","type":"text","position":{"x":15,"y":100},"width":180,"height":7,"fontSize":20,"fontName":"NotoDevanagari","fontColor":"#F27A1A","alignment":"center","content":""},{"name":"body2","type":"text","position":{"x":15,"y":116},"width":180,"height":7,"fontSize":11,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"center","content":"ने वर्ष [YEAR] की छठ पूजा में निम्न कार्य में अपना योगदान दिया / contributed to the following work:"},{"name":"DETAIL","type":"text","position":{"x":25,"y":132},"width":160,"height":20,"fontSize":13,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"center","content":""},{"name":"lbl_village","type":"text","position":{"x":40,"y":165},"width":30,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Village:"},{"name":"VILLAGE","type":"text","position":{"x":72,"y":165},"width":60,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_father","type":"text","position":{"x":140,"y":165},"width":30,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Father''s Name:"},{"name":"FATHER_NAME","type":"text","position":{"x":172,"y":165},"width":60,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"thanks","type":"text","position":{"x":15,"y":200},"width":180,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"center","content":"समिति की ओर से हार्दिक धन्यवाद एवं शुभकामनाएं / With heartfelt thanks and best wishes."},{"name":"GENERATED_AT","type":"text","position":{"x":15,"y":277},"width":180,"height":7,"fontSize":8,"fontName":"NotoDevanagari","fontColor":"#888888","alignment":"center","content":""}]]}', '2026-08-14 05:12:21', '2026-08-14 05:12:21');
INSERT INTO doc_pdf_templates (doc_type, year, schema_json, created_at, updated_at) VALUES ('consent_loaner', 2026.0, '{"basePdf":{"width":210,"height":297,"padding":[10,10,10,10]},"schemas":[[{"name":"title1","type":"text","position":{"x":15,"y":15},"width":180,"height":7,"fontSize":15,"fontName":"NotoDevanagari","fontColor":"#F27A1A","alignment":"center","content":"नवयुवक छठ पूजा समिति — Loan Final Consent Record"},{"name":"lbl_id","type":"text","position":{"x":15,"y":30},"width":45,"height":7,"fontSize":11,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Reference ID:"},{"name":"LOAN_CONSENT_ID","type":"text","position":{"x":62,"y":30},"width":80,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_year","type":"text","position":{"x":150,"y":30},"width":20,"height":7,"fontSize":11,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Year:"},{"name":"FUND_YEAR","type":"text","position":{"x":172,"y":30},"width":25,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_name","type":"text","position":{"x":15,"y":44},"width":45,"height":7,"fontSize":11,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Loaner Name:"},{"name":"LOANER_NAME","type":"text","position":{"x":62,"y":44},"width":130,"height":7,"fontSize":12,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_amount","type":"text","position":{"x":15,"y":56},"width":45,"height":7,"fontSize":11,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Loan Amount:"},{"name":"LOAN_AMOUNT","type":"text","position":{"x":62,"y":56},"width":60,"height":7,"fontSize":11,"fontName":"NotoDevanagari","fontColor":"#F27A1A","alignment":"left","content":""},{"name":"lbl_rate","type":"text","position":{"x":130,"y":56},"width":30,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Interest:"},{"name":"MONTHLY_INTEREST_RATE","type":"text","position":{"x":162,"y":56},"width":35,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_tenure","type":"text","position":{"x":15,"y":66},"width":45,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Min. Tenure (months):"},{"name":"MINIMUM_TENURE_MONTHS","type":"text","position":{"x":62,"y":66},"width":40,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_repay","type":"text","position":{"x":15,"y":76},"width":45,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Final Repayment Date:"},{"name":"FINAL_REPAYMENT_DATE","type":"text","position":{"x":62,"y":76},"width":60,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"guarantors_hdr","type":"text","position":{"x":15,"y":92},"width":180,"height":7,"fontSize":12,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Guarantor Consent Status"},{"name":"lbl_g1","type":"text","position":{"x":15,"y":102},"width":60,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Guarantor 1:"},{"name":"GUARANTOR_1_NAME","type":"text","position":{"x":75,"y":102},"width":65,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"GUARANTOR_1_STATUS","type":"text","position":{"x":142,"y":102},"width":55,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_g2","type":"text","position":{"x":15,"y":112},"width":60,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Guarantor 2:"},{"name":"GUARANTOR_2_NAME","type":"text","position":{"x":75,"y":112},"width":65,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"GUARANTOR_2_STATUS","type":"text","position":{"x":142,"y":112},"width":55,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_g3","type":"text","position":{"x":15,"y":122},"width":60,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Guarantor 3:"},{"name":"GUARANTOR_3_NAME","type":"text","position":{"x":75,"y":122},"width":65,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"GUARANTOR_3_STATUS","type":"text","position":{"x":142,"y":122},"width":55,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"note","type":"text","position":{"x":15,"y":145},"width":180,"height":7,"fontSize":9,"fontName":"NotoDevanagari","fontColor":"#666666","alignment":"left","content":"Ye document Loaner ke digitally accepted Final Consent ka record hai."},{"name":"GENERATED_AT","type":"text","position":{"x":15,"y":277},"width":180,"height":7,"fontSize":8,"fontName":"NotoDevanagari","fontColor":"#888888","alignment":"center","content":""}]]}', '2026-08-14 05:12:21', '2026-08-14 05:12:21');
INSERT INTO doc_pdf_templates (doc_type, year, schema_json, created_at, updated_at) VALUES ('consent_guarantor', 2026.0, '{"basePdf":{"width":210,"height":297,"padding":[10,10,10,10]},"schemas":[[{"name":"title1","type":"text","position":{"x":15,"y":15},"width":180,"height":7,"fontSize":15,"fontName":"NotoDevanagari","fontColor":"#F27A1A","alignment":"center","content":"नवयुवक छठ पूजा समिति — Loan Guarantor Consent Record"},{"name":"lbl_id","type":"text","position":{"x":15,"y":30},"width":45,"height":7,"fontSize":11,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Reference ID:"},{"name":"CONSENT_ID","type":"text","position":{"x":62,"y":30},"width":80,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_year","type":"text","position":{"x":150,"y":30},"width":20,"height":7,"fontSize":11,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Year:"},{"name":"FUND_YEAR","type":"text","position":{"x":172,"y":30},"width":25,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_guarantor","type":"text","position":{"x":15,"y":44},"width":45,"height":7,"fontSize":11,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Guarantor Name:"},{"name":"GUARANTOR_NAME","type":"text","position":{"x":62,"y":44},"width":130,"height":7,"fontSize":12,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_loaner","type":"text","position":{"x":15,"y":56},"width":45,"height":7,"fontSize":11,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Loaner Name:"},{"name":"LOANER_NAME","type":"text","position":{"x":62,"y":56},"width":130,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_amount","type":"text","position":{"x":15,"y":68},"width":45,"height":7,"fontSize":11,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Loan Amount:"},{"name":"LOAN_AMOUNT","type":"text","position":{"x":62,"y":68},"width":60,"height":7,"fontSize":11,"fontName":"NotoDevanagari","fontColor":"#F27A1A","alignment":"left","content":""},{"name":"lbl_rate","type":"text","position":{"x":130,"y":68},"width":30,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Interest:"},{"name":"MONTHLY_INTEREST_RATE","type":"text","position":{"x":162,"y":68},"width":35,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_tenure","type":"text","position":{"x":15,"y":78},"width":45,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Min. Tenure (months):"},{"name":"MINIMUM_TENURE_MONTHS","type":"text","position":{"x":62,"y":78},"width":40,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_repay","type":"text","position":{"x":15,"y":88},"width":45,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Final Repayment Date:"},{"name":"FINAL_REPAYMENT_DATE","type":"text","position":{"x":62,"y":88},"width":60,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"note","type":"text","position":{"x":15,"y":110},"width":180,"height":7,"fontSize":9,"fontName":"NotoDevanagari","fontColor":"#666666","alignment":"left","content":"Ye document Guarantor ke digitally accepted Consent ka record hai."},{"name":"GENERATED_AT","type":"text","position":{"x":15,"y":277},"width":180,"height":7,"fontSize":8,"fontName":"NotoDevanagari","fontColor":"#888888","alignment":"center","content":""}]]}', '2026-08-14 05:12:21', '2026-08-14 05:12:21');
INSERT INTO doc_pdf_templates (doc_type, year, schema_json, created_at, updated_at) VALUES ('certificate', 2025.0, '{"basePdf":{"width":148,"height":210,"padding":[8,8,8,8]},"schemas":[[{"name":"title1","type":"text","position":{"x":10,"y":10},"width":128,"height":7,"fontSize":14,"fontName":"NotoDevanagari","fontColor":"#F27A1A","alignment":"center","content":"नवयुवक छठ पूजा समिति"},{"name":"title2","type":"text","position":{"x":10,"y":17},"width":128,"height":7,"fontSize":9,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"center","content":"NAVYUVAK CHHATH PUJA SAMITI"},{"name":"title3","type":"text","position":{"x":10,"y":24},"width":128,"height":7,"fontSize":11,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"center","content":"Donation Receipt / दान रसीद"},{"name":"lbl_no","type":"text","position":{"x":10,"y":36},"width":30,"height":7,"fontSize":11,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Receipt No:"},{"name":"RECEIPT_NO","type":"text","position":{"x":42,"y":36},"width":60,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_date","type":"text","position":{"x":10,"y":44},"width":30,"height":7,"fontSize":11,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Date:"},{"name":"DATE","type":"text","position":{"x":42,"y":44},"width":60,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_name","type":"text","position":{"x":10,"y":56},"width":30,"height":7,"fontSize":11,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Received From:"},{"name":"NAME","type":"text","position":{"x":42,"y":56},"width":96,"height":7,"fontSize":11,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_father","type":"text","position":{"x":10,"y":66},"width":30,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Father''s Name:"},{"name":"FATHER_NAME","type":"text","position":{"x":42,"y":66},"width":96,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_village","type":"text","position":{"x":10,"y":74},"width":30,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Village:"},{"name":"VILLAGE","type":"text","position":{"x":42,"y":74},"width":96,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_designation","type":"text","position":{"x":10,"y":82},"width":30,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Designation:"},{"name":"DESIGNATION","type":"text","position":{"x":42,"y":82},"width":96,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_mobile","type":"text","position":{"x":10,"y":90},"width":30,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Mobile:"},{"name":"MOBILE","type":"text","position":{"x":42,"y":90},"width":96,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_detail","type":"text","position":{"x":10,"y":100},"width":30,"height":7,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Detail:"},{"name":"DETAIL","type":"text","position":{"x":42,"y":100},"width":96,"height":14,"fontSize":10,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":""},{"name":"lbl_amount","type":"text","position":{"x":10,"y":122},"width":30,"height":7,"fontSize":13,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"left","content":"Amount:"},{"name":"AMOUNT","type":"text","position":{"x":42,"y":121},"width":96,"height":7,"fontSize":15,"fontName":"NotoDevanagari","fontColor":"#F27A1A","alignment":"left","content":""},{"name":"thanks","type":"text","position":{"x":10,"y":145},"width":128,"height":7,"fontSize":9,"fontName":"NotoDevanagari","fontColor":"#111111","alignment":"center","content":"धन्यवाद! आपके योगदान से छठ पूजा का आयोजन सफल होगा।"},{"name":"GENERATED_AT","type":"text","position":{"x":10,"y":195},"width":128,"height":7,"fontSize":7,"fontName":"NotoDevanagari","fontColor":"#888888","alignment":"center","content":""}]]}', '2026-08-14 13:07:27', '2026-08-14 13:07:27');

-- 2 rows from sheet "CERTIFICATE_TEMPLATES" -> certificate_templates
INSERT INTO certificate_templates (year, template_text, page_size, created_at, updated_at) VALUES (2026.0, '## नवयुवक छठ पूजा समिति / NAVYUVAK CHHATH PUJA SAMITI
### प्रमाण पत्र / CERTIFICATE OF APPRECIATION

---

**Certificate No / प्रमाण पत्र संख्या:** [CERT_NO]

**Date / दिनांक:** [DATE]

---

Ye प्रमाणित किया जाता है कि **[NAME]** ने वर्ष [YEAR] की छठ पूजा में निम्न कार्य में अपना योगदान दिया:

*This is to certify that **[NAME]** contributed to the following work during the [YEAR] Chhath Puja celebration:*

**[DETAIL]**

{{#IF VILLAGE}}
**Village / गाँव:** [VILLAGE]
{{/IF}}
{{#IF FATHER_NAME}}
**Father''s Name / पिता का नाम:** [FATHER_NAME]
{{/IF}}

समिति की ओर से हार्दिक धन्यवाद एवं शुभकामनाएं।

*With heartfelt thanks and best wishes from the committee.*

---

*Generated at / जनरेट किया गया: [GENERATED_AT]*', 'A5', '2026-08-13 02:46:37', '2026-08-14 15:37:02');
INSERT INTO certificate_templates (year, template_text, page_size, created_at, updated_at) VALUES (2025.0, '## नवयुवक छठ पूजा समिति / NAVYUVAK CHHATH PUJA SAMITI
### प्रमाण पत्र / CERTIFICATE OF APPRECIATION

---

**Certificate No / प्रमाण पत्र संख्या:** [CERT_NO]

**Date / दिनांक:** [DATE]

---

Ye प्रमाणित किया जाता है कि **[NAME]** ने वर्ष [YEAR] की छठ पूजा में निम्न कार्य में अपना योगदान दिया:

*This is to certify that **[NAME]** contributed to the following work during the [YEAR] Chhath Puja celebration:*

**[DETAIL]**

{{#IF VILLAGE}}
**Village / गाँव:** [VILLAGE]
{{/IF}}
{{#IF FATHER_NAME}}
**Father''s Name / पिता का नाम:** [FATHER_NAME]
{{/IF}}

समिति की ओर से हार्दिक धन्यवाद एवं शुभकामनाएं।

*With heartfelt thanks and best wishes from the committee.*

---

*Generated at / जनरेट किया गया: [GENERATED_AT]*', 'A5', '2026-08-15 13:44:27', '2026-08-15 13:44:27');

-- 1 rows from sheet "RECEIPT_TEMPLATES" -> receipt_templates
INSERT INTO receipt_templates (year, template_text, page_size, created_at, updated_at) VALUES (2026.0, '## नवयुवक छठ पूजा समिति / NAVYUVAK CHHATH PUJA SAMITI
### Donation Receipt / दान रसीद

---

**Receipt No / रसीद संख्या:** [RECEIPT_NO]
**Date / दिनांक:** [DATE]

---

**Received From / प्राप्तकर्ता का नाम:** [NAME]

{{#IF FATHER_NAME}}
**Father''s Name / पिता का नाम:** [FATHER_NAME]
{{/IF}}
{{#IF VILLAGE}}
**Village / गाँव:** [VILLAGE]
{{/IF}}
{{#IF DESIGNATION}}
**Designation / पदनाम:** [DESIGNATION]
{{/IF}}
{{#IF MOBILE}}
**Mobile / मोबाइल:** [MOBILE]
{{/IF}}

---

{{#IF AMOUNT}}
**Amount Received / प्राप्त राशि:** ₹[AMOUNT]
{{/IF}}
{{#IF DETAIL}}
**Work/Contribution Detail / कार्य विवरण:** [DETAIL]
{{/IF}}

धन्यवाद! आपके योगदान से छठ पूजा का आयोजन सफल होगा।

*Thank you! Your contribution helps make the Chhath Puja celebration successful.*

---

*Generated at / जनरेट किया गया: [GENERATED_AT]*', 'A5', '2026-08-11 00:35:41', '2026-08-11 00:35:41');

-- 2 rows from sheet "CONSENT_PAGE_TEMPLATES" -> consent_page_templates
INSERT INTO consent_page_templates (type, text, updated_at) VALUES ('loaner_consent', '## नवयुवक छठ पूजा समिति / NAVYUVAK CHHATH PUJA SAMITI
### ऋण प्राप्ति एवं Final Consent / LOAN RECEIPT & FINAL CONSENT

---

### 1. ऋण संबंधी विवरण / Loan Details

- ऋण प्राप्तकर्ता / Loaner: **[LOANER_NAME]**
- मूलधन / ऋण राशि / Principal Loan Amount: **₹[LOAN_AMOUNT]**
- मासिक ब्याज दर / Monthly Interest Rate: **[MONTHLY_INTEREST_RATE]% प्रति माह / per month**
- न्यूनतम ब्याज अवधि / Minimum Interest Period: **[MINIMUM_TENURE_MONTHS] माह / months**
- अधिकतम भुगतान तिथि / Maximum Repayment Date: **[FINAL_REPAYMENT_DATE]**
- Loan Consent Reference ID: **[LOAN_CONSENT_ID]**

---

### 2. महत्वपूर्ण तिथियां एवं अवसर / IMPORTANT DATES & OCCASIONS

- दीपावली के अगले दिन / Day After Diwali: **[DIWALI_NEXT_DAY_DATE] — [DIWALI_NEXT_DAY_DAY_NAME]**
- नहाय-खाय का दिन / Nahay-Khay Day: **[NAHAY_KHAY_DATE] — [NAHAY_KHAY_DAY_NAME]**
- अधिकतम भुगतान का अंतिम दिन / Final Repayment Day: **[FINAL_REPAYMENT_DATE] — [FINAL_REPAYMENT_DAY_NAME]**
- छठ पूजा के सुबह अर्घ्य का दिन / Chhath Morning Arghya Day: **[CHHATH_MORNING_ARGHYA_DATE] — [CHHATH_MORNING_ARGHYA_DAY_NAME]**

इन तिथियों का उपयोग ऋण की अवधि, भुगतान की अंतिम सीमा और गारंटर संबंधी जिम्मेदारी को स्पष्ट करने के लिए किया गया है।

*These dates are provided to clearly define the loan period, final repayment deadline, and guarantor-related responsibility.*

---

### 3. गारंटर Consent Status / GUARANTOR CONSENT STATUS

- गारंटर 1 / Guarantor 1 — **[GUARANTOR_1_NAME]**: [GUARANTOR_1_STATUS]
- गारंटर 2 / Guarantor 2 — **[GUARANTOR_2_NAME]**: [GUARANTOR_2_STATUS]
- गारंटर 3 / Guarantor 3 — **[GUARANTOR_3_NAME]**: [GUARANTOR_3_STATUS]

**[ACCEPTED_COUNT] / 3 GUARANTORS ACCEPTED** (Pending: [PENDING_COUNT], Declined: [DECLINED_COUNT])

---

### 4. Final Acceptance की शर्त / FINAL ACCEPTANCE CONDITION

मैं, **[LOANER_NAME]**, समझता/समझती हूँ कि मेरा Final Loan Acceptance तभी उपलब्ध होगा जब तीनों गारंटर अपनी Consent स्वीकार कर चुके हों। यदि किसी भी गारंटर का Status Pending या Declined है, तो मेरा Final Acceptance Locked रहेगा।

*I, **[LOANER_NAME]**, understand that my Final Loan Acceptance will only become available after all three guarantors have accepted their consent. If any guarantor''s status is Pending or Declined, my Final Acceptance will remain locked.*

---

### 5. ऋण का विवरण / LOAN DETAILS

मैं, [LOANER_NAME], यह स्वीकार करता/करती हूँ कि नवयुवक छठ पूजा समिति के वर्ष **[FUND_YEAR]** की बची हुई राशि में से ₹[LOAN_AMOUNT]/- की राशि मुझे [MONTHLY_INTEREST_RATE]% प्रति माह की ब्याज दर पर दी गई है। मैंने ऋण राशि, ब्याज दर, न्यूनतम ब्याज अवधि, अधिकतम भुगतान अवधि, अंतिम भुगतान तिथि और गारंटरों से संबंधित सभी शर्तों को पढ़कर और समझकर स्वीकार किया है।

*I, [LOANER_NAME], acknowledge that an amount of ₹[LOAN_AMOUNT]/- from the remaining funds of Navyuvak Chhath Puja Samiti for the year **[FUND_YEAR]** has been provided to me at an interest rate of [MONTHLY_INTEREST_RATE]% per month. I have read and understood all terms relating to the loan amount, interest rate, minimum interest period, maximum repayment period, final repayment date, and guarantors.*

---

### 6. न्यूनतम ब्याज अवधि / MINIMUM INTEREST PERIOD

इस ऋण की न्यूनतम ब्याज अवधि **[MINIMUM_TENURE_MONTHS] माह** होगी। यदि मैं इस अवधि पूरे होने से पहले मूलधन वापस कर देता/देती हूँ, तब भी पूरे [MINIMUM_TENURE_MONTHS] माह का निर्धारित ब्याज देना अनिवार्य होगा — समय से पहले भुगतान करने पर भी न्यूनतम अवधि के ब्याज में कोई कमी नहीं की जाएगी।

*The minimum interest period for this loan shall be **[MINIMUM_TENURE_MONTHS] months**. If I repay the principal early, I shall still be required to pay the full prescribed interest for [MINIMUM_TENURE_MONTHS] months — early repayment shall not reduce the minimum interest payable.*

---

### 7. अधिकतम भुगतान अवधि / MAXIMUM REPAYMENT PERIOD

इस ऋण की अधिकतम भुगतान तिथि **[FINAL_REPAYMENT_DATE]** होगी। मुझे इस तिथि तक मूलधन एवं उस समय तक देय ब्याज की पूरी राशि वापस करनी होगी।

*The maximum repayment date for this loan shall be **[FINAL_REPAYMENT_DATE]**. I shall repay the complete principal amount along with all interest due up to this date.*

---

### 8. अंतिम तिथि तक भुगतान न होने पर / FAILURE TO REPAY BY THE FINAL DATE

यदि मैं [FINAL_REPAYMENT_DATE] तक ऋण की पूरी राशि वापस नहीं करता/करती हूँ, तो समझौते में निर्धारित गारंटर संबंधी जिम्मेदारी लागू होगी। यदि [CHHATH_MORNING_ARGHYA_DATE] की सुबह तक भी देय राशि वापस नहीं की जाती है, तो तीनों गारंटरों की निर्धारित जिम्मेदारी के अनुसार समिति की देय राशि की भरपाई की जाएगी।

*If I fail to repay by [FINAL_REPAYMENT_DATE], the guarantor-related responsibility specified in this agreement shall apply. If the amount due is still not repaid by the morning of [CHHATH_MORNING_ARGHYA_DATE], the three guarantors shall be responsible for fulfilling the committee''s due amount as per the agreed terms.*

---

### 9. गारंटरों की जानकारी / GUARANTOR INFORMATION

इस ऋण के लिए निर्धारित गारंटर हैं / The designated guarantors for this loan are:

1. [GUARANTOR_1_NAME]
2. [GUARANTOR_2_NAME]
3. [GUARANTOR_3_NAME]

मैं स्वीकार करता/करती हूँ कि इन सभी गारंटरों को ऋण की राशि, ब्याज, अवधि, अंतिम भुगतान तिथि तथा उनकी गारंटर संबंधी जिम्मेदारियों की जानकारी दी गई है।

*I acknowledge that all guarantors have been informed about the loan amount, interest, tenure, final repayment date, and their responsibilities as guarantors.*

---

### 10. मेरी अंतिम घोषणा / FINAL DECLARATION

मैं, [LOANER_NAME], घोषणा करता/करती हूँ कि मैंने इस ऋण से संबंधित सभी विवरण, राशि, ब्याज दर, न्यूनतम अवधि, अधिकतम भुगतान अवधि, अंतिम भुगतान तिथि तथा गारंटर संबंधी सभी नियम एवं शर्तें पढ़ ली हैं और समझ ली हैं। मैं अपनी स्वेच्छा से इस ऋण को स्वीकार करता/करती हूँ।

*I, [LOANER_NAME], declare that I have read and understood all details related to this loan, and all terms and conditions relating to the guarantors. I voluntarily accept this loan.*', '2026-08-09 13:49:51');
INSERT INTO consent_page_templates (type, text, updated_at) VALUES ('guarantor_consent', '## नवयुवक छठ पूजा समिति / NAVYUVAK CHHATH PUJA SAMITI
### ऋण गारंटर Consent एवं नियम एवं शर्तें / LOAN GUARANTOR CONSENT & TERMS AND CONDITIONS

---

### 1. ऋण संबंधी विवरण / Loan Details

- Consent देने वाले गारंटर / Consenting Guarantor: **[GUARANTOR_NAME]**
- ऋण प्राप्तकर्ता / Loaner: **[LOANER_NAME]**
- मूलधन / ऋण राशि / Principal Loan Amount: **₹[LOAN_AMOUNT]**
- मासिक ब्याज दर / Monthly Interest Rate: **[MONTHLY_INTEREST_RATE]% प्रति माह / per month**
- न्यूनतम ब्याज अवधि / Minimum Interest Period: **[MINIMUM_TENURE_MONTHS] माह / months**
- अधिकतम भुगतान तिथि / Maximum Repayment Date: **[FINAL_REPAYMENT_DATE]**
- Consent Reference ID: **[CONSENT_ID]**

---

### 2. महत्वपूर्ण तिथियां एवं अवसर / IMPORTANT DATES & OCCASIONS

- दीपावली के अगले दिन / Day After Diwali: **[DIWALI_NEXT_DAY_DATE] — [DIWALI_NEXT_DAY_DAY_NAME]**
- नहाय-खाय का दिन / Nahay-Khay Day: **[NAHAY_KHAY_DATE] — [NAHAY_KHAY_DAY_NAME]**
- अधिकतम भुगतान का अंतिम दिन / Final Repayment Day: **[FINAL_REPAYMENT_DATE] — [FINAL_REPAYMENT_DAY_NAME]**
- छठ पूजा के सुबह अर्घ्य का दिन / Chhath Morning Arghya Day: **[CHHATH_MORNING_ARGHYA_DATE] — [CHHATH_MORNING_ARGHYA_DAY_NAME]**

*The above dates are recorded to clearly define the loan period, final repayment deadline, and guarantor-related responsibility.*

---

### 3. ऋण का विवरण / LOAN DETAILS

नवयुवक छठ पूजा समिति के वर्ष **[FUND_YEAR]** की बची हुई राशि में से ₹[LOAN_AMOUNT]/- की राशि [LOANER_NAME] को [MONTHLY_INTEREST_RATE]% प्रति माह की ब्याज दर पर दी गई है। इस राशि के लिए मुझे गारंटर के रूप में नामित किया गया है।

*An amount of ₹[LOAN_AMOUNT]/- from the remaining funds of Navyuvak Chhath Puja Samiti for the year **[FUND_YEAR]** has been provided to [LOANER_NAME] at [MONTHLY_INTEREST_RATE]% per month. I have been designated as a Guarantor for this loan.*

---

### 4. ऋण अवधि एवं ब्याज की शर्तें / LOAN TENURE & INTEREST TERMS

**4.1 न्यूनतम ब्याज अवधि / Minimum Interest Period** — [MINIMUM_TENURE_MONTHS] माह। यदि [LOANER_NAME] न्यूनतम अवधि पूरी होने से पहले मूलधन वापस करता/करती है, तब भी पूरे [MINIMUM_TENURE_MONTHS] माह का ब्याज देना अनिवार्य होगा।

**4.2 अधिकतम भुगतान अवधि / Maximum Repayment Period** — [FINAL_REPAYMENT_DATE] तक।

**4.3 अंतिम भुगतान दिवस / Final Repayment Day** — [LOANER_NAME] को [FINAL_REPAYMENT_DATE] तक मूलधन एवं देय ब्याज की पूरी राशि वापस करनी होगी।

**4.4 अंतिम तिथि तक भुगतान न होने की स्थिति** — यदि [LOANER_NAME] द्वारा [FINAL_REPAYMENT_DATE] तक पूरी राशि वापस नहीं की जाती है, तो गारंटर की भुगतान संबंधी जिम्मेदारी लागू होगी। यदि [CHHATH_MORNING_ARGHYA_DATE] की सुबह तक भी भुगतान नहीं किया जाता है, तो तीनों गारंटरों की निर्धारित जिम्मेदारी के अनुसार समिति की देय राशि की भरपाई की जाएगी।

---

### 5. गारंटर की जिम्मेदारी / GUARANTOR RESPONSIBILITY

मैं, [GUARANTOR_NAME], यह स्वीकार करता/करती हूँ कि मैं [LOANER_NAME] के उक्त ऋण के लिए गारंटर हूँ। यदि निर्धारित अंतिम समय तक ऋण की देय राशि वापस नहीं की जाती है, तो समझौते के अनुसार मेरी गारंटर संबंधी भुगतान जिम्मेदारी लागू होगी — इसमें कम-से-कम मूलधन ₹[LOAN_AMOUNT] तथा [MINIMUM_TENURE_MONTHS] माह का न्यूनतम निर्धारित ब्याज शामिल होगा।

*I, [GUARANTOR_NAME], acknowledge that I am a guarantor for this loan of [LOANER_NAME]. If the amount due is not repaid within the prescribed time, my payment responsibility as a guarantor shall apply — including at minimum the principal ₹[LOAN_AMOUNT] and the minimum interest for [MINIMUM_TENURE_MONTHS] months.*

---

### 6. तीनों गारंटर / THREE GUARANTORS

1. [GUARANTOR_1_NAME]
2. [GUARANTOR_2_NAME]
3. [GUARANTOR_3_NAME]

प्रत्येक गारंटर अपनी Consent स्वतंत्र रूप से स्वीकार या अस्वीकार करेगा।

*Each guarantor shall independently accept or decline their consent.*

---

### 7. Loaner की Final Acceptance / LOANER FINAL ACCEPTANCE

[LOANER_NAME] तब तक इस ऋण का Final Acceptance नहीं कर सकेगा/सकेगी जब तक सभी तीनों गारंटर अपनी Consent Accepted स्थिति में दर्ज नहीं कर देते।

- Guarantor 1: [GUARANTOR_1_STATUS]
- Guarantor 2: [GUARANTOR_2_STATUS]
- Guarantor 3: [GUARANTOR_3_STATUS]

**[ACCEPTED_COUNT] / 3 GUARANTORS ACCEPTED**

यदि किसी भी गारंटर का Status Pending या Declined है, तो Loaner''s Final Acceptance Locked रहेगा।

---

### 8. Consent की स्वतंत्रता / VOLUNTARY CONSENT

मैं पुष्टि करता/करती हूँ कि मैंने सभी शर्तें पढ़ी और समझी हैं तथा अपनी इच्छा से यह Consent स्वीकार करने का निर्णय लिया है। मुझ पर किसी प्रकार का अनुचित दबाव डालकर Consent स्वीकार नहीं कराया गया है।

*I confirm that I have read and understood all the terms and have voluntarily decided to provide this consent. I have not been forced or subjected to undue pressure.*

---

### 9. डिजिटल Consent Record / DIGITAL CONSENT RECORD

मैं सहमत हूँ कि मेरे द्वारा दिया गया Consent डिजिटल रूप से रिकॉर्ड और सुरक्षित किया जा सकता है, jismein naam, bhoomika, status, tareekh-samay, reference ID, aur device/technical record shaamil ho sakta hai.

*I agree that my consent may be digitally recorded and securely stored, including name, role, status, date & time, reference ID, and device/technical record.*

---

### 10. मेरी अंतिम घोषणा / FINAL DECLARATION

मैंने ऊपर दिए गए ऋण संबंधी सभी विवरण, नियम एवं शर्तें तथा गारंटर के रूप में अपनी जिम्मेदारियां ध्यानपूर्वक पढ़ ली हैं और समझ ली हैं। मैं अपनी स्वेच्छा से इस ऋण के लिए गारंटर के रूप में Consent स्वीकार करता/करती हूँ।

*I have carefully read and understood all the above loan details, terms and conditions, and my responsibilities as a guarantor. I voluntarily provide my consent as a guarantor for this loan.*', '2026-08-09 13:49:51');

-- 1 rows from sheet "PDF_TEMPLATES" -> pdf_templates
INSERT INTO pdf_templates (template_id, name, schema_json, created_at, updated_at) VALUES ('TPLmsti2f7bh7fu', 'Normal Template', '{"schemas":[[{"name":"Lbl_name","type":"table","position":{"x":24.54,"y":196},"required":false,"width":150,"height":57.5184,"content":"[[\"Alice\",\"New York\",\"Alice is a freelance web designer and developer\"],[\"Bob\",\"Paris\",\"Bob is a freelance illustrator and graphic designer\"]]","showHead":true,"repeatHead":false,"head":["Name","City","Description"],"headWidthPercentages":[30,30,40],"tableStyles":{"borderColor":"#000000","borderWidth":0.3},"headStyles":{"fontName":"NotoDevanagari","alignment":"left","verticalAlignment":"middle","fontSize":13,"lineHeight":1,"characterSpacing":0,"fontColor":"#ffffff","backgroundColor":"#2980ba","borderColor":"","borderWidth":{"top":0,"right":0,"bottom":0,"left":0},"padding":{"top":5,"right":5,"bottom":5,"left":5}},"bodyStyles":{"fontName":"NotoDevanagari","alignment":"left","verticalAlignment":"middle","fontSize":13,"lineHeight":1,"characterSpacing":0,"fontColor":"#000000","backgroundColor":"","borderColor":"#888888","borderWidth":{"top":0.1,"right":0.1,"bottom":0.1,"left":0.1},"padding":{"top":5,"right":5,"bottom":5,"left":5},"alternateBackgroundColor":"#f5f5f5"},"columnStyles":{},"readOnly":false},{"name":"Name","type":"text","content":"Type Something...","position":{"x":46.78,"y":116.89},"width":96.84,"height":24.61,"rotate":0,"alignment":"left","verticalAlignment":"top","fontSize":13,"textFormat":"plain","overflow":"visible","fontVariantFallback":"synthetic","lineHeight":1,"characterSpacing":0,"fontColor":"#000000","fontName":"NotoDevanagari","backgroundColor":"","borderColor":"#000000","borderWidth":{"top":0,"right":0,"bottom":0,"left":0},"padding":{"top":0,"right":0,"bottom":0,"left":0},"opacity":1,"strikethrough":false,"underline":false,"required":false,"readOnly":false}]],"basePdf":{"width":210,"height":297,"padding":[10,10,10,10]},"pdfmeVersion":"6.1.12"}', '2026-08-14 15:09:40', '2026-08-14 15:14:30');

