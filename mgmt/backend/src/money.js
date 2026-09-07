// ============ Shared money parsing (audit L-13) ============
//
// parseAmt was copy-pasted identically into templates.js, views.js, loans.js,
// docxTemplates.js and whatsapp.js. Identical duplication drifts (see M-31, where
// two copies of isTruthyFlag disagreed on 7 real values), so it lives here once.
//
// Parses a currency-ish value ("₹1,100", "1100", 1100, null) to a Number.
// Strips everything except digits, the minus sign and the decimal point, then
// parseFloat. Non-numeric / empty / null -> 0 (never NaN), matching the original
// behaviour byte-for-byte.
export const parseAmt = (v) => parseFloat((v || '').toString().replace(/[^0-9.-]+/g, '')) || 0;
