/* scroll-narrative.test.mjs — node:test, headless, no DOM. Rule 9: each test states the consequence of failure. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChapterChain, readChapterChain, createScrollNarrative } from './scroll-narrative.js';

const THREE_EQUAL = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

test('equal-weight sections divide [0,1] into equal thirds', () => {
  // WHY: "weight" is the whole scroll-budget promise — if equal weights don't produce equal ranges,
  // no per-section override could ever be trusted either.
  const chain = buildChapterChain(THREE_EQUAL);
  assert.equal(chain.sectionSegments.length, 3);
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(chain.sectionSegments[i].start - i / 3) < 1e-9);
    assert.ok(Math.abs(chain.sectionSegments[i].end - (i + 1) / 3) < 1e-9);
  }
});

test('a heavier weight buys a proportionally longer dwell', () => {
  // WHY: "a longer budget = a slower dwell" is the brief's stated contract — a weight-2 section that
  // doesn't occupy twice the range of a weight-1 sibling silently breaks every project that tunes pacing.
  const chain = buildChapterChain([{ id: 'a', weight: 1 }, { id: 'b', weight: 3 }]);
  const [a, b] = chain.sectionSegments;
  assert.ok(Math.abs((a.end - a.start) - 0.25) < 1e-9);
  assert.ok(Math.abs((b.end - b.start) - 0.75) < 1e-9);
});

test('a connector opens a content-free gap between two sections', () => {
  // WHY: the brief asks for "optional connector segments between them" — a project relies on there being
  // real dead space (e.g. for a camera flyover) between chapters when it asks for one.
  const chain = buildChapterChain(THREE_EQUAL.slice(0, 2), { connectorWeight: 1 });
  // sections=1+1, connector=1 → total weight 3: section0 [0,1/3], connector [1/3,2/3], section1 [2/3,1].
  assert.equal(chain.segments.length, 3);
  assert.equal(chain.segments[1].kind, 'connector');
  assert.ok(Math.abs(chain.sectionSegments[1].start - 2 / 3) < 1e-9);
});

test('readChapterChain never returns an out-of-range activeIndex, even mid-connector', () => {
  // WHY: activeIndex drives which nav dot lights up and which accent CSS var gets set — an out-of-range
  // index would either throw (accessing sections[activeIndex]) or silently light no dot at all.
  const chain = buildChapterChain(THREE_EQUAL, { connectorWeight: 0.5 });
  for (let i = 0; i <= 20; i++) {
    const p = i / 20;
    const r = readChapterChain(chain, p);
    assert.ok(r.activeIndex >= 0 && r.activeIndex < 3, `p=${p} → activeIndex=${r.activeIndex}`);
  }
});

test('a mid-connector activeIndex resolves to whichever section is closer', () => {
  // WHY: "closer neighbour" is the documented resolution rule for a connector gap — if it silently stuck
  // to the section BEFORE the gap the whole way through, the nav dot would light up a whole chapter late.
  const chain = buildChapterChain(THREE_EQUAL.slice(0, 2), { connectorWeight: 1 }); // conn spans [1/3, 2/3]
  assert.equal(readChapterChain(chain, 0.34).activeIndex, 0);   // just past the gap's start → still chapter 0
  assert.equal(readChapterChain(chain, 0.66).activeIndex, 1);   // past the gap's midpoint → already chapter 1
});

test('linger=1 makes eased time move slowest near the mid-point and fastest near the seams', () => {
  // WHY: "settles mid-section" means velocity (d eased / d raw) is LOWEST at local=0.5 — the camera/copy
  // should barely advance for a stretch of scroll right around the middle, then move quickly near each
  // seam. A linger that doesn't measurably shape velocity this way makes the knob a documented no-op.
  const chain = buildChapterChain([{ id: 'a', linger: 1 }]);
  const at = (x) => readChapterChain(chain, x).eased;
  assert.ok(Math.abs(at(0.5) - 0.5) < 1e-9, `linger reshapes the approach only — eased(0.5) must stay 0.5, got ${at(0.5)}`);
  const midDelta = at(0.55) - at(0.45);      // velocity right around the settle point
  const edgeDelta = at(0.10) - at(0.00);     // velocity right at the seam, same raw span (0.10)
  assert.ok(midDelta < edgeDelta / 3, `expected the mid-point to move far slower than the seam: midDelta=${midDelta} edgeDelta=${edgeDelta}`);
});

test('linger=0 (the default) is the identity — a no-op unless a project opts in', () => {
  // WHY: engine-first constraint — "no-op defaults", every section that doesn't ask for linger must get
  // plain linear local progress.
  const chain = buildChapterChain([{ id: 'a' }]);
  for (const p of [0, 0.1, 0.37, 0.5, 0.9, 1]) {
    const r = readChapterChain(chain, p);
    assert.ok(Math.abs(r.local - r.eased) < 1e-9, `linger=0 changed local ${r.local} into eased ${r.eased}`);
  }
});

test('createScrollNarrative outside a DOM (SSR/node) returns an inert no-op API instead of throwing', () => {
  // WHY: side-effect-free-at-import is only half the F05 promise — a project that imports this module in
  // a non-browser build step (SSR prerender, a node test) must not crash just from calling the factory.
  const story = createScrollNarrative({ sections: [{ id: 'a' }] });
  assert.doesNotThrow(() => story.update(0.5, 0.5));
  assert.doesNotThrow(() => story.destroy());
  assert.equal(story.activeIndex, -1);
});
