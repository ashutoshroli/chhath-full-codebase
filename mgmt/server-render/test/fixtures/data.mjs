// The known input data for the golden baseline + parity tests. Shared by the
// capture harness (which runs the browser renderer on main) and the parity test
// (which runs the ported server renderer), so both fill the SAME template with
// the SAME data and their outputs can be compared byte-for-byte.
//
//   name          -> resolves
//   missing       -> deliberately ABSENT so nullGetter fires (missingTags)
//   photo         -> a valid 1x1 red PNG data-URL
//   missingPhoto  -> a truthy-but-invalid data-URL whose base64 payload is empty,
//                    so getImage records missingImages and returns BLANK_PNG.
//
// NOTE ON THE FALLBACK PATH: docxtemplater-image-module-free only calls getImage
// when the tag value is TRUTHY (a falsy/empty value renders as empty tag text and
// getImage is never reached). To genuinely exercise the renderer's blank-PNG
// fallback + missingImages recording we therefore pass a non-empty but INVALID
// data-URL ("data:image/png;base64," with no payload): base64FromDataUrl extracts
// an empty string, which is falsy, so getImage records the tag and returns the
// 1x1 BLANK_PNG. This is the real "missing/invalid image" case in production.

// A valid 1x1 red PNG, distinct from the renderer's internal BLANK_PNG fallback,
// so a test can tell "used the supplied image" from "fell back to blank".
export const RED_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export const DATA = {
  name: 'Chhath Committee',
  // `missing` intentionally omitted -> unresolved tag.
  photo: `data:image/png;base64,${RED_PNG_B64}`,
  missingPhoto: 'data:image/png;base64,', // truthy but empty payload -> blank-PNG fallback
};

// Second, DIFFERENT document used only by the concurrency test. Its report must
// differ from DATA's so a singleton report bug is caught: here BOTH image tags
// resolve to the valid PNG (no missingImages) and `missing` is still unresolved.
export const DATA_B = {
  name: 'Second Document',
  photo: `data:image/png;base64,${RED_PNG_B64}`,
  missingPhoto: `data:image/png;base64,${RED_PNG_B64}`,
};
