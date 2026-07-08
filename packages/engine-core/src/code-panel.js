/* ============================================================
   code-panel.js — VIZ SLICE 2: DOM code display with line highlighting
   ------------------------------------------------------------
   A simple <pre><code> code display with per-line highlighting.
   No Shiki dependency (not installed; plain DOM is sufficient for N ≤ 20 lines).

   SEMANTICS (Opus-refute correction 5): line is lit at the START of the tween
   for a step — cause before effect. The consumer calls setLine() when the player
   fires onUpdate with tween.t ≈ 0, before the visual animation completes.

   API:
     createCodePanel(container, lines, opts) → { element, setLine }
       container:  DOM element to append the panel into
       lines:      string[] — one string per code line
       opts.title: optional heading string
   ============================================================ */

export function createCodePanel(container, lines, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'code-panel';
  wrap.style.cssText = `
    font: 12px/1.7 ui-monospace, "JetBrains Mono", monospace;
    background: #0e0b07; border: 1px solid #3a3028;
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
    ln.style.cssText = `
      padding: 0 10px; white-space: pre; color: #b8a898; transition: background 0.1s, color 0.1s;
    `;
    ln.textContent = text;
    wrap.appendChild(ln);
    return ln;
  });

  container.appendChild(wrap);

  let _activeLine = -1;

  // Highlight line `n` (0-indexed). Removes the previous highlight first.
  // Called at tween-START — before the visual animation for this op completes.
  function setLine(n) {
    if (_activeLine === n) return;
    if (_activeLine >= 0 && lineEls[_activeLine]) {
      lineEls[_activeLine].style.background = '';
      lineEls[_activeLine].style.color = '#b8a898';
    }
    _activeLine = n;
    if (n >= 0 && lineEls[n]) {
      lineEls[n].style.background = 'rgba(176,67,42,0.18)';
      lineEls[n].style.color = '#e8d5b8';
    }
  }

  return { element: wrap, setLine };
}
