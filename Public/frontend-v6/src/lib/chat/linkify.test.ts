// linkifyTokens() turns UNTRUSTED bot replies into text/link tokens. These tests
// pin the safety guarantees that make {@html} unnecessary: only validated
// http(s) URLs become link tokens, markdown autolink brackets are stripped, and
// no XSS/attribute-breakout payload can escape a text token. Runs in the default
// node env (pure function, no DOM).

import { describe, it, expect } from 'vitest';
import { linkifyTokens, type LinkToken, type Token } from './linkify';

const links = (toks: Token[]): LinkToken[] => toks.filter((t): t is LinkToken => t.type === 'link');
const text = (toks: Token[]) =>
  toks
    .filter((t) => t.type === 'text')
    .map((t) => (t as { value: string }).value)
    .join('');

describe('linkifyTokens — recognition', () => {
  it('strips the angle brackets off a markdown autolink and yields ONE link token', () => {
    const toks = linkifyTokens('See <https://host.example/x.pdf> now');
    const ls = links(toks);
    expect(ls).toHaveLength(1);
    expect(ls[0].href).toBe('https://host.example/x.pdf');
    expect(ls[0].label).toBe('https://host.example/x.pdf');
    expect(ls[0].href).not.toContain('<');
    expect(ls[0].href).not.toContain('>');
    expect(ls[0].label).not.toContain('<');
    expect(ls[0].label).not.toContain('>');
  });

  it('turns a bare https url into a link token whose label equals the href', () => {
    const toks = linkifyTokens('go to https://example.com/page');
    const ls = links(toks);
    expect(ls).toHaveLength(1);
    expect(ls[0].href).toBe('https://example.com/page');
    expect(ls[0].label).toBe(ls[0].href);
  });

  it('uses the markdown label for [label](url)', () => {
    const toks = linkifyTokens('click [the docs](https://example.com/docs)');
    const ls = links(toks);
    expect(ls).toHaveLength(1);
    expect(ls[0].href).toBe('https://example.com/docs');
    expect(ls[0].label).toBe('the docs');
  });

  it('leaves plain text with no url as a single unchanged text token', () => {
    const toks = linkifyTokens('just a normal sentence, नमस्ते');
    expect(toks).toHaveLength(1);
    expect(toks[0]).toEqual({ type: 'text', value: 'just a normal sentence, नमस्ते' });
  });

  it('preserves newlines and leading indentation exactly', () => {
    const src = 'line1\n  - item\n\nend';
    const toks = linkifyTokens(src);
    expect(text(toks)).toBe(src);
  });

  it('trims trailing sentence punctuation off a bare url', () => {
    const toks = linkifyTokens('visit https://example.com/x.');
    const ls = links(toks);
    expect(ls).toHaveLength(1);
    expect(ls[0].href).toBe('https://example.com/x');
    expect(text(toks)).toContain('.');
  });
});

describe('linkifyTokens — scheme safety', () => {
  it('never links a javascript: url (stays text)', () => {
    const toks = linkifyTokens('javascript:alert(1)');
    expect(links(toks)).toHaveLength(0);
    expect(text(toks)).toContain('javascript:alert(1)');
  });

  it('never links a data: url (stays text)', () => {
    const toks = linkifyTokens('data:text/html,<script>alert(1)</script>');
    expect(links(toks)).toHaveLength(0);
  });

  it('never links vbscript:/file:/mailto:/relative/protocol-relative targets', () => {
    for (const s of [
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'mailto:a@b.com',
      '/relative/path',
      '//evil.example/x',
      'ftp://host/f'
    ]) {
      expect(links(linkifyTokens(s)), s).toHaveLength(0);
    }
  });

  it('rejects a javascript: url even inside markdown link syntax', () => {
    const toks = linkifyTokens('[click me](javascript:alert(1))');
    expect(links(toks)).toHaveLength(0);
  });
});

describe('linkifyTokens — XSS / attribute breakout', () => {
  it('keeps a raw HTML/onerror payload as text, never a link', () => {
    const toks = linkifyTokens('"><img src=x onerror=alert(1)>');
    expect(links(toks)).toHaveLength(0);
    // The dangerous characters remain in a plain text token; Svelte will escape
    // them at render time. No link token means no anchor is ever produced.
    expect(text(toks)).toContain('onerror');
  });

  it('cannot break out of the href even when the url carries quotes/brackets', () => {
    const toks = linkifyTokens('https://evil.example/"><script>alert(1)</script>');
    const ls = links(toks);
    // Whatever is treated as the URL is a single href value; the payload cannot
    // introduce a new attribute because Svelte escapes attribute values and the
    // scanner stops the URL at whitespace/`<`/`>`.
    if (ls.length) {
      expect(ls[0].href).not.toContain('<');
      expect(ls[0].href).not.toContain('>');
      expect(ls[0].href.startsWith('https://')).toBe(true);
    }
  });
});
