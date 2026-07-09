/* ============================================================
   code-panel.js — VIZ SLICE 2: DOM code display with per-line highlighting
   ------------------------------------------------------------
   Synchronous return (unchanged API) — the panel is immediately usable with
   plain-text content. Shiki syntax highlighting loads in a BACKGROUND IIFE and
   overlays colour once ready (progressive enhancement — no layout shift, no API
   change, no CDN).

   SEMANTICS: line is lit at tween-START — cause before effect (Opus-refute
   correction 5). The consumer calls setLine() when the player fires onUpdate
   with tween.t ≈ 0, before the visual animation completes.

   API:
     createCodePanel(container, lines, opts) → { element, setLine }
       container:  DOM element to append the panel into
       lines:      string[] — one string per code line
       opts.title: optional heading string
       opts.lang:  language for Shiki ('python' | 'javascript' | ...) default 'python'
   ============================================================ */

export function createCodePanel(container, lines, opts = {}) {
  const lang = opts.lang || 'python';

  const wrap = document.createElement('div');
  wrap.className = 'code-panel';
  wrap.style.cssText = `
    font: 12px/1.7 ui-monospace, "JetBrains Mono", monospace;
    background: #121212; border: 1px solid #3a3028;
    border-radius: 4px; padding: 8px 0; overflow: hidden;
  `;

  if (opts.title) {
    const h = document.createElement('div');
    h.textContent = opts.title;
    h.style.cssText = `
      font: 700 9px/1 ui-monospace, monospace; letter-spacing: 0.18em;
      text-transform: uppercase; color: #7a6a58; padding: 0 10px 6px;
    `;
    wrap.appendChild(h);
  }

  const lineEls = lines.map((text, i) => {
    const ln = document.createElement('div');
    ln.className = 'cp-line';
    ln.dataset.n = i;
    ln.style.cssText = `padding: 0 10px; white-space: pre; color: #b8a898; transition: background 0.1s, color 0.1s;`;
    ln.textContent = text;
    wrap.appendChild(ln);
    return ln;
  });

  container.appendChild(wrap);

  let _activeLine = -1;
  let _shikiLoaded = false;

  function setLine(n) {
    if (_activeLine === n) return;
    if (_activeLine >= 0 && lineEls[_activeLine]) {
      lineEls[_activeLine].style.background = '';
      if (!_shikiLoaded) lineEls[_activeLine].style.color = '#b8a898';
    }
    _activeLine = n;
    if (n >= 0 && lineEls[n]) {
      lineEls[n].style.background = 'rgba(176,67,42,0.18)';
      if (!_shikiLoaded) lineEls[n].style.color = '#e8d5b8';
    }
  }

  // Shiki progressive enhancement — background load, no blocking.
  // Vite dynamic-import code-splits shiki out of the main bundle automatically.
  (async () => {
    try {
      const { createHighlighter } = await import('shiki');
      const highlighter = await createHighlighter({ themes: ['vitesse-dark'], langs: [lang] });
      const full = lines.join('\n');
      const html = highlighter.codeToHtml(full, { lang, theme: 'vitesse-dark' });

      // Parse per-line spans from the <pre><code><span class="line">...</span></code></pre> output.
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const lineSpans = tmp.querySelectorAll('.line');

      lineSpans.forEach((span, i) => {
        if (!lineEls[i]) return;
        lineEls[i].innerHTML = span.innerHTML || lineEls[i].textContent;
        // Shiki sets colour via inline styles; clear the plain-text colour so Shiki colours win.
        lineEls[i].style.color = '';
      });

      _shikiLoaded = true;
      // Re-apply the active line highlight (background only — Shiki owns the colour).
      if (_activeLine >= 0 && lineEls[_activeLine]) {
        lineEls[_activeLine].style.background = 'rgba(176,67,42,0.18)';
      }
      highlighter.dispose();
    } catch (_) {
      // Shiki load failure is non-fatal — plain text fallback is already rendered.
    }
  })();

  return { element: wrap, setLine };
}
