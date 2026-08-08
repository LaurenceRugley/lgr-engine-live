# scroll-narrative.js — source + licence

**Lifted from:** [github.com/oso95/scroll-world](https://github.com/oso95/scroll-world), specifically
`mountScrollWorld`'s `layout()` (the interleaved dive/connector segment-chain layout), `lingerEase()`
(the mid-chapter-settle remap), and `read()`'s three-branch copy-opacity shape (first section greets on
landing / last holds its CTA / middle sections peak at their own mid-point). Reviewed via a local copy at
`~/lgr-business/research/` (scroll-world-analysis-2026-08-01.md) fetched 2026-08-01.

**Licence: MIT.**

```
MIT License

Copyright (c) 2026 cyw

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**What was ported (as code, algorithm-level):**
- The segment-chain layout concept — sections interleaved with optional connector gaps, each with its own
  relative scroll budget, cumulative-offset into a normalized range. Reference: pixel/vh offsets into a
  literal page height the reference engine builds itself. Ours: fractions of `[0,1]`, the SAME `[0,1]`
  `createScrollDirector` already produces from whatever scroll height the host page has — this engine
  owns no page height, unlike the reference (see `scroll-narrative.js` header for the full reasoning).
- `lingerEase(x, L)` — verbatim formula: `(1-L)*x + L*(4*(x-0.5)^3 + 0.5)`.
- The copy-opacity three-branch shape (`smoothstep(1 - pr/0.62)` for the first section, `smoothstep(pr/0.4)`
  for the last, `smoothstep(1 - |pr-0.5|/0.5)` for the rest) — verbatim constants.

**What was NOT ported** (owner's explicit 2026-08-01 decision — see the brief this module was built
against): any video handling (blob-seek, seek coalescing, GOP tuning, iOS muted-video priming,
poster-until-first-paint), the DOM/CSS scaffolding (rebuilt against this engine's own conventions — see
`command-palette.js` for the precedent this module follows instead), and the reference's own per-frame
`cur += (target-cur)*0.18` re-smoothing loop (frame-rate-dependent; superseded here by the director's
existing dt-correct `damp()` — see `scroll-narrative.js` header).
