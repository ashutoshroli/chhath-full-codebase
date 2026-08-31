// ============ RUNTIME POLYFILLS (must be imported first) ============
//
// The production Error Log had 5 rows of:
//     Uncaught TypeError: this.i.at is not a function
//     Uncaught TypeError: t.entries.at is not a function
//
// `Array.prototype.at()` needs Chrome/Edge 92+, Safari 15.4+, Firefox 90+. Several
// committee members are on older Android WebViews / iOS builds, where the app died
// outright at that call.
//
// WHY A POLYFILL AND NOT A BUILD TARGET
// Lowering `build.target` in vite.config.js does NOT fix this. esbuild down-levels
// *syntax* (optional chaining, `??=`, class fields); it never rewrites *instance
// method* calls and ships no runtime shims. Verified against a real build: with
// target chrome87/safari14 the output still contained 19 raw `.at(` calls, coming
// from `marked` (its lexer does `tokens.at(-1)`) and from the APNG decoder inside
// the jspdf/html2canvas chunk. Both are dependencies, so we cannot avoid the call
// in our own code — the prototype has to be filled in.
//
// Everything else modern in the bundle was checked and needs no shim at our target:
// Object.hasOwn ships with its own `||` fallback, `??=` is lowered by esbuild, and
// .flatMap/.trimEnd/Promise.allSettled/globalThis/queueMicrotask all predate it.

// Spec-faithful enough for the callers above: relative index, floor-truncated,
// undefined when out of range.
function at(index) {
  const len = this.length >>> 0;
  let i = Math.trunc(index) || 0;
  if (i < 0) i += len;
  if (i < 0 || i >= len) return undefined;
  return this[i];
}

if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, 'at', {
    value: at, writable: true, enumerable: false, configurable: true,
  });
}

if (!String.prototype.at) {
  Object.defineProperty(String.prototype, 'at', {
    value: at, writable: true, enumerable: false, configurable: true,
  });
}

// The APNG decoder indexes into Uint8Array-backed frame data.
const TypedArray = Object.getPrototypeOf(Int8Array);
if (TypedArray && TypedArray.prototype && !TypedArray.prototype.at) {
  Object.defineProperty(TypedArray.prototype, 'at', {
    value: at, writable: true, enumerable: false, configurable: true,
  });
}
