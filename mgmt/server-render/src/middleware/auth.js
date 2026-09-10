import crypto from 'node:crypto';
import { config } from '../config.js';

// Constant-time compare of two strings (via SHA-256 of each, so length differences
// don't short-circuit and leak timing). Node's timingSafeEqual needs equal-length
// buffers; hashing first guarantees that.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update((a || '').toString()).digest();
  const hb = crypto.createHash('sha256').update((b || '').toString()).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Require the shared secret on every Worker->Render request (Requirement #1:
// the Render server is never usable without auth). Missing/mismatch -> 401.
export function requireRenderApiKey(req, res, next) {
  const provided = req.get('X-Render-Api-Key') || '';
  if (!provided || !safeEqual(provided, config.renderApiKey)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
}
