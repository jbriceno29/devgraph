import { PROTOTYPE_CSP } from '../../../shared/prototype-safety.js';

/**
 * The document the preview iframe loads. The iframe is `sandbox="allow-scripts allow-forms"` (opaque origin: no access to the app, its storage or the top
 * window); this adds what the sandbox alone does not stop: a Content-Security-Policy that forbids every network request, as the very first
 * element of the document, and the removal of whatever could leave it or open something else (links to other sites, forms that submit, frames,
 * objects, external stylesheets, redirects). The HTML is parsed, not pattern-matched, so a `<head>` inside a comment cannot hide the policy.
 */
export function hardenPrototype(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc
    .querySelectorAll('meta[http-equiv], link, base, iframe, frame, frameset, object, embed, applet')
    .forEach(element => element.remove());
  doc.querySelectorAll('a[href], area[href]').forEach(element => {
    if (!(element.getAttribute('href') ?? '').startsWith('#')) element.removeAttribute('href');
  });
  doc.querySelectorAll('[target]').forEach(element => element.removeAttribute('target'));
  doc.querySelectorAll('form[action], [formaction], form[target]').forEach(element => {
    element.removeAttribute('action');
    element.removeAttribute('formaction');
  });
  const policy = doc.createElement('meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy');
  policy.setAttribute('content', PROTOTYPE_CSP);
  doc.head.prepend(policy);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}
