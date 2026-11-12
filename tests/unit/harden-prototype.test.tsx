// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { hardenPrototype } from '../../src/desktop/presentation/inception/harden-prototype.js';
import { PROTOTYPE_CSP, findExternalReferences } from '../../src/shared/prototype-safety.js';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const policy = (doc: Document) => doc.head.firstElementChild as HTMLMetaElement;

describe('hardenPrototype: what the preview iframe loads', () => {
  it('puts the no-network policy as the very first element, even when a comment or a script tries to get ahead of it', () => {
    const tricky =
      '<!-- <head> --><script>window.early = 1</script><!doctype html><html><head><title>x</title><script>fetch("https://evil.example")</script></head><body><p>hola</p></body></html>';
    const doc = parse(hardenPrototype(tricky));
    expect(policy(doc).getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(policy(doc).getAttribute('content')).toBe(PROTOTYPE_CSP);
    expect(doc.head.firstElementChild).toBe(policy(doc));
    // Everything the prototype needs to run is still there: its scripts, styles and content.
    expect(doc.querySelectorAll('script')).toHaveLength(2);
    expect(doc.body.textContent).toContain('hola');
  });

  it('works on a bare fragment with no html, head or doctype', () => {
    const html = hardenPrototype('<div id="app">solo un div</div><script>1+1</script>');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    const doc = parse(html);
    expect(policy(doc).getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(doc.getElementById('app')?.textContent).toBe('solo un div');
  });

  it('forbids every network request and everything but inline code', () => {
    for (const rule of [
      "default-src 'none'",
      "connect-src 'none'",
      "form-action 'none'",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "script-src 'unsafe-inline'",
      "style-src 'unsafe-inline'",
      'img-src data: blob:',
      'font-src data:',
    ])
      expect(PROTOTYPE_CSP).toContain(rule);
    expect(PROTOTYPE_CSP).not.toMatch(/https?:|\*|'self'|unsafe-eval/);
  });

  it('removes what could leave the document: links to other sites, submitting forms, frames, objects, stylesheets, redirects and a base', () => {
    const doc = parse(
      hardenPrototype(`<!doctype html><html><head>
      <meta http-equiv="refresh" content="0;url=https://evil.example"><meta http-equiv="Content-Security-Policy" content="default-src *">
      <base href="https://evil.example/"><link rel="stylesheet" href="https://cdn.example.com/x.css"></head><body>
      <a id="out" href="https://evil.example" target="_blank">fuera</a><a id="in" href="#seccion">dentro</a><a id="mail" href="mailto:a@b.c">mail</a>
      <form id="f" action="https://evil.example/post" method="post"><button formaction="https://evil.example/x">enviar</button></form>
      <iframe src="https://evil.example"></iframe><object data="x.swf"></object><embed src="y"></body></html>`),
    );
    expect(doc.querySelector('#out')?.hasAttribute('href')).toBe(false);
    expect(doc.querySelector('#out')?.hasAttribute('target')).toBe(false);
    expect(doc.querySelector('#in')?.getAttribute('href')).toBe('#seccion');
    expect(doc.querySelector('#mail')?.hasAttribute('href')).toBe(false);
    expect(doc.querySelector('#f')?.hasAttribute('action')).toBe(false);
    expect(doc.querySelector('button')?.hasAttribute('formaction')).toBe(false);
    expect(doc.querySelectorAll('iframe, object, embed, base, link')).toHaveLength(0);
    // Only our own policy remains; the prototype's own http-equiv metas (refresh, a looser CSP) are gone.
    expect(doc.querySelectorAll('meta[http-equiv]')).toHaveLength(1);
  });

  it('is idempotent: hardening twice does not stack policies', () => {
    const once = hardenPrototype('<main>x</main>');
    expect(parse(hardenPrototype(once)).querySelectorAll('meta[http-equiv]')).toHaveLength(1);
  });
});

describe('findExternalReferences', () => {
  it('lists the hosts of absolute URLs and the network APIs, once each, at most six', () => {
    expect(
      findExternalReferences(
        '<link href="https://fonts.googleapis.com/css"><script src="//cdn.jsdelivr.net/npm/x"></script><img src="http://img.example.org/a.png"><style>@import url(https://fonts.googleapis.com/x)</style><script>fetch("/api"); new WebSocket("wss://ws.example.com")</script>',
      ),
    ).toEqual([
      'fonts.googleapis.com',
      'cdn.jsdelivr.net',
      'img.example.org',
      'ws.example.com',
      'fetch()',
      'WebSocket',
    ]);
    expect(
      findExternalReferences(
        Array.from({ length: 9 }, (_, index) => `<img src="https://h${index}.example.com/a">`).join(''),
      ),
    ).toHaveLength(6);
  });
  it('ignores relative paths, anchors, data URIs and version numbers', () => {
    expect(
      findExternalReferences(
        '<a href="#x">a</a><img src="data:image/png;base64,AAAA"><link href="./style.css"><p>Versión 1.2.3 de Node 22.11</p>',
      ),
    ).toEqual([]);
  });
});
