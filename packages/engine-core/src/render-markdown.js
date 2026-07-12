/* ============================================================
   render-markdown.js — VIZ SLICE 9: the READER's first-party mini markdown renderer.
   ------------------------------------------------------------
   Renders a vault note's markdown to HTML for the in-app reader. FIRST-PARTY by doctrine
   (dependency-minimalism): the subset our notes actually use — #/##/### headings, **bold**, *italic*,
   `code`, fenced blocks, -/1. lists, plain [text](http…) links — plus THE feature no library ships:
   [[wikilinks]] render as GRAPH NAVIGATION (a clickable span carrying data-wl="target"; the consumer
   binds one delegated click handler and drives select/fly/reader from it). Tables/blockquotes/images are
   OUT of scope (they render as plain paragraphs) — the vault doesn't use them; grow when it does.

   SECURITY IS THE FIRST TRANSFORM, NOT AN AFTERTHOUGHT: note content is UNTRUSTED data. Every character
   is HTML-escaped BEFORE any markup transform runs, so a note containing <script> renders as the visible
   text "<script>" — the transforms below only ever emit tags from their own fixed templates around
   already-escaped text. (C++ anchor: sanitize at the trust boundary, then operate on the safe copy.)

   resolveWikilink(target) → truthy if the target is a live graph node. A dead [[link]] renders inert
   (class wl-dead, title "needs tending — not a node yet") — the same honesty the validator applies to
   dangling edges, carried into the reading surface.
   ============================================================ */

const escapeHtml = (s) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* Inline transforms — run on ESCAPED text (so their regexes see &lt; not <, and can never be tricked
   into opening a real tag). Order matters: code spans first (their content must not be bolded), then
   bold before italic (** would otherwise match * twice), links last. */
function inline(s, resolveWikilink) {
  // Code spans become placeholders FIRST and are restored LAST — otherwise the bold/italic regexes reach
  // inside the emitted <code> tag and transform its interior (caught by the unit test, not by eye).
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(`<code>${c}</code>`); return `\x01${codes.length - 1}\x01`; });
  // IMAGES (slice 10, the rich-content seed) — before links (an image is a link with a bang). Relative
  // paths render inline (they resolve against the built site; the consumer swaps a 404 to a labeled link
  // via a delegated error handler — no inline onerror, that's an injection surface). Foreign (scheme'd)
  // images stay links: the reader never hot-loads third-party content.
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, path) =>
    /^[a-z][a-z0-9+.-]*:/i.test(path)
      ? `<a href="${path}" target="_blank" rel="noopener">🖼 ${alt || path}</a>`
      : `<img src="${path}" alt="${alt}" loading="lazy">`);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => {
    const t = target.trim();
    const label = (alias || t).trim();
    const live = resolveWikilink ? !!resolveWikilink(t) : false;
    return live
      ? `<span class="wikilink" data-wl="${t}" role="link" tabindex="0">${label}</span>`
      : `<span class="wikilink wl-dead" title="needs tending — not a node yet">${label}</span>`;
  });
  // Plain links: only http(s), only escaped-safe text. target=_blank + noopener (an external site must
  // never get a handle on the atlas window).
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\x01(\d+)\x01/g, (_, i) => codes[Number(i)]);   // restore code spans, untouched
  return s;
}

/* scanFileRefs(md) → [{label, path}] — every [label](path) whose target is a plain FILE (not http(s),
   not a .md note, not an image the body already renders): PDFs, sheets, design files. The reader shows
   these as a REFERENCES list — the seed of the rich-media direction; embedding is a future decision. */
export function scanFileRefs(md) {
  if (typeof md !== 'string') return [];
  const out = [];
  const seen = new Set();
  const re = /(!?)\[([^\]]+)\]\(([^)\s]+)\)/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    const [, bang, label, path] = m;
    if (bang) continue;                                   // images render in the body
    if (/^[a-z][a-z0-9+.-]*:/i.test(path)) continue;      // web links render in the body
    if (/\.md$/i.test(path)) continue;                    // notes are wikilink territory
    if (!/\.[a-z0-9]{2,5}$/i.test(path)) continue;        // no extension → not a file ref
    if (!seen.has(path)) { seen.add(path); out.push({ label, path }); }
  }
  return out;
}

/* renderNoteHtml(md, { resolveWikilink }) → HTML string. Strips frontmatter, protects fenced blocks,
   then walks lines: headings / list runs / paragraphs. */
export function renderNoteHtml(md, { resolveWikilink } = {}) {
  if (typeof md !== 'string' || !md.length) return '';
  let src = md.replace(/^---\n[\s\S]*?\n---\n?/, '');   // frontmatter is metadata, not content

  // 1) Escape EVERYTHING at the trust boundary.
  src = escapeHtml(src);

  // 2) Pull fenced blocks out before line processing (their interiors must stay verbatim — escaped,
  //    but untouched by inline/list/heading rules). \x00n\x00 placeholders cannot collide: \x00 was
  //    never emitted by escapeHtml and cannot survive from input (it is not printable markdown).
  const fences = [];
  src = src.replace(/```[^\n]*\n([\s\S]*?)```/g, (_, body) => {
    fences.push(`<pre><code>${body}</code></pre>`);
    return `\x00${fences.length - 1}\x00`;
  });

  const out = [];
  let list = null;   // 'ul' | 'ol' | null — the open list run
  let para = [];     // consecutive plain lines JOIN into one paragraph (vault notes are hard-wrapped at
                     // ~100 chars; one <p> per source line fragments every sentence — caught by READING
                     // the rendered note, not by any gate)
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const closePara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '), resolveWikilink)}</p>`); para = []; } };

  for (const raw of src.split('\n')) {
    const line = raw.trimEnd();
    const fence = /^\x00(\d+)\x00$/.exec(line.trim());
    if (fence) { closeList(); closePara(); out.push(fences[Number(fence[1])]); continue; }

    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { closeList(); closePara(); out.push(`<h${h[1].length + 1}>${inline(h[2], resolveWikilink)}</h${h[1].length + 1}>`); continue; }
    // h1..h3 in a note render as h2..h4: the reader panel owns the page's h1 (the note title).

    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    const on = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (li || on) {
      closePara();
      const want = li ? 'ul' : 'ol';
      if (list !== want) { closeList(); out.push(`<${want}>`); list = want; }
      out.push(`<li>${inline((li || on)[1], resolveWikilink)}</li>`);
      continue;
    }

    closeList();
    if (line.trim() === '') { closePara(); continue; }
    para.push(line.trim());
  }
  closeList();
  closePara();
  return out.join('\n');
}
