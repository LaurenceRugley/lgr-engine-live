/* ============================================================
   ingest-vault.js — memory vault (*.md) → GraphSpec (Mission Control atlas).
   ------------------------------------------------------------
   LIFTED into engine-core (VIZ SLICE 3). The pure parse/build functions have NO fs and NO THREE dep —
   filesystem access stays in projects/atlas/build-data.mjs, the one caller that reads the real vault
   directory. See docs/guides/mission-control-graph-design.md §4.

   THE PAYOFF (why this exists): the atlas's first REAL dataset is not hand-authored — it's the live memory
   vault (atomic notes + frontmatter node_type + kind/ tags + [[wikilinks]]). This ingester is the binding
   that turns Face-2 (the Obsidian vault) and Face-1 (the engine graph) into ONE data source: same files, one
   ingestion, two front-ends. It's only trivial BECAUSE the vault honors the portability guardrail (plain
   markdown, frontmatter + [[links]], nothing Obsidian-proprietary) — zero-migration by design.

   Mapping (design doc §4):
     each *.md (except MEMORY.md) → a NodeRecord { id: slug, label: name, kind: from tags[kind/X],
                                                   type: node_type, href: path }
     MEMORY.md                   → the single kind:'hub' node (the index/center)
     each [[link]] in a body     → an EdgeRecord { from: slug, to: linkedSlug, rel:'links-to' }
   A [[link]] whose target is no note becomes a DANGLING edge — NOT dropped. validateGraphSpec flags it
   (the [[L08]] class), so we either write the missing node or fix the link — the vault-tending loop, now
   programmatic instead of an Obsidian eyeball.

   C++ anchor: a loader that parses a directory of records into an in-memory graph, deferring integrity
   checks to a separate validate pass — parse is permissive, validate is strict.
   ============================================================ */

/* parseFrontmatter(content) → { name, nodeType, kind } — a MINIMAL reader for OUR known frontmatter shape
   (not a general YAML parser — we own the format). Reads `name:`, `metadata.node_type:`, and the first
   `kind/X` inside a `tags: [...]` line. Absent fields come back undefined (the caller defaults them). */
export function parseFrontmatter(content) {
  const fm = {};
  const m = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!m) return fm;
  const block = m[1];
  const name = /^name:\s*(.+)$/m.exec(block);            if (name) fm.name = name[1].trim();
  const nt = /node_type:\s*(.+)$/m.exec(block);          if (nt)   fm.nodeType = nt[1].trim();
  const kindTag = /kind\/([a-z0-9-]+)/i.exec(block);     if (kindTag) fm.kind = kindTag[1];
  return fm;
}

/* extractLinks(content) → string[] — every [[target]] in the note (alias after `|` stripped, deduped,
   order-preserved). CODE-SPAN AWARE: a wikilink shown as a code EXAMPLE — inline `` `[[links]]` `` or inside
   a fenced ``` block — is NOT a real edge, so we strip code first. (Grounded in the real vault: the
   mission-control note documents the format with `` `[[links]]` `` / `` `[[wikilinks]]` `` in prose — those
   must not become dangling edges. A genuine prose link like `[[L08]]` is NOT in code, so it survives and, if
   its target is missing, the validator flags it — which is correct.) */
