/* ============================================================
   @lgr/engine-core — createRecorder (Portfolio P1: the capture MULTIPLIER, lifted out of capture.js).
   ------------------------------------------------------------
   THE ABILITY: turn ANY canvas into a one-call still + video recorder — `S` grabs a PNG, `R` toggles an
   MP4/WebM recording, both download to disk. This is the generic half of capture.js (Lesson 15), extracted
   so every portfolio tool ships an MP4 without re-implementing MediaRecorder, format feature-detection, the
   object-URL download dance, and the recording indicator. capture.js is now its FIRST consumer (it wires the
   lab's lesson/clock/style filename into `name`), proving the seam is real by re-using it byte-for-byte.

   Contract: createRecorder({ canvas, name, fps?, bitsPerSecond?, showIndicator? }) -> {
     still(), startRec(), stopRec(), toggleRec(), get recording
   }
     · canvas — the source (any <canvas>; a WebGL canvas needs `preserveDrawingBuffer:true` for a non-black
       still, exactly as capture.js documents — that's the consumer's renderer setting, not ours).
     · name  — the base filename WITHOUT extension; a string, or a function returning one (so a consumer can
       derive it from live state each grab, like capture.js's `lgr-<lesson>-<clock>-<style>`).

   C++ anchor: MediaRecorder ≈ an encoder pipeline you feed frames into (you never touch the codec); the
   object URL ≈ a manual heap handle you must free (revoke) after the download, like delete[].
   ============================================================ */

/* Candidate recording formats, best-first — feature-detected because support varies by browser (Chrome 126+
   emits MP4/H.264, universally playable; everything modern does WebM/VP9). Exported so it's inspectable. */
export const VIDEO_TYPES = Object.freeze([
  'video/mp4;codecs=avc1.42E01E',   // H.264 in MP4 — most portable (newer Chrome)
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm',
]);

/* pickVideoType(isSupported) — the best supported mime, or '' (let the browser default). Pure: takes the
   `MediaRecorder.isTypeSupported`-shaped predicate so it's node-testable without the browser API. */
export function pickVideoType(isSupported) {
  return VIDEO_TYPES.find((t) => isSupported(t)) || '';
}

/* recorderExt(mimeType) — the download extension for a recorded blob's mime (mp4 vs webm). Pure. */
export function recorderExt(mimeType) {
  return mimeType && mimeType.includes('mp4') ? 'mp4' : 'webm';
}

/* The recording indicator — a tiny DOM "● REC" badge, top-right, NOT on the canvas so it never appears in a
   recording (that's the whole lesson). Byte-identical to the badge capture.js shipped before the extraction. */
function makeIndicator() {
  const el = document.createElement('div');
  el.textContent = '● REC';
  el.style.cssText = 'position:fixed;top:14px;right:16px;z-index:2;font:bold 12px ui-monospace,monospace;'
    + 'color:#ff3b30;letter-spacing:.12em;text-shadow:0 1px 3px #000;display:none;';
  document.body.appendChild(el);
  return { show: () => { el.style.display = 'block'; }, hide: () => { el.style.display = 'none'; } };
}

export function createRecorder({ canvas, name, fps = 60, bitsPerSecond = 12_000_000, showIndicator = true } = {}) {
  if (!canvas) throw new Error('createRecorder: a canvas is required');
  const baseName = typeof name === 'function' ? name : () => (name || 'capture');
  const indicator = showIndicator ? makeIndicator() : { show() {}, hide() {} };

  /* Blob → download: object URL, click a hidden <a>, revoke (a manual free, like delete[]). */
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* STILL — canvas → PNG. (A WebGL canvas clears its drawing buffer after compositing, so the consumer's
     renderer needs preserveDrawingBuffer:true for a non-black read — same note capture.js has always had.) */
  function still() {
    canvas.toBlob((blob) => {
      if (!blob) return;
      download(blob, `${baseName()}.png`);
      window.__lastStill = blob.size;             // exposed for the verify harness (preserved from capture.js)
    }, 'image/png');
  }

  /* VIDEO — captureStream → MediaRecorder → download on stop. */
  let recorder = null, chunks = [], recording = false;
  function startRec() {
    if (recording) return;
    const mimeType = pickVideoType((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
    const stream = canvas.captureStream(fps);         // the canvas as a live video track
    recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: bitsPerSecond } : {});
    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType });
      download(blob, `${baseName()}.${recorderExt(recorder.mimeType)}`);
      window.__lastVideo = blob.size;
    };
    recorder.start();
    recording = true; window.__recording = true; indicator.show();
  }
  function stopRec() {
    if (!recording) return;
    recorder.stop();                                  // flushes → onstop → download
    recording = false; window.__recording = false; indicator.hide();
  }
  const toggleRec = () => (recording ? stopRec() : startRec());

  return { still, startRec, stopRec, toggleRec, get recording() { return recording; } };
}
