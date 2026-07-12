/* ingest-vault.test.mjs — headless (node --test). The parse/build functions are pure; tested with inline
   FIXTURES (not the live vault, which changes as auto-memory writes). Each test encodes the WHY (Rule 9).
   Run: `node --test projects/atlas/ingest-vault.test.mjs`. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, extractLinks, extractMarkdownLinks, noteToRecords, buildGraphSpec, extractExcerpt } from './ingest-vault.js';
import { validateGraphSpec } from './graph-spec.js';

const NOTE = `---
name: dev-mode-face1-proto
metadata:
  node_type: memory
  type: project
tags: [kind/live-ops]
---
Body text linking [[mission-control-graph]] and [[engine-first-upstream]] and again [[mission-control-graph]].
`;

test('parseFrontmatter reads our known shape (name, node_type, kind tag)', () => {
  const fm = parseFrontmatter(NOTE);
  assert.equal(fm.name, 'dev-mode-face1-proto');
  assert.equal(fm.nodeType, 'memory');
  assert.equal(fm.kind, 'live-ops');
});

test('parseFrontmatter on a note with no frontmatter returns empty (not a throw)', () => {
  assert.deepEqual(parseFrontmatter('# just a heading\n[[x]]'), {});
});

test('extractLinks finds every [[link]], strips aliases, dedups, preserves order', () => {
  assert.deepEqual(extractLinks(NOTE), ['mission-control-graph', 'engine-first-upstream']);
  assert.deepEqual(extractLinks('see [[target|Alias Text]] here'), ['target']);
});

test('extractLinks ignores wikilinks shown as CODE examples (inline + fenced), keeps real prose links', () => {
  // Grounded in the real vault: the design note documents the format with `[[links]]` in inline code —
  // that must NOT become a graph edge; a bare prose [[L08]] must.
  assert.deepEqual(extractLinks('the format uses `[[links]]` and ```\n[[fenced-example]]\n``` but see [[L08]]'), ['L08']);
});

test('noteToRecords maps a content note to a typed NodeRecord + its link targets', () => {
  const { node, links } = noteToRecords('dev-mode-face1-proto', NOTE);
  assert.deepEqual(node, {
    id: 'dev-mode-face1-proto', label: 'dev-mode-face1-proto',
    kind: 'live-ops', type: 'memory', href: 'dev-mode-face1-proto.md',
  });
  assert.deepEqual(links, ['mission-control-graph', 'engine-first-upstream']);
});

test('MEMORY.md becomes the single hub node', () => {
  const { node } = noteToRecords('MEMORY', '# index\n- [x](x.md)');
  assert.equal(node.kind, 'hub');
  assert.equal(node.label, 'MEMORY');
});

test('an untagged note drops kind/type rather than emitting undefined (clean spec)', () => {
  const { node } = noteToRecords('bare', '---\nname: Bare\n---\nno tags here');
  assert.equal('kind' in node, false);
  assert.equal('type' in node, false);
  assert.equal(node.label, 'Bare');
});

test('buildGraphSpec on a self-consistent vault validates clean', () => {
  const notes = [
    { slug: 'MEMORY', content: '# index' },
    { slug: 'a', content: '---\nname: A\ntags: [kind/doctrine]\n---\nlinks [[b]]' },
    { slug: 'b', content: '---\nname: B\ntags: [kind/initiative]\n---\nno links' },
  ];
  const spec = buildGraphSpec(notes);
  assert.equal(spec.nodes.length, 3);
  assert.equal(spec.edges.length, 1);
  assert.equal(validateGraphSpec(spec).ok, true);
});

test('extractExcerpt: strips frontmatter/headings, flattens links+markup, clips at a word boundary', () => {
  const note = '---\nname: x\n---\n# Heading\n\n**STATUS:** links [[a-note|A Note]] and `code` here.\n\nSecond para.';
  assert.equal(extractExcerpt(note), 'STATUS: links A Note and code here.');
  assert.equal(extractExcerpt('---\nname: y\n---\n'), '');                      // frontmatter-only note
  const long = '---\nname: z\n---\n' + 'word '.repeat(100);
  const ex = extractExcerpt(long, 50);
  assert.ok(ex.length <= 51 && ex.endsWith('…'), 'clips with ellipsis at a word boundary');
});

test('a [[link]] to a missing note produces a DANGLING edge the validator catches (the L08 class)', () => {
  // This is the whole point: ingestion is permissive (emits the edge), validation is strict (flags it).
  const notes = [{ slug: 'office-dive', content: '---\nname: Office\ntags: [kind/initiative]\n---\nStyle LOD [[L08]]' }];
  const spec = buildGraphSpec(notes);
  assert.equal(spec.edges.length, 1);
  const r = validateGraphSpec(spec);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /L08.*dangling/i);
});

/* --- VIZ SLICE 5: the hub's markdown index links become real edges (slice-4 finding, DESIGN ruling) --- */

