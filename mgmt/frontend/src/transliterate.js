
const GOOGLE_TIMEOUT_MS = 2500;

async function transliterateOnline(text) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOOGLE_TIMEOUT_MS);
  try {
    const url = `https://inputtools.google.com/request?text=${encodeURIComponent(text)}&itc=hi-t-i0-und&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error('bad status');
    const data = await res.json();
    if (data[0] === 'SUCCESS' && data[1] && data[1][0] && data[1][0][1] && data[1][0][1][0]) {
      return data[1][0][1][0];
    }
    throw new Error('no suggestion');
  } finally {
    clearTimeout(timeout);
  }
}

const MULTI = [
  ['shh', 'ऺ'], ['chh', 'छ'], ['ksh', 'क्ष'], ['gya', 'ज्ञ'], ['jn', 'ज्ञ'],
  ['sh', 'श'], ['ch', 'च'], ['th', 'थ'], ['dh', 'ध'], ['bh', 'भ'], ['ph', 'फ'],
  ['kh', 'ख'], ['gh', 'घ'], ['jh', 'झ'], ['ng', 'ङ'], ['ny', 'ञ'],
  ['aa', 'ा'], ['ee', 'ी'], ['oo', 'ू'], ['ai', 'ै'], ['au', 'ौ'],
  ['a', 'अ'], ['i', 'इ'], ['u', 'उ'], ['e', 'ए'], ['o', 'ओ'],
];
const VOWEL_INDEP = { a: 'अ', aa: 'आ', i: 'इ', ee: 'ई', u: 'उ', oo: 'ऊ', e: 'ए', ai: 'ऐ', o: 'ओ', au: 'औ' };
const VOWEL_MATRA = { a: '', aa: 'ा', i: 'ि', ee: 'ी', u: 'ु', oo: 'ू', e: 'े', ai: 'ै', o: 'ो', au: 'ौ' };
const CONSONANTS = {
  k: 'क', kh: 'ख', g: 'ग', gh: 'घ', ng: 'ङ',
  ch: 'च', chh: 'छ', j: 'ज', jh: 'झ', ny: 'ञ',
  t: 'ट', th: 'ठ', d: 'ड', dh: 'ढ', n: 'न',
  T: 'त', D: 'द',
  p: 'प', ph: 'फ', f: 'फ', b: 'ब', bh: 'भ', m: 'म',
  y: 'य', r: 'र', l: 'ल', v: 'व', w: 'व',
  sh: 'श', shh: 'ष', s: 'स', h: 'ह',
  q: 'क', x: 'क्स', z: 'ज़',
};
const HALANT = '्';

function transliterateWordOffline(word) {
  const vowelKeys = Object.keys(VOWEL_INDEP).sort((a, b) => b.length - a.length);
  const consKeys = Object.keys(CONSONANTS).sort((a, b) => b.length - a.length);
  let i = 0;
  let out = '';
  let lastWasConsonant = false;
  const lower = word.toLowerCase();

  while (i < lower.length) {
    let matchedCons = consKeys.find(c => lower.startsWith(c, i));
    if (matchedCons) {
      i += matchedCons.length;
      let matchedVowel = vowelKeys.find(v => lower.startsWith(v, i));
      if (matchedVowel) {
        out += CONSONANTS[matchedCons] + VOWEL_MATRA[matchedVowel];
        i += matchedVowel.length;
        lastWasConsonant = false;
      } else {
        out += CONSONANTS[matchedCons];
        lastWasConsonant = true;
      }
      continue;
    }
    let matchedVowel = vowelKeys.find(v => lower.startsWith(v, i));
    if (matchedVowel) {
      if (lastWasConsonant) {
      }
      out += VOWEL_INDEP[matchedVowel];
      i += matchedVowel.length;
      lastWasConsonant = false;
      continue;
    }
    out += word[i];
    i += 1;
    lastWasConsonant = false;
  }
  return out;
}

function transliterateOffline(text) {
  return text.split(' ').map(w => (w ? transliterateWordOffline(w) : w)).join(' ');
}

let offlineFallbackReported = false;

export async function transliterate(text) {
  const r = await transliterateWithMeta(text);
  return r.text;
}

export async function transliterateWithMeta(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return { text: '', approximate: false };
  try {
    return { text: await transliterateOnline(trimmed), approximate: false };
  } catch (err) {
    if (!offlineFallbackReported) {
      offlineFallbackReported = true;
      import('./api.js')
        .then(({ reportClientError }) => reportClientError(
          'transliterate',
          'Online transliteration unavailable — falling back to the approximate offline table. Hindi spellings entered now may be wrong.',
          err,
          {}
        ))
        .catch(() => {});
    }
    return { text: transliterateOffline(trimmed), approximate: true };
  }
}
