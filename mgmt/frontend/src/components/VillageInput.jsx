import { useState, useEffect } from 'react';
import { useDropdownList } from '../useDropdownList.js';
import TransliterateInput from './TransliterateInput.jsx';

// Dropdown of known villages (from DROPDOWN_LISTS, Superadmin-managed) + "Other"
// which reveals a bilingual free-text field (auto-transliterate + edit pencil).
// value = plain village name string (English), hiValue = village Hindi string.
// onChange(village, villageHindi) — villageHindi is looked up automatically when
// picked from the list, or typed/transliterated when "Other" is used.
export default function VillageInput({ value, hiValue, onChange }) {
  const { options, hindiOf } = useDropdownList('Village');
  const villageNames = options.map(o => o['English Value']);
  const [customMode, setCustomMode] = useState(Boolean(value) && !villageNames.includes(value));

  useEffect(() => {
    if (value && villageNames.length && !villageNames.includes(value)) setCustomMode(true);
    else if (villageNames.includes(value)) setCustomMode(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, options.length]);

  return (
    <>
      <select
        value={customMode ? 'Other' : (value || '')}
        onChange={e => {
          if (e.target.value === 'Other') {
            setCustomMode(true);
            onChange('', '');
          } else {
            setCustomMode(false);
            onChange(e.target.value, hindiOf(e.target.value));
          }
        }}
      >
        <option value="" disabled>-- Select Village --</option>
        {villageNames.map(v => <option key={v} value={v}>{v}</option>)}
        <option value="Other">Other</option>
      </select>
      {customMode && (
        <div style={{ marginTop: 8 }}>
          <TransliterateInput
            label="Village"
            placeholder="Enter village name"
            value={{ en: value || '', hi: hiValue || '' }}
            onChange={({ en, hi }) => onChange(en, hi)}
          />
        </div>
      )}
    </>
  );
}
