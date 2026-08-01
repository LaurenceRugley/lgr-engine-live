/* ============================================================
   noise3d.js — FIRST-PARTY. A tiling 3D Perlin-Worley noise volume for the volumetric clouds.
   ------------------------------------------------------------
   This is the "Nubis" cloud-noise recipe (Andrew Schneider / Guerrilla, Horizon Zero Dawn 2015) that
   MSFS-class volumetric clouds are built on. We precompute ONE small tiling RGBA volume at boot and
   sample it in the raymarch — far cheaper per-step than analytic FBM, AND banding-free (the old value
   noise banded because of its grid-aligned hash; a trilinearly-filtered texture is smooth).

   Channels (Schneider's packing):
     R = Perlin-Worley  → the billowy BASE cloud shape (low freq).
     G = Worley fbm      → medium erosion detail.
     B = Worley fbm      → finer erosion (cauliflower edges).
     A = Worley fbm      → finest wisps.

   Everything TILES (periodic) so the raymarch can repeat the volume across the sky with no seam.

   C++ anchor: this is a compute-once const lookup table (a 3D array) that the GPU kernel indexes with
   hardware trilinear interpolation — exactly like baking an expensive function into a texture so the
   per-fragment cost drops to one fetch.
   ============================================================ */

/* ---- gradient (Perlin) noise, TILING with integer period `per` ---- */
const GRAD = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);      // quintic — C2 continuous, no 2nd-derivative banding
const lerp = (a, b, t) => a + t * (b - a);

function ihash(x, y, z, seed) {                                // integer hash → 0..0x7fffffff
  let h = (x * 1619 + y * 31337 + z * 6971 + seed * 1013) | 0;
  h = (h ^ (h >> 13)) * 60493; h = h ^ (h >> 13);
  return h & 0x7fffffff;
}
function perlin(x, y, z, per, seed) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  const xf = x - X, yf = y - Y, zf = z - Z;
  const u = fade(xf), v = fade(yf), w = fade(zf);
  const wrap = (n) => ((n % per) + per) % per;
  const g = (cx, cy, cz, dx, dy, dz) => {
    const gi = ihash(wrap(cx), wrap(cy), wrap(cz), seed) % 12, gr = GRAD[gi];
    return gr[0] * dx + gr[1] * dy + gr[2] * dz;
  };
  const n000 = g(X, Y, Z, xf, yf, zf),         n100 = g(X + 1, Y, Z, xf - 1, yf, zf);
  const n010 = g(X, Y + 1, Z, xf, yf - 1, zf), n110 = g(X + 1, Y + 1, Z, xf - 1, yf - 1, zf);
  const n001 = g(X, Y, Z + 1, xf, yf, zf - 1), n101 = g(X + 1, Y, Z + 1, xf - 1, yf, zf - 1);
  const n011 = g(X, Y + 1, Z + 1, xf, yf - 1, zf - 1), n111 = g(X + 1, Y + 1, Z + 1, xf - 1, yf - 1, zf - 1);
  const nx00 = lerp(n000, n100, u), nx10 = lerp(n010, n110, u), nx01 = lerp(n001, n101, u), nx11 = lerp(n011, n111, u);
  return lerp(lerp(nx00, nx10, v), lerp(nx01, nx11, v), w);    // ~[-1,1]
}

/* ---- Worley (cellular) noise, TILING: nearest jittered feature point over 3×3×3 wrapped cells ---- */
function worley(x, y, z, per, seed) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  let md = 1e9;
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const cx = X + dx, cy = Y + dy, cz = Z + dz;
        const wx = ((cx % per) + per) % per, wy = ((cy % per) + per) % per, wz = ((cz % per) + per) % per;
        const jx = (ihash(wx, wy, wz, seed) & 0xff) / 255;      // feature point jittered inside its cell
        const jy = (ihash(wx, wy, wz, seed + 1) & 0xff) / 255;
        const jz = (ihash(wx, wy, wz, seed + 2) & 0xff) / 255;
        const px = cx + jx, py = cy + jy, pz = cz + jz;
        const ex = px - x, ey = py - y, ez = pz - z;
        md = Math.min(md, ex * ex + ey * ey + ez * ez);
      }
  return Math.min(1, Math.sqrt(md));                            // 0 (on a point) .. ~1
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const remap = (v, ol, oh, nl, nh) => nl + (v - ol) * (nh - nl) / (oh - ol);

/* fbm helpers (tiling: octave freq f uses period = f) */
function perlinFbm(x, y, z, f, seed) {
  let a = 0.5, s = 0, ff = f;
  for (let o = 0; o < 3; o++) { s += a * perlin(x * ff, y * ff, z * ff, ff, seed + o * 17); ff *= 2; a *= 0.5; }
  return s;                                                     // ~[-0.9,0.9]
}
function worleyFbm(x, y, z, f, seed) {                          // INVERTED → billows (1 = dense). 2 octaves
  let a = 0.65, s = 0, ff = f;                                  // (keeps the finest octave from aliasing at low N)
  for (let o = 0; o < 2; o++) { s += a * (1 - worley(x * ff, y * ff, z * ff, ff, seed + o * 23)); ff *= 2; a *= 0.5; }
  return s;                                                     // ~[0,1]
}

/* Generate the raw RGBA volume (pure — Node-testable, no THREE dependency). */
export function generateVolume({ N = 48, seed = 1337 } = {}) {
  const data = new Uint8Array(N * N * N * 4);
  const baseF = 4;                                              // base cells across the volume (low freq)
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const fx = x / N, fy = y / N, fz = z / N;
        // R — Perlin-Worley: Perlin FBM shaped by low-freq Worley billows (Schneider remap), then
        // STRETCHED to span the full 0..1 so the shader's coverage threshold can carve crisp gaps.
        const pf = clamp01(perlinFbm(fx, fy, fz, baseF, seed) * 0.5 + 0.5);
        const wLow = clamp01(worleyFbm(fx, fy, fz, baseF, seed + 100));
        let pw = clamp01(remap(pf, wLow - 1, 1, 0, 1));         // billowy base (~0.4..0.86)
        pw = clamp01(remap(pw, 0.36, 0.88, 0, 1));              // stretch to full contrast
        // G/B/A — Worley FBM at rising frequencies for erosion detail (kept low enough not to alias at N=48)
        const g = clamp01(worleyFbm(fx, fy, fz, baseF * 1.5, seed + 200));
        const b = clamp01(worleyFbm(fx, fy, fz, baseF * 2.5, seed + 300));
        const a = clamp01(worleyFbm(fx, fy, fz, baseF * 4, seed + 400));
        const i = (z * N * N + y * N + x) * 4;
        data[i] = pw * 255; data[i + 1] = g * 255; data[i + 2] = b * 255; data[i + 3] = a * 255;
      }
    }
  }
  return { data, N };
}

/* Wrap a raw RGBA volume in a THREE.Data3DTexture (RepeatWrapping + trilinear). */
export function volumeToTexture(THREE, data, N) {
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;                          // raw data, not colour
  tex.needsUpdate = true;
  return tex;
}

/* Convenience: generate + wrap in one call (synchronous — blocks; prefer the worker path at boot). */
export function buildCloudNoise(THREE, opts = {}) {
  const { data, N } = generateVolume(opts);
  return volumeToTexture(THREE, data, N);
}
