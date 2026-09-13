// Ported verbatim from mgmt/frontend/src/polyfills.js — Array/String/TypedArray
// `.at()` for older browsers. Imported once from the root +layout so it runs
// before any app code (same position as React's main.jsx import).
function at(this: { length: number; [i: number]: unknown }, index: number) {
  const len = this.length >>> 0;
  let i = Math.trunc(index) || 0;
  if (i < 0) i += len;
  if (i < 0 || i >= len) return undefined;
  return this[i];
}

if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, 'at', {
    value: at,
    writable: true,
    enumerable: false,
    configurable: true
  });
}

if (!String.prototype.at) {
  Object.defineProperty(String.prototype, 'at', {
    value: at,
    writable: true,
    enumerable: false,
    configurable: true
  });
}

const TypedArray = Object.getPrototypeOf(Int8Array);
if (TypedArray && TypedArray.prototype && !TypedArray.prototype.at) {
  Object.defineProperty(TypedArray.prototype, 'at', {
    value: at,
    writable: true,
    enumerable: false,
    configurable: true
  });
}

export {};
