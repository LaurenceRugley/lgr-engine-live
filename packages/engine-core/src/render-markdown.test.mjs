/* render-markdown.test.mjs — headless (node --test). The renderer is pure string→string; each test encodes
   the WHY (Rule 9). Run: node --test packages/engine-core/src/render-markdown.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderNoteHtml, scanFileRefs } from './render-markdown.js';

const live = (t) => ['a-note', 'workers'].includes(t);

test('UNTRUSTED input: <script> renders as visible text, never as a tag (escape-first is the design)', () => {
  const html = renderNoteHtml('hello <script>alert(1)</script> & <img onerror=x>');
  assert.ok(!html.includes('<script'), 'no live script tag');
  assert.ok(!html.includes('<img'), 'no live img tag');
  assert.ok(html.includes('&lt;script&gt;'), 'script visible as text');
  assert.ok(html.includes('&amp;'), 'ampersand escaped');
});

test('wikilinks: live target → navigable span with data-wl; alias respected; dead target → inert + honest title', () => {
  const html = renderNoteHtml('see [[a-note|The Note]] and [[ghost-note]]', { resolveWikilink: live });
  assert.ok(html.includes('data-wl="a-note"'), 'live link carries the nav target');
  assert.ok(html.includes('>The Note</span>'), 'alias is the label');
  assert.ok(html.includes('wl-dead'), 'dead link marked');
  assert.ok(html.includes('needs tending'), 'dead link says why it is inert');
  assert.ok(!html.includes('data-wl="ghost-note"'), 'dead link is NOT navigable');
});

test('fenced blocks are verbatim islands: markup inside them is not transformed, content is escaped', () => {
  const html = renderNoteHtml('```js\nconst a = "**not bold**";\nif (a < b) {}\n```');
  assert.ok(html.includes('<pre><code>'), 'fence renders as pre/code');
  assert.ok(html.includes('**not bold**'), 'bold syntax inert inside fence');
  assert.ok(html.includes('&lt; b'), 'operators escaped inside fence');
});

test('headings shift down one level (the reader panel owns h1) and lists open/close correctly', () => {
  const html = renderNoteHtml('# Title\n\n- one\n- two\n\n1. first\n\ntext');
  assert.ok(html.includes('<h2>Title</h2>'), 'h1 renders as h2');
  assert.ok(/<ul>\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ul>/.test(html), 'ul run closes');
  assert.ok(html.includes('<ol>'), 'numbered list becomes ol');
  assert.ok(html.includes('<p>text</p>'), 'paragraph after list');
});

test('inline order: code spans are immune to bold/italic; plain links get _blank + noopener', () => {
  const html = renderNoteHtml('use `**raw**` but **bold** and [docs](https://example.com)');
  assert.ok(html.includes('<code>**raw**</code>'), 'code interior untouched');
  assert.ok(html.includes('<strong>bold</strong>'));
  assert.ok(html.includes('target="_blank" rel="noopener"'), 'external link hardened');
});

test('frontmatter is stripped; empty/non-string input yields empty output', () => {
  assert.ok(!renderNoteHtml('---\nname: x\ntags: [kind/doctrine]\n---\nbody').includes('kind/doctrine'));
  assert.equal(renderNoteHtml(''), '');
  assert.equal(renderNoteHtml(null), '');
});

test('hard-wrapped source lines JOIN into one paragraph (vault notes wrap at ~100 chars)', () => {
  const html = renderNoteHtml('first line of a sentence\nthat continues here.\n\nsecond paragraph.');
  assert.ok(html.includes('<p>first line of a sentence that continues here.</p>'), 'lines joined');
  assert.equal((html.match(/<p>/g) || []).length, 2, 'blank line still splits paragraphs');
});

test('images: relative paths render inline, foreign schemes stay labeled links (no third-party hot-load)', () => {
  const html = renderNoteHtml('![diagram](docs/pic.png) and ![ext](https://x.com/pic.png)');
  assert.ok(html.includes('<img src="docs/pic.png" alt="diagram" loading="lazy">'), 'relative image inline');
  assert.ok(!html.includes('<img src="https'), 'foreign image NOT hot-loaded');
  assert.ok(html.includes('rel="noopener">🖼 ext</a>'), 'foreign image is a labeled link');
});

test('scanFileRefs: plain file links surface as references; notes/web/images do not', () => {
  const refs = scanFileRefs('see [spec](docs/plan.pdf), [note]([[x]]-ish.md), [site](https://a.com/b.pdf), ![img](p.png), [dup](docs/plan.pdf)');
  assert.deepEqual(refs, [{ label: 'spec', path: 'docs/plan.pdf' }], 'only the pdf, deduped');
});