test('extractMarkdownLinks harvests [Title](note.md) as slugs, ignoring URLs, images and code examples', () => {
  const md = [
    '- [Design workflow](design-implement-workflow.md) — the baton',
    '- [Audio](audio-direction.md#section) — anchors are dropped',
    '- [Docs](https://example.com/thing.md) — an absolute URL is not a note',
    '- ![shot](capture.png) — not a note either',
    'Documented as `[Example](example.md)` in prose — a code span is not an edge.',
  ].join('\n');
  assert.deepEqual(extractMarkdownLinks(md), ['design-implement-workflow', 'audio-direction']);
});

test('the HUB is no longer an orphan: MEMORY.md index links become hub->note edges', () => {
  // WHY THIS MATTERS: the hub is the index of the whole vault. With degree 0 it floated at the origin, and
  // because focus-dim keys off ADJACENCY, selecting any node hid the hub — the one node that should always
  // stay lit. An index that indexes nothing is not an index; this test is the guard against regressing it.
  const notes = [
    { slug: 'MEMORY', content: '# Index\n- [Alpha](alpha.md) — hook\n- [Beta](beta.md) — hook\n' },
    { slug: 'alpha', content: '---\nname: Alpha\n---\nAlpha body.\n' },
    { slug: 'beta', content: '---\nname: Beta\n---\nBeta links to [[alpha]].\n' },
  ];
  const spec = buildGraphSpec(notes);
  const hubEdges = spec.edges.filter((e) => e.from === 'MEMORY');
  assert.deepEqual(hubEdges.map((e) => e.to).sort(), ['alpha', 'beta']);
  assert.equal(validateGraphSpec(spec).ok, true, 'hub edges must resolve to real nodes, not dangle');
});

test('a NON-hub note\'s markdown links stay CITATIONS, not edges — [[wikilinks]] are the vault convention', () => {
  // Scoped deliberately: prose that references [a file](x.md) is citing it. Harvesting those everywhere
  // would silently double the graph's edge count with links their authors never meant as structure.
  const { links } = noteToRecords('alpha', 'See [Beta](beta.md) for context, and [[gamma]] for the rule.');
  assert.deepEqual(links, ['gamma']);
});

test('noteToRecords href override — non-vault sources (docs/guides) name their repo-relative file', () => {
  // A guide's inspector link must point at the REAL file (docs/guides/cloudflare/workers.md), not a
  // fabricated vault-style "workers.md" that doesn't exist. Default (no override) stays vault-shaped.
  const content = '---\nname: workers\ntags: [kind/learning, topic/cloudflare]\n---\nsee [[what-is-cloudflare|PoP]]';
  const { node, links } = noteToRecords('workers', content, { href: 'docs/guides/cloudflare/workers.md' });
  assert.equal(node.href, 'docs/guides/cloudflare/workers.md');
  assert.equal(node.kind, 'learning');
  assert.deepEqual(links, ['what-is-cloudflare']);   // alias stripped, cross-guide edge harvested
  assert.equal(noteToRecords('a', '---\nname: a\n---\nx').node.href, 'a.md');   // default unchanged
});