export function extractLinks(content) {
  const noCode = content
    .replace(/```[\s\S]*?```/g, '')   // fenced code blocks
    .replace(/`[^`\n]*`/g, '');       // inline code spans
  const out = [];
  const seen = new Set();
  const re = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(noCode)) !== null) {
    const target = m[1].split('|')[0].trim();
    if (target && !seen.has(target)) { seen.add(target); out.push(target); }
  }
  return out;
}

/* extractMarkdownLinks(content) → string[] — every `[text](target.md)` in the note, as slugs (the `.md`
   stripped, aliases and anchors dropped, deduped, order-preserved). CODE-SPAN AWARE, exactly as
   extractLinks is, and for the same reason: a link shown as an EXAMPLE is not an edge.

   WHY THIS EXISTS (slice-4 finding, DESIGN ruling): MEMORY.md is the hub — the index of the whole vault —
   and it had degree ZERO. It indexes every note with a MARKDOWN link `[Title](note.md)`, while extractLinks
   only harvests `[[wikilinks]]`. So the index that indexes everything indexed nothing *in the graph*: the
   hub floated at the origin, and because focus-dim keys off adjacency, selecting ANY node hid the hub.
   Only external (http) links and non-.md targets are ignored — we are harvesting note references, not URLs. */
export function extractMarkdownLinks(content) {
  const noCode = content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '');
  const out = [];
  const seen = new Set();
  const re = /\[[^\]]*\]\(([^)\s]+)\)/g;
  let m;
  while ((m = re.exec(noCode)) !== null) {
    const target = m[1].split('#')[0].trim();          // drop any #anchor
    if (!/\.md$/i.test(target)) continue;              // not a note reference (http://, an image, …)
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) continue;  // an absolute URL that happens to end in .md
    const slug = target.replace(/\.md$/i, '');
    if (slug && !seen.has(slug)) { seen.add(slug); out.push(slug); }
  }
  return out;
}

/* noteToRecords(slug, content) → { node, links } — one note → its NodeRecord + the raw link targets (slugs).
   MEMORY (the index) becomes the hub; everything else keeps its kind/node_type. `href` is the relative file.
   The HUB additionally contributes its markdown index links as real edges (see extractMarkdownLinks). We
   scope that to the hub deliberately: a prose note that happens to reference `[a file](x.md)` is citing it,
   not linking it, and the vault's own convention is that `[[wikilinks]]` are the edges. */
export function noteToRecords(slug, content, { href } = {}) {
  const fm = parseFrontmatter(content);
  const isHub = slug === 'MEMORY';
  const node = {
    id: slug,
    label: isHub ? 'MEMORY' : (fm.name || slug),
    kind: isHub ? 'hub' : fm.kind,          // may be undefined for an untagged note — validator/layout tolerate it
    type: fm.nodeType,
    href: href || `${slug}.md`,             // override for non-vault sources (docs/guides/… repo-relative paths)
  };
  // Drop undefined optional fields so the emitted spec is clean (undefined kind/type would serialize as absent anyway).
  if (node.kind == null) delete node.kind;
  if (node.type == null) delete node.type;
  const links = extractLinks(content);
  if (isHub) for (const md of extractMarkdownLinks(content)) if (!links.includes(md)) links.push(md);
  return { node, links };
}

/* extractExcerpt(content, maxLen) → string — the note's first real prose for the inspector panel: strip
   frontmatter + headings + blank lines, take the first paragraph, flatten [[links]]/`code`/**bold** to plain
   text, clip at a word boundary. Pure (panel-display concern, but the parse belongs with the parser). */
export function extractExcerpt(content, maxLen = 220) {
  const body = content.replace(/^---\n[\s\S]*?\n---/, '');
  const para = body.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith('#'));
  if (!para) return '';
  const flat = para
    .replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_, t, __, alias) => alias || t)   // [[t]] / [[t|alias]] → text
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= maxLen) return flat;
  const cut = flat.slice(0, maxLen);
  return cut.slice(0, cut.lastIndexOf(' ')) + '…';
}

/* buildGraphSpec(notes) → GraphSpec — notes: [{ slug, content }]. Emits nodes + [[link]] edges. Every link
   becomes an edge (even dangling ones) — permissive parse; validateGraphSpec is where integrity is enforced. */
export function buildGraphSpec(notes) {
  const nodes = [];
  const edges = [];
  for (const { slug, content, href } of notes) {
    const { node, links } = noteToRecords(slug, content, { href });   // href: non-vault sources (docs/guides/…) override the vault default
    nodes.push(node);
    for (const to of links) edges.push({ from: slug, to, rel: 'links-to' });
  }
  return { v: 1, nodes, edges };
}
