import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectDocType, buildRecordId, isFileGenerated } from '../src/lib/downloads.js';

test('selectDocType: Contribution Type "2" is a material receipt (samaan)', () => {
  assert.equal(selectDocType({ 'Contribution Type': '2' }), 'samaan');
  assert.equal(selectDocType({ 'Contribution Type': '2', 'Certificate Or Receipt': 'Certificate' }), 'samaan');
});

test('selectDocType: an explicit Certificate choice (non-material) -> certificate', () => {
  assert.equal(selectDocType({ 'Contribution Type': '1', 'Certificate Or Receipt': 'Certificate' }), 'certificate');
  assert.equal(selectDocType({ 'Contribution Type': '3', 'Certificate Or Receipt': 'Certificate' }), 'certificate');
});

test('selectDocType: Contribution Type "3" receipt (not cert, not material) -> receipt_work', () => {
  assert.equal(selectDocType({ 'Contribution Type': '3' }), 'receipt_work');
  assert.equal(selectDocType({ 'Contribution Type': '3', 'Certificate Or Receipt': 'Receipt' }), 'receipt_work');
});

test('selectDocType: everything else -> plain receipt', () => {
  assert.equal(selectDocType({ 'Contribution Type': '1' }), 'receipt');
  assert.equal(selectDocType({ 'Contribution Type': '1', 'Certificate Or Receipt': 'Receipt' }), 'receipt');
  assert.equal(selectDocType({}), 'receipt');
  assert.equal(selectDocType(null), 'receipt');
});

test('buildRecordId: produces `${docType}-${year}-${rowIndex}`', () => {
  assert.equal(buildRecordId('receipt', 2023, 5), 'receipt-2023-5');
  assert.equal(buildRecordId('samaan', 2022, 0), 'samaan-2022-0');
  assert.equal(buildRecordId('receipt_work', 2024, 12), 'receipt_work-2024-12');
  assert.equal(buildRecordId('certificate', 2021, 3), 'certificate-2021-3');
});

test('isFileGenerated: matches on doc_type + integer year + record_id, else null', () => {
  const generatedFiles = [
    { doc_type: 'receipt', year: '2023', record_id: 'receipt-2023-5', public_link: 'https://x/1' },
    { doc_type: 'certificate', year: 2022, record_id: 'certificate-2022-1', public_link: 'https://x/2' },
  ];
  const hit = isFileGenerated(generatedFiles, 'receipt', 2023, 'receipt-2023-5');
  assert.ok(hit);
  assert.equal(hit.public_link, 'https://x/1');
  assert.ok(isFileGenerated(generatedFiles, 'certificate', 2022, 'certificate-2022-1'));
  assert.equal(isFileGenerated(generatedFiles, 'receipt', 2024, 'receipt-2024-5'), null);
  assert.equal(isFileGenerated([], 'receipt', 2023, 'receipt-2023-5'), null);
  assert.equal(isFileGenerated(undefined, 'receipt', 2023, 'receipt-2023-5'), null);
});
