import * as e from "three";
import { BackSide as t, BoxGeometry as n, InstancedMesh as r, Mesh as i, MeshLambertMaterial as a, MeshStandardMaterial as o, Object3D as s, PointLight as c, Scene as l } from "three";
//#region src/math.js
var u = (e, t, n, r) => e + (t - e) * (1 - Math.exp(-n * r)), d = Math.atan(1 / Math.SQRT2), f = Math.atan(.5), p = Math.PI / 4, m = {
	PERSPECTIVE: 4,
	ISOMETRIC: 5,
	DIMETRIC: 6
}, h = 8, g = .03, _ = 1.45, v = 4, y = 40, b = 1.5, x = 16, S = 1.2, C = .15, w = 4, T = .4, E = 6, D = 22, O = 3.5, k = 11, A = (e, t, n) => u(e, t, h, n), j = (e, t) => e + Math.PI * 2 * Math.round((t - e) / (Math.PI * 2));
function M({ aspect: t, fov: n = 48, near: r = .1, far: i = 100, target: a = new e.Vector3(0, .8, 0), azimuth: o = p, elevation: s = .52, distance: c = 12, zoom: l = 5.5, elMin: M = g, elMax: N = _, distMin: P = v, distMax: F = y, zoomMin: I = b, zoomMax: L = x, styleDistNear: ee = E, styleDistFar: te = D, styleZoomNear: R = O, styleZoomFar: z = k } = {}) {
	let B = new e.PerspectiveCamera(n, t, r, i), V = new e.OrthographicCamera(-1, 1, 1, -1, r, i), H = m.PERSPECTIVE, U = t, W = {
		azimuth: o,
		elevation: s,
		distance: c,
		zoom: l,
		target: a.clone(),
		roll: 0
	}, G = {
		azimuth: o,
		elevation: s,
		distance: c,
		zoom: l,
		target: a.clone(),
		roll: 0
	}, ne = !1, re = null, K = new e.Vector3(), ie = !1, q = null, ae = null, oe = .25, se = W.distance, ce = 0, J = !1, le = new e.Vector3(), ue = new e.Vector3(0, 0, 1), de = () => H === m.PERSPECTIVE ? B : V;
	function fe(e) {
		if (e === H) {
			(H === m.ISOMETRIC || H === m.DIMETRIC) && (W.elevation = H === m.ISOMETRIC ? d : f, ne = !0);
			return;
		}
		H = e, H === m.ISOMETRIC || H === m.DIMETRIC ? (W.elevation = H === m.ISOMETRIC ? d : f, W.azimuth = j(p, G.azimuth), ne = !0) : ne = !1;
	}
	function pe(t, n) {
		W.azimuth += t, ne || (W.elevation = e.MathUtils.clamp(W.elevation + n, M, N));
	}
	function me(t) {
		H === m.PERSPECTIVE ? W.distance = e.MathUtils.clamp(W.distance * t, P, F) : W.zoom = e.MathUtils.clamp(W.zoom * t, I, L);
	}
	function he(t, n, r = 0) {
		let i = W.azimuth, a = H === m.PERSPECTIVE ? W.distance * .04 : W.zoom * .08, o = new e.Vector3(Math.cos(i), 0, -Math.sin(i)), s = new e.Vector3(-Math.sin(i), 0, -Math.cos(i)), c = W.target.x, l = W.target.y, u = W.target.z, d = c + o.x * t * a + s.x * n * a, f = u + o.z * t * a + s.z * n * a;
		if (ie && q && (t !== 0 || n !== 0)) {
			let e = q(c, l, u, d, l, f, oe);
			e < 1 && (d = c + (d - c) * e, f = u + (f - u) * e);
		}
		W.target.set(d, l + r * a, f);
	}
	function ge(e, t) {
		U = e / t, B.aspect = U, B.updateProjectionMatrix();
	}
	function _e(e) {
		if (J) {
			let t = de();
			if (t.position.copy(le), t.lookAt(le.x + ue.x, le.y + ue.y, le.z + ue.z), G.roll = A(G.roll, W.roll, e), G.roll !== 0 && t.rotateZ(G.roll), t.isOrthographicCamera) {
				let e = G.zoom, n = e * U;
				t.left = -n, t.right = n, t.top = e, t.bottom = -e, t.updateProjectionMatrix();
			}
			return;
		}
		re && (re(K), W.target.copy(K)), G.azimuth = A(G.azimuth, W.azimuth, e), G.elevation = A(G.elevation, W.elevation, e), G.distance = A(G.distance, W.distance, e), G.zoom = A(G.zoom, W.zoom, e), G.target.x = A(G.target.x, W.target.x, e), G.target.y = A(G.target.y, W.target.y, e), G.target.z = A(G.target.z, W.target.z, e);
		let t = Math.cos(G.elevation), n = Math.sin(G.elevation), r = Math.cos(G.azimuth), i = Math.sin(G.azimuth), a = de(), o = G.target.x + G.distance * t * i, s = G.target.y + G.distance * n, c = G.target.z + G.distance * t * r;
		if (ie) {
			if (ae) {
				ce = u(ce, ae(o, c), h, e);
				let t = ce + T;
				s < t && (s = t);
			}
			if (q) {
				let t = q(G.target.x, G.target.y, G.target.z, o, s, c, oe), n = Math.hypot(o - G.target.x, s - G.target.y, c - G.target.z), r = t < 1 ? Math.max(S, n * t - C) : n;
				se = r < se ? r : u(se, r, w, e);
				let i = n > 1e-4 ? se / n : 1;
				o = G.target.x + (o - G.target.x) * i, s = G.target.y + (s - G.target.y) * i, c = G.target.z + (c - G.target.z) * i;
			}
		}
		if (a.position.set(o, s, c), a.lookAt(G.target), a.isOrthographicCamera) {
			let e = G.zoom, t = e * U;
			a.left = -t, a.right = t, a.top = e, a.bottom = -e, a.updateProjectionMatrix();
		}
	}
	function ve(e, t, n, r = !1) {
		W.target.set(e, t, n), r && G.target.copy(W.target);
	}
	function ye(t, n = !1) {
		W.zoom = e.MathUtils.clamp(t, I, L), n && (G.zoom = W.zoom);
	}
	function be(t, n = !1) {
		W.distance = e.MathUtils.clamp(t, P, F), n && (G.distance = W.distance);
	}
	function xe(t, n) {
		P = Number.isFinite(t) ? t : v, F = Number.isFinite(n) ? n : y, W.distance = e.MathUtils.clamp(W.distance, P, F);
	}
	function Se(e, t = !1) {
		W.azimuth = j(e, G.azimuth), t && (G.azimuth = W.azimuth);
	}
	function Ce(t, n = !1) {
		W.elevation = e.MathUtils.clamp(t, M, N), n && (G.elevation = W.elevation);
	}
	function we(t, { frame: n, snap: r = !1 } = {}) {
		re = t, r && (re(K), W.target.copy(K), G.target.copy(K)), n != null && (H === m.PERSPECTIVE ? W.distance = e.MathUtils.clamp(n, P, F) : W.zoom = e.MathUtils.clamp(n, I, L));
	}
	function Te() {
		re = null;
	}
	function Ee(e) {
		q = e && e.segmentQuery || null, ae = e && e.getGroundY || null, oe = e && e.radius != null ? e.radius : .25, ie = !!(e && e.enabled), ie && (se = G.distance, ce = G.target.y);
	}
	function De(e, t, n = 0) {
		le.copy(e), ue.copy(t), W.roll = n, J = !0;
	}
	function Oe() {
		if (J = !1, W.roll = 0, G.roll = 0, !re) return;
		re(K);
		let t = de(), n = t.position.x - K.x, r = t.position.y - K.y, i = t.position.z - K.z, a = Math.hypot(n, r, i);
		a < 1e-4 || (G.target.copy(K), W.target.copy(K), G.distance = e.MathUtils.clamp(a, P, F), G.elevation = Math.asin(e.MathUtils.clamp(r / a, -1, 1)), G.azimuth = Math.atan2(n, i), W.azimuth = j(W.azimuth, G.azimuth));
	}
	return {
		get camera() {
			return de();
		},
		get mode() {
			return H;
		},
		get armDist() {
			return se;
		},
		get armed() {
			return ie;
		},
		get azimuth() {
			return G.azimuth;
		},
		get elevation() {
			return G.elevation;
		},
		get distance() {
			return G.distance;
		},
		get zoom() {
			return G.zoom;
		},
		get target() {
			return G.target;
		},
		get following() {
			return !!re;
		},
		setTarget: ve,
		setZoom: ye,
		setDistance: be,
		setDistanceClamp: xe,
		setFollow: we,
		clearFollow: Te,
		setSpringArm: Ee,
		setEye: De,
		clearEye: Oe,
		setAzimuth: Se,
		setElevation: Ce,
		get styleT() {
			return H === m.PERSPECTIVE ? e.MathUtils.clamp((G.distance - ee) / (te - ee), 0, 1) : e.MathUtils.clamp((G.zoom - R) / (z - R), 0, 1);
		},
		setMode: fe,
		orbit: pe,
		zoomBy: me,
		pan: he,
		setViewport: ge,
		update: _e
	};
}
//#endregion
//#region src/sun-rig.js
var N = Math.PI * 2, P = .7, F = 90, I = 1.5, L = 900, ee = (t) => e.MathUtils.smoothstep(t, -.06, .12) * (1 - e.MathUtils.smoothstep(t, .45, .7)), te = [
	{
		name: "night",
		sun: "#4a6f9e",
		intensity: .35,
		hemiSky: "#26344f",
		hemiGround: "#0c1018",
		horizon: "#1e2942",
		sky: "#36486e",
		exposure: .95,
		outline: "#101a30",
		window: 1,
		toonGain: 2.6,
		turbidity: 3,
		rayleigh: 1,
		mie: .004,
		mieG: .75,
		gradeTint: "#cfd8ec",
		gradeSat: .84,
		gradeLift: "#05070e",
		gradeContrast: 1
	},
	{
		name: "dawn",
		sun: "#ff9e54",
		intensity: 2.4,
		hemiSky: "#8a7686",
		hemiGround: "#2a1f1a",
		horizon: "#b8512c",
		sky: "#ffb070",
		exposure: 1.05,
		outline: "#241826",
		window: .3,
		toonGain: 2,
		turbidity: 6,
		rayleigh: 3,
		mie: .025,
		mieG: .86,
		gradeTint: "#ffe6cf",
		gradeSat: 1.05,
		gradeLift: "#0a0603",
		gradeContrast: 1.04
	},
	{
		name: "noon",
		sun: "#fff4e0",
		intensity: 4.6,
		hemiSky: "#9cb8cc",
		hemiGround: "#33302a",
		horizon: "#5e7689",
		sky: "#aacadd",
		exposure: 1.18,
		outline: "#0b0a08",
		window: 0,
		toonGain: 1.7,
		turbidity: 1.3,
		rayleigh: 3.6,
		mie: .005,
		mieG: .78,
		gradeTint: "#d6e6f4",
		gradeSat: 1.34,
		gradeLift: "#000000",
		gradeContrast: 1.26
	},
	{
		name: "dusk",
		sun: "#ff6b35",
		intensity: 2,
		hemiSky: "#7a566a",
		hemiGround: "#281a18",
		horizon: "#b0432a",
		sky: "#ff8a5a",
		exposure: 1.05,
		outline: "#1f1420",
		window: .72,
		toonGain: 2,
		turbidity: 7,
		rayleigh: 3.2,
		mie: .028,
		mieG: .87,
		gradeTint: "#ffdcc0",
		gradeSat: 1.06,
		gradeLift: "#0c0604",
		gradeContrast: 1.05
	}
], R = (e) => e - Math.floor(e), z = (e, t, n) => e + (t - e) * n, B = (e, t, n) => e + (t - e) * (1 - Math.exp(-6 * n)), V = [
	"sun",
	"hemiSky",
	"hemiGround",
	"horizon",
	"sky",
	"outline",
	"gradeTint",
	"gradeLift"
], H = [
	"intensity",
	"exposure",
	"window",
	"toonGain",
	"turbidity",
	"rayleigh",
	"mie",
	"mieG",
	"gradeSat",
	"gradeContrast"
];
function U(e) {
	if (!Array.isArray(e) || e.length !== 4) throw Error(`createSunRig: keyframes must be an array of EXACTLY 4 (night/dawn/noon/dusk), got ${Array.isArray(e) ? e.length : typeof e}`);
	return e.forEach((e, t) => {
		if (!e || typeof e != "object") throw Error(`createSunRig: keyframe[${t}] is not an object`);
		for (let n of V) if (e[n] == null) throw Error(`createSunRig: keyframe[${t}] ("${e.name ?? "?"}") missing colour field "${n}"`);
		for (let n of H) if (typeof e[n] != "number" || !Number.isFinite(e[n])) throw Error(`createSunRig: keyframe[${t}] ("${e.name ?? "?"}") field "${n}" must be a finite number, got ${e[n]}`);
	}), e;
}
function W({ t = .5, keyframes: n = te } = {}) {
	let r = t, i = t, a = !1, o = !1, s = F;
	U(n);
	let c = n.map((t) => ({
		name: t.name,
		sun: new e.Color(t.sun),
		hemiSky: new e.Color(t.hemiSky),
		hemiGround: new e.Color(t.hemiGround),
		horizon: new e.Color(t.horizon),
		sky: new e.Color(t.sky),
		outline: new e.Color(t.outline),
		intensity: t.intensity,
		exposure: t.exposure,
		window: t.window,
		toonGain: t.toonGain,
		turbidity: t.turbidity,
		rayleigh: t.rayleigh,
		mie: t.mie,
		mieG: t.mieG,
		gradeTint: new e.Color(t.gradeTint),
		gradeLift: new e.Color(t.gradeLift),
		gradeSat: t.gradeSat,
		gradeContrast: t.gradeContrast
	})), l = new e.Vector3(0, 1, 0), u = new e.Color("#fff4e0"), d = new e.Color("#6f97b3"), f = new e.Color("#2a2620"), p = new e.Color("#3a4a57"), m = new e.Color("#7da3bd"), h = new e.Color("#0b0a08"), g = new e.Color("#000000"), _ = 3, v = 1, y = 0, b = 1.7, x = {
		turbidity: 2.2,
		rayleigh: 1.3,
		mie: .005,
		mieG: .78
	}, S = {
		tint: new e.Color("#fafdff"),
		lift: new e.Color("#000000"),
		sat: 1.08,
		contrast: 1
	}, C = new e.Vector3();
	function w(e) {
		let t = R(e) * 4, n = Math.floor(t) % 4, r = (n + 1) % 4, i = t - Math.floor(t), a = c[n], o = c[r];
		u.lerpColors(a.sun, o.sun, i), d.lerpColors(a.hemiSky, o.hemiSky, i), f.lerpColors(a.hemiGround, o.hemiGround, i), p.lerpColors(a.horizon, o.horizon, i), m.lerpColors(a.sky, o.sky, i), h.lerpColors(a.outline, o.outline, i), _ = z(a.intensity, o.intensity, i), v = z(a.exposure, o.exposure, i), y = z(a.window, o.window, i), b = z(a.toonGain, o.toonGain, i), x.turbidity = z(a.turbidity, o.turbidity, i), x.rayleigh = z(a.rayleigh, o.rayleigh, i), x.mie = z(a.mie, o.mie, i), x.mieG = z(a.mieG, o.mieG, i), S.tint.lerpColors(a.gradeTint, o.gradeTint, i), S.lift.lerpColors(a.gradeLift, o.gradeLift, i), S.sat = z(a.gradeSat, o.gradeSat, i), S.contrast = z(a.gradeContrast, o.gradeContrast, i), g.setRGB(.045 * y, .075 * y, .14 * y);
		let s = R(e) * N - Math.PI / 2, w = Math.cos(s), T = Math.sin(s);
		C.set(w, T * Math.cos(P), T * Math.sin(P)), C.y >= 0 ? l.copy(C) : l.copy(C).negate();
	}
	return w(r), {
		sunDir: l,
		sunColor: u,
		hemiSky: d,
		hemiGround: f,
		horizon: p,
		sky: m,
		outline: h,
		toonFloor: g,
		skyParams: x,
		grade: S,
		sunArc: C,
		get sunIntensity() {
			return _;
		},
		get exposure() {
			return v;
		},
		get windowGlow() {
			return y;
		},
		get toonGain() {
			return b;
		},
		get t() {
			return R(r);
		},
		get auto() {
			return a;
		},
		get clock() {
			let e = Math.round(R(r) * 24 * 60) % 1440;
			return `${String(Math.floor(e / 60)).padStart(2, "0")}:${String(e % 60).padStart(2, "0")}`;
		},
		cyclePreset() {
			i = (Math.floor(r * 4 + 1e-4) + 1) / 4;
		},
		nudge(e) {
			Number.isFinite(e) && (i += e / 24);
		},
		goTo(e, t = !1) {
			Number.isFinite(e) && (i = e, t && (r = e));
		},
		toggleAuto() {
			a = !a;
		},
		setAuto(e) {
			a = !!e;
		},
		setPace(t) {
			Number.isFinite(t) && (s = e.MathUtils.clamp(t, I, L));
		},
		get pace() {
			return s;
		},
		setReducedMotion(e) {
			o = e;
		},
		update(e) {
			a && !o && (i += e / s), r = B(r, i, e), w(r);
		}
	};
}
//#endregion
//#region src/profiler.js
var G = 120;
function ne(e, t) {
	return e.length ? e[Math.min(e.length - 1, Math.max(0, Math.round(t / 100 * (e.length - 1))))] : 0;
}
function re({ renderer: e }) {
	let t = e.getContext(), n = !1, r = new Float32Array(G), i = new Float32Array(G), a = 0, o = 0, s = 0, c = 0, l = t.getExtension && t.getExtension("EXT_disjoint_timer_query_webgl2"), u = [], d = null, f = null, p = l && l.TIME_ELAPSED_EXT, m = l && l.GPU_DISJOINT_EXT, h = null, g = 0, _ = !1, v = {
		fps: 0,
		cpuMs: {
			p50: 0,
			p95: 0,
			p99: 0
		},
		gpuMs: null,
		info: null,
		leak: !1,
		gpuTimer: !!l
	}, y = 0, b = typeof performance < "u" ? performance.now() : 0;
	function x() {
		n ||= (e.info.autoReset = !1, !0), s = performance.now();
		let r = e.info;
		v.info = {
			calls: r.render.calls,
			tris: r.render.triangles,
			programs: r.programs ? r.programs.length : 0,
			geo: r.memory.geometries,
			tex: r.memory.textures
		}, r.reset(), l && !d && (d = t.createQuery(), t.beginQuery(p, d));
	}
	function S() {
		if (r[o] = performance.now() - s + c, o = (o + 1) % G, a < G && a++, l && d && (t.endQuery(p), u.push(d), d = null), l && u.length) {
			let e = u[0], n = t.getQueryParameter(e, t.QUERY_RESULT_AVAILABLE), r = t.getParameter(m);
			(n || r) && (u.shift(), n && !r && (f = t.getQueryParameter(e, t.QUERY_RESULT) / 1e6), t.deleteQuery(e));
		}
		if (v.info) {
			let e = v.info.geo + v.info.tex;
			h == null ? h = e : e > h + 200 ? (g++, g > 300 && (_ = !0)) : g = Math.max(0, g - 2);
		}
		y++;
		let e = performance.now();
		if (e - b >= 1e3) {
			let t = Array.from(r.subarray(0, a)).sort((e, t) => e - t);
			v.fps = y, v.cpuMs = {
				p50: +ne(t, 50).toFixed(2),
				p95: +ne(t, 95).toFixed(2),
				p99: +ne(t, 99).toFixed(2)
			}, v.gpuMs = f == null ? null : +f.toFixed(2), v.leak = _, y = 0, b = e, typeof window < "u" && (window.__fps = v.fps, window.__perf = w());
		}
	}
	function C() {
		if (!a) return 0;
		let e = i.subarray(0, a);
		return e.set(r.subarray(0, a)), e.sort(), ne(e, 95);
	}
	function w() {
		return {
			fps: v.fps,
			cpuMs: v.cpuMs,
			gpuMs: v.gpuMs,
			info: v.info,
			leak: v.leak,
			gpuTimer: !!l
		};
	}
	return {
		frameStart: x,
		frameEnd: S,
		sample: w,
		p95Now: C,
		get gpuTimerAvailable() {
			return !!l;
		},
		forceLoad(e = 0) {
			c = Math.max(0, e);
		}
	};
}
//#endregion
//#region src/quality-governor.js
var K = [
	{
		dpr: null,
		shadows: !0,
		refl: !0
	},
	{
		dpr: 1.5,
		shadows: !0,
		refl: !1
	},
	{
		dpr: 1,
		shadows: !0,
		refl: !1
	},
	{
		dpr: 1,
		shadows: !1,
		refl: !1
	},
	{
		dpr: .75,
		shadows: !1,
		refl: !1
	}
];
function ie({ profiler: e, apply: t, targetFps: n = 30, strongFps: r = 58, ladder: i } = {}) {
	let a = Array.isArray(i) && i.length ? i : K, o = 1e3 / n, s = 1e3 / r, c = 0, l = 0, u = 0, d = "full", f = 0;
	function p() {
		let n = e.p95Now();
		return n <= 0 ? c : f > 0 ? (f--, l = 0, u = 0, c) : (n > o ? (l++, u = 0, l >= 45 && c < a.length - 1 && (c++, l = 0, f = 120, d = `p95 ${n.toFixed(1)}ms > ${o.toFixed(0)}ms`, t(c, a[c]), m(n))) : n < s ? (u++, l = 0, u >= 180 && c > 0 && (c--, u = 0, f = 120, d = `p95 ${n.toFixed(1)}ms < ${s.toFixed(0)}ms (headroom)`, t(c, a[c]), m(n))) : (l = Math.max(0, l - 1), u = Math.max(0, u - 1)), c);
	}
	function m(e) {
		typeof window < "u" && (window.__quality = {
			level: c,
			of: a.length - 1,
			reason: d,
			p95: +(e || 0).toFixed(1)
		});
	}
	return m(0), {
		update: p,
		get level() {
			return c;
		},
		get reason() {
			return d;
		},
		reset() {
			c = 0, l = u = 0, f = 0, d = "full", t(0, a[0]), m(0);
		}
	};
}
var q = {
	"1-bit": {
		gridWidth: 110,
		dither: .6,
		palette: ["#15120c", "#c8b486"]
	},
	gb: {
		gridWidth: 130,
		dither: .4,
		palette: [
			"#0f380f",
			"#306230",
			"#8bac0f",
			"#9bbc0f"
		]
	},
	"8-bit": {
		gridWidth: 160,
		dither: .55,
		palette: [
			"#140c1c",
			"#442434",
			"#30346d",
			"#4e4a4e",
			"#854c30",
			"#346524",
			"#d04648",
			"#757161",
			"#597dce",
			"#d27d2c",
			"#8595a1",
			"#6daa2c",
			"#d2aa99",
			"#6dc2ca",
			"#dad45e",
			"#deeed6"
		]
	},
	"16-bit": {
		gridWidth: 280,
		dither: .3,
		palette: /* @__PURE__ */ "#000000.#222034.#45283c.#663931.#8f563b.#df7126.#d9a066.#eec39a.#fbf236.#99e550.#6abe30.#37946e.#4b692f.#524b24.#323c39.#3f3f74.#306082.#5b6ee1.#639bff.#5fcde4.#cbdbfc.#ffffff.#9badb7.#847e87.#696a6a.#595652.#76428a.#ac3232.#d95763.#d77bba.#8f974a.#8a6f30".split(".")
	},
	modern: {
		gridWidth: 460,
		dither: .6,
		palette: null
	}
}, ae = [
	"gb",
	"8-bit",
	"16-bit",
	"modern"
], oe = {
	"ink-gold (day)": [
		"#16100A",
		"#3A2F1E",
		"#6B563A",
		"#937B54",
		"#B89968"
	],
	"ink-gold (night)": [
		"#0A0C16",
		"#1C2236",
		"#3A3A52",
		"#5A5A78",
		"#8A92B0"
	],
	"terminal (day)": [
		"#050805",
		"#0E2912",
		"#1E6B2F",
		"#3CF06A",
		"#FFB000"
	],
	"terminal (night)": [
		"#020604",
		"#06180E",
		"#10401E",
		"#1E9040",
		"#7FE0FF"
	],
	"neutral (photoreal)": [
		"#1B1B1E",
		"#3D3A3A",
		"#5E5750",
		"#867C70",
		"#A99C8A",
		"#C8BCAB",
		"#E3DCCF",
		"#F5F1E8"
	],
	"cool (noir)": [
		"#0A0E14",
		"#16202E",
		"#243447",
		"#3A536B",
		"#5A7D96",
		"#86A6BD",
		"#B6CDDA",
		"#E6EEF2"
	],
	"warm (sunset)": [
		"#190B0A",
		"#3B150F",
		"#6E2A17",
		"#A8421F",
		"#DB702F",
		"#F2A23E",
		"#F9CF76",
		"#FDF0C4"
	],
	"vibrant (pop)": [
		"#1A1A2E",
		"#E43F5A",
		"#F9A826",
		"#FFE05D",
		"#2EC4B6",
		"#3A86FF",
		"#8338EC",
		"#FFFFFF"
	],
	"mono (ink)": [
		"#0C0C0C",
		"#2A2A2A",
		"#474747",
		"#666666",
		"#8A8A8A",
		"#B0B0B0",
		"#D6D6D6",
		"#F5F5F5"
	]
};
function se(t) {
	let n = Math.max(t.length, 1), r = new Float32Array(n * 4);
	t.forEach((t, n) => {
		let i = new e.Color(t);
		r[n * 4 + 0] = i.r, r[n * 4 + 1] = i.g, r[n * 4 + 2] = i.b, r[n * 4 + 3] = 1;
	});
	let i = new e.DataTexture(r, n, 1, e.RGBAFormat, e.FloatType);
	return i.minFilter = e.NearestFilter, i.magFilter = e.NearestFilter, i.needsUpdate = !0, i;
}
//#endregion
//#region src/vector-style.js
var ce = { value: 0 };
new e.Color("#ffffff"), new e.Vector2();
//#endregion
//#region src/shaders/fullscreen.vert
var J = "varying vec2 vUv;\n\nvoid main() {\n  vUv = uv;\n  gl_Position = vec4(position.xy, 0.0, 1.0); \n}", le = "const float CA_STRENGTH   = 0.0030;  \nconst float VIGNETTE_EDGE = 1.20;    \nconst float VIGNETTE_SOFT = 0.45;    \nconst float VIGNETTE_MIN  = 0.55;    \nconst float GRAIN         = 0.045;   \nconst vec3  TINT_WARM     = vec3(1.03, 1.00, 0.94); \n\nvarying vec2 vUv;\nuniform sampler2D uScene;      \nuniform float     uTime;       \nuniform vec2      uResolution; \nuniform float     uGrain;      \n                               \n                               \nuniform float     uChroma;     \n                               \nuniform float     uExposure;   \n                               \nuniform float     uAces;       \n                               \nuniform sampler2D uBloom;        \nuniform float     uBloomStrength;\nuniform float     uGrade;        \nuniform vec3      uGradeTint;    \nuniform vec3      uGradeLift;    \nuniform float     uGradeSat;     \nuniform float     uGradeContrast;\nuniform float     uWarmBal;       \nuniform float     uDither;        \n                                  \nuniform float     uTonemap;       \nuniform sampler2D uRaysTex;       \nuniform float     uRays;          \nuniform float     uBeautyExp;     \nuniform vec2      uSunScreenPos;   \nuniform float     uSunRadius;      \nuniform float     uSunException;   \n                                   \n                                   \n                                   \n                                   \n\n/* Cheap screen-space hash (the classic sin-dot trick): one pseudo-random number\n   per pixel per frame. Not statistically perfect — perfectly fine for grain. */\nfloat hash(vec2 p) {\n  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);\n}\n\n/* L66 ACES FILMIC TONEMAP (Narkowicz 2015 fit) — maps unbounded HDR → a filmic [0,1] display curve.\n   Bright highlights (suns/speculars) roll off toward white CINEMATICALLY instead of clipping flat, and\n   the toe lifts shadows. The instant \"looks pro, not a demo\" lever. C++: a fixed rational-polynomial\n   kernel applied per pixel on the framebuffer. */\nvec3 aces(vec3 x) {\n  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;\n  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);\n}\n\n/* L83 AgX TONEMAP (Troy Sobotka's AgX, minimal sRGB-space impl by Benjamin Wrensch — iolite-engine.com, MIT).\n   vs ACES: AgX desaturates highlights more gracefully (no ACES \"notorious six\" hue shift / skin-orange clip) and\n   keeps a cleaner neutral. A 6th-order polynomial sigmoid in a log2 working space, between two 3×3 inset/outset\n   matrices. Drop-in for aces(): linear HDR in, display [0,1] out. C++: a fixed transfer curve (matrix·log2·poly·matrix). */\nconst mat3 AGX_IN = mat3(\n  0.842479062253094,  0.0423282422610123, 0.0423756549057051,\n  0.0784335999999992, 0.878468636469772,  0.0784336,\n  0.0792237451477643, 0.0791661274605434, 0.879142973793104);\nconst mat3 AGX_OUT = mat3(\n   1.19687900512017,   -0.0528968517574562, -0.0529716355144438,\n  -0.0980208811401368,  1.15190312990417,   -0.0980434501171241,\n  -0.0990297440797205, -0.0989611768448433,  1.15107367264116);\nvec3 agxContrast(vec3 x) {                          \n  vec3 x2 = x * x, x4 = x2 * x2;\n  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;\n}\nvec3 agx(vec3 col) {\n  const float minEv = -12.47393, maxEv = 4.026069;\n  col = AGX_IN * max(col, vec3(0.0));\n  col = clamp(log2(max(col, vec3(1e-10))), minEv, maxEv);\n  col = (col - minEv) / (maxEv - minEv);            \n  col = agxContrast(col);\n  col = AGX_OUT * col;\n  return clamp(col, 0.0, 1.0);\n}\n\nvoid main() {\n  /* Distance from the image centre, ASPECT-CORRECTED: without the correction a\n     vignette on a wide screen is an ellipse squashed the wrong way. We scale x\n     by aspect so \"radius\" means the same thing horizontally and vertically. */\n  vec2  toCentre = vUv - 0.5;\n  float aspect   = uResolution.x / uResolution.y;\n  float r        = length(toCentre * vec2(aspect, 1.0));\n\n  /* 1) CHROMATIC ABERRATION — sample R pushed outward, B pulled inward, G true.\n     The offset grows with r² so the centre stays clean and edges fringe. */\n  vec2 dir = (r > 0.0001) ? normalize(toCentre) : vec2(0.0);\n  vec2 off = dir * (r * r) * CA_STRENGTH * uChroma;  \n                                                     \n                                                     \n  vec3 col;\n  col.r = texture2D(uScene, vUv + off).r;\n  col.g = texture2D(uScene, vUv).g;\n  col.b = texture2D(uScene, vUv - off).b;\n\n  /* 2) VIGNETTE — smoothstep from \"no effect\" inside VIGNETTE_SOFT to full\n     darkening at VIGNETTE_EDGE; never below VIGNETTE_MIN so blacks stay readable.\n     The centre gets a slight warm tint instead — ink edges, golden heart. */\n  float vig = 1.0 - smoothstep(VIGNETTE_SOFT, VIGNETTE_EDGE, r) * (1.0 - VIGNETTE_MIN);\n  col *= mix(vec3(1.0), TINT_WARM, 1.0 - smoothstep(0.0, VIGNETTE_SOFT, r));\n  col *= vig;\n\n  /* 3) FILM GRAIN — re-seed the hash every frame via uTime so the noise dances.\n     fract(uTime) cycles 0..1; multiplying into the pixel coord shifts the\n     pattern. Centered around 0 (±0.5) so grain doesn't brighten the image. */\n  float g = hash(gl_FragCoord.xy + fract(uTime * 13.37) * uResolution) - 0.5;\n  col += g * GRAIN * uGrain;\n\n  \n  \n  col += texture2D(uBloom, vUv).rgb * uBloomStrength;\n\n  \n  \n  \n  col += texture2D(uRaysTex, vUv).rgb * uRays;\n\n  col *= uExposure;                              \n  \n  \n  \n  \n  \n  \n  \n  \n  vec2  sunD      = (vUv - uSunScreenPos) * vec2(aspect, 1.0);\n  float sunDisc   = smoothstep(uSunRadius, uSunRadius * 0.35, length(sunD));   \n  float sunBright = smoothstep(0.9, 1.6, dot(col, vec3(0.2126, 0.7152, 0.0722)));   \n  float sunMask   = sunDisc * sunBright * uSunException;\n\n  if (uAces > 0.5) col = (uTonemap > 0.5) ? agx(col) : aces(col);\n  vec3 sunHot = col;   \n\n  /* L67 COLOUR GRADE (display-referred, AFTER ACES, beauty-tier only) — pulls every surface into ONE\n     art-directed mood: a saturation tweak, a hue-tinted gain, and a small shadow lift. Keyframed by the\n     SunRig (warm dawn/dusk, clean noon, cool-moody night). uGrade = 0 on the pixel/toon pre-pass → no-op. */\n  if (uGrade > 0.5) {\n    col *= uBeautyExp;   \n    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));     \n    col = mix(vec3(l), col, uGradeSat);                   \n    col = col * uGradeTint + uGradeLift * (1.0 - col);    \n    col = (col - 0.5) * uGradeContrast + 0.5;             \n    col = clamp(col, 0.0, 1.0);\n    /* L105 NOON WARM-BALANCE — kill the residual blue sky-IBL cast at high sun (uWarmBal = midK·strength from the\n       engine; 0 at golden hour → no-op there). Push R up / B down, then rescale to PRESERVE LUMA (a white-balance,\n       NOT exposure). Inside the uGrade gate → pixel/toon/vector (uGrade=0) stay BYTE-IDENTICAL.\n       LUMA GATE (2026-08-05, metropolis noon fix — headed-browser pixel sweep): the cast this lever kills lives on\n       SHADOW faces and concrete (luma ≲ 0.5, lit by the blue sky-IBL); the noon SKY BAND itself measures ~0.62-0.65\n       and was being warm-balanced into the exact \"flat pale gray-green\" the noon-washout docs keep fighting\n       (measured: intended #aacadd rendered as rgb(161,166,142) — blue INVERTED to green). No single uWarmBal value\n       serves both (sweep: sky needs ≤0.25, shadow faces need ≥0.6), so gate by luma: full balance below 0.50,\n       none above 0.66 — the sky, the horizon haze and the clouds keep their color, the cast-afflicted faces keep\n       their cure. Sun-lit bright faces lose the balance too, but they are lit by the WARM sun and never had the\n       blue cast. Dusk/night unchanged by construction (uWarmBal is already 0 outside high sun). */\n    if (uWarmBal > 0.0) {\n      float lg = dot(col, vec3(0.2126, 0.7152, 0.0722));\n      float wbK = uWarmBal * (1.0 - smoothstep(0.50, 0.66, lg));\n      vec3 warm = vec3(1.0 + 0.20 * wbK, 1.0, 1.0 - 0.26 * wbK);\n      float l0 = lg;\n      vec3 cw = col * warm;\n      float l1 = dot(cw, vec3(0.2126, 0.7152, 0.0722));\n      col = clamp(cw * (l1 > 1e-4 ? l0 / l1 : 1.0), 0.0, 1.0);\n    }\n\n    /* L92 CINEMATIC GRADE DISCIPLINE — layered ON the SunRig time-of-day mood above to read \"shot, not\n       rendered\". STATIC (not keyframed): the discipline is constant; the SunRig handles the daily mood.\n       Beauty-tier only (this whole block is uGrade-gated) → pixel/vector/toon stay byte-identical.\n       C++: rgb' = grade(rgb) — three per-pixel functions composed. */\n    \n    \n    \n    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));\n    col += vec3(-0.018, 0.005, 0.028) * (1.0 - smoothstep(0.0, 0.28, lum));   \n    col += vec3( 0.040, 0.015, -0.030) * smoothstep(0.62, 1.0, lum);          \n    col = clamp(col, 0.0, 1.0);\n    \n    \n    col = mix(vec3(0.02), vec3(0.98), col);\n    col += (smoothstep(0.0, 1.0, col) - col) * 0.42;\n    \n    \n    float mx = max(col.r, max(col.g, col.b)), mn = min(col.r, min(col.g, col.b)), sat = mx - mn;\n    float lv = dot(col, vec3(0.2126, 0.7152, 0.0722));\n    col = mix(vec3(lv), col, 1.0 + 0.22 * (1.0 - sat));\n    col = clamp(col, 0.0, 1.0);\n\n    /* L93 BEAUTY HERO POP — the L92 caveat: at midday the bright Preetham sun over-lights the pale building\n       albedo, blowing it toward white and drowning the L92 varied albedo / AO / window grid. A soft-knee\n       HIGHLIGHT SHOULDER pulls the blown top back into a readable bright range so the buildings POP (detail\n       reads), + a tiny black-point lift for depth/separation. Beauty-tier ONLY (this whole block is uGrade-\n       gated → pixel/vector/toon untouched). We do NOT touch uExposure (it feeds the pixel pre-pass). */\n    float Lp = dot(col, vec3(0.2126, 0.7152, 0.0722));\n    col *= 1.0 - smoothstep(0.50, 1.0, Lp) * 0.36;        \n                                                          \n                                                          \n    col = (col - 0.44) * 1.14 + 0.44;                     \n                                                          \n    col = mix(vec3(0.030), vec3(1.0), col);              \n    col = clamp(col, 0.0, 1.0);\n\n    /* L93 HERO VIGNETTE — a soft EXTRA corner darken on the BEAUTY hero, AFTER the grade (display-referred)\n       so it frames the eye on the city without muddying the tonemap. Subtle (~10% at the extreme corners) on\n       top of the universal base vignette above. Beauty-tier ONLY (this block is uGrade-gated) → pixel/vector/\n       toon keep their byte-identical base vignette. (r = the aspect-corrected radius computed up top.) */\n    col *= 1.0 - smoothstep(0.62, 1.20, r) * 0.11;\n\n    \n    \n    \n    col = mix(col, sunHot, sunMask);\n  }\n\n  /* L80 OUTPUT DITHER (beauty only) — smooth gradients (the Preetham sky, fog, soft lighting) quantize into\n     visible STAIR-STEP BANDS at 8-bit output, glaring on a phone. Add a tiny TRIANGULAR (TPDF) noise of ~±1 LSB\n     so the quantization error averages out across neighbouring pixels → the eye integrates it to a smooth ramp\n     (the same noise-shaping trick as audio dithering). Two hashes → a triangular distribution (softer than flat).\n     uDither is 0 on the pixel/toon pre-pass (+ vector) → exactly a no-op → those tiers stay byte-identical. */\n  if (uDither > 0.0) {\n    float d = (hash(gl_FragCoord.xy * 0.7919) + hash(gl_FragCoord.xy * 1.137 + 19.19) - 1.0) / 255.0;\n    col += d * uDither;\n  }\n\n  gl_FragColor = vec4(col, 1.0);\n}", ue = "const float DITHER = 0.55;   \n\nvarying vec2 vUv;\nuniform sampler2D uScene;        \nuniform vec2      uResolution;   \nuniform float     uPixelSize;    \nuniform vec3      uPalette[8];   \nuniform vec3      uPaletteB[8];  \nuniform float     uPaletteBlend; \nuniform int       uPaletteSize;  \n\n/* Bayer threshold for a virtual-pixel coordinate. mat4 columns are written\n   column-major, so matrix[column][row] — laid out here so it reads like the\n   table above. Returns 0..15. */\nfloat bayer4(vec2 cell) {\n  int x = int(mod(cell.x, 4.0));\n  int y = int(mod(cell.y, 4.0));\n  mat4 m = mat4(\n     0.0, 12.0,  3.0, 15.0,   \n     8.0,  4.0, 11.0,  7.0,   \n     2.0, 14.0,  1.0, 13.0,   \n    10.0,  6.0,  9.0,  5.0    \n  );\n  return m[x][y];\n}\n\nvoid main() {\n  /* 1) SNAP — virtual grid: uPixelSize cells across, height follows the real\n     aspect ratio so the cells are square on screen. floor() + 0.5 samples the\n     CENTRE of each cell (sampling an edge invites bleeding between texels). */\n  float aspect = uResolution.x / uResolution.y;\n  vec2  grid   = vec2(uPixelSize, uPixelSize / aspect);\n  vec2  cell   = floor(vUv * grid);             \n  vec2  snapUv = (cell + 0.5) / grid;           \n  vec3  col    = texture2D(uScene, snapUv).rgb;\n\n  /* 2) DITHER — Bayer threshold for THIS CELL (not this real pixel: dithering\n     must operate at virtual-pixel scale or the pattern vanishes inside blocks).\n     Bias is ± half a \"palette step\" (≈ 1/paletteSize of full range) × DITHER. */\n  float threshold = (bayer4(cell) + 0.5) / 16.0 - 0.5;        \n  float step      = 1.0 / max(float(uPaletteSize - 1), 1.0);  \n  col += threshold * step * DITHER;\n\n  /* 3) QUANTIZE — nearest palette colour by squared RGB distance. The loop has a\n     constant bound (GLSL requirement) and breaks at the live palette size.\n     LESSON 09: we don't grade a fixed palette to \"tint\" it for time of day — that\n     fights the quantizer (a graded source maps to the wrong fixed buckets). Instead\n     we INTERPOLATE between two AUTHORED palettes (current → next time-of-day) and\n     quantize against the blended entries. Each pixel still snaps to a clean palette\n     colour; the palette itself drifts dawn→day→dusk→night (the Pokémon Gold/Silver\n     trick, made continuous). */\n  vec3  best  = mix(uPalette[0], uPaletteB[0], uPaletteBlend);\n  float bestD = 1e9;\n  for (int i = 0; i < 8; i++) {\n    if (i >= uPaletteSize) break;\n    vec3  pal = mix(uPalette[i], uPaletteB[i], uPaletteBlend);\n    vec3  d   = col - pal;\n    float dd  = dot(d, d);                       \n    if (dd < bestD) { bestD = dd; best = pal; }\n  }\n\n  gl_FragColor = vec4(best, 1.0);\n}", de = "precision highp float;\n\nconst float OUTLINE_LO = 0.030;  \nconst float OUTLINE_HI = 0.075;  \n\nvarying vec2 vUv;\nuniform sampler2D uScene;        \nuniform sampler2D uDepth;        \nuniform vec2      uResolution;   \nuniform float     uBands;        \nuniform float     uToonGain;     \nuniform float     uToonGamma;    \nuniform vec3      uToonFloor;    \n                                 \nuniform vec3      uOutline;      \nuniform float     uNear;         \nuniform float     uFar;          \nuniform float     uIsPerspective;\n\n/* Raw depth sample → real view-space distance (positive, in world units). */\nfloat linearDepth(vec2 uv) {\n  float d = texture2D(uDepth, uv).x;          \n  if (uIsPerspective > 0.5) {\n    float z = d * 2.0 - 1.0;                   \n    return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));\n  }\n  return uNear + d * (uFar - uNear);          \n}\n\nvoid main() {\n  vec2 texel = 1.0 / uResolution;\n\n  /* --- 1) CEL POSTERIZE — snap luminance to flat bands, keep the hue. --------\n     Rec.601 luma, then a TONE LIFT (gain + gamma) BEFORE banding. The lab scene\n     is deliberately deep-ink/moody; without the lift almost every pixel sits in\n     the lowest band and the toon look collapses to black blobs. The lift maps the\n     scene's dark range up into the band range (gamma < 1 raises the shadows most),\n     so towers AND water resolve into a few flat tones — and the dark outline then\n     has a lit surface to sit on. Banding the LIFTED luminance, we re-apply the\n     original hue (chroma = colour / luma) at the quantized brightness: shade snaps,\n     hue survives. */\n  vec3  c      = texture2D(uScene, vUv).rgb;\n  c            = max(c, uToonFloor);     \n  float lum    = dot(c, vec3(0.299, 0.587, 0.114));\n  float lifted = pow(clamp(lum * uToonGain, 0.0, 1.0), uToonGamma);\n  float levels = max(uBands, 2.0);\n  float qlum   = clamp(floor(lifted * levels) / (levels - 1.0), 0.0, 1.0);\n  vec3  cel    = (c / max(lum, 1e-4)) * qlum;\n\n  /* --- 2) DEPTH OUTLINE — Roberts cross over a 2×2 block of linear depths. ----\n     Normalise the jump by the centre distance (a RELATIVE threshold) so a far\n     silhouette reads the same as a near one, and a gently receding surface (the\n     water toward the horizon) doesn't trip a false line. */\n  float dA = linearDepth(vUv);\n  float dB = linearDepth(vUv + vec2(texel.x, 0.0));\n  float dC = linearDepth(vUv + vec2(0.0, texel.y));\n  float dD = linearDepth(vUv + texel);\n  float grad = abs(dA - dD) + abs(dB - dC);            \n  float rel  = grad / max(dA, 1e-3);\n  float edge = smoothstep(OUTLINE_LO, OUTLINE_HI, rel);\n\n  gl_FragColor = vec4(mix(cel, uOutline, edge), 1.0);\n}", fe = "precision highp float;\n\nvarying vec2 vUv;\nuniform sampler2D uToon;   \nuniform sampler2D uPixel;  \nuniform float     uBlend;  \n\nvoid main() {\n  vec3 t = texture2D(uToon, vUv).rgb;\n  vec3 p = texture2D(uPixel, vUv).rgb;\n  gl_FragColor = vec4(mix(t, p, uBlend), 1.0);\n}", pe = "varying vec2 vUv;\nuniform sampler2D uScene;\nuniform float     uThreshold;   \n\nvoid main() {\n  vec3 c = texture2D(uScene, vUv).rgb;\n  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));        \n  float k = smoothstep(uThreshold, uThreshold + 0.22, l); \n  gl_FragColor = vec4(c * k, 1.0);\n}", me = "varying vec2 vUv;\nuniform sampler2D uScene;\nuniform vec2      uDir;     \n\nvoid main() {\n  \n  float w0 = 0.227027, w1 = 0.1945946, w2 = 0.1216216, w3 = 0.054054, w4 = 0.016216;\n  vec3 sum = texture2D(uScene, vUv).rgb * w0;\n  sum += texture2D(uScene, vUv + uDir * 1.0).rgb * w1;\n  sum += texture2D(uScene, vUv - uDir * 1.0).rgb * w1;\n  sum += texture2D(uScene, vUv + uDir * 2.0).rgb * w2;\n  sum += texture2D(uScene, vUv - uDir * 2.0).rgb * w2;\n  sum += texture2D(uScene, vUv + uDir * 3.0).rgb * w3;\n  sum += texture2D(uScene, vUv - uDir * 3.0).rgb * w3;\n  sum += texture2D(uScene, vUv + uDir * 4.0).rgb * w4;\n  sum += texture2D(uScene, vUv - uDir * 4.0).rgb * w4;\n  gl_FragColor = vec4(sum, 1.0);\n}", he = "precision highp float;\n\nuniform sampler2D uBright;   \nuniform vec2  uSunUv;        \nuniform float uDensity;      \nuniform float uDecay;        \nuniform float uWeight;       \n\nvarying vec2 vUv;\n\nconst int STEPS = 48;        \n\nvoid main() {\n  vec2 duv = (vUv - uSunUv) * (uDensity / float(STEPS));   \n  vec2 uv = vUv;\n  float sum = 0.0, illum = 1.0;\n  for (int i = 0; i < STEPS; i++) {\n    uv -= duv;                                             \n    sum += texture2D(uBright, uv).r * illum * uWeight;     \n    illum *= uDecay;\n  }\n  gl_FragColor = vec4(vec3(sum), 1.0);                     \n}", ge = "precision highp float;\n\nconst int   MAX_PALETTE = 64;   \nconst float BAYER_DIV   = 16.0; \n\nvarying vec2 vUv;\nuniform sampler2D uScene;        \nuniform vec2      uResolution;   \nuniform float     uGridWidth;    \nuniform float     uDither;       \nuniform sampler2D uPalette;      \nuniform int       uPaletteSize;  \nuniform float     uUsePalette;   \n\n/* 4×4 Bayer threshold (0..15) for a virtual-pixel cell — laid out column-major. */\nfloat bayer4(vec2 cell) {\n  int x = int(mod(cell.x, 4.0));\n  int y = int(mod(cell.y, 4.0));\n  mat4 m = mat4(\n     0.0, 12.0,  3.0, 15.0,\n     8.0,  4.0, 11.0,  7.0,\n     2.0, 14.0,  1.0, 13.0,\n    10.0,  6.0,  9.0,  5.0\n  );\n  return m[x][y];\n}\n\n/* Read palette entry i from the LUT texture (centre-sample the i-th texel). */\nvec3 paletteEntry(int i) {\n  float u = (float(i) + 0.5) / float(uPaletteSize);\n  return texture2D(uPalette, vec2(u, 0.5)).rgb;\n}\n\nvoid main() {\n  /* 1) SNAP — sample the CENTRE of the virtual cell so each cell is one flat colour.\n     Cell height follows the real aspect so cells stay square on screen. */\n  float aspect = uResolution.x / uResolution.y;\n  vec2  grid   = vec2(uGridWidth, uGridWidth / aspect);\n  vec2  cell   = floor(vUv * grid);\n  vec2  snapUv = (cell + 0.5) / grid;\n  vec3  col    = texture2D(uScene, snapUv).rgb;\n\n  if (uUsePalette < 0.5) {\n    /* MODERN era — no palette cap: just the chunky grid, plus a whisper of ordered\n       dither so flat regions don't look dead. Full 24-bit colour survives. */\n    col += (bayer4(cell) / BAYER_DIV - 0.5) * uDither * 0.04;\n    gl_FragColor = vec4(col, 1.0);\n    return;\n  }\n\n  /* 2) DITHER — bias by ± half a palette step (ordered, per virtual cell) BEFORE the\n     snap-to-palette, so gradients resolve into a stable crosshatch instead of bands. */\n  float threshold = (bayer4(cell) + 0.5) / BAYER_DIV - 0.5;   \n  float palStep   = 1.0 / max(float(uPaletteSize - 1), 1.0);\n  col += threshold * palStep * uDither;\n\n  /* 3) QUANTIZE — nearest palette colour by squared RGB distance (sqrt unneeded). */\n  vec3  best  = paletteEntry(0);\n  float bestD = 1e9;\n  for (int i = 0; i < MAX_PALETTE; i++) {\n    if (i >= uPaletteSize) break;\n    vec3  p  = paletteEntry(i);\n    vec3  d  = col - p;\n    float dd = dot(d, d);\n    if (dd < bestD) { bestD = dd; best = p; }\n  }\n\n  gl_FragColor = vec4(best, 1.0);\n}", _e = "varying vec2 vUv;\nuniform sampler2D uScene;        \n\nuniform vec3  uLift;             \nuniform vec3  uGamma;            \nuniform vec3  uGain;             \nuniform float uContrast;         \nuniform float uSat;              \nuniform vec3  uShadowTint;       \nuniform vec3  uHighlightTint;    \nuniform float uSplitStrength;    \nuniform float uStrength;         \n\nconst vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);   \n\nvoid main() {\n  vec3 base = texture2D(uScene, vUv).rgb;   \n  vec3 c = base;\n\n  \n  c = c * uGain + uLift;\n  c = pow(max(c, 0.0), 1.0 / uGamma);\n\n  \n  c = (c - 0.5) * uContrast + 0.5;\n\n  \n  float luma = dot(max(c, 0.0), LUMA);\n  c = mix(vec3(luma), c, uSat);\n\n  \n  \n  float t = smoothstep(0.0, 1.0, clamp(luma, 0.0, 1.0));   \n  vec3 splitTint = mix(uShadowTint, uHighlightTint, t);\n  c *= mix(vec3(1.0), splitTint, uSplitStrength);\n\n  vec3 graded = clamp(c, 0.0, 1.0);\n\n  \n  gl_FragColor = vec4(mix(base, graded, uStrength), 1.0);\n}", ve = (t) => 1 - e.MathUtils.smoothstep(t, -.02, .45), ye = 220, be = {
	night: [
		"#0A0C16",
		"#1C2236",
		"#3A3A52",
		"#5A5A78",
		"#8A92B0"
	],
	dawn: [
		"#1A1008",
		"#43281A",
		"#7A4A30",
		"#B07A4E",
		"#E8A86A"
	],
	noon: [
		"#16100A",
		"#3A2F1E",
		"#6B563A",
		"#937B54",
		"#B89968"
	],
	dusk: [
		"#140A0A",
		"#3E1E1A",
		"#7A3828",
		"#B85A36",
		"#F0884A"
	]
}, xe = {
	night: [
		"#020604",
		"#06180E",
		"#10401E",
		"#1E9040",
		"#7FE0FF"
	],
	dawn: [
		"#060603",
		"#1A2410",
		"#3A6B22",
		"#6CC040",
		"#FFC060"
	],
	noon: [
		"#050805",
		"#0E2912",
		"#1E6B2F",
		"#3CF06A",
		"#FFB000"
	],
	dusk: [
		"#080402",
		"#241408",
		"#6B4A12",
		"#E0A030",
		"#FF7030"
	]
};
function Se(e) {
	if (typeof document > "u" || document.getElementById("lgr-nowebgl")) return;
	let t = document.createElement("div");
	t.id = "lgr-nowebgl", t.style.cssText = "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:#0e1116;color:#cdd6e4;font:16px/1.6 system-ui,-apple-system,sans-serif;text-align:center;padding:2rem;", t.innerHTML = "<div style=\"max-width:30rem\"><div style=\"font-size:2.4rem;margin-bottom:1rem\">🌊</div><h1 style=\"font-size:1.3rem;margin:0 0 .6rem;color:#fff;font-weight:600\">This experience needs a modern browser</h1><p style=\"margin:0;color:#9aa6b8\">" + e + "</p></div>", document.body && document.body.appendChild(t);
}
function Ce(t = {}) {
	let n = t.container instanceof Element ? t.container : document.body, r = () => n.clientWidth || window.innerWidth, i = () => n.clientHeight || window.innerHeight, a;
	try {
		a = new e.WebGLRenderer({
			antialias: !0,
			preserveDrawingBuffer: !0
		});
	} catch (e) {
		throw Se("This experience needs WebGL2 — please open it in an up-to-date browser (Chrome, Edge, Firefox, or Safari on iOS 15+) with hardware acceleration enabled."), e;
	}
	a.shadowMap.enabled = !0;
	let o = {
		basic: e.BasicShadowMap,
		pcf: e.PCFShadowMap,
		soft: e.PCFSoftShadowMap
	};
	a.shadowMap.type = o[t.shadowType] || e.PCFShadowMap, a.shadowMap.autoUpdate = !1, a.shadowMap.needsUpdate = !0;
	let s = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
	typeof window < "u" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
	let c = s ? 1.5 : 2;
	a.setPixelRatio(Math.min(window.devicePixelRatio, c)), a.setSize(r(), i()), a.setClearColor(920327, 1), n.appendChild(a.domElement);
	let l = a.getDrawingBufferSize(new e.Vector2()), u = !1, d = !1, f = () => {};
	a.domElement.addEventListener("webglcontextlost", (e) => {
		e.preventDefault(), u = !0, typeof window < "u" && (window.__contextLost = !0);
	}, !1), a.domElement.addEventListener("webglcontextrestored", () => {
		f(), u = !1, typeof window < "u" && (window.__contextLost = !1);
	}, !1);
	let p = new e.Scene();
	p.fog = new e.FogExp2(10465470, 0);
	let m = new e.Color("#aeb6c0"), h = new e.Color("#74508f"), g = new e.Color(), _ = M({
		...t.cameraRig || {},
		aspect: r() / i()
	}), v = W({
		t: .5,
		keyframes: t.sunKeyframes
	}), y = !!t.lean, b = new e.DataTexture(new Uint8Array([
		0,
		0,
		0,
		255
	]), 1, 1, e.RGBAFormat);
	b.needsUpdate = !0;
	let x = (e) => e ? e.texture : b, S = y ? null : new e.DepthTexture(l.x, l.y), C = y ? null : new e.WebGLRenderTarget(l.x, l.y, {
		minFilter: e.LinearFilter,
		magFilter: e.LinearFilter,
		depthBuffer: !0,
		stencilBuffer: !1,
		depthTexture: S
	}), w = y ? null : new e.WebGLRenderTarget(l.x, l.y, {
		minFilter: e.LinearFilter,
		magFilter: e.LinearFilter,
		depthBuffer: !1,
		stencilBuffer: !1
	}), T = new e.WebGLRenderTarget(l.x, l.y, {
		minFilter: e.LinearFilter,
		magFilter: e.LinearFilter,
		depthBuffer: !0,
		stencilBuffer: !1,
		samples: 4,
		type: e.HalfFloatType
	}), E = y ? null : new e.WebGLRenderTarget(l.x, l.y, {
		minFilter: e.LinearFilter,
		magFilter: e.LinearFilter,
		depthBuffer: !1,
		stencilBuffer: !1
	}), D = y ? null : new e.WebGLRenderTarget(l.x, l.y, {
		minFilter: e.LinearFilter,
		magFilter: e.LinearFilter,
		depthBuffer: !1,
		stencilBuffer: !1
	}), O = Math.max(1, Math.floor(l.x / 2)), k = Math.max(1, Math.floor(l.y / 2)), A = new e.WebGLRenderTarget(O, k, {
		minFilter: e.LinearFilter,
		magFilter: e.LinearFilter,
		depthBuffer: !1,
		stencilBuffer: !1
	}), j = new e.WebGLRenderTarget(O, k, {
		minFilter: e.LinearFilter,
		magFilter: e.LinearFilter,
		depthBuffer: !1,
		stencilBuffer: !1
	}), N = y ? null : new e.WebGLRenderTarget(O, k, {
		minFilter: e.LinearFilter,
		magFilter: e.LinearFilter,
		depthBuffer: !1,
		stencilBuffer: !1
	}), P = y ? null : new e.WebGLRenderTarget(O, k, {
		minFilter: e.LinearFilter,
		magFilter: e.LinearFilter,
		depthBuffer: !1,
		stencilBuffer: !1
	}), F = new e.WebGLRenderTarget(l.x, l.y, {
		minFilter: e.LinearFilter,
		magFilter: e.LinearFilter,
		depthBuffer: !1,
		stencilBuffer: !1
	}), I = new e.Scene(), L = new e.OrthographicCamera(-1, 1, 1, -1, 0, 1), te = new e.Mesh(new e.PlaneGeometry(2, 2));
	I.add(te);
	let R = new e.ShaderMaterial({
		vertexShader: J,
		fragmentShader: le,
		uniforms: {
			uScene: { value: x(C) },
			uTime: { value: 0 },
			uResolution: { value: new e.Vector2(l.x, l.y) },
			uGrain: { value: 1 },
			uChroma: { value: 1 },
			uExposure: { value: 1 },
			uAces: { value: 0 },
			uBloom: { value: A.texture },
			uBloomStrength: { value: 0 },
			uGrade: { value: 0 },
			uGradeTint: { value: v.grade.tint },
			uGradeLift: { value: v.grade.lift },
			uGradeSat: { value: 1 },
			uGradeContrast: { value: 1 },
			uWarmBal: { value: 0 },
			uDither: { value: 0 },
			uTonemap: { value: 0 },
			uRaysTex: { value: x(P) },
			uRays: { value: 0 },
			uBeautyExp: { value: 1 },
			uSunException: { value: 0 },
			uSunScreenPos: { value: new e.Vector2(-1, -1) },
			uSunRadius: { value: 0 }
		}
	}), z = new e.ShaderMaterial({
		vertexShader: J,
		fragmentShader: _e,
		uniforms: {
			uScene: { value: x(F) },
			uLift: { value: new e.Vector3(0, 0, 0) },
			uGamma: { value: new e.Vector3(1, 1, 1) },
			uGain: { value: new e.Vector3(1, 1, 1) },
			uContrast: { value: 1 },
			uSat: { value: 1 },
			uShadowTint: { value: new e.Vector3(1, 1, 1) },
			uHighlightTint: { value: new e.Vector3(1, 1, 1) },
			uSplitStrength: { value: 0 },
			uStrength: { value: 0 }
		}
	}), B = new e.ShaderMaterial({
		vertexShader: J,
		fragmentShader: pe,
		uniforms: {
			uScene: { value: x(C) },
			uThreshold: { value: .78 }
		}
	}), V = new e.ShaderMaterial({
		vertexShader: J,
		fragmentShader: me,
		uniforms: {
			uScene: { value: A.texture },
			uDir: { value: new e.Vector2() }
		}
	});
	function H(t) {
		let n = 1 - e.MathUtils.clamp(v.sunArc.y * 2.2, 0, 1), r = ee(v.sunArc.y);
		B.uniforms.uThreshold.value = Math.max(.6 + .08 * r, .92 + .3 * n - .62 * ve(v.sunArc.y)), B.uniforms.uScene.value = t.texture, Y(B, A), V.uniforms.uScene.value = A.texture, V.uniforms.uDir.value.set(1.6 / O, 0), Y(V, j), V.uniforms.uScene.value = j.texture, V.uniforms.uDir.value.set(0, 1.6 / k), Y(V, A), R.uniforms.uBloom.value = A.texture, R.uniforms.uBloomStrength.value = .85 * (.32 + .27 * r);
	}
	let U = new e.ShaderMaterial({
		vertexShader: J,
		fragmentShader: he,
		uniforms: {
			uBright: { value: x(N) },
			uSunUv: { value: new e.Vector2(.5, .5) },
			uDensity: { value: .9 },
			uDecay: { value: .96 },
			uWeight: { value: .05 }
		}
	}), G = new e.Vector4();
	function ne(t) {
		if (!P || !N) {
			R.uniforms.uRays.value = 0;
			return;
		}
		G.set(_.camera.position.x + v.sunDir.x * 88, _.camera.position.y + v.sunDir.y * 88, _.camera.position.z + v.sunDir.z * 88, 1).applyMatrix4(_.camera.matrixWorldInverse).applyMatrix4(_.camera.projectionMatrix);
		let n = G.w, r = G.x / n, i = G.y / n, a = n > 0 ? 1 - e.MathUtils.smoothstep(Math.max(Math.abs(r), Math.abs(i)), .9, 1.35) : 0, o = 1 - e.MathUtils.clamp(v.sunArc.y * 2.2, 0, 1), s = e.MathUtils.smoothstep(v.sunArc.y, -.05, .06), c = .22 * o * a * s;
		if (c <= .001) {
			R.uniforms.uRays.value = 0;
			return;
		}
		U.uniforms.uSunUv.value.set(r * .5 + .5, i * .5 + .5), B.uniforms.uThreshold.value = 1.9, B.uniforms.uScene.value = t.texture, Y(B, N), U.uniforms.uBright.value = N.texture, Y(U, P), R.uniforms.uRaysTex.value = P.texture, R.uniforms.uRays.value = c;
	}
	let K = (t) => {
		let n = t.map((t) => new e.Color(t));
		for (; n.length < 8;) n.push(new e.Color(0, 0, 0));
		return n;
	}, oe = [
		"night",
		"dawn",
		"noon",
		"dusk"
	], Ce = {
		inkgold: oe.map((e) => K(be[e])),
		terminal: oe.map((e) => K(xe[e]))
	}, we = new e.ShaderMaterial({
		vertexShader: J,
		fragmentShader: ue,
		uniforms: {
			uScene: { value: x(w) },
			uResolution: { value: new e.Vector2(l.x, l.y) },
			uPixelSize: { value: ye },
			uPalette: { value: Ce.inkgold[2] },
			uPaletteB: { value: Ce.inkgold[2] },
			uPaletteBlend: { value: 0 },
			uPaletteSize: { value: 5 }
		}
	}), Te = new e.ShaderMaterial({
		vertexShader: J,
		fragmentShader: ge,
		uniforms: {
			uScene: { value: x(w) },
			uResolution: { value: new e.Vector2(l.x, l.y) },
			uGridWidth: { value: 160 },
			uDither: { value: .55 },
			uPalette: { value: se(q["8-bit"].palette) },
			uPaletteSize: { value: 1 },
			uUsePalette: { value: 1 }
		}
	}), Ee = {};
	for (let e of ae) Ee[e] = q[e].palette ? se(q[e].palette) : null;
	let De = new e.ShaderMaterial({
		vertexShader: J,
		fragmentShader: de,
		uniforms: {
			uScene: { value: x(w) },
			uDepth: { value: S },
			uResolution: { value: new e.Vector2(l.x, l.y) },
			uBands: { value: 4 },
			uToonGain: { value: 1.7 },
			uToonGamma: { value: .6 },
			uToonFloor: { value: v.toonFloor },
			uOutline: { value: v.outline },
			uNear: { value: .1 },
			uFar: { value: 100 },
			uIsPerspective: { value: 1 }
		}
	}), Oe = new e.ShaderMaterial({
		vertexShader: J,
		fragmentShader: fe,
		uniforms: {
			uToon: { value: x(E) },
			uPixel: { value: x(D) },
			uBlend: { value: 0 }
		}
	});
	function Y(e, t) {
		te.material = e, a.setRenderTarget(t), a.render(I, L);
	}
	let ke = {
		neutral: null,
		"lgr-premium": {
			lift: [
				0,
				.006,
				.012
			],
			gamma: [
				1,
				1,
				1
			],
			gain: [
				1.03,
				1.005,
				.975
			],
			contrast: 1.07,
			sat: 1.06,
			shadowTint: [
				.86,
				.94,
				1.06
			],
			highlightTint: [
				1.06,
				1,
				.9
			],
			splitStrength: .18,
			strength: .55
		}
	}, Ae = null, je = !1;
	function Me(e) {
		let t = null, n = "neutral";
		if (e && typeof e == "object") t = e, n = "custom";
		else if (e == null || e === "neutral" || e === "off") t = null, n = "neutral";
		else if (Object.prototype.hasOwnProperty.call(ke, e)) t = ke[e], n = e;
		else throw Error(`setLook: unknown look "${e}" (known: ${Object.keys(ke).join(", ")})`);
		let r = z.uniforms;
		if (!t) r.uLift.value.set(0, 0, 0), r.uGamma.value.set(1, 1, 1), r.uGain.value.set(1, 1, 1), r.uContrast.value = 1, r.uSat.value = 1, r.uShadowTint.value.set(1, 1, 1), r.uHighlightTint.value.set(1, 1, 1), r.uSplitStrength.value = 0, r.uStrength.value = 0, je = !1;
		else {
			let e = t;
			r.uLift.value.fromArray(e.lift ?? [
				0,
				0,
				0
			]), r.uGamma.value.fromArray(e.gamma ?? [
				1,
				1,
				1
			]), r.uGain.value.fromArray(e.gain ?? [
				1,
				1,
				1
			]), r.uContrast.value = e.contrast ?? 1, r.uSat.value = e.sat ?? 1, r.uShadowTint.value.fromArray(e.shadowTint ?? [
				1,
				1,
				1
			]), r.uHighlightTint.value.fromArray(e.highlightTint ?? [
				1,
				1,
				1
			]), r.uSplitStrength.value = e.splitStrength ?? 0, r.uStrength.value = e.strength ?? 1, je = !0;
		}
		return Ae = n, typeof window < "u" && (window.__look = n), n;
	}
	function Ne(e, t) {
		z.uniforms.uScene.value = e, Y(z, t);
	}
	let Pe = [];
	function Fe(e) {
		Pe.push(e);
	}
	function Ie() {
		_.setViewport(r(), i()), a.setSize(r(), i());
		let t = a.getDrawingBufferSize(new e.Vector2());
		C?.setSize(t.x, t.y), w?.setSize(t.x, t.y), T.setSize(t.x, t.y), E?.setSize(t.x, t.y), D?.setSize(t.x, t.y), O = Math.max(1, t.x >> 1), k = Math.max(1, t.y >> 1), A.setSize(O, k), j.setSize(O, k), N?.setSize(O, k), P?.setSize(O, k), F.setSize(t.x, t.y), R.uniforms.uResolution.value.set(t.x, t.y), we.uniforms.uResolution.value.set(t.x, t.y), Te.uniforms.uResolution.value.set(t.x, t.y), De.uniforms.uResolution.value.set(t.x, t.y), l.copy(t);
		for (let e of Pe) e(t);
		return t;
	}
	let Le = re({ renderer: a }), Re = !0, ze = !0, Be = [];
	function Ve(e, t) {
		let n = t.dpr == null ? c : t.dpr, r = Math.min(window.devicePixelRatio, n);
		Math.abs(a.getPixelRatio() - r) > .001 && (a.setPixelRatio(r), typeof window < "u" && window.dispatchEvent ? window.dispatchEvent(new Event("resize")) : Ie()), Re = t.shadows !== !1, Re || (a.shadowMap.needsUpdate = !1), ze = t.refl !== !1;
		for (let n = 0; n < Be.length; n++) try {
			Be[n](e, t);
		} catch {}
	}
	let He = ie({
		profiler: Le,
		apply: Ve,
		ladder: t.qualityLadder
	});
	function Ue() {
		!d && !u && Le.frameStart();
	}
	function We() {
		d || u || (Le.frameEnd(), He.update(), typeof window < "u" && window.__frames++);
	}
	function Ge(e) {
		d = !e, typeof window < "u" && (window.__paused = d);
	}
	let X = 3, Z = !1, Q = !1, Ke = "native", qe = .3, Je = .46, $ = ["native", ...ae], Ye = {
		"16-bit": "16-bit",
		"8-bit": "8-bit",
		gb: "Game Boy",
		modern: "Modern",
		native: "Pixel",
		"1-bit": "1-bit"
	};
	typeof window < "u" && (window.__mode = X, window.__vector = Z, window.__era = Ke), typeof window < "u" && (window.__frames = 0), typeof window < "u" && (window.__loaded = !1);
	function Xe(e) {
		let t = Q ? Ce.terminal : Ce.inkgold, n = e % 1 * 4, r = Math.floor(n) % 4;
		we.uniforms.uPalette.value = t[r], we.uniforms.uPaletteB.value = t[(r + 1) % 4], we.uniforms.uPaletteBlend.value = n - Math.floor(n);
	}
	function Ze(e) {
		let t = q[e];
		t && (Te.uniforms.uGridWidth.value = t.gridWidth, Te.uniforms.uDither.value = t.dither, Te.uniforms.uUsePalette.value = +!!t.palette, t.palette && (Te.uniforms.uPalette.value = Ee[e], Te.uniforms.uPaletteSize.value = t.palette.length));
	}
	function Qe() {
		Ke !== "native" && Ze(Ke);
	}
	function $e() {
		return et();
	}
	function et() {
		if (X === 1 || X === 2) return { kind: "none" };
		if (X === 7) return { kind: "pixel" };
		if (X === 8) return { kind: "toon" };
		let t = _.styleT;
		return window.__styleT = t, t <= qe ? { kind: "toon" } : t >= Je ? {
			kind: "pixel",
			era: t < .62 ? "16-bit" : t < .8 ? "8-bit" : "gb"
		} : {
			kind: "blend",
			blend: e.MathUtils.smoothstep(t, qe, Je),
			era: "16-bit"
		};
	}
	function tt(e) {
		return X === 1 || X === 2 ? "" : Z && X !== 7 && X !== 8 ? "Vector" : e.kind === "toon" ? "Toon" : e.kind === "pixel" ? Ye[e.era || Ke] || "Pixel" : e.kind === "blend" ? "Toon → " + (Ye[e.era] || "Pixel") : "";
	}
	function nt(e) {
		X = e, window.__mode = X;
	}
	function rt() {
		return Z = !Z, ce.value = +!!Z, window.__vector = Z, Z;
	}
	function it(e) {
		return Z = !!e, ce.value = +!!Z, window.__vector = Z, Z;
	}
	function at() {
		return Ke = $[($.indexOf(Ke) + 1) % $.length], window.__era = Ke, Qe(), Ke;
	}
	function ot() {
		return Q = !Q, Q;
	}
	function st(e) {
		f = e;
	}
	return {
		onContextRestored: st,
		registerContentResizer: Fe,
		renderer: a,
		drawBuffer: l,
		scene: p,
		rig: _,
		sunRig: v,
		sceneDepth: S,
		sceneRT: C,
		filmicRT: w,
		beautyRT: T,
		toonRT: E,
		pixelRT: D,
		bloomA: A,
		bloomB: j,
		raysBright: N,
		raysRT: P,
		gradeRT: F,
		postScene: I,
		postCamera: L,
		postQuad: te,
		filmicMaterial: R,
		brightMaterial: B,
		blurMaterial: V,
		godraysMaterial: U,
		pixelMaterial: we,
		pixelkitMaterial: Te,
		toonMaterial: De,
		mixMaterial: Oe,
		gradeMaterial: z,
		PALCACHE: Ce,
		ERA_TEX: Ee,
		runPass: Y,
		bloomPass: H,
		godraysPass: ne,
		gradePass: Ne,
		setLook: Me,
		LOOKS: ke,
		get gradeActive() {
			return je;
		},
		get look() {
			return Ae;
		},
		resize: Ie,
		profiler: Le,
		governor: He,
		frameStart: Ue,
		frameEnd: We,
		setActive: Ge,
		addQualityListener: (e) => {
			typeof e == "function" && Be.push(e);
		},
		get paused() {
			return d;
		},
		get contextLost() {
			return u;
		},
		get _qualityRefl() {
			return ze;
		},
		get _qualityShadows() {
			return Re;
		},
		get mode() {
			return X;
		},
		get vector() {
			return Z;
		},
		get sceneEra() {
			return Ke;
		},
		decideStyle: $e,
		styleHintName: tt,
		updatePixelPalette: Xe,
		setEra: Ze,
		setPostMode: nt,
		toggleVector: rt,
		setVector: it,
		cycleEra: at,
		togglePalette: ot,
		setTonemap: (e) => {
			let t = e === "agx" || e === 1 || e === !0;
			return R.uniforms.uTonemap.value = +!!t, typeof window < "u" && (window.__tonemap = t ? "agx" : "aces"), t ? "agx" : "aces";
		},
		OVERCAST_GREY: m,
		FOG_DENSITY: .062,
		FOG_NIGHT_TINT: h,
		_fogColor: g
	};
}
//#endregion
//#region src/shaders/post-dive.frag
var we = "precision highp float;\n\nvarying vec2 vUv;\n\nuniform sampler2D uA;\nuniform sampler2D uB;\nuniform float uT;\nuniform vec2  uFocus;\nuniform float uZoom;    \n\nvoid main() {\n  \n  float t = uT * uT * (3.0 - 2.0 * uT);\n\n  \n  \n  float scale = mix(1.0, mix(1.0, 0.32, uZoom), t);\n  vec2 aUv = uFocus + (vUv - uFocus) * scale;\n  vec3 a = texture2D(uA, aUv).rgb;\n\n  \n  float bMix = smoothstep(0.40, 1.0, uT);\n  vec3 b = texture2D(uB, vUv).rgb;\n\n  \n  vec3 col = mix(a, b, bMix);\n  float v = 1.0 - smoothstep(0.2, 1.1, distance(vUv, vec2(0.5))) * (0.35 * (1.0 - abs(uT - 0.5) * 2.0));\n  col *= v;\n\n  gl_FragColor = vec4(col, 1.0);\n}";
//#endregion
//#region src/scene-transition.js
function Te({ rate: t = 4.6 } = {}) {
	let n = new e.ShaderMaterial({
		vertexShader: J,
		fragmentShader: we,
		uniforms: {
			uA: { value: null },
			uB: { value: null },
			uT: { value: 0 },
			uFocus: { value: new e.Vector2(.5, .5) },
			uZoom: { value: 1 }
		}
	}), r = "a", i = 0;
	function a(e, t) {
		n.uniforms.uA.value = e, n.uniforms.uB.value = t;
	}
	function o(e) {
		return r === "a" ? (e && n.uniforms.uFocus.value.copy(e), r = "in", !0) : !1;
	}
	function s() {
		return r !== "b" && r !== "in" ? !1 : (r = "out", !0);
	}
	function c(e) {
		r = e === "b" ? "b" : "a", i = +(e === "b"), n.uniforms.uT.value = i;
	}
	function l(e) {
		return i += (+(r === "b" || r === "in") - i) * Math.min(1, e * t), r === "in" && i > .992 && (i = 1, r = "b"), r === "out" && i < .008 && (i = 0, r = "a"), n.uniforms.uT.value = i, r;
	}
	function u(e) {
		n.uniforms.uZoom.value = Math.max(0, Math.min(1, e));
	}
	return {
		material: n,
		setSources: a,
		enter: o,
		exit: s,
		update: l,
		snap: c,
		setZoom: u,
		get mode() {
			return r;
		},
		get t() {
			return i;
		},
		get transitioning() {
			return r === "in" || r === "out";
		}
	};
}
//#endregion
//#region src/hero/hero-ring.js
function Ee(e) {
	if (e < 1) throw RangeError("createRing: count must be >= 1");
	let t = 0;
	function n() {
		return e === 1 || (t = (t + 1) % e), t;
	}
	function r() {
		return e === 1 || (t = (t - 1 + e) % e), t;
	}
	function i(n) {
		if (n < 0 || n >= e) throw RangeError(`goTo(${n}) out of range [0, ${e})`);
		return t = n, t;
	}
	return {
		get current() {
			return t;
		},
		get size() {
			return e;
		},
		next: n,
		prev: r,
		goTo: i
	};
}
function De(e, t, n) {
	return e ? !1 : n >= t;
}
function Oe(e) {
	for (let t of e) t.dispose();
}
//#endregion
//#region src/hero/createBeautyPresenter.js
function Y(t) {
	let { renderer: n, filmicMaterial: r, runPass: i, bloomPass: a, beautyRT: o, gradeRT: s, gradePass: c } = t, l = new e.Color(1, 1, 1), u = new e.Color(0, 0, 0), d = r.uniforms.uGradeTint.value, f = r.uniforms.uGradeLift.value, p = r.uniforms.uGradeSat.value, m = r.uniforms.uGradeContrast.value, h = !1;
	function g(e) {
		let t = e.filmic;
		t ? (r.uniforms.uGradeTint.value = t.tint ?? l, r.uniforms.uGradeLift.value = t.lift ?? u, r.uniforms.uGradeSat.value = t.sat ?? 1, r.uniforms.uGradeContrast.value = t.contrast ?? 1, h = !0) : h &&= (r.uniforms.uGradeTint.value = d, r.uniforms.uGradeLift.value = f, r.uniforms.uGradeSat.value = p, r.uniforms.uGradeContrast.value = m, !1);
	}
	function _(e, l) {
		n.setRenderTarget(o), n.render(e.scene, e.camera), e.usesBloom ? a(o) : r.uniforms.uBloomStrength.value = 0, r.uniforms.uScene.value = o.texture, r.uniforms.uAces.value = 1, r.uniforms.uDither.value = 1, r.uniforms.uGrade.value = 1, r.uniforms.uRays.value = 0, g(e), t.gradeActive ? (i(r, s), c(s.texture, l)) : i(r, l);
	}
	return { present: _ };
}
//#endregion
//#region src/hero/createHeroDirector.js
function ke(t, { scenes: n, dwell: r = 18e3, transitionMs: i = 1200, sunT: a = .75 } = {}) {
	if (!n || n.length === 0) throw Error("createHeroDirector: scenes must be a non-empty array");
	let { sunRig: o, drawBuffer: s, runPass: c, registerContentResizer: l, frameStart: u, frameEnd: d } = t, f = Y(t);
	o.goTo(a), typeof console < "u" && Math.abs(o.t - a) > .001 && console.warn(`[createHeroDirector] sunT=${a} has NO EFFECT: the rig is at t=${o.t.toFixed(3)} and this director never calls sunRig.update(), so goTo() only sets a goal nothing reads. The ring is graded at the core's boot time. See invariant 3 in createHeroDirector.js.`);
	let p = typeof window < "u" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : !1, m = Ee(n.length), h = Te({ rate: 4600 / i });
	h.setZoom(0);
	let g = .5, _ = () => Math.max(1, Math.floor(s.x * g)), v = () => Math.max(1, Math.floor(s.y * g)), y = new e.WebGLRenderTarget(_(), v(), {
		minFilter: e.LinearFilter,
		magFilter: e.LinearFilter,
		depthBuffer: !1,
		stencilBuffer: !1,
		type: e.HalfFloatType
	}), b = new e.WebGLRenderTarget(_(), v(), {
		minFilter: e.LinearFilter,
		magFilter: e.LinearFilter,
		depthBuffer: !1,
		stencilBuffer: !1,
		type: e.HalfFloatType
	});
	h.setSources(y.texture, b.texture), l((e) => {
		y.setSize(Math.max(1, Math.floor(e.x * g)), Math.max(1, Math.floor(e.y * g))), b.setSize(Math.max(1, Math.floor(e.x * g)), Math.max(1, Math.floor(e.y * g)));
		for (let t of n) t.camera && t.camera.isPerspectiveCamera && (t.camera.aspect = e.x / e.y, t.camera.updateProjectionMatrix());
	});
	let x = new e.Vector2(.5, .5), S = 0, C = 0;
	function w(e) {
		e !== m.current && (S = m.current, m.goTo(e), h.snap("a"), h.enter(x), C = 0);
	}
	function T() {
		w((m.current + 1) % n.length);
	}
	function E() {
		w((m.current - 1 + n.length) % n.length);
	}
	function D(e) {
		if (e < 0 || e >= n.length) throw RangeError(`goTo(${e}) out of range`);
		w(e);
	}
	if (p) {
		let e = n[0];
		return e.update(0, 0), f.present(e, null), {
			next: T,
			prev: E,
			goTo: D,
			dispose() {
				Oe(n), y.dispose(), b.dispose(), h.material.dispose();
			},
			get currentIndex() {
				return m.current;
			},
			get transitioning() {
				return !1;
			},
			get currentTone() {
				return n[m.current].tone;
			}
		};
	}
	let O = null, k = null, A = !1;
	function j(e) {
		if (O = requestAnimationFrame(j), t.paused || t.contextLost) {
			k = null;
			return;
		}
		let i = k === null ? 0 : (e - k) * .001;
		k = e, C += i * 1e3, u();
		let a = n[m.current];
		a.update(i, e * .001);
		let o = h.update(i);
		if (o === "in" || o === "out") {
			let t = n[S];
			t.update(i, e * .001), f.present(t, y), f.present(a, b), c(h.material, null);
		} else f.present(a, null), n.length > 1 && De(p, r, C) && T();
		d();
	}
	function M() {
		t.setActive(document.visibilityState === "visible"), document.visibilityState === "visible" && (k = null);
	}
	document.addEventListener("visibilitychange", M), O = requestAnimationFrame(j);
	function N() {
		A || (A = !0, O !== null && (cancelAnimationFrame(O), O = null), document.removeEventListener("visibilitychange", M), y.dispose(), b.dispose(), h.material.dispose(), Oe(n));
	}
	return {
		next: T,
		prev: E,
		goTo: D,
		dispose: N,
		get currentIndex() {
			return m.current;
		},
		get transitioning() {
			return h.transitioning;
		},
		get currentTone() {
			return n[m.current].tone;
		}
	};
}
//#endregion
//#region src/shaders/hero-wipe.frag
var Ae = "precision highp float;\n\nvarying vec2 vUv;\n\nuniform sampler2D uA;       \nuniform sampler2D uB;       \nuniform float uT;           \nuniform float uMode;        \nuniform float uDensity;     \nuniform float uBand;        \nuniform vec2  uDir;         \nuniform float uAspect;      \n\n/* 2D value hash -> 0..1. Cheap, stable per cell (same input => same threshold every frame). */\nfloat hash21(vec2 p) {\n  p = fract(p * vec2(123.34, 345.45));\n  p += dot(p, p + 34.345);\n  return fract(p.x * p.y);\n}\n\n/* Hex metric on the pointy-top lattice below: 0 at a hex centre, 0.5 at the flat edge midpoint.\n   A hexagon grown to radius 0.5 exactly TILES its neighbours — that is why honeycomb has no seam. */\nfloat hexDist(vec2 p) {\n  p = abs(p);\n  return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);\n}\n\n/* Nearest hex-cell local coordinate: two rectangular lattices interleaved by half a cell tile the\n   plane with hexagons; the pixel belongs to whichever centre is closer. Returns the offset from\n   that centre (so hexDist(hexGV(p)) is the pixel's distance within its hex). */\nvec2 hexGV(vec2 p) {\n  vec2 r = vec2(1.0, 1.7320508);\n  vec2 h = r * 0.5;\n  vec2 a = mod(p, r) - h;\n  vec2 b = mod(p - h, r) - h;\n  return dot(a, a) < dot(b, b) ? a : b;\n}\n\nvoid main() {\n  vec3 A = texture2D(uA, vUv).rgb;\n  vec3 B = texture2D(uB, vUv).rgb;\n\n  /* MODE 0 — FADE (baseline). No cells, no direction: a plain eased global cross-fade. This is the\n     graceful-degradation target for reduced motion too (the JS forces this mode there). */\n  if (uMode < 0.5) {\n    float e = uT * uT * (3.0 - 2.0 * uT);      \n    gl_FragColor = vec4(mix(A, B, e), 1.0);\n    return;\n  }\n\n  /* ── shared wipe geometry (ash / honeycomb / halftone) ── */\n\n  /* dirp: position along the wipe direction, remapped to 0..1 across the unit square. dmin/dmax are\n     the direction's reach over the square's corners, so any direction vector normalises correctly\n     (the default diagonal sweeps corner-to-corner). */\n  vec2 nd = normalize(uDir);\n  float dmin = min(0.0, nd.x) + min(0.0, nd.y);\n  float dmax = max(0.0, nd.x) + max(0.0, nd.y);\n  float dirp = (dot(vUv, nd) - dmin) / max(dmax - dmin, 1e-3);\n\n  /* localT: the band has width uBand and its trailing edge is at progress uT*(1+bw). A pixel at\n     dirp is fully A ahead of the band, fully B once the band has passed, and mid-handoff inside it.\n     Band-limited BY CONSTRUCTION: clamp to 0..1 means solid A ahead and solid B behind — the dither\n     never bleeds outside the moving band. */\n  float bw = max(uBand, 1e-3);\n  float localT = clamp((uT * (1.0 + bw) - dirp) / bw, 0.0, 1.0);\n\n  /* Aspect-corrected cell space: multiply x by aspect so a \"cell\" is square (and a hex regular /\n     a dot round) no matter the viewport shape. uDensity sets how many cells span the frame. */\n  vec2 cuv = vec2(vUv.x * uAspect, vUv.y) * uDensity;\n\n  float m;  \n  if (uMode < 1.5) {\n    /* MODE 1 — ASH (FM dissolve). Coarse + fine cell thresholds; the cell flips the instant localT\n       passes its threshold. step() (not smoothstep) keeps the flip HARD so whole cells switch at\n       once — that hard cell boundary is what reads as crumbling squares, not a soft gradient. */\n    float thC = hash21(floor(cuv) + 0.5);\n    float thF = hash21(floor(cuv * 2.3) + 11.7);\n    float th  = thC * 0.68 + thF * 0.32;       \n    m = step(th, localT);\n  } else if (uMode < 2.5) {\n    /* MODE 2 — HONEYCOMB (hex AM). Grow each hexagon from its centre. radius runs to 0.58 (a touch\n       past the 0.5 tiling radius) so that by localT=1 even the hex CORNERS are covered — no residual\n       seams. The small smoothstep is a fixed-width anti-alias on the growing edge (no derivatives\n       needed, since cells are uniform in cuv space). */\n    vec2 gv = hexGV(cuv);\n    float radius = localT * 0.58;\n    m = smoothstep(radius + 0.045, radius - 0.045, hexDist(gv));\n    m *= smoothstep(0.0, 0.015, localT);       \n  } else {\n    /* MODE 3 — HALFTONE (circle AM). A square grid of dots that grow with localT. Circles cannot\n       tile, so radius runs to 0.78 (past the 0.707 cell-corner distance) — the overdraw closes the\n       corner gaps that would otherwise leave a dotted line of background along the fill edge\n       (the GLOSSARY overdraw-past-boundary fix). Single-sided growth => no crossover seam. */\n    vec2 gv = fract(cuv) - 0.5;\n    float radius = localT * 0.78;\n    m = smoothstep(radius + 0.045, radius - 0.045, length(gv));\n    m *= smoothstep(0.0, 0.015, localT);\n  }\n\n  gl_FragColor = vec4(mix(A, B, m), 1.0);\n}", je = Object.freeze({
	fade: 0,
	ash: 1,
	honeycomb: 2,
	halftone: 3
});
function Me(e) {
	let t = je[e];
	if (t === void 0) throw Error(`createHeroWipe: unknown mode ${JSON.stringify(e)} — expected one of ${Object.keys(je).join(", ")}`);
	return t;
}
function Ne(e, t) {
	return t ? {
		...e,
		mode: "fade",
		duration: Math.min(150, e.duration ?? 150)
	} : e;
}
function Pe() {
	let e = "idle", t = 0, n = 1;
	function r(r) {
		n = Math.max(1, r), t = 0, e = "wiping";
	}
	function i(r) {
		return e === "wiping" ? (t += r / n, t >= 1 ? (t = 1, e = "idle", {
			t: 1,
			active: !1,
			justFinished: !0
		}) : {
			t,
			active: !0,
			justFinished: !1
		}) : {
			t,
			active: !1,
			justFinished: !1
		};
	}
	function a() {
		let n = e === "wiping";
		return t = 1, e = "idle", n;
	}
	return {
		start: r,
		advance: i,
		finish: a,
		get t() {
			return t;
		},
		get active() {
			return e === "wiping";
		}
	};
}
//#endregion
//#region src/hero/createHeroWipe.js
function Fe(t, { transScale: n = .5, cell: r = 30, band: i = .35, direction: a = [1, 1] } = {}) {
	let { drawBuffer: o, runPass: s, registerContentResizer: c } = t, l = Y(t), u = new e.ShaderMaterial({
		vertexShader: J,
		fragmentShader: Ae,
		uniforms: {
			uA: { value: null },
			uB: { value: null },
			uT: { value: 0 },
			uMode: { value: 0 },
			uDensity: { value: r },
			uBand: { value: i },
			uDir: { value: new e.Vector2(a[0], a[1]) },
			uAspect: { value: o.x / Math.max(o.y, 1) }
		},
		depthTest: !1,
		depthWrite: !1
	}), d = () => Math.max(1, Math.floor(o.x * n)), f = () => Math.max(1, Math.floor(o.y * n)), p = {
		minFilter: e.LinearFilter,
		magFilter: e.LinearFilter,
		depthBuffer: !1,
		stencilBuffer: !1,
		type: e.HalfFloatType
	}, m = new e.WebGLRenderTarget(d(), f(), p), h = new e.WebGLRenderTarget(d(), f(), p);
	u.uniforms.uA.value = m.texture, u.uniforms.uB.value = h.texture, c((e) => {
		m.setSize(Math.max(1, Math.floor(e.x * n)), Math.max(1, Math.floor(e.y * n))), h.setSize(Math.max(1, Math.floor(e.x * n)), Math.max(1, Math.floor(e.y * n)));
		for (let t of [
			_,
			v,
			y
		]) t && t.camera && t.camera.isPerspectiveCamera && (t.camera.aspect = e.x / e.y, t.camera.updateProjectionMatrix());
	});
	let g = Pe(), _ = null, v = null, y = null, b = null, x = 0, S = typeof window < "u" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : !1;
	function C(e) {
		_ = e;
	}
	function w(e, t, n = {}) {
		g.active && b && T(y);
		let a = Ne(n, S), o = Me(a.mode ?? "fade");
		return u.uniforms.uMode.value = o, u.uniforms.uDensity.value = a.cell ?? r, u.uniforms.uBand.value = a.band ?? i, a.direction && u.uniforms.uDir.value.set(a.direction[0], a.direction[1]), v = e, y = t, _ = e, g.start(a.duration ?? 1200), u.uniforms.uT.value = 0, new Promise((e) => {
			b = e;
		});
	}
	function T(e) {
		g.finish(), _ = e, v = y = null;
		let t = b;
		b = null, t && t();
	}
	function E(e, t) {
		if (x = t ?? x + e, u.uniforms.uAspect.value = o.x / Math.max(o.y, 1), g.active) {
			v.update(e, x), y.update(e, x), l.present(v, m), l.present(y, h);
			let t = g.advance(e * 1e3);
			u.uniforms.uT.value = t.t, s(u, null), t.justFinished && T(y);
		} else _ && (_.update(e, x), l.present(_, null));
	}
	function D() {
		m.dispose(), h.dispose(), u.dispose();
	}
	return {
		setScene: C,
		transition: w,
		update: E,
		dispose: D,
		material: u,
		get t() {
			return g.t;
		},
		get transitioning() {
			return g.active;
		},
		get mode() {
			return u.uniforms.uMode.value;
		}
	};
}
//#endregion
//#region src/math/easing.js
var Ie = (e) => e < 0 ? 0 : e > 1 ? 1 : e;
function Le(e) {
	return Ie(e);
}
function Re(e) {
	return e = Ie(e), e * e * (3 - 2 * e);
}
function ze(e) {
	return e = Ie(e), e < .5 ? 4 * e * e * e : 1 - (-2 * e + 2) ** 3 / 2;
}
function Be(e) {
	return e = Ie(e), 1 - (1 - e) ** 3;
}
function Ve(e) {
	return e = Ie(e), e * e * e;
}
function He(e) {
	return e = Ie(e), (1 - Math.cos(Math.PI * e)) / 2;
}
var Ue = Object.freeze({
	linear: Le,
	smoothstep: Re,
	easeInOutCubic: ze,
	easeOutCubic: Be,
	easeInCubic: Ve,
	easeInOutSine: He
});
function We(e) {
	if (typeof e == "function") return e;
	if (e == null) return ze;
	let t = Ue[e];
	if (!t) throw Error(`easing: unknown curve ${JSON.stringify(e)} — expected one of ${Object.keys(Ue).join(", ")} (or a function)`);
	return t;
}
//#endregion
//#region src/reel-grammar.js
var Ge = Object.freeze({
	24: 73.7,
	35: 54.4,
	50: 39.6,
	85: 23.9
}), X = Object.freeze({
	wide: 24,
	medium: 50,
	close: 85
}), Z = Object.freeze([
	"wide",
	"medium",
	"close"
]), Q = Object.freeze({
	shotMinMs: 2e3,
	shotMaxMs: 3e3,
	defaultShotMs: 2500,
	hookWindowMs: 3e3,
	reelMinMs: 7e3,
	reelSoftMaxMs: 3e4
}), Ke = (e, t, n) => e < t ? t : e > n ? n : e;
function qe(e, t = {}) {
	let n = t.loop !== !1;
	if (!Array.isArray(e) || e.length === 0) throw Error("buildReelPlan: need at least one beat (the hook) — the trailer opens on real footage.");
	if (e[0].intro) throw Error("buildReelPlan: beat[0] is flagged intro — the trailer rule forbids an intro; open on the hook (playbook §trailer-grammar).");
	let r = [], i = e.map((e, t) => {
		let n = e.framing || Z[t % Z.length];
		if (!X[n]) throw Error(`buildReelPlan: beat ${JSON.stringify(e.id ?? t)} has unknown framing ${JSON.stringify(n)} (wide|medium|close).`);
		let i = e.focalMm ?? X[n];
		if (!Ge[i]) throw Error(`buildReelPlan: beat ${JSON.stringify(e.id ?? t)} has off-set focal ${i}mm (use 24|35|50|85).`);
		let a = e.durationMs ?? Q.defaultShotMs, o = Ke(a, Q.shotMinMs, Q.shotMaxMs);
		return a !== o && r.push(`beat ${e.id ?? t}: duration ${a}ms clamped to ${o}ms (2–3 s shots).`), {
			id: e.id ?? `beat-${t}`,
			framing: n,
			focalMm: i,
			fov: Ge[i],
			durationMs: o,
			caption: e.caption ?? "",
			captionSub: e.captionSub ?? "",
			move: e.move ?? null,
			meta: e.meta ?? null,
			isHook: t === 0
		};
	}), a = i[0].durationMs;
	if (a > Q.hookWindowMs && r.push(`hook beat is ${a}ms — the payoff should land inside ${Q.hookWindowMs}ms (§attention-math).`), n) {
		let e = i[0];
		i.push({
			id: `${e.id}-loopback`,
			framing: e.framing,
			focalMm: e.focalMm,
			fov: e.fov,
			durationMs: Q.shotMinMs,
			caption: "",
			captionSub: "",
			move: e.move,
			meta: e.meta,
			isHook: !1,
			isLoopback: !0
		});
	}
	let o = i.reduce((e, t) => e + t.durationMs, 0);
	return o < Q.reelMinMs && r.push(`reel is ${o}ms — under the ${Q.reelMinMs}ms looper floor; add a beat.`), o > Q.reelSoftMaxMs && r.push(`reel is ${o}ms — over the ${Q.reelSoftMaxMs}ms v1 ceiling (that's an engagement-format length).`), {
		shots: i,
		totalMs: o,
		loop: n,
		hookMs: a,
		warnings: r
	};
}
//#endregion
//#region src/hero/createCameraDirector.js
var Je = Math.PI / 180, $ = (t, n = 0) => new e.Vector3(t?.[0] ?? n, t?.[1] ?? n, t?.[2] ?? n);
function Ye(t, { wipe: n } = {}) {
	let r = Y(t), i = n || Fe(t), a = !n, o = typeof window < "u" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : !1, s = new e.Vector3(), c = new e.Vector3(), l = new e.Vector3(), u = "auto";
	function d(e) {
		return u = e === "auto" ? "auto" : !!e, I;
	}
	function f(e) {
		let n = e.pack.camera;
		if (!n.isPerspectiveCamera) return;
		let r = t.drawBuffer, i = r.x / Math.max(1, r.y);
		Math.abs(n.aspect - i) > 1e-6 && (n.aspect = i, n.updateProjectionMatrix());
		let a = u === "auto" ? i < 1 : u, o = e.framing || e.pack.framing;
		if (!a || !o) return;
		l.set(o.center?.[0] ?? 0, o.center?.[1] ?? 0, o.center?.[2] ?? 0);
		let s = Math.max(.001, n.position.distanceTo(l)), c = (o.radius ?? 1) / (o.fill ?? .85);
		n.fov = 2 * Math.atan(c / (s * i)) / Je, n.updateProjectionMatrix();
	}
	let p = [], m = {
		shotchange: [],
		end: []
	}, h = -1, g = "idle", _ = 0, v = 0, y = !1, b = 0;
	function x(e) {
		let t = e.params || {}, n = {
			pack: e.pack,
			move: e.move,
			duration: e.duration ?? 5e3,
			easing: We(e.easing),
			transition: e.transition || null,
			framing: e.framing || null,
			bestT: e.bestT,
			center: $(t.center),
			radius: t.radius ?? 10,
			height: t.height ?? 0,
			startDeg: t.startDeg ?? 0,
			arcDeg: t.arcDeg ?? 90,
			from: $(t.from),
			to: $(t.to),
			lookFrom: $(t.lookFrom ?? t.lookAt),
			lookTo: $(t.lookTo ?? t.lookAt),
			lookAt: $(t.lookAt),
			fovFrom: t.fovFrom,
			fovTo: t.fovTo,
			fromT: t.fromT ?? 0,
			toT: t.toT ?? 0,
			drift: t.drift || null,
			hasPose: !!(t.from || t.center || t.pos || t.lookAt),
			pos: $(t.pos ?? t.from),
			offset: $(t.offset)
		};
		if (![
			"orbit",
			"dolly",
			"push-in",
			"hold",
			"timelapse",
			"crane",
			"follow"
		].includes(n.move)) throw Error(`createCameraDirector: unknown move ${JSON.stringify(n.move)} (orbit|dolly|push-in|hold|timelapse|crane|follow)`);
		return n.bestT ??= n.move === "timelapse" ? 1 : n.move === "hold" ? 0 : .5, n;
	}
	function S(e) {
		return p.push(x(e)), I;
	}
	function C(e, t = {}) {
		let n = qe(t.beats || [], { loop: t.loop }), r = t.subject || [
			0,
			0,
			0
		], i = t.radius ?? 6, a = {
			close: 1,
			medium: 1.6,
			wide: 2.4
		}, o = t.height ?? 2, s = t.arcDeg ?? 24, c = t.startDeg ?? -12;
		for (let l of n.shots) {
			let n = i * (a[l.framing] ?? 1.6);
			S({
				pack: e,
				move: l.move === "push-in" ? "push-in" : "orbit",
				duration: l.durationMs,
				easing: "easeInOutSine",
				framing: {
					center: r,
					radius: n * .5,
					fill: .82
				},
				params: {
					center: r,
					radius: n,
					height: o,
					startDeg: c,
					arcDeg: s,
					fovFrom: l.fov,
					fovTo: l.fov,
					lookAt: r,
					from: [
						r[0] + n,
						r[1] + o,
						r[2]
					],
					to: [
						r[0],
						r[1] + o,
						r[2]
					]
				},
				transition: t.transition || {
					mode: "fade",
					duration: 350
				}
			}), c += s;
		}
		return {
			api: I,
			plan: n
		};
	}
	function w(e, t) {
		return (m[e] || (m[e] = [])).push(t), I;
	}
	function T(e, t) {
		for (let n of m[e] || []) n(t);
	}
	function E(e, t, n) {
		let r = e.pack.camera;
		switch (e.move) {
			case "orbit": {
				let n = (e.startDeg + e.arcDeg * t) * Je;
				s.set(e.center.x + e.radius * Math.cos(n), e.center.y + e.height, e.center.z + e.radius * Math.sin(n)), r.position.copy(s), r.lookAt(e.center.x, e.center.y, e.center.z);
				break;
			}
			case "dolly":
				r.position.lerpVectors(e.from, e.to, t), c.lerpVectors(e.lookFrom, e.lookTo, t), r.lookAt(c.x, c.y, c.z);
				break;
			case "push-in":
				r.position.lerpVectors(e.from, e.to, t), r.lookAt(e.lookAt.x, e.lookAt.y, e.lookAt.z), e.fovFrom != null && e.fovTo != null && r.isPerspectiveCamera && (r.fov = e.fovFrom + (e.fovTo - e.fovFrom) * t, r.updateProjectionMatrix());
				break;
			case "crane":
				r.position.lerpVectors(e.from, e.to, t), r.lookAt(e.lookAt.x, e.lookAt.y, e.lookAt.z);
				break;
			case "follow":
				c.lerpVectors(e.lookFrom, e.lookTo, t), r.position.set(c.x + e.offset.x, c.y + e.offset.y, c.z + e.offset.z), r.lookAt(c.x, c.y, c.z);
				break;
			case "hold":
			case "timelapse":
				if (e.hasPose && (r.position.copy(e.pos), r.lookAt(e.lookAt.x, e.lookAt.y, e.lookAt.z)), e.drift && r.isPerspectiveCamera) {
					let t = e.drift, i = (t.speed ?? .3) * n;
					r.position.x += Math.sin(i) * (t.amp ?? .05), r.position.y += Math.sin(i * .73 + 1.3) * (t.amp ?? .05) * .6, r.lookAt(e.lookAt.x, e.lookAt.y, e.lookAt.z);
				}
				break;
		}
	}
	function D(e, t) {
		return e.move === "timelapse" ? b + e.fromT + (e.toT - e.fromT) * t : v;
	}
	function O(e, t, n) {
		let i = D(e, t);
		e.pack.update(n, i), E(e, t, v), f(e), r.present(e.pack, null);
	}
	function k(e) {
		h = e, g = "shot", _ = 0;
		let t = p[e];
		t.move === "timelapse" && (b = v), T("shotchange", {
			index: e,
			move: t.move,
			pack: t.pack
		});
	}
	function A() {
		let e = p[h];
		if (h + 1 >= p.length) {
			g = "idle", y = !1, T("end", { index: h });
			return;
		}
		let t = p[h + 1];
		t.move === "timelapse" && (b = v), t.pack.update(0, D(t, 0)), E(t, 0, v), f(t);
		let n = e.transition || {
			mode: "fade",
			duration: 1200
		};
		i.transition(e.pack, t.pack, {
			mode: n.mode ?? "fade",
			duration: n.duration ?? 1200
		}), g = "transition";
	}
	function j(e, t) {
		if (v = t ?? v + e, h < 0) return;
		if (g === "transition") {
			i.update(e, v), i.transitioning || k(h + 1);
			return;
		}
		let n = p[h];
		if (o) {
			n.pack.update(e, D(n, n.bestT)), E(n, n.bestT, 0), f(n), r.present(n.pack, null), y && (_ += e * 1e3, _ >= n.duration && (h + 1 >= p.length ? (g = "idle", y = !1, T("end", { index: h })) : k(h + 1)));
			return;
		}
		if (!y) {
			O(n, Math.min(1, _ / n.duration), e);
			return;
		}
		_ += e * 1e3;
		let a = Math.min(1, _ / n.duration);
		O(n, n.easing(a), e), a >= 1 && A();
	}
	function M() {
		return h < 0 && p.length && k(0), y = !0, I;
	}
	function N() {
		return y = !1, I;
	}
	function P() {
		return h = -1, v = 0, _ = 0, p.length && k(0), y = !0, I;
	}
	function F() {
		a && i.dispose();
	}
	let I = {
		addShot: S,
		addReelSequence: C,
		play: M,
		pause: N,
		restart: P,
		update: j,
		on: w,
		dispose: F,
		setVertical: d,
		get playing() {
			return y;
		},
		get shotIndex() {
			return h;
		},
		get phase() {
			return g;
		},
		get vertical() {
			return u;
		}
	};
	return I;
}
//#endregion
//#region src/hero/createBuildIn.js
var Xe = [
	"rise",
	"converge",
	"press",
	"disassemble"
];
function Ze(e, t) {
	let n = e * 2.399963, r = 1 - e % 7 / 6 * 1.6, i = Math.sqrt(Math.max(0, 1 - r * r * .25));
	return t.set(Math.cos(n) * i, r, Math.sin(n) * i);
}
function Qe(t, {} = {}) {
	let n = t && Array.isArray(t.buildGroups) && t.buildGroups.length > 0, r = t && typeof t.setBuild == "function";
	if (!n && !r) throw Error("createBuildIn: pack must expose buildGroups ([{ object, role }]) OR a setBuild(t) hook");
	let i = n ? t.buildGroups : [], a = i.length, o = i.map((t) => ({
		obj: t.object,
		role: t.role,
		home: new e.Vector3(),
		homeScale: new e.Vector3(),
		offset: new e.Vector3(),
		delay: 0
	})), s = new e.Vector3(), c = "rise", l = We("easeOutCubic"), u = .5, d = 5, f = .14, p = 1, m = 1, h = 0, g = 1400, _ = null, v = typeof window < "u" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : !1;
	function y(e) {
		let t = e === "press", n = a > 1 ? u : 0;
		p = Math.max(.001, 1 - n);
		for (let r = 0; r < a; r++) {
			let i = o[r];
			i.home.copy(i.obj.position), i.homeScale.copy(i.obj.scale), i.delay = a > 1 ? r / (a - 1) * n : 0, e === "rise" ? i.offset.set(0, -d, 0) : t ? i.offset.set(0, d, 0) : i.offset.copy(Ze(r, s)).multiplyScalar(d);
		}
	}
	function b(e) {
		m = e < 0 ? 0 : e > 1 ? 1 : e;
		let n = c === "press";
		for (let e = 0; e < a; e++) {
			let t = o[e], r = p > 0 ? (m - t.delay) / p : m, i = l(r < 0 ? 0 : r > 1 ? 1 : r);
			t.obj.position.copy(t.home).addScaledVector(t.offset, 1 - i);
			let a = c === "converge" ? .12 + .88 * i : c === "rise" ? .55 + .45 * i : 1, s = a, u = a;
			if (n) {
				let e = i > .72 ? Math.sin((i - .72) / .28 * Math.PI) : 0;
				u = 1 - f * e, s = 1 + f * .72 * e;
			}
			t.obj.scale.set(t.homeScale.x * s, t.homeScale.y * u, t.homeScale.z * s);
		}
		r && t.setBuild(l(m < 0 ? 0 : m > 1 ? 1 : m));
	}
	function x(e = "rise", { duration: t = 1400, easing: n = "easeOutCubic", stagger: r = .5, distance: i = 5, impact: a = .14 } = {}) {
		let o = e === "disassemble", s = o ? c : e;
		if (!Xe.includes(e)) throw Error(`createBuildIn: unknown choreography ${JSON.stringify(e)} (${Xe.join("|")})`);
		return o || (c = s), l = We(n), u = r, d = i, f = a, g = Math.max(1, t), y(c), v ? (b(+!o), h = 0, Promise.resolve()) : (m = +!!o, h = o ? -1 : 1, b(m), new Promise((e) => {
			_ = e;
		}));
	}
	function S(e = {}) {
		return x("disassemble", {
			duration: e.duration ?? g,
			easing: e.easing,
			stagger: e.stagger ?? u,
			distance: d,
			impact: f
		});
	}
	function C(e) {
		h !== 0 && (m += e * 1e3 * h / g, h > 0 && m >= 1 ? (m = 1, h = 0, w()) : h < 0 && m <= 0 && (m = 0, h = 0, w())), b(m);
	}
	function w() {
		let e = _;
		_ = null, e && e();
	}
	function T() {}
	return {
		play: x,
		reverse: S,
		update: C,
		set: b,
		dispose: T,
		get t() {
			return m;
		},
		get choreography() {
			return c;
		},
		get playing() {
			return h !== 0;
		}
	};
}
//#endregion
//#region src/hero/createShadowRig.js
function $e(t, { scene: n, color: r = 16777215, intensity: i = 1, center: a = [
	0,
	0,
	0
], radius: o = 20, distance: s = 40, mapSize: c = 2048, bias: l = -4e-4, normalBias: u = 0, softness: d = 1, animatedCaster: f = !1 } = {}) {
	if (!n) throw Error("createShadowRig: `scene` is required (the scene to cast shadows in)");
	let { renderer: p } = t, m = new e.DirectionalLight(r, i);
	m.castShadow = !0, m.shadow.mapSize.set(c, c), m.shadow.bias = l, m.shadow.normalBias = u, m.shadow.radius = d;
	let h = new e.Vector3().fromArray(a), g = o;
	n.add(m), n.add(m.target);
	let _ = new e.Vector3(0, 1, 0), v = new e.Vector3(0, -1, 0), y = !1;
	function b({ center: e, radius: t } = {}) {
		e && h.fromArray(e), typeof t == "number" && (g = t);
		let n = m.shadow.camera;
		n.left = -g, n.right = g, n.top = g, n.bottom = -g, n.near = .1, n.far = s + g * 2 + .1, n.updateProjectionMatrix(), m.target.position.copy(h), m.target.updateMatrixWorld(), p.shadowMap.needsUpdate = !0;
	}
	function x(e) {
		_.copy(e).normalize(), m.position.copy(h).addScaledVector(_, s), m.target.position.copy(h), m.target.updateMatrixWorld();
	}
	function S() {
		let e = t._qualityShadows;
		if (e) {
			let e = v.distanceToSquared(_) > 1e-6;
			(f || e || !y) && (p.shadowMap.needsUpdate = !0, v.copy(_));
		}
		y = e;
	}
	return b({
		center: a,
		radius: o
	}), {
		light: m,
		setSunDir: x,
		fit: b,
		update: S,
		get sunDir() {
			return _;
		},
		get strength() {
			return +!!t._qualityShadows;
		},
		get active() {
			return t._qualityShadows;
		},
		dispose() {
			n.remove(m), n.remove(m.target), m.dispose?.();
		}
	};
}
//#endregion
//#region src/shaders/silk.vert
var et = "#include <common>\n#include <shadowmap_pars_vertex>\n\nuniform float uTime;\n\nvarying vec2 vUv;\nvarying float vDisplacement;\n\n/* Smooth value noise — 2D hash + bilinear blend with a quintic (C2) fade. Prefixed 'silk_'\n   so it can't collide with any function three's chunks bring in. */\nfloat silk_hash2(vec2 p) {\n  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);\n}\nfloat silk_noise2(vec2 p) {\n  vec2 i = floor(p);\n  vec2 f = fract(p);\n  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);\n  return mix(\n    mix(silk_hash2(i),                 silk_hash2(i + vec2(1.0, 0.0)), u.x),\n    mix(silk_hash2(i + vec2(0.0, 1.0)), silk_hash2(i + vec2(1.0, 1.0)), u.x),\n    u.y\n  );\n}\n\n/* The wave height at a plane position, at time t. Returns the raw y-offset (also the value\n   silk.frag maps to the ink→gold→cream gradient, so silk.vert still passes it on as\n   vDisplacement). Identical expressions to the original inline body — do not \"tidy\" the\n   constants; both the render and the depth pass depend on them matching exactly. */\nfloat silkDisplacement(vec3 pos, float t) {\n  float x = pos.x;\n  float z = pos.z;\n  /* L1 — long slow swells: primary fabric drape (λ ≈ 25 units, T ≈ 18s). */\n  float d1 = sin(x * 0.25 + t * 0.35) * cos(z * 0.18 + t * 0.26) * 1.8;\n  /* L2 — medium diagonal ripple (λ ≈ 8 units, T ≈ 11s, 45° bias). */\n  float d2 = sin((x * 0.55 + z * 0.40) + t * 0.57 + 1.2) * 0.9;\n  /* L3 — smooth noise detail (fine silk texture). */\n  float d3 = (silk_noise2(vec2(x * 0.70 + t * 0.32, z * 0.70 + t * 0.24)) - 0.5) * 1.0;\n  return d1 + d2 + d3;\n}\n\nvoid main() {\n  vUv = uv;\n\n  /* The wave height — shared with the depth pass so the cast shadow matches the surface. */\n  float disp = silkDisplacement(position, uTime);\n  vDisplacement = disp;\n\n  /* 'transformed' is the displaced object-space position — the single point everything below\n     (clip position, world position for the shadow coord) is derived from. */\n  vec3 transformed = position;\n  transformed.y += disp;\n\n  /* World position of the DISPLACED point — three's shadow chunk projects THIS into the sun's\n     shadow camera. Deriving it from the flat plane instead would make the shadow swim. */\n  vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);\n\n  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);\n  gl_Position = projectionMatrix * mvPosition;\n\n  /* transformedNormal — required by <shadowmap_vertex> under HAS_NORMAL (which three defines for\n     this material). The plane's up-normal is a fine stand-in: normalBias is 0, so this only has to\n     exist, not be exact. 'normal'/'normalMatrix' are three-injected. */\n  vec3 transformedNormal = normalMatrix * normal;\n\n  #include <shadowmap_vertex>\n}", tt = "precision highp float;\n\n#include <common>\n#include <packing>\n\nuniform bool receiveShadow;   \n                              \n#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>\n\nvarying vec2 vUv;\nvarying float vDisplacement;\n\n/* Dusk-harbor palette — linear sRGB. L-N re-skin: uniforms so a client build injects its own\n   gradient without editing this shader; JS defaults them to the values below → byte-identical. */\nuniform vec3 uInk;    /* trough — very dark warm near-black */\nuniform vec3 uGold;   /* mid-wave — warm orange (dusk.sky linear) */\nuniform vec3 uCream;  /* crest — warm cream (NEUTRAL.text linear) */\n\n/* uShadow: self-shadow strength, 0..1. 0 = OFF and byte-identical to pre-shadows Dusk-Silk. */\nuniform float uShadow;\n\n/* uBrightness ramp — crests 2.4× to trigger bloom, troughs 0.6× to stay dark. */\nconst float BRIGHT_LOW  = 0.60;\nconst float BRIGHT_HIGH = 2.40;\n\nvoid main() {\n  /* Map raw displacement to [0,1] (range [-3,+3] covers >99% of wave values). */\n  float t = clamp((vDisplacement + 3.0) / 6.0, 0.0, 1.0);\n\n  /* Two-stop gradient: ink → gold → cream. */\n  vec3 col;\n  if (t < 0.5) {\n    col = mix(uInk, uGold, t * 2.0);\n  } else {\n    col = mix(uGold, uCream, (t - 0.5) * 2.0);\n  }\n\n  /* HDR brightness ramp. */\n  float brightness = mix(BRIGHT_LOW, BRIGHT_HIGH, t);\n  col *= brightness;\n\n  /* SELF-SHADOW: 1.0 lit, <1.0 where a crest occludes the sun. Gated by uShadow (0 → identity,\n     so an un-shadowed build is unchanged). We darken toward, but not fully to, black — a real\n     letterpress-flat 0 reads as a hole; 0.28 keeps a touch of ambient in the shade so the silk\n     still reads as fabric in the troughs. */\n  float sMask = getShadowMask();\n  float shade = mix(1.0, mix(0.28, 1.0, sMask), uShadow);\n  col *= shade;\n\n  gl_FragColor = vec4(col, 1.0);\n}", nt = "uniform float uTime;\n\nvarying vec2 vHighPrecisionZW;\n\n/* Smooth value noise — 2D hash + bilinear blend with a quintic (C2) fade. Prefixed 'silk_'\n   so it can't collide with any function three's chunks bring in. */\nfloat silk_hash2(vec2 p) {\n  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);\n}\nfloat silk_noise2(vec2 p) {\n  vec2 i = floor(p);\n  vec2 f = fract(p);\n  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);\n  return mix(\n    mix(silk_hash2(i),                 silk_hash2(i + vec2(1.0, 0.0)), u.x),\n    mix(silk_hash2(i + vec2(0.0, 1.0)), silk_hash2(i + vec2(1.0, 1.0)), u.x),\n    u.y\n  );\n}\n\n/* The wave height at a plane position, at time t. Returns the raw y-offset (also the value\n   silk.frag maps to the ink→gold→cream gradient, so silk.vert still passes it on as\n   vDisplacement). Identical expressions to the original inline body — do not \"tidy\" the\n   constants; both the render and the depth pass depend on them matching exactly. */\nfloat silkDisplacement(vec3 pos, float t) {\n  float x = pos.x;\n  float z = pos.z;\n  /* L1 — long slow swells: primary fabric drape (λ ≈ 25 units, T ≈ 18s). */\n  float d1 = sin(x * 0.25 + t * 0.35) * cos(z * 0.18 + t * 0.26) * 1.8;\n  /* L2 — medium diagonal ripple (λ ≈ 8 units, T ≈ 11s, 45° bias). */\n  float d2 = sin((x * 0.55 + z * 0.40) + t * 0.57 + 1.2) * 0.9;\n  /* L3 — smooth noise detail (fine silk texture). */\n  float d3 = (silk_noise2(vec2(x * 0.70 + t * 0.32, z * 0.70 + t * 0.24)) - 0.5) * 1.0;\n  return d1 + d2 + d3;\n}\n\nvoid main() {\n  /* Same displacement as silk.vert — identical field, identical time. */\n  float disp = silkDisplacement(position, uTime);\n  vec3 transformed = position;\n  transformed.y += disp;\n\n  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);\n  gl_Position = projectionMatrix * mvPosition;\n\n  vHighPrecisionZW = gl_Position.zw;\n}", rt = "#include <common>\n#include <packing>\n\nvarying vec2 vHighPrecisionZW;\n\nvoid main() {\n  /* Normalised device depth in [0,1], then packed to RGBA (three's MeshDepthMaterial recipe). */\n  float fragCoordZ = 0.5 * vHighPrecisionZW.x / vHighPrecisionZW.y + 0.5;\n  gl_FragColor = packDepthToRGBA(fragCoordZ);\n}", it = new e.Color(.009, .004, .001), at = new e.Color(1, .258, .101), ot = new e.Color(.65, .563, .474);
function st(t, { ink: n = it, gold: r = at, cream: i = ot, shadows: a = !0 } = {}) {
	let o = new e.Scene(), { x: s, y: c } = t.drawBuffer, l = new e.PerspectiveCamera(52, s / c, .1, 500);
	l.position.set(0, 5.5, 13), l.lookAt(0, .5, 0);
	let u = new e.PlaneGeometry(40, 24, 120, 80);
	u.rotateX(-Math.PI / 2);
	let d = new e.ShaderMaterial({
		vertexShader: et,
		fragmentShader: tt,
		lights: !0,
		uniforms: e.UniformsUtils.merge([e.UniformsLib.lights, {
			uTime: { value: 0 },
			uInk: { value: new e.Color().copy(n) },
			uGold: { value: new e.Color().copy(r) },
			uCream: { value: new e.Color().copy(i) },
			uShadow: { value: +!!a }
		}]),
		side: e.FrontSide
	}), f = new e.Mesh(u, d);
	o.add(f);
	let p = null;
	a && (f.castShadow = !0, f.receiveShadow = !0, f.customDepthMaterial = new e.ShaderMaterial({
		vertexShader: nt,
		fragmentShader: rt,
		uniforms: { uTime: { value: 0 } }
	}), p = $e(t, {
		scene: o,
		center: [
			0,
			0,
			0
		],
		radius: 24,
		distance: 46,
		mapSize: 2048,
		bias: -.0016,
		softness: 3.5,
		animatedCaster: !0
	}));
	let m = .2, h = new e.Vector3(), g = Math.cos(m), _ = Math.sin(m);
	function v(e) {
		let t = -.55 + Math.sin(e * .05) * .75;
		h.set(Math.cos(t) * g, _, Math.sin(t) * g), p.setSunDir(h);
	}
	p && v(0);
	function y(e, t) {
		d.uniforms.uTime.value = t, p && (f.customDepthMaterial.uniforms.uTime.value = t, v(t), p.update(), d.uniforms.uShadow.value = p.strength);
	}
	function b() {
		u.dispose(), d.dispose(), p && (f.customDepthMaterial.dispose(), p.dispose()), o.remove(f);
	}
	return {
		scene: o,
		camera: l,
		update: y,
		dispose: b,
		usesBloom: !0,
		tone: "dark"
	};
}
//#endregion
//#region src/shaders/disc-glow.vert
var ct = "uniform float uTime;\n\nattribute float aSize;    \nattribute float aPhase;   \n\nvarying vec2  vUv;\nvarying float vPulse;\n\nvoid main() {\n  vUv = uv;\n\n  /* Twinkle: brightness breathes 0.55 → 1.0, staggered by aPhase so the field\n     never pulses in unison. */\n  vPulse = 0.55 + 0.45 * (0.5 + 0.5 * sin(uTime * 1.5 + aPhase));\n\n  /* Instance centre in view space (instanceMatrix = node translation). */\n  vec3 centerView = (modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;\n\n  /* Quad corner (PlaneGeometry(1,1): position.xy ∈ [-0.5, 0.5]) → camera-facing offset. */\n  vec2 corner = position.xy * aSize;\n\n  gl_Position = projectionMatrix * vec4(centerView + vec3(corner, 0.0), 1.0);\n}", lt = "precision highp float;\n\nuniform vec3 uColor;   \n\nvarying vec2  vUv;\nvarying float vPulse;\n\nvoid main() {\n  /* Distance from disc centre: 0 at centre → 1 at the quad edge. */\n  float d = length(vUv - 0.5) * 2.0;\n\n  /* Two-part glow: a bright tight core + a soft wide halo. Both feather to 0 at\n     the rim so there is no hard sprite edge. */\n  float core = smoothstep(0.35, 0.0, d);\n  float halo = smoothstep(1.0,  0.0, d);\n  halo = pow(halo, 2.0);\n\n  float glow = halo + core * 1.6;          \n  vec3  col  = uColor * glow * vPulse * 1.5;\n\n  gl_FragColor = vec4(col, halo);          \n}", ut = "uniform float uWidth;   \n\nattribute vec3  aEndA;\nattribute vec3  aEndB;\nattribute float aAlong;\nattribute float aSide;\n\nvarying float vAlong;\nvarying float vSide;\n\nvoid main() {\n  vAlong = aAlong;\n  vSide  = aSide;\n\n  /* Endpoints → view space (tracks the group's slow rotation/drift). */\n  vec3 aV = (modelViewMatrix * vec4(aEndA, 1.0)).xyz;\n  vec3 bV = (modelViewMatrix * vec4(aEndB, 1.0)).xyz;\n\n  vec3 baseV = mix(aV, bV, aAlong);\n\n  /* Screen-plane perpendicular of the edge (epsilon guards a degenerate\n     end-on edge where both endpoints project to the same xy). */\n  vec2 dir  = bV.xy - aV.xy;\n  dir = normalize(dir + vec2(1e-6, 0.0));\n  vec2 perp = vec2(-dir.y, dir.x);\n\n  baseV.xy += perp * aSide * uWidth;\n\n  gl_Position = projectionMatrix * vec4(baseV, 1.0);\n}", dt = "precision highp float;\n\nuniform vec3  uColor;   \nuniform float uTime;    \nuniform float uSpeed;   \nuniform float uDash;    \n\nvarying float vAlong;\nvarying float vSide;\n\nvoid main() {\n  /* Across-width feather: soft glow, no hard edge. */\n  float feather = smoothstep(1.0, 0.0, abs(vSide));\n  feather = pow(feather, 1.4);\n\n  /* Flowing comet along the length: a triangle wave peaked in a short window\n     that slides with uTime. tri is 1 at a comet centre, 0 between comets. */\n  float phase = fract(vAlong * uDash - uTime * uSpeed);\n  float tri   = 1.0 - abs(phase - 0.5) * 2.0;\n  float comet = smoothstep(0.55, 1.0, tri);\n\n  /* Base rail glow (dim, always present) + bright moving comet on top. */\n  float bright = 0.35 + 1.9 * comet;\n\n  vec3 col = uColor * feather * bright;\n  gl_FragColor = vec4(col, feather);   \n}";
//#endregion
//#region src/hero/edge-geometry.js
function ft(e, t) {
	let n = e[t];
	if (n && typeof n.x == "number") return [
		n.x,
		n.y,
		n.z
	];
	let r = t * 3;
	return [
		e[r],
		e[r + 1],
		e[r + 2]
	];
}
function pt(e = 1) {
	let t = Math.max(1, Math.floor(e)), n = (t + 1) * 2, r = new Float32Array(n * 3), i = new Float32Array(n), a = new Float32Array(n), o = new Uint32Array(t * 6);
	for (let e = 0; e <= t; e++) {
		let n = e / t, o = e * 2, s = o + 1;
		r[o * 3] = n, r[o * 3 + 1] = 0, r[o * 3 + 2] = 0, r[s * 3] = n, r[s * 3 + 1] = 1, r[s * 3 + 2] = 0, i[o] = n, i[s] = n, a[o] = -1, a[s] = 1;
	}
	for (let e = 0; e < t; e++) {
		let t = e * 2, n = t + 1, r = t + 2, i = t + 3;
		o[e * 6] = t, o[e * 6 + 1] = r, o[e * 6 + 2] = i, o[e * 6 + 3] = t, o[e * 6 + 4] = i, o[e * 6 + 5] = n;
	}
	return {
		position: r,
		aAlong: i,
		aSide: a,
		index: o,
		vertsPerEdge: n
	};
}
function mt({ positions: e, pairs: t }) {
	let n = t.length, r = new Float32Array(n * 3), i = new Float32Array(n * 3);
	for (let a = 0; a < n; a++) {
		let [n, o] = t[a], s = ft(e, n), c = ft(e, o);
		r[a * 3] = s[0], r[a * 3 + 1] = s[1], r[a * 3 + 2] = s[2], i[a * 3] = c[0], i[a * 3 + 1] = c[1], i[a * 3 + 2] = c[2];
	}
	return {
		aEndA: r,
		aEndB: i,
		nEdges: n
	};
}
//#endregion
//#region src/createEdgeField.js
function ht({ positions: t, pairs: n, color: r, width: i = .05, speed: a = .35, dash: o = 2, segments: s = 1, dynamic: c = !1, material: l = null }) {
	let u = pt(s), { aEndA: d, aEndB: f, nEdges: p } = mt({
		positions: t,
		pairs: n
	}), m = new e.InstancedBufferGeometry();
	m.instanceCount = p, m.setAttribute("position", new e.BufferAttribute(u.position, 3)), m.setAttribute("aAlong", new e.BufferAttribute(u.aAlong, 1)), m.setAttribute("aSide", new e.BufferAttribute(u.aSide, 1)), m.setIndex(new e.BufferAttribute(u.index, 1));
	let h = new e.InstancedBufferAttribute(d, 3), g = new e.InstancedBufferAttribute(f, 3);
	c && (h.setUsage(e.DynamicDrawUsage), g.setUsage(e.DynamicDrawUsage)), m.setAttribute("aEndA", h), m.setAttribute("aEndB", g);
	let _ = l || new e.ShaderMaterial({
		vertexShader: ut,
		fragmentShader: dt,
		uniforms: {
			uWidth: { value: i },
			uColor: { value: new e.Color(r) },
			uTime: { value: 0 },
			uSpeed: { value: a },
			uDash: { value: o }
		},
		transparent: !0,
		blending: e.AdditiveBlending,
		depthWrite: !1,
		depthTest: !1
	}), v = new e.Mesh(m, _);
	v.frustumCulled = !1;
	function y(e) {
		_.uniforms.uTime && (_.uniforms.uTime.value = e);
	}
	function b() {
		h.needsUpdate = !0, g.needsUpdate = !0;
	}
	function x() {
		m.dispose(), _.dispose();
	}
	return {
		mesh: v,
		material: _,
		geometry: m,
		endA: h,
		endB: g,
		nEdges: p,
		update: y,
		commitEndpoints: b,
		dispose: x
	};
}
//#endregion
//#region src/hero/createConstellation.js
function gt(e) {
	let t = e >>> 0;
	return function() {
		t |= 0, t = t + 1831565813 | 0;
		let e = Math.imul(t ^ t >>> 15, 1 | t);
		return e = e + Math.imul(e ^ e >>> 7, 61 | e) ^ e, ((e ^ e >>> 14) >>> 0) / 4294967296;
	};
}
var _t = new e.Color(1, .258, .101), vt = new e.Color(328714);
function yt(t, { count: n = 44, seed: r = 24301, spanX: i = 8.5, spanY: a = 5, spanZ: o = 2.6, gold: s = _t, backdrop: c = vt } = {}) {
	let l = new e.Scene();
	l.background = new e.Color().copy(c);
	let { x: u, y: d } = t.drawBuffer, f = new e.PerspectiveCamera(50, u / d, .1, 200);
	f.position.set(0, 0, 14), f.lookAt(0, 0, 0);
	let p = new e.Group();
	l.add(p);
	let m = gt(r), h = new Float32Array(n * 3);
	for (let e = 0; e < n; e++) h[e * 3] = (m() * 2 - 1) * i, h[e * 3 + 1] = (m() * 2 - 1) * a, h[e * 3 + 2] = (m() * 2 - 1) * o;
	let g = new e.PlaneGeometry(1, 1), _ = new Float32Array(n), v = new Float32Array(n);
	for (let e = 0; e < n; e++) _[e] = .32 + m() * .62, v[e] = m() * Math.PI * 2;
	g.setAttribute("aSize", new e.InstancedBufferAttribute(_, 1)), g.setAttribute("aPhase", new e.InstancedBufferAttribute(v, 1));
	let y = new e.ShaderMaterial({
		vertexShader: ct,
		fragmentShader: lt,
		uniforms: {
			uTime: { value: 0 },
			uColor: { value: s.clone() }
		},
		transparent: !0,
		blending: e.AdditiveBlending,
		depthWrite: !1,
		depthTest: !1
	}), b = new e.InstancedMesh(g, y, n);
	b.frustumCulled = !1;
	let x = new e.Matrix4();
	for (let e = 0; e < n; e++) x.makeTranslation(h[e * 3], h[e * 3 + 1], h[e * 3 + 2]), b.setMatrixAt(e, x);
	b.instanceMatrix.needsUpdate = !0, p.add(b);
	let S = [], C = /* @__PURE__ */ new Set();
	for (let e = 0; e < n; e++) {
		let t = -1, r = -1, i = Infinity, a = Infinity;
		for (let o = 0; o < n; o++) {
			if (o === e) continue;
			let n = h[e * 3] - h[o * 3], s = h[e * 3 + 1] - h[o * 3 + 1], c = h[e * 3 + 2] - h[o * 3 + 2], l = n * n + s * s + c * c;
			l < i ? (a = i, r = t, i = l, t = o) : l < a && (a = l, r = o);
		}
		for (let n of [t, r]) {
			if (n < 0) continue;
			let t = e < n ? `${e}_${n}` : `${n}_${e}`;
			C.has(t) || (C.add(t), S.push([e, n]));
		}
	}
	let w = ht({
		positions: h,
		pairs: S,
		color: s.clone(),
		width: .045,
		speed: .28,
		dash: 2
	});
	p.add(w.mesh);
	function T(e, t) {
		p.rotation.y = t * .06, p.rotation.x = Math.sin(t * .04) * .08, y.uniforms.uTime.value = t, w.update(t);
	}
	function E() {
		g.dispose(), y.dispose(), w.dispose(), p.remove(b, w.mesh), l.remove(p);
	}
	return {
		scene: l,
		camera: f,
		update: T,
		dispose: E,
		usesBloom: !0,
		tone: "dark"
	};
}
//#endregion
//#region src/shaders/aurora.vert
var bt = "uniform float uTime;\nuniform float uPhase;   \n\nvarying vec2  vUv;\nvarying float vWave;\n\nvoid main() {\n  vUv = uv;\n  vec3 p = position;\n\n  /* Two horizontal folds at different wavelengths/speeds → organic drape. */\n  float w =\n      sin(p.y * 0.45 + uTime * 0.28 + uPhase)        * 1.30\n    + sin(p.y * 1.20 - uTime * 0.17 + uPhase * 1.7)  * 0.55;\n\n  p.x += w;\n  vWave = w;\n\n  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);\n}", xt = "precision highp float;\n\nuniform float uTime;\nuniform vec3  uColorLow;    \nuniform vec3  uColorHigh;   \nuniform float uPhase;\n\nvarying vec2  vUv;\nvarying float vWave;\n\nvoid main() {\n  /* Vertical envelope: 0 at top & bottom, 1 across the middle band. */\n  float vgrad = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.62, vUv.y);\n\n  /* Horizontal envelope: soft left/right edges so each curtain reads as a\n     distinct vertical light RIBBON, not a hard-edged sheet. */\n  float hgrad = smoothstep(0.0, 0.32, vUv.x) * smoothstep(1.0, 0.68, vUv.x);\n\n  /* Slow vertical shimmer striations, nudged by the curtain's wave. */\n  float shimmer = 0.60 + 0.40 * sin(vUv.x * 9.0 + uTime * 0.7 + uPhase + vWave * 2.2);\n\n  float alpha = vgrad * hgrad * shimmer * 0.72;   \n\n  /* Gold base → cream crown. Cream rises through the upper curtain so the crests\n     read as luminous light (not a red smear), while the base stays warm gold.\n     Brightness capped (peak ≈ 1.5×) — trips bloom on the crests, no blow-out. */\n  vec3 col = mix(uColorLow, uColorHigh, smoothstep(0.15, 1.0, vUv.y)) * alpha * 1.5;\n  gl_FragColor = vec4(col, alpha);\n}", St = new e.Color(1, .258, .101), Ct = new e.Color(.65, .563, .474), wt = new e.Color(262922), Tt = [
	{
		z: -6.5,
		x: -6.4,
		phase: 0,
		w: 3.4,
		h: 15
	},
	{
		z: -5,
		x: -3.6,
		phase: 1.4,
		w: 2.8,
		h: 14
	},
	{
		z: -4,
		x: -1.2,
		phase: 2.7,
		w: 3.2,
		h: 16
	},
	{
		z: -3,
		x: 1.4,
		phase: 3.9,
		w: 2.6,
		h: 14
	},
	{
		z: -4.6,
		x: 3.8,
		phase: 5.1,
		w: 3,
		h: 15
	},
	{
		z: -6,
		x: 6.2,
		phase: .8,
		w: 3.6,
		h: 16
	}
];
function Et(t, { gold: n = St, cream: r = Ct, backdrop: i = wt } = {}) {
	let a = new e.Scene();
	a.background = new e.Color().copy(i);
	let { x: o, y: s } = t.drawBuffer, c = new e.PerspectiveCamera(55, o / s, .1, 200);
	c.position.set(0, .5, 9), c.lookAt(0, .5, 0);
	let l = [], u = [], d = [];
	for (let t of Tt) {
		let i = new e.PlaneGeometry(t.w, t.h, 24, 40), o = new e.ShaderMaterial({
			vertexShader: bt,
			fragmentShader: xt,
			uniforms: {
				uTime: { value: 0 },
				uPhase: { value: t.phase },
				uColorLow: { value: n.clone() },
				uColorHigh: { value: r.clone() }
			},
			transparent: !0,
			blending: e.AdditiveBlending,
			depthWrite: !1,
			depthTest: !1,
			side: e.DoubleSide
		}), s = new e.Mesh(i, o);
		s.position.set(t.x, .5, t.z), s.frustumCulled = !1, a.add(s), l.push(i), u.push(o), d.push(s);
	}
	function f(e, t) {
		for (let e of u) e.uniforms.uTime.value = t;
	}
	function p() {
		for (let e = 0; e < d.length; e++) l[e].dispose(), u[e].dispose(), a.remove(d[e]);
	}
	return {
		scene: a,
		camera: c,
		update: f,
		dispose: p,
		usesBloom: !0,
		tone: "dark",
		buildGroups: d.map((e) => ({
			object: e,
			role: "curtain"
		}))
	};
}
//#endregion
//#region ../../node_modules/three/examples/jsm/environments/RoomEnvironment.js
var Dt = class extends l {
	constructor() {
		super(), this.name = "RoomEnvironment", this.position.y = -3.5;
		let e = new n();
		e.deleteAttribute("uv");
		let a = new o({ side: t }), l = new o(), u = new c(16777215, 900, 28, 2);
		u.position.set(.418, 16.199, .3), this.add(u);
		let d = new i(e, a);
		d.position.set(-.757, 13.219, .717), d.scale.set(31.713, 28.305, 28.591), this.add(d);
		let f = new r(e, l, 6), p = new s();
		p.position.set(-10.906, 2.009, 1.846), p.rotation.set(0, -.195, 0), p.scale.set(2.328, 7.905, 4.651), p.updateMatrix(), f.setMatrixAt(0, p.matrix), p.position.set(-5.607, -.754, -.758), p.rotation.set(0, .994, 0), p.scale.set(1.97, 1.534, 3.955), p.updateMatrix(), f.setMatrixAt(1, p.matrix), p.position.set(6.167, .857, 7.803), p.rotation.set(0, .561, 0), p.scale.set(3.927, 6.285, 3.687), p.updateMatrix(), f.setMatrixAt(2, p.matrix), p.position.set(-2.017, .018, 6.124), p.rotation.set(0, .333, 0), p.scale.set(2.002, 4.566, 2.064), p.updateMatrix(), f.setMatrixAt(3, p.matrix), p.position.set(2.291, -.756, -2.621), p.rotation.set(0, -.286, 0), p.scale.set(1.546, 1.552, 1.496), p.updateMatrix(), f.setMatrixAt(4, p.matrix), p.position.set(-2.193, -.369, -5.547), p.rotation.set(0, .516, 0), p.scale.set(3.875, 3.487, 2.986), p.updateMatrix(), f.setMatrixAt(5, p.matrix), this.add(f);
		let m = new i(e, Ot(50));
		m.position.set(-16.116, 14.37, 8.208), m.scale.set(.1, 2.428, 2.739), this.add(m);
		let h = new i(e, Ot(50));
		h.position.set(-16.109, 18.021, -8.207), h.scale.set(.1, 2.425, 2.751), this.add(h);
		let g = new i(e, Ot(17));
		g.position.set(14.904, 12.198, -1.832), g.scale.set(.15, 4.265, 6.331), this.add(g);
		let _ = new i(e, Ot(43));
		_.position.set(-.462, 8.89, 14.52), _.scale.set(4.38, 5.441, .088), this.add(_);
		let v = new i(e, Ot(20));
		v.position.set(3.235, 11.486, -12.541), v.scale.set(2.5, 2, .1), this.add(v);
		let y = new i(e, Ot(100));
		y.position.set(0, 20, 0), y.scale.set(1, .1, 1), this.add(y);
	}
	dispose() {
		let e = /* @__PURE__ */ new Set();
		this.traverse((t) => {
			t.isMesh && (e.add(t.geometry), e.add(t.material));
		});
		for (let t of e) t.dispose();
	}
};
function Ot(e) {
	return new a({
		color: 0,
		emissive: 16777215,
		emissiveIntensity: e
	});
}
//#endregion
//#region src/hero/createProductMoment.js
var kt = new e.Color("#d8a55e"), At = new e.Color("#d8b98a"), jt = {
	tint: new e.Color(1, .985, .96),
	lift: new e.Color(.01, .006, .003),
	sat: .96,
	contrast: 1.05
};
function Mt(t, { envIntensity: n = 1, metal: r = kt, backdrop: i = At, filmic: a = jt, shadows: o = !0 } = {}) {
	let { renderer: s } = t, c = new e.Scene();
	c.background = new e.Color().copy(i);
	let { x: l, y: u } = t.drawBuffer, d = new e.PerspectiveCamera(38, l / u, .05, 100);
	d.position.set(0, .9, 7.6), d.lookAt(0, 0, 0);
	let f = new e.PMREMGenerator(s), p = new Dt(), m = f.fromScene(p, .04);
	c.environment = m.texture, c.environmentIntensity = n, f.dispose(), p.traverse((e) => {
		e.geometry && e.geometry.dispose(), e.material && e.material.dispose?.();
	});
	let h = 16773858, g = 2.2, _ = new e.Vector3(2.6, 4.2, 2.4), v = null;
	o || (v = new e.DirectionalLight(h, g), v.position.copy(_), c.add(v));
	let y = new e.TorusKnotGeometry(1, .3, 220, 32), b = new e.MeshPhysicalMaterial({
		color: new e.Color().copy(r),
		metalness: 1,
		roughness: .42,
		anisotropy: .4,
		anisotropyRotation: Math.PI * .25,
		envMapIntensity: 1,
		clearcoat: 0
	}), x = new e.Mesh(y, b);
	c.add(x);
	let S = -2.15, C = null, w = null;
	if (o) {
		x.castShadow = !0, x.receiveShadow = !0;
		let n = new e.PlaneGeometry(60, 60);
		n.rotateX(-Math.PI / 2);
		let r = new e.MeshStandardMaterial({
			color: new e.Color().copy(i).multiplyScalar(.62),
			roughness: .95,
			metalness: 0,
			envMapIntensity: .35
		});
		w = new e.Mesh(n, r), w.position.y = S, w.receiveShadow = !0, c.add(w), C = $e(t, {
			scene: c,
			color: h,
			intensity: g,
			center: [
				0,
				S * .5,
				0
			],
			radius: 4,
			distance: 24,
			mapSize: 2048,
			bias: -6e-4,
			normalBias: .03,
			softness: 4,
			animatedCaster: !0
		}), C.setSunDir(_);
	}
	function T(e, t) {
		x.rotation.y = t * .35, x.rotation.x = Math.sin(t * .25) * .12, x.position.y = Math.sin(t * .6) * .14, C && C.update();
	}
	function E() {
		y.dispose(), b.dispose(), m.dispose(), c.environment = null, c.remove(x), v && c.remove(v), w && (w.geometry.dispose(), w.material.dispose(), c.remove(w)), C && C.dispose();
	}
	return {
		scene: c,
		camera: d,
		update: T,
		dispose: E,
		usesBloom: !0,
		tone: "bright",
		filmic: a,
		framing: {
			center: [
				0,
				-.2,
				0
			],
			radius: 1.7
		}
	};
}
//#endregion
//#region src/shaders/starfield.vert
var Nt = "attribute float aSize;\nattribute float aBright;\nattribute float aPhase;\n\nuniform float uTime;       \nuniform float uTwinkle;    \nuniform float uSizeScale;  \n\nvarying float vBright;\n\nvoid main() {\n  \n  float tw = 1.0 - uTwinkle * 0.3 * (0.5 + 0.5 * sin(uTime * 2.2 + aPhase));\n  vBright = aBright * tw;\n  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n  gl_PointSize = aSize * uSizeScale;\n}", Pt = "precision highp float;\n\nuniform vec3  uColor;\nuniform float uNight;\nuniform float uMode;\n\nvarying float vBright;\n\nvoid main() {\n  vec2 p = gl_PointCoord - 0.5;\n  float d = length(p);\n  float a;\n  if (uMode > 1.5)      a = 1.0;                       \n  else if (uMode > 0.5) a = step(d, 0.45);             \n  else                  a = smoothstep(0.5, 0.06, d);  \n  float alpha = a * vBright * uNight;\n  if (alpha < 0.01) discard;\n  gl_FragColor = vec4(uColor, alpha);\n}", Ft = "precision highp float;\n\nattribute vec2 aCorner;\nattribute float aSize;\n\nvarying vec2 vC;   \n\nvoid main() {\n  vC = aCorner;\n  vec4 mv = modelViewMatrix * vec4(position, 1.0);\n  mv.xy += aCorner * aSize;\n  gl_Position = projectionMatrix * mv;\n}", It = "precision highp float;\n\nuniform vec3  uColor;\nuniform float uIntensity;\n\nvarying vec2 vC;   \n\nvoid main() {\n  vec2 c = vC;\n  float core = exp(-dot(c, c) * 160.0);\n  \n  float armH = exp(-c.y * c.y * 2600.0) * exp(-c.x * c.x * 22.0);\n  float armV = exp(-c.x * c.x * 2600.0) * exp(-c.y * c.y * 22.0);\n  float g = core + (armH + armV) * 0.55;\n  gl_FragColor = vec4(uColor, 1.0) * g * uIntensity;   \n}", Lt = "varying vec2 vUv;\n\nvoid main() {\n  vUv = uv;\n  gl_Position = vec4(position.xy * 2.0, 1.0, 1.0);   \n}", Rt = "precision highp float;\n\nuniform float uTime;\nuniform float uDrift;      \n                           \nuniform float uIntensity;  \nuniform vec3  uColorA;     \nuniform vec3  uColorB;     \nuniform vec3  uColorC;     \nuniform vec3  uBg;         \nuniform float uAspect;\nuniform vec2  uPan;\nuniform float uBandMul;   \nuniform float uDustMul;\nuniform float uExtraSmudge;  \n                             \n                             \nuniform float uArt;          \n                             \nuniform float uClearing;     \n                             \n                             \nuniform float uStars;        \n                             \n                             \n                             \n                             \n                             \n                             \nuniform float uStarTwinkle;  \nuniform float uStarShape;    \n                             \n                             \n                             \n                           \n                           \n                           \n\nvarying vec2 vUv;\n\nfloat hash(vec2 p) {\n  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);\n}\n\nfloat vnoise(vec2 p) {\n  vec2 i = floor(p);\n  vec2 f = fract(p);\n  vec2 u = f * f * (3.0 - 2.0 * f);\n  float a = hash(i);\n  float b = hash(i + vec2(1.0, 0.0));\n  float c = hash(i + vec2(0.0, 1.0));\n  float d = hash(i + vec2(1.0, 1.0));\n  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);\n}\n\nvec3 goldRamp(float t) {\n  vec3 c0 = vec3(0.271, 0.157, 0.235);   \n  vec3 c1 = vec3(0.400, 0.224, 0.192);   \n  vec3 c2 = vec3(0.561, 0.337, 0.231);   \n  vec3 c3 = vec3(0.875, 0.443, 0.149);   \n  vec3 c4 = vec3(0.851, 0.627, 0.400);   \n  vec3 c5 = vec3(0.933, 0.765, 0.604);   \n  float s = clamp(t, 0.0, 1.0) * 5.0;\n  vec3 col = mix(c0, c1, clamp(s, 0.0, 1.0));\n  col = mix(col, c2, clamp(s - 1.0, 0.0, 1.0));\n  col = mix(col, c3, clamp(s - 2.0, 0.0, 1.0));\n  col = mix(col, c4, clamp(s - 3.0, 0.0, 1.0));\n  col = mix(col, c5, clamp(s - 4.0, 0.0, 1.0));\n  return col;\n}\n\nvec3 coolRamp(float t) {\n  vec3 c0 = vec3(0.247, 0.247, 0.455);   \n  vec3 c1 = vec3(0.357, 0.431, 0.882);   \n  vec3 c2 = vec3(0.388, 0.608, 1.000);   \n  float s = clamp(t, 0.0, 1.0) * 2.0;\n  vec3 col = mix(c0, c1, clamp(s, 0.0, 1.0));\n  return mix(col, c2, clamp(s - 1.0, 0.0, 1.0));\n}\n\n/* --- SLICE 22: THE PROCEDURAL STARFIELD (screen space, edge-to-edge, endless) ---\n   The trick is the classic one: chop the plane into cells, put at most ONE star in each, and hash the\n   cell to decide where it sits and how bright it is. Because the cells are generated on demand there is\n   no array, no bound, and no edge -- the field is as big as the screen, at any zoom.\n\n   PARALLAX WITHOUT DEPTH: an orthographic camera gives zero real parallax on translation (the slice-9\n   lesson), so depth is FAKED by sampling two layers at different uPan rates -- the near layer slides\n   more than the far one as you pan, and the eye reads the difference as distance.\n\n   THE QUANTIZER RULE (slice 15's star lesson, again): a star must own a whole virtual pixel or the box\n   filter averages it into the background and DB32 rounds it to black. So these are drawn as small SQUARE\n   cores (a smoothstep on the chebyshev distance), not gaussian points -- a square survives. */\nfloat starLayer(vec2 uv, float cells, float density, float bright, float tw) {\n  vec2 gv = uv * cells;\n  vec2 id = floor(gv);\n  vec2 f  = fract(gv) - 0.5;\n  float h = hash(id);\n  if (h > density) return 0.0;                       \n  vec2 off = vec2(hash(id + 3.7) - 0.5, hash(id + 9.1) - 0.5) * 0.7;   \n  vec2 q = f - off;\n  float dSq = max(abs(q.x), abs(q.y));      \n  float dRo = length(q);                     \n  float d = mix(dRo, dSq, uStarShape);\n  /* LOOK-ROUND 2: at 0.10-0.24 of a cell the stars quantized into 8-16px BLOCKS and the sky read as\n     confetti, not distance. A star must be BRIGHT (to clear DB32's black floor) and SMALL (to read as\n     far away) — those pull in opposite directions, and the resolution is: keep the brightness, shrink\n     the core to ~one virtual pixel. Big and bright is snow; small and bright is a star. */\n  float size = 0.035 + 0.05 * hash(id + 17.3);\n  float core = 1.0 - smoothstep(size, size + 0.035, d);\n  float phase = hash(id + 41.7);\n  float t = 1.0 + tw * 0.5 * (sin(uTime * (0.9 + phase * 1.3) + phase * 6.28318)\n                            + sin(uTime * 1.618 + phase * 4.0));\n  return core * bright * (0.45 + 0.55 * hash(id + 5.5)) * clamp(t, 0.0, 2.0);\n}\n\nfloat fbm(vec2 p) {\n  float v = 0.0;\n  float amp = 0.5;\n  for (int i = 0; i < 3; i++) {\n    v += amp * vnoise(p);\n    p *= 2.02;      \n    amp *= 0.5;\n  }\n  return v;\n}\n\n/* cloudField -- ONE billowed noise sample shared by every authored mass (fbm is the expensive part;\n   masks are cheap). billow = 1-|2n-1| squared: ridged peaks read as lit cumulus, not fog. The three\n   gaussian masks are the COMPOSITION -- a diagonal river of cloud sweeping the upper-right corner\n   region, a counter-mass lower-left, a small connector -- authored, deliberately NOT centered. */\nfloat cloudField(vec2 p, float t) {\n  \n  \n  \n  \n  vec2 d = p * 1.5 + vec2(t * 0.004, t * -0.003);\n  float n = fbm(d + fbm(d * 1.25) * 0.38);\n  float billow = 1.0 - abs(2.0 * n - 1.0);\n  billow *= billow;\n  vec2 q1 = p - vec2(0.62, -0.34);   \n  vec2 a1 = vec2(0.803, 0.596);\n  float m1 = exp(-pow(dot(q1, a1), 2.0) * 1.7 - pow(dot(q1, vec2(-a1.y, a1.x)), 2.0) * 8.0);\n  vec2 q2 = p - vec2(-0.68, 0.42);   \n  vec2 a2 = vec2(0.921, 0.390);\n  float m2 = exp(-pow(dot(q2, a2), 2.0) * 2.8 - pow(dot(q2, vec2(-a2.y, a2.x)), 2.0) * 10.5);\n  vec2 q3 = p - vec2(0.05, -0.55);   \n  float m3 = exp(-dot(q3, q3) * 5.5);\n  return (m1 * 1.15 + m2 * 0.8 + m3 * 0.5) * billow;\n}\n\nvoid main() {\n  vec2 p = vUv - 0.5;\n  p.x *= uAspect;                       \n\n  vec2 q = p * 2.6 + vec2(uTime * 0.006 * uDrift, uTime * -0.004 * uDrift);\n  float n = fbm(q + fbm(q * 1.7) * 0.35);   \n\n  \n  \n  \n  vec2 qd1 = p * 6.3 + uPan * 0.55 + vec2(uTime * 0.0022 * uDrift, uTime * 0.0016 * uDrift);\n  vec2 qd2 = p * 10.7 + uPan * 0.25 + vec2(uTime * -0.0013 * uDrift, uTime * 0.0009 * uDrift);\n  float dust = fbm(qd1);\n  dust = dust * dust * dust * 0.35 * uDustMul;\n  float dust2 = fbm(qd2);\n  dust2 = dust2 * dust2 * dust2 * 0.22 * uDustMul;\n\n  \n  \n  \n  vec2 qp = p * 1.15 + uPan * 0.12 + vec2(uTime * 0.003 * uDrift, 0.0);\n  float wisp = smoothstep(0.62, 0.85, fbm(qp)) * 0.5 * uDustMul;\n\n  \n  \n  vec2 ps = p + uPan * 0.08;\n  vec2 g1 = vec2((ps.x - 0.31) * 0.766 + (ps.y - 0.22) * 0.643, (ps.x - 0.31) * -0.643 + (ps.y - 0.22) * 0.766);\n  float sm1 = exp(-(g1.x * g1.x * 90.0 + g1.y * g1.y * 900.0)) * (0.7 + 0.3 * fbm(g1 * 24.0));\n  vec2 g2 = vec2((ps.x + 0.36) * 0.5 - (ps.y + 0.27) * 0.866, (ps.x + 0.36) * 0.866 + (ps.y + 0.27) * 0.5);\n  float sm2 = exp(-(g2.x * g2.x * 140.0 + g2.y * g2.y * 1200.0)) * (0.7 + 0.3 * fbm(g2 * 24.0));\n  float smudge = (sm1 + sm2) * 0.55;\n  \n  \n  vec2 g3 = vec2((ps.x + 0.42) * 0.906 + (ps.y - 0.30) * 0.423, (ps.x + 0.42) * -0.423 + (ps.y - 0.30) * 0.906);\n  float sm3 = exp(-(g3.x * g3.x * 60.0 + g3.y * g3.y * 520.0)) * (0.7 + 0.3 * fbm(g3 * 18.0));\n  vec2 g4 = vec2((ps.x - 0.44) * 0.259 - (ps.y + 0.33) * 0.966, (ps.x - 0.44) * 0.966 + (ps.y + 0.33) * 0.259);\n  float sm4 = exp(-(g4.x * g4.x * 170.0 + g4.y * g4.y * 1500.0)) * (0.7 + 0.3 * fbm(g4 * 24.0));\n  smudge += (sm3 * 0.7 + sm4 * 0.5) * uExtraSmudge;\n\n  \n  \n  \n  \n  float bandY = p.x * -0.342 + p.y * 0.940;      \n  float band  = exp(-bandY * bandY * 18.0);\n  float boost = 1.0 + band * 1.2 * uBandMul;\n\n  /* THE PROCEDURAL FIELD (slice 22): three layers at different cell sizes and parallax rates -- far\n     (dense, faint, barely moves), mid, and a sparse bright foreground. Sampled in the SCREEN-SPACE uv,\n     so it fills the frame corner to corner no matter where the camera is or how far it is zoomed out. */\n  vec3 stars = vec3(0.0);\n  if (uStars > 0.0) {\n    vec2 sp = p;\n    /* LOOK-ROUND 1 (measured, not guessed): at 26 cells across the frame, a screen CORNER contains ~2\n       cells — at 16% occupancy that is 0.3 expected stars, so corners came up EMPTY (max luminance 18)\n       and the \"full-bleed\" sky still had holes. Finer cells + higher occupancy make coverage a\n       certainty rather than a coin flip: the far layer now lays ~45 cells across at 30%. */\n    float far  = starLayer(sp + uPan * 0.05, 46.0, 0.22, 0.50, uStarTwinkle * 0.5);\n    float mid  = starLayer(sp + uPan * 0.14, 27.0, 0.13, 0.80, uStarTwinkle);\n    float near = starLayer(sp + uPan * 0.30, 13.0, 0.06, 1.15, uStarTwinkle);\n    float s = (far + mid + near) * uStars;\n    \n    stars = mix(vec3(0.796, 0.859, 0.988), vec3(0.933, 0.765, 0.604), step(0.82, hash(floor(sp * 15.0)))) * s;\n  }\n\n  \n  float r   = length(p);\n  float vig = 1.0 - smoothstep(0.15, 0.95, r);\n\n  \n  \n  \n  float clearing = 1.0 - uClearing * (1.0 - smoothstep(0.14, 0.62, r));\n\n  \n  \n  \n  \n  \n  vec3 gold = vec3(0.0);\n  vec3 cool = vec3(0.0);\n  if (uArt > 0.0) {\n    float artVig = 1.0 - smoothstep(0.85, 1.3, r);\n    vec2 L = vec2(-0.55, 0.835);\n    float cd  = cloudField(p, uTime * uDrift);\n    float cdL = cloudField(p + L * 0.05, uTime * uDrift);\n    float rim = clamp((cd - cdL) * 2.4, -0.3, 1.0);\n    \n    \n    \n    float shade = clamp(cd * 0.8 + rim * 0.4, 0.0, 1.0);\n    gold = goldRamp(shade) * smoothstep(0.16, 0.72, cd) * artVig * 0.62;\n    \n    \n    vec2 w1 = p - vec2(-0.72, -0.30);\n    vec2 w2 = p - vec2(0.55, 0.48);\n    float wd = (exp(-dot(w1, w1) * 9.0) * 0.9 + exp(-dot(w2, w2) * 12.0) * 0.7)\n             * (1.0 - abs(2.0 * fbm(p * 3.4 + vec2(17.3, 9.1) + uPan * 0.2) - 1.0));\n    \n    \n    cool = coolRamp(clamp(wd * 0.9, 0.0, 1.0)) * smoothstep(0.22, 0.75, wd) * artVig * 0.4;\n    cool += vec3(0.843, 0.482, 0.729) * exp(-dot(w2, w2) * 16.0) * wd * 0.12 * artVig;\n  }\n\n  \n  \n  \n  \n  float artOwn = 1.0 - clamp((gold.r + gold.g + cool.b) * 1.8, 0.0, 0.95) * step(0.001, uArt);   \n  vec3 neb = mix(uColorA, uColorB, n);\n  vec3 col = uBg\n           + (neb * (n * n) * uIntensity * boost * vig * artOwn            \n           + uColorB * dust  * uIntensity * boost * vig * artOwn           \n           + mix(uColorB, uColorC, 0.5) * dust2 * uIntensity * boost * vig * artOwn \n           + mix(uColorB, uColorC, 0.7) * wisp * uIntensity * 1.6 * vig * artOwn   \n           + mix(uColorC, vec3(1.0), 0.35) * smudge * uIntensity * 1.8 * vig * artOwn \n           + (gold + cool) * uArt                                          \n           + stars                                                          \n           ) * clearing;                                                    \n\n  gl_FragColor = vec4(col, 1.0);\n}";
//#endregion
//#region src/hero/createObservatory.js
function zt(e) {
	let t = e >>> 0;
	return function() {
		t |= 0, t = t + 1831565813 | 0;
		let e = Math.imul(t ^ t >>> 15, 1 | t);
		return e = e + Math.imul(e ^ e >>> 7, 61 | e) ^ e, ((e ^ e >>> 14) >>> 0) / 4294967296;
	};
}
var Bt = new e.Color(.62, .72, 1), Vt = new e.Color(.86, .92, 1), Ht = new e.Color(527132), Ut = new e.Color(2768762), Wt = new e.Color(1924206);
function Gt(t, { count: n = 3400, glints: r = 14, seed: i = 677860, radius: a = 62, band: o = .55, nebula: s = 1.15, star: c = Bt, glow: l = Vt, backdrop: u = Ht, haze: d = Ut, hazeAlt: f = Wt } = {}) {
	let p = new e.Scene();
	p.background = new e.Color().copy(u);
	let { x: m, y: h } = t.drawBuffer, g = new e.PerspectiveCamera(52, m / h, .1, 400);
	g.position.set(0, 0, .001), g.lookAt(0, 0, -1);
	let _ = new e.ShaderMaterial({
		vertexShader: Lt,
		fragmentShader: Rt,
		depthTest: !1,
		depthWrite: !1,
		uniforms: {
			uTime: { value: 0 },
			uDrift: { value: 1 },
			uIntensity: { value: s },
			uColorA: { value: new e.Color().copy(u) },
			uColorB: { value: new e.Color().copy(d) },
			uColorC: { value: new e.Color().copy(f) },
			uBg: { value: new e.Color().copy(u) },
			uAspect: { value: m / h },
			uPan: { value: new e.Vector2() },
			uBandMul: { value: 1 },
			uDustMul: { value: 1 }
		}
	}), v = new e.Mesh(new e.PlaneGeometry(1, 1), _);
	v.frustumCulled = !1, v.renderOrder = -10, p.add(v);
	let y = new e.Group();
	p.add(y);
	let b = zt(i), x = new Float32Array(n * 3), S = new Float32Array(n), C = new Float32Array(n), w = new Float32Array(n);
	for (let e = 0; e < n; e++) {
		let t = b() * Math.PI * 2, n = b() * 2 - 1, r = n * (1 - o) + n * Math.abs(n) * o * .35, i = Math.sqrt(Math.max(0, 1 - r * r)), s = a * (.82 + b() * .18);
		x[e * 3] = Math.cos(t) * i * s, x[e * 3 + 1] = r * s, x[e * 3 + 2] = Math.sin(t) * i * s;
		let c = b() ** 2.2;
		S[e] = 1.1 + c * 3.4, C[e] = .22 + c * .78, w[e] = b() * Math.PI * 2;
	}
	let T = new e.BufferGeometry();
	T.setAttribute("position", new e.BufferAttribute(x, 3)), T.setAttribute("aSize", new e.BufferAttribute(S, 1)), T.setAttribute("aBright", new e.BufferAttribute(C, 1)), T.setAttribute("aPhase", new e.BufferAttribute(w, 1));
	let E = new e.ShaderMaterial({
		vertexShader: Nt,
		fragmentShader: Pt,
		uniforms: {
			uTime: { value: 0 },
			uTwinkle: { value: 1 },
			uSizeScale: { value: 1.7 },
			uColor: { value: c.clone() },
			uNight: { value: 1 },
			uMode: { value: 0 }
		},
		transparent: !0,
		blending: e.AdditiveBlending,
		depthWrite: !1,
		depthTest: !1
	}), D = new e.Points(T, E);
	D.frustumCulled = !1, y.add(D);
	let O = new Float32Array(r * 4 * 3), k = new Float32Array(r * 4 * 2), A = new Float32Array(r * 4), j = new Uint16Array(r * 6), M = [
		[-.5, -.5],
		[.5, -.5],
		[.5, .5],
		[-.5, .5]
	];
	for (let e = 0; e < r; e++) {
		let t = b() * Math.PI * 2, n = (b() * 2 - 1) * .42, r = Math.sqrt(Math.max(0, 1 - n * n)), i = a * .9, o = Math.cos(t) * r * i, s = n * i, c = Math.sin(t) * r * i, l = 2.6 + b() * 1.8;
		for (let t = 0; t < 4; t++) {
			let n = e * 4 + t;
			O[n * 3] = o, O[n * 3 + 1] = s, O[n * 3 + 2] = c, k[n * 2] = M[t][0], k[n * 2 + 1] = M[t][1], A[n] = l;
		}
		let u = e * 4, d = e * 6;
		j[d] = u, j[d + 1] = u + 1, j[d + 2] = u + 2, j[d + 3] = u, j[d + 4] = u + 2, j[d + 5] = u + 3;
	}
	let N = new e.BufferGeometry();
	N.setAttribute("position", new e.BufferAttribute(O, 3)), N.setAttribute("aCorner", new e.BufferAttribute(k, 2)), N.setAttribute("aSize", new e.BufferAttribute(A, 1)), N.setIndex(new e.BufferAttribute(j, 1));
	let P = new e.ShaderMaterial({
		vertexShader: Ft,
		fragmentShader: It,
		uniforms: {
			uColor: { value: l.clone() },
			uIntensity: { value: 1.7 }
		},
		transparent: !0,
		blending: e.AdditiveBlending,
		depthWrite: !1,
		depthTest: !1
	}), F = new e.Mesh(N, P);
	F.frustumCulled = !1, y.add(F);
	function I(e, n) {
		y.rotation.y = n * .0115, y.rotation.x = Math.sin(n * .021) * .045, E.uniforms.uTime.value = n, _.uniforms.uTime.value = n, _.uniforms.uAspect.value = t.drawBuffer.x / t.drawBuffer.y;
	}
	function L() {
		T.dispose(), E.dispose(), N.dispose(), P.dispose(), v.geometry.dispose(), _.dispose(), y.remove(D, F), p.remove(y, v);
	}
	return {
		scene: p,
		camera: g,
		update: I,
		dispose: L,
		usesBloom: !0,
		tone: "dark"
	};
}
//#endregion
//#region src/shaders/pixel-morph.frag
var Kt = "precision highp float;\n\nvarying vec2 vUv;\n\nuniform sampler2D uRaw;    \nuniform sampler2D uPix;    \nuniform float     uMorph;  \n\nvoid main() {\n  vec3 raw = texture2D(uRaw, vUv).rgb;\n  vec3 pix = texture2D(uPix, vUv).rgb;\n  gl_FragColor = vec4(mix(raw, pix, uMorph), 1.0);\n}", qt = new e.Color(.85, .55, .18), Jt = new e.Color(1, .78, .42), Yt = new e.Color(.35, .62, 1), Xt = new e.Color(722708), Zt = {
	sat: 1,
	contrast: 1
}, Qt = 5, $t = 3, en = 16, tn = (e) => e * e * (3 - 2 * e);
function nn(e) {
	let t = (e % en + en) % en;
	return t < Qt ? 0 : t < 8 ? tn((t - Qt) / $t) : t < 13 ? 1 : 1 - tn((t - Qt - $t - Qt) / $t);
}
function rn(t, { era: n = "16-bit", palette: r = oe["warm (sunset)"], solid: i = qt, key: a = Jt, rim: o = Yt, backdrop: s = Xt, detail: c = 0, filmic: l = Zt } = {}) {
	let { renderer: u, drawBuffer: d, runPass: f } = t, p = q[n] ?? q["16-bit"], m = new e.Scene();
	m.background = new e.Color().copy(s);
	let h = new e.PerspectiveCamera(45, d.x / d.y, .1, 100);
	h.position.set(0, 0, 9), h.lookAt(0, 0, 0);
	let g = new e.IcosahedronGeometry(2.6, c), _ = new e.MeshStandardMaterial({
		color: i.clone(),
		flatShading: !0,
		metalness: .1,
		roughness: .45,
		emissive: i.clone().multiplyScalar(.06)
	}), v = new e.Mesh(g, _);
	m.add(v);
	let y = new e.DirectionalLight(a.clone(), 3.2);
	y.position.set(4, 5, 6);
	let b = new e.DirectionalLight(o.clone(), 2.4);
	b.position.set(-6, -1, -4);
	let x = new e.AmbientLight(16777215, .18);
	m.add(y, b, x);
	let S = new e.WebGLRenderTarget(d.x, d.y, {
		minFilter: e.LinearFilter,
		magFilter: e.LinearFilter,
		type: e.HalfFloatType,
		depthBuffer: !0,
		stencilBuffer: !1
	}), C = new e.WebGLRenderTarget(d.x, d.y, {
		minFilter: e.NearestFilter,
		magFilter: e.NearestFilter,
		depthBuffer: !1,
		stencilBuffer: !1
	}), w = se(r), T = new e.ShaderMaterial({
		vertexShader: J,
		fragmentShader: ge,
		uniforms: {
			uScene: { value: S.texture },
			uResolution: { value: new e.Vector2(d.x, d.y) },
			uGridWidth: { value: p.gridWidth },
			uDither: { value: p.dither },
			uPalette: { value: w },
			uPaletteSize: { value: r.length },
			uUsePalette: { value: 1 }
		}
	}), E = new e.Scene(), D = new e.OrthographicCamera(-1, 1, 1, -1, 0, 1), O = new e.ShaderMaterial({
		vertexShader: J,
		fragmentShader: Kt,
		uniforms: {
			uRaw: { value: S.texture },
			uPix: { value: C.texture },
			uMorph: { value: 0 }
		},
		depthTest: !1,
		depthWrite: !1
	}), k = new e.PlaneGeometry(2, 2), A = new e.Mesh(k, O);
	A.frustumCulled = !1, E.add(A);
	let j = d.x, M = d.y;
	function N() {
		let e = d.x, t = d.y;
		e === j && t === M || (j = e, M = t, S.setSize(e, t), C.setSize(e, t), T.uniforms.uResolution.value.set(e, t), h.aspect = e / t, h.updateProjectionMatrix());
	}
	function P(e, t) {
		N(), v.rotation.y = t * .28, v.rotation.x = Math.sin(t * .19) * .35;
		let n = nn(t);
		O.uniforms.uMorph.value = n, T.uniforms.uGridWidth.value = 460 - (460 - p.gridWidth) * n, u.setRenderTarget(S), u.render(m, h), f(T, C);
	}
	function F() {
		S.dispose(), C.dispose(), w.dispose(), T.dispose(), O.dispose(), k.dispose(), g.dispose(), _.dispose(), m.remove(v, y, b, x), E.remove(A);
	}
	return {
		scene: E,
		camera: D,
		update: P,
		dispose: F,
		usesBloom: !0,
		tone: "dark",
		filmic: l
	};
}
//#endregion
//#region src/hero/createMaterialStudy.js
var an = new e.Color("#aebecb"), on = new e.Color("#d8a55e"), sn = new e.Color("#dff0f4"), cn = new e.Color("#f2ece0"), ln = 5, un = 3, dn = 8, fn = dn * 3, pn = (e) => e * e * (3 - 2 * e), mn = [
	{
		metalness: 1,
		roughness: .24,
		opacity: 1,
		clearcoat: 1e-4,
		ior: 1.5,
		env: 1
	},
	{
		metalness: 0,
		roughness: .06,
		opacity: .34,
		clearcoat: 1,
		ior: 1.5,
		env: 1.7
	},
	{
		metalness: 0,
		roughness: .62,
		opacity: 1,
		clearcoat: .85,
		ior: 1.4,
		env: .9
	}
], hn = {
	tint: new e.Color(1, .88, .85),
	lift: new e.Color(.012, .006, .006),
	sat: 1.06,
	contrast: 1.05
};
function gn(t, { backdrop: n = an, metal: r = on, glass: i = sn, ceramic: a = cn, envIntensity: o = 1, filmic: s = hn } = {}) {
	let { renderer: c } = t, l = new e.Scene();
	l.background = new e.Color().copy(n);
	let { x: u, y: d } = t.drawBuffer, f = new e.PerspectiveCamera(40, u / d, .05, 100);
	f.position.set(0, .5, 7), f.lookAt(0, 0, 0);
	let p = new e.PMREMGenerator(c), m = new Dt(), h = p.fromScene(m, .04);
	l.environment = h.texture, l.environmentIntensity = o, p.dispose(), m.traverse((e) => {
		e.geometry && e.geometry.dispose(), e.material && e.material.dispose?.();
	});
	let g = new e.DirectionalLight(16774376, 2);
	g.position.set(2.2, 3.8, 3), l.add(g);
	let _ = new e.TorusKnotGeometry(1.05, .32, 240, 40, 3, 5), v = new e.MeshPhysicalMaterial({
		color: new e.Color().copy(r),
		metalness: mn[0].metalness,
		roughness: mn[0].roughness,
		clearcoat: mn[0].clearcoat,
		ior: mn[0].ior,
		envMapIntensity: mn[0].env,
		transparent: !0,
		opacity: mn[0].opacity,
		depthWrite: !0
	}), y = new e.Mesh(_, v);
	l.add(y);
	let b = [
		new e.Color().copy(r),
		new e.Color().copy(i),
		new e.Color().copy(a)
	];
	function x(e, t) {
		y.rotation.y = t * .3, y.rotation.x = Math.sin(t * .22) * .14;
		let n = (t % fn + fn) % fn, r = Math.floor(n / dn), i = n - r * dn, a = i <= ln ? 0 : pn((i - ln) / un), o = mn[r], s = mn[(r + 1) % 3];
		v.metalness = o.metalness + (s.metalness - o.metalness) * a, v.roughness = o.roughness + (s.roughness - o.roughness) * a, v.opacity = o.opacity + (s.opacity - o.opacity) * a, v.clearcoat = o.clearcoat + (s.clearcoat - o.clearcoat) * a, v.ior = o.ior + (s.ior - o.ior) * a, v.envMapIntensity = o.env + (s.env - o.env) * a, v.color.copy(b[r]).lerp(b[(r + 1) % 3], a);
	}
	function S() {
		_.dispose(), v.dispose(), h.dispose(), l.environment = null, l.remove(y, g);
	}
	return {
		scene: l,
		camera: f,
		update: x,
		dispose: S,
		usesBloom: !0,
		tone: "bright",
		filmic: s,
		buildGroups: [{
			object: y,
			role: "hero"
		}]
	};
}
//#endregion
//#region src/shaders/edge-ink.frag
var _n = "precision highp float;\n\nuniform vec3  uColor;   \nuniform float uTime;    \nuniform float uSpeed;   \nuniform float uDash;    \nuniform float uFlow;    \n\nvarying float vAlong;\nvarying float vSide;\n\nvoid main() {\n  /* Across-width feather — but TIGHTER than edge-flow's glow: a drawn line has a crisp\n     core and only a hair of softness at the rim (that hair is the anti-alias). A wide\n     feather here would read as an airbrush, not a pen. */\n  float feather = smoothstep(1.0, 0.55, abs(vSide));\n\n  /* The draw-on pulse: a slow bright-DARK wave along the length. It modulates OPACITY,\n     never luminance — the ink can get denser, never lighter than the page. */\n  float phase = fract(vAlong * uDash - uTime * uSpeed);\n  float tri   = 1.0 - abs(phase - 0.5) * 2.0;\n  float pulse = smoothstep(0.35, 1.0, tri);\n\n  float ink = feather * (0.62 + uFlow * 0.38 * pulse);\n\n  /* Alpha-blended: the fragment IS the ink colour; alpha decides how much page shows\n     through. (Additive would do the opposite and wash the page out.) */\n  gl_FragColor = vec4(uColor, ink);\n}", vn = new e.Color("#e8e0cd"), yn = new e.Color("#16233d"), bn = new e.Color("#8c3b2e"), xn = {
	tint: new e.Color(.96, .92, .86),
	lift: new e.Color(0, 0, 0),
	sat: .94,
	contrast: 1.22
};
function Sn(t, { detail: n = 1, radius: r = 3.1, paper: i = vn, ink: a = yn, node: o = bn, width: s = .022, flow: c = 1, filmic: l = xn } = {}) {
	let u = new e.Scene();
	u.background = new e.Color().copy(i);
	let { x: d, y: f } = t.drawBuffer, p = new e.PerspectiveCamera(46, d / f, .1, 100);
	p.position.set(0, 0, 10.5), p.lookAt(0, 0, 0);
	let m = new e.Group();
	u.add(m);
	let h = new e.IcosahedronGeometry(r, n), g = h.getAttribute("position"), _ = (e) => `${g.getX(e).toFixed(3)}_${g.getY(e).toFixed(3)}_${g.getZ(e).toFixed(3)}`, v = /* @__PURE__ */ new Map(), y = [], b = (e) => {
		let t = _(e), n = v.get(t);
		return n === void 0 && (n = y.length, v.set(t, n), y.push([
			g.getX(e),
			g.getY(e),
			g.getZ(e)
		])), n;
	}, x = /* @__PURE__ */ new Set(), S = [];
	for (let e = 0; e < g.count; e += 3) {
		let t = b(e), n = b(e + 1), r = b(e + 2);
		for (let [e, i] of [
			[t, n],
			[n, r],
			[r, t]
		]) {
			let t = e < i ? `${e}_${i}` : `${i}_${e}`;
			x.has(t) || (x.add(t), S.push([e, i]));
		}
	}
	h.dispose();
	let C = new Float32Array(y.length * 3);
	y.forEach((e, t) => {
		C[t * 3] = e[0], C[t * 3 + 1] = e[1], C[t * 3 + 2] = e[2];
	});
	let w = ht({
		positions: C,
		pairs: S,
		color: a,
		width: s,
		material: new e.ShaderMaterial({
			vertexShader: ut,
			fragmentShader: _n,
			uniforms: {
				uWidth: { value: s },
				uColor: { value: new e.Color().copy(a) },
				uTime: { value: 0 },
				uSpeed: { value: .11 },
				uDash: { value: 1 },
				uFlow: { value: c }
			},
			transparent: !0,
			blending: e.NormalBlending,
			depthWrite: !1,
			depthTest: !1
		})
	});
	m.add(w.mesh);
	let T = new e.SphereGeometry(.075, 10, 8), E = new e.MeshBasicMaterial({ color: new e.Color().copy(o) }), D = new e.InstancedMesh(T, E, y.length);
	D.frustumCulled = !1;
	let O = new e.Matrix4();
	for (let e = 0; e < y.length; e++) O.makeTranslation(C[e * 3], C[e * 3 + 1], C[e * 3 + 2]), D.setMatrixAt(e, O);
	D.instanceMatrix.needsUpdate = !0, m.add(D);
	function k(e, t) {
		m.rotation.y = t * .16, m.rotation.x = .28 + Math.sin(t * .09) * .1, w.update(t);
	}
	function A() {
		w.dispose(), T.dispose(), E.dispose(), m.remove(w.mesh, D), u.remove(m);
	}
	return {
		scene: u,
		camera: p,
		update: k,
		dispose: A,
		usesBloom: !1,
		tone: "bright",
		filmic: l
	};
}
//#endregion
//#region src/shaders/liquid-metal.frag
var Cn = "precision highp float;\n\nvarying vec2 vUv;\n\nuniform float uTime;\nuniform vec2  uRes;      \nuniform vec3  uTint;     \nuniform vec3  uBgTop;    \nuniform vec3  uBgBot;\nuniform float uBlobs;    \n\nconst int   STEPS   = 64;      \nconst float MAX_D   = 14.0;    \nconst float HIT_D   = 0.0022;  \nconst float BOUND_R = 3.4;     \n\n/* Smooth minimum (polynomial, iq). k controls how wide the merge is: the bigger k, the more the two\n   surfaces \"reach\" for each other before they touch. This is the mercury. */\nfloat smin(float a, float b, float k) {\n  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);\n  return mix(b, a, h) - k * h * (1.0 - h);\n}\n\n/* THE SCENE, as a function. Six drifting spheres, smooth-min'd into one body.\n   Each blob rides its own slow Lissajous path, so the cluster never repeats and never quite settles. */\nfloat sdf(vec3 p) {\n  float t = uTime * 0.35;\n\n  vec3 c0 = vec3(sin(t * 0.9) * 0.75, cos(t * 0.7) * 0.60, sin(t * 0.5) * 0.5);\n  float d = length(p - c0) - 1.20;\n\n  vec3 c1 = vec3(cos(t * 0.6) * 0.95, sin(t * 1.1) * 0.70, cos(t * 0.8) * 0.45);\n  d = smin(d, length(p - c1) - 1.00, 0.75);\n\n  vec3 c2 = vec3(sin(t * 1.3 + 2.0) * 0.85, cos(t * 0.5 + 1.0) * 0.85, sin(t * 0.9) * 0.6);\n  d = smin(d, length(p - c2) - 0.90, 0.75);\n\n  if (uBlobs > 3.5) {\n    vec3 c3 = vec3(cos(t * 0.8 + 4.0) * 1.05, sin(t * 0.6 + 3.0) * 0.55, cos(t * 1.2) * 0.55);\n    d = smin(d, length(p - c3) - 0.80, 0.70);\n  }\n  if (uBlobs > 4.5) {\n    vec3 c4 = vec3(sin(t * 0.4 + 1.5) * 0.65, cos(t * 1.0 + 2.5) * 0.95, sin(t * 0.7 + 1.0) * 0.7);\n    d = smin(d, length(p - c4) - 0.72, 0.68);\n  }\n  if (uBlobs > 5.5) {\n    vec3 c5 = vec3(cos(t * 1.1 + 0.5) * 0.70, sin(t * 0.9 + 4.5) * 0.70, cos(t * 0.6 + 2.0) * 0.8);\n    d = smin(d, length(p - c5) - 0.68, 0.68);\n  }\n  return d;\n}\n\n/* Normal by gradient — the 4-tap tetrahedron form: 4 SDF evaluations instead of the naive 6. */\nvec3 normalAt(vec3 p) {\n  const vec2 k = vec2(1.0, -1.0);\n  const float h = 0.0015;\n  return normalize(k.xyy * sdf(p + k.xyy * h) +\n                   k.yyx * sdf(p + k.yyx * h) +\n                   k.yxy * sdf(p + k.yxy * h) +\n                   k.xxx * sdf(p + k.xxx * h));\n}\n\n/* THE STUDIO THE METAL REFLECTS — and it is the difference between chrome and rubber.\n   Metal has no colour of its own: it is a mirror with a tint. So the ONLY thing that makes a blob look\n   metallic is what it reflects. The first cut of this function was a soft gradient, and the blobs came\n   out looking like matte blue putty — a smooth reflection of a smooth nothing is indistinguishable from\n   diffuse shading. A mirror needs something with EDGES to mirror.\n   So this is a real (if cheap) studio: a HARD HORIZON, a bright overhead softbox, a dark floor, and a\n   couple of soft kickers. When those slide across a curved surface you read \"polished\", instantly. */\nvec3 env(vec3 rd) {\n  /* Hard horizon — the single most important line in this shader. */\n  float h = smoothstep(-0.015, 0.015, rd.y);\n  vec3 floorC = uBgBot * 0.55;\n  vec3 skyC   = mix(uBgTop * 1.35, uBgTop * 0.45, smoothstep(0.0, 0.9, rd.y));\n  vec3 c = mix(floorC, skyC, h);\n\n  /* The softbox: a bright, sharply-bounded overhead panel — this is the highlight that slides. */\n  float box = smoothstep(0.42, 0.60, rd.y) * (1.0 - smoothstep(0.86, 0.99, rd.y));\n  c += vec3(1.00, 0.98, 0.95) * box * 2.6;\n\n  /* A bright strip just above the horizon: the classic chrome \"waistline\" reflection. */\n  c += vec3(0.85, 0.90, 1.00) * smoothstep(0.10, 0.02, abs(rd.y - 0.06)) * 0.55;\n\n  /* Cool kickers at the sides so the silhouette edges stay alive against the backdrop. */\n  c += vec3(0.30, 0.42, 0.62) * smoothstep(0.62, 1.0, abs(rd.x)) * 0.45;\n  return c;\n}\n\nvoid main() {\n  /* Build the camera ray for this pixel. */\n  vec2 uv = (vUv * 2.0 - 1.0);\n  uv.x *= uRes.x / max(uRes.y, 1.0);\n\n  vec3 ro = vec3(0.0, 0.0, 6.2);                  \n  vec3 rd = normalize(vec3(uv * 0.62, -1.0));     \n\n  vec3 bg = mix(uBgBot, uBgTop, vUv.y);\n\n  /* BOUNDING-SPHERE REJECT — the big perf win. Solve the ray/sphere intersection first; if the ray\n     misses the volume the blobs live in, there is nothing to march and we bail immediately. Most of a\n     typical frame is background, so most pixels take this path and never enter the loop at all. */\n  float b = dot(ro, rd);\n  float c = dot(ro, ro) - BOUND_R * BOUND_R;\n  float disc = b * b - c;\n  if (disc < 0.0) { gl_FragColor = vec4(bg, 1.0); return; }\n\n  float tEnter = max(-b - sqrt(disc), 0.0);       \n  float tExit  = min(-b + sqrt(disc), MAX_D);\n\n  /* SPHERE-TRACE. */\n  float t = tEnter;\n  bool hit = false;\n  for (int i = 0; i < STEPS; i++) {\n    vec3 p = ro + rd * t;\n    float d = sdf(p);\n    if (d < HIT_D) { hit = true; break; }         \n    t += d;                                        \n    if (t > tExit) break;                          \n  }\n\n  if (!hit) { gl_FragColor = vec4(bg, 1.0); return; }\n\n  vec3 p = ro + rd * t;\n  vec3 n = normalAt(p);\n\n  /* METAL: it's a mirror with a tint. Reflect the view ray and look up the environment; multiply by\n     the metal's colour (that IS what \"metallic\" means — the reflection takes the metal's hue). The\n     Fresnel term brightens grazing angles toward white, which is what stops it reading as plastic. */\n  vec3 refl = reflect(rd, n);\n  vec3 base = env(refl) * uTint;\n\n  float fres = pow(1.0 - max(dot(n, -rd), 0.0), 4.0);\n  vec3 col = mix(base, env(refl) * 1.15, fres * 0.75);\n\n  /* A tight specular from the overhead band, so the blobs get a liquid highlight that slides as they move. */\n  vec3 lightDir = normalize(vec3(0.35, 0.9, 0.35));\n  float spec = pow(max(dot(refl, lightDir), 0.0), 48.0);\n  col += vec3(1.0, 0.98, 0.94) * spec * 1.6;\n\n  /* Fade the far edge of the body into the backdrop so the silhouette doesn't cut like a sticker. */\n  float edge = smoothstep(MAX_D * 0.75, MAX_D, t);\n  col = mix(col, bg, edge);\n\n  gl_FragColor = vec4(col, 1.0);\n}", wn = "precision highp float;\n\nvarying vec2 vUv;\nuniform sampler2D uTex;\n\nvoid main() {\n  gl_FragColor = vec4(texture2D(uTex, vUv).rgb, 1.0);\n}", Tn = new e.Color(.82, .84, .9), En = new e.Color(.17, .18, .205), Dn = new e.Color(.03, .032, .042);
function On(t, { scale: n = .5, blobs: r = 6, tint: i = Tn, bgTop: a = En, bgBot: o = Dn } = {}) {
	let { drawBuffer: s, runPass: c } = t, l = () => Math.max(1, Math.floor(s.x * n)), u = () => Math.max(1, Math.floor(s.y * n)), d = new e.WebGLRenderTarget(l(), u(), {
		minFilter: e.LinearFilter,
		magFilter: e.LinearFilter,
		depthBuffer: !1,
		stencilBuffer: !1,
		type: e.HalfFloatType
	}), f = new e.ShaderMaterial({
		vertexShader: J,
		fragmentShader: Cn,
		uniforms: {
			uTime: { value: 0 },
			uRes: { value: new e.Vector2(l(), u()) },
			uTint: { value: new e.Color().copy(i) },
			uBgTop: { value: new e.Color().copy(a) },
			uBgBot: { value: new e.Color().copy(o) },
			uBlobs: { value: r }
		}
	}), p = new e.Scene(), m = new e.OrthographicCamera(-1, 1, 1, -1, 0, 1), h = new e.ShaderMaterial({
		vertexShader: J,
		fragmentShader: wn,
		uniforms: { uTex: { value: d.texture } },
		depthTest: !1,
		depthWrite: !1
	}), g = new e.PlaneGeometry(2, 2), _ = new e.Mesh(g, h);
	_.frustumCulled = !1, p.add(_);
	let v = l(), y = u();
	function b() {
		let e = l(), t = u();
		e === v && t === y || (v = e, y = t, d.setSize(e, t), f.uniforms.uRes.value.set(e, t));
	}
	function x(e, t) {
		b(), f.uniforms.uTime.value = t, c(f, d);
	}
	function S() {
		d.dispose(), f.dispose(), h.dispose(), g.dispose(), p.remove(_);
	}
	return {
		scene: p,
		camera: m,
		update: x,
		dispose: S,
		usesBloom: !0,
		tone: "dark"
	};
}
//#endregion
//#region src/shaders/living-ink-sim.frag
var kn = "precision highp float;\n\nvarying vec2 vUv;\n\nuniform sampler2D uState;   \nuniform vec2      uTexel;   \nuniform float     uFeed;    \nuniform float     uKill;    \nuniform float     uDt;      \n\nvoid main() {\n  vec2 s = texture2D(uState, vUv).rg;\n\n  /* The 9-point Laplacian: neighbours pull, the centre pushes back. */\n  vec2 lap = vec2(0.0);\n  lap += texture2D(uState, vUv + vec2(-uTexel.x, -uTexel.y)).rg * 0.05;\n  lap += texture2D(uState, vUv + vec2( 0.0,      -uTexel.y)).rg * 0.20;\n  lap += texture2D(uState, vUv + vec2( uTexel.x, -uTexel.y)).rg * 0.05;\n  lap += texture2D(uState, vUv + vec2(-uTexel.x,  0.0)).rg     * 0.20;\n  lap += s * -1.0;\n  lap += texture2D(uState, vUv + vec2( uTexel.x,  0.0)).rg     * 0.20;\n  lap += texture2D(uState, vUv + vec2(-uTexel.x,  uTexel.y)).rg * 0.05;\n  lap += texture2D(uState, vUv + vec2( 0.0,       uTexel.y)).rg * 0.20;\n  lap += texture2D(uState, vUv + vec2( uTexel.x,  uTexel.y)).rg * 0.05;\n\n  float A = s.r, B = s.g;\n  float reaction = A * B * B;            \n\n  float dA = 1.00 * lap.r - reaction + uFeed * (1.0 - A);\n  float dB = 0.50 * lap.g + reaction - (uKill + uFeed) * B;\n\n  /* Clamp: the system is only conditionally stable, and one NaN would poison the whole field forever\n     (it would ping-pong back in next frame and spread through the Laplacian). Cheap insurance. */\n  gl_FragColor = vec4(clamp(A + dA * uDt, 0.0, 1.0),\n                      clamp(B + dB * uDt, 0.0, 1.0),\n                      0.0, 1.0);\n}", An = "precision highp float;\n\nvarying vec2 vUv;\n\nuniform sampler2D uState;\nuniform vec2      uTexel;\nuniform vec3      uPaper;   \nuniform vec3      uInk;     \nuniform vec3      uGlow;    \n\nvoid main() {\n  float b = texture2D(uState, vUv).g;\n\n  /* Gradient of B → where is the pattern GROWING right now. */\n  float bx = texture2D(uState, vUv + vec2(uTexel.x, 0.0)).g - texture2D(uState, vUv - vec2(uTexel.x, 0.0)).g;\n  float by = texture2D(uState, vUv + vec2(0.0, uTexel.y)).g - texture2D(uState, vUv - vec2(0.0, uTexel.y)).g;\n  float edge = clamp(length(vec2(bx, by)) * 9.0, 0.0, 1.0);\n\n  /* Paper → ink through the concentration, then the glowing front laid on top. */\n  vec3 col = mix(uPaper, uInk, smoothstep(0.08, 0.34, b));\n  col = mix(col, uGlow, edge * 0.60);\n\n  gl_FragColor = vec4(col, 1.0);\n}", jn = new e.Color(.105, .045, .15), Mn = new e.Color(.62, .28, .95), Nn = new e.Color(1, .94, .86);
function Pn(e) {
	let t = e >>> 0;
	return function() {
		t |= 0, t = t + 1831565813 | 0;
		let e = Math.imul(t ^ t >>> 15, 1 | t);
		return e = e + Math.imul(e ^ e >>> 7, 61 | e) ^ e, ((e ^ e >>> 14) >>> 0) / 4294967296;
	};
}
function Fn(t, { simRes: n = 256, iters: r = 12, feed: i = .0545, kill: a = .062, seed: o = 12648430, paper: s = jn, ink: c = Mn, glow: l = Nn } = {}) {
	let { renderer: u, runPass: d } = t, f = {
		minFilter: e.LinearFilter,
		magFilter: e.LinearFilter,
		depthBuffer: !1,
		stencilBuffer: !1,
		type: e.FloatType,
		wrapS: e.RepeatWrapping,
		wrapT: e.RepeatWrapping
	}, p = new e.WebGLRenderTarget(n, n, f), m = new e.WebGLRenderTarget(n, n, f), h = new Float32Array(n * n * 4), g = Pn(o);
	for (let e = 0; e < n * n; e++) h[e * 4] = 1, h[e * 4 + 3] = 1;
	for (let e = 0; e < 26; e++) {
		let e = Math.floor(g() * n), t = Math.floor(g() * n), r = 3 + Math.floor(g() * 5);
		for (let i = -r; i <= r; i++) for (let a = -r; a <= r; a++) {
			if (a * a + i * i > r * r) continue;
			let o = (e + a + n) % n, s = ((t + i + n) % n * n + o) * 4;
			h[s] = .35, h[s + 1] = .92;
		}
	}
	let _ = new e.DataTexture(h, n, n, e.RGBAFormat, e.FloatType);
	_.needsUpdate = !0;
	let v = new e.ShaderMaterial({
		vertexShader: J,
		fragmentShader: wn,
		uniforms: { uTex: { value: _ } }
	});
	d(v, p), v.dispose();
	let y = new e.ShaderMaterial({
		vertexShader: J,
		fragmentShader: kn,
		uniforms: {
			uState: { value: p.texture },
			uTexel: { value: new e.Vector2(1 / n, 1 / n) },
			uFeed: { value: i },
			uKill: { value: a },
			uDt: { value: 1 }
		}
	}), b = new e.Scene(), x = new e.OrthographicCamera(-1, 1, 1, -1, 0, 1), S = new e.ShaderMaterial({
		vertexShader: J,
		fragmentShader: An,
		uniforms: {
			uState: { value: p.texture },
			uTexel: { value: new e.Vector2(1 / n, 1 / n) },
			uPaper: { value: new e.Color().copy(s) },
			uInk: { value: new e.Color().copy(c) },
			uGlow: { value: new e.Color().copy(l) }
		},
		depthTest: !1,
		depthWrite: !1
	}), C = new e.PlaneGeometry(2, 2), w = new e.Mesh(C, S);
	w.frustumCulled = !1, b.add(w);
	for (let e = 0; e < 1600; e++) T();
	function T() {
		y.uniforms.uState.value = p.texture, d(y, m);
		let e = p;
		p = m, m = e, S.uniforms.uState.value = p.texture;
	}
	function E(e, t) {
		if (!(e <= 0)) for (let e = 0; e < r; e++) T();
	}
	function D() {
		p.dispose(), m.dispose(), _.dispose(), y.dispose(), S.dispose(), C.dispose(), b.remove(w);
	}
	return {
		scene: b,
		camera: x,
		update: E,
		dispose: D,
		usesBloom: !0,
		tone: "dark"
	};
}
//#endregion
//#region src/shaders/caustics.frag
var In = "precision highp float;\n\nvarying vec2 vUv;\n\nuniform float uTime;\nuniform vec2  uRes;\nuniform vec3  uDeep;    \nuniform vec3  uShallow; \nuniform vec3  uCaustic; \nuniform float uSharp;   \n\n/* Hash a cell to a jittered feature point. */\nvec2 hash2(vec2 p) {\n  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));\n  return fract(sin(p) * 43758.5453);\n}\n\n/* Worley / cellular — returning the TWO nearest distances (F1, F2), not just the nearest.\n   The points DRIFT with time (that's the water moving), so the whole web is alive. */\nvec2 worley2(vec2 p, float t) {\n  vec2 cell = floor(p);\n  vec2 f    = fract(p);\n  float f1 = 1e9, f2 = 1e9;\n  for (int y = -1; y <= 1; y++) {\n    for (int x = -1; x <= 1; x++) {\n      vec2 g = vec2(float(x), float(y));\n      vec2 o = hash2(cell + g);\n      /* Each feature point orbits its own little circle — the surface never stops rippling. */\n      o = 0.5 + 0.5 * sin(t + 6.2831 * o);\n      float d = length(g + o - f);\n      if (d < f1) { f2 = f1; f1 = d; }        \n      else if (d < f2) { f2 = d; }\n    }\n  }\n  return vec2(f1, f2);\n}\n\n/* ONE OCTAVE OF THE WEB — and getting this right is the whole scene.\n   The first cut brightened 1 - F1, which peaks AT each feature point. That draws glowing DOTS, and\n   the scene came out looking like bokeh / plankton — pretty, and not remotely a caustic.\n   A caustic filament is not a point, it is a BORDER: the set of places equidistant from two feature\n   points, where light focused by neighbouring parts of the surface piles up. That set is exactly where\n   F2 - F1 → 0. So the web is the CELL EDGES, and the thin searing line comes from sharpening how fast\n   that gap opens up. Same noise function, opposite feature — dots become a net. */\nfloat web(vec2 p, float t, float sharp) {\n  vec2 f = worley2(p, t);\n  float gap = f.y - f.x;                       \n  float edge = 1.0 - clamp(gap * 2.6, 0.0, 1.0);\n  return pow(edge, sharp * 0.55);\n}\n\nvoid main() {\n  vec2 uv = vUv;\n  uv.x *= uRes.x / max(uRes.y, 1.0);   \n\n  float t = uTime * 0.55;\n\n  /* DOMAIN WARP: push the lookup around with a slow wave before sampling. This is what turns a static\n     lattice of cells into something that flows and folds like a real surface. */\n  vec2 w = uv * 3.4;\n  w += 0.22 * vec2(sin(w.y * 2.1 + t * 0.9), cos(w.x * 1.9 - t * 0.7));\n\n  /* Two octaves drifting against each other — the interference is where the picture comes alive. */\n  float a = web(w,                t,        uSharp);\n  float b = web(w * 1.9 + 11.3,   t * 1.27, uSharp * 0.75);\n  float c = a * 0.65 + b * 0.45 + a * b * 0.8;   \n\n  /* CHROMATIC FRINGE — sample the web at three slightly different scales for R/G/B. */\n  float cr = c;\n  float cg = web(w * 1.012, t, uSharp) * 0.65 + b * 0.45;\n  float cb = web(w * 1.026, t, uSharp) * 0.65 + b * 0.45;\n\n  /* The floor: lit in the middle, falling to deep water at the edges (a cheap pool vignette). */\n  float floorLit = 1.0 - smoothstep(0.25, 0.95, length(vUv - 0.5) * 1.35);\n  vec3 base = mix(uDeep, uShallow, floorLit);\n\n  vec3 col = base + uCaustic * vec3(cr, cg, cb) * (0.55 + 0.75 * floorLit);\n\n  /* A slow bright swell so the whole pool breathes, not just the filaments. */\n  col += uCaustic * 0.06 * (0.5 + 0.5 * sin(t * 0.6 + vUv.y * 3.0));\n\n  gl_FragColor = vec4(col, 1.0);\n}", Ln = new e.Color(.01, .05, .09), Rn = new e.Color(.04, .18, .23), zn = new e.Color(.55, .95, 1);
function Bn(t, { sharp: n = 14, deep: r = Ln, shallow: i = Rn, caustic: a = zn } = {}) {
	let { drawBuffer: o } = t, s = new e.Scene(), c = new e.OrthographicCamera(-1, 1, 1, -1, 0, 1), l = new e.ShaderMaterial({
		vertexShader: J,
		fragmentShader: In,
		uniforms: {
			uTime: { value: 0 },
			uRes: { value: new e.Vector2(o.x, o.y) },
			uDeep: { value: new e.Color().copy(r) },
			uShallow: { value: new e.Color().copy(i) },
			uCaustic: { value: new e.Color().copy(a) },
			uSharp: { value: n }
		},
		depthTest: !1,
		depthWrite: !1
	}), u = new e.PlaneGeometry(2, 2), d = new e.Mesh(u, l);
	d.frustumCulled = !1, s.add(d);
	function f(e, t) {
		l.uniforms.uTime.value = t, l.uniforms.uRes.value.set(o.x, o.y);
	}
	function p() {
		l.dispose(), u.dispose(), s.remove(d);
	}
	return {
		scene: s,
		camera: c,
		update: f,
		dispose: p,
		usesBloom: !0,
		tone: "dark"
	};
}
//#endregion
//#region src/shaders/letterpress.frag
var Vn = "precision highp float;\n\nvarying vec2 vUv;\n\nuniform float     uTime;         \nuniform vec2      uResolution;   \nuniform sampler2D uText;         \nuniform vec2      uTextAspect;   \nuniform float     uTextScale;    \nuniform float     uMaxWidth;     \nuniform vec3      uPaper;        \nuniform vec3      uInk;          \nuniform float     uGrain;        \nuniform float     uInkFill;      \nuniform float     uInkEdge;      \nuniform float     uRelief;       \nuniform float     uSweepAmp;     \nuniform float     uSweepSpeed;   \nuniform float     uBuild;        \n\n/* Value noise — the same cheap hash+vnoise the other engine shaders inline (image-transition.frag). A\n   full fbm would be wasted on paper tooth; one octave of value noise is the grain. */\nfloat hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat vnoise(vec2 p) {\n  vec2 i = floor(p), f = fract(p);\n  vec2 u = f * f * (3.0 - 2.0 * f);\n  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),\n             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);\n}\n\n/* Map a fullscreen uv into the letterform's own texture space, preserving its aspect and centring it.\n   Returns the text-space uv; the caller tests whether it landed inside [0,1] (outside = open sheet). */\nvec2 toTextUv(vec2 uv) {\n  float screenA = uResolution.x / max(uResolution.y, 1.0);\n  float textA   = uTextAspect.x / max(uTextAspect.y, 1.0);\n  /* Height-driven scale, but CONTAINED: at uTextScale of the height the glyph is uTextScale*textA wide in\n     screen-HEIGHT units, i.e. uTextScale*textA/screenA of the WIDTH — which blows past 1.0 on a portrait\n     phone (a huge cropped '&'). Cap the scale so that width stays ≤ uMaxWidth; min() picks the axis that\n     fits. On a wide desktop the cap is slack, so s == uTextScale and the settled desktop frame is unchanged. */\n  float s = min(uTextScale, uMaxWidth * screenA / textA);\n  vec2 c = uv - 0.5;\n  c.x *= screenA;                                   \n  vec2 t;\n  t.y = c.y / s + 0.5;                              \n  t.x = c.x / (s * textA) + 0.5;                    \n  return t;\n}\n\n/* Coverage of the letterform at a text-space uv: 0 on the open sheet (outside the tile), the mask's red\n   channel inside. Sampled several times to build the relief gradient, so it is its own function. */\nfloat cov(vec2 t) {\n  if (t.x < 0.0 || t.x > 1.0 || t.y < 0.0 || t.y > 1.0) return 0.0;\n  return texture2D(uText, t).r;\n}\n\nvoid main() {\n  vec2 t = toTextUv(vUv);\n\n  /* Sample the coverage and its gradient. The step is a small fraction of the tile — big enough to span a\n     couple of baked texels (a soft wall the light can rake), small enough to stay crisp. */\n  float e = 0.0035;\n  float m  = cov(t);\n  float gx = cov(t + vec2(e, 0.0)) - cov(t - vec2(e, 0.0));\n  float gy = cov(t + vec2(0.0, e)) - cov(t - vec2(0.0, e));\n  float edge = clamp(length(vec2(gx, gy)) * 6.0, 0.0, 1.0);   \n\n  /* BUILD-IN PRESS. uBuild 0->1 stamps the impression IN: the deboss tilt, ink and lips all scale up from a\n     flat sheet, with an impact BITE near landing (a brief over-press that settles). At uBuild=1 the bite is\n     0 and press == 1.0 EXACTLY, so the built sheet is byte-identical to the un-built shader (present-parity\n     contract — the pack defaults uBuild to 1). The mark thus appears to be punched into the paper. */\n  float b     = clamp(uBuild, 0.0, 1.0);\n  /* bite is gated to the OPEN interval (0.62, 1.0): at b==1 it is exactly 0, so press is exactly 1.0 and\n     every \"* press\" below becomes \"* 1.0\" (an identity) — the built sheet is bit-for-bit the original\n     shader (sin PI is NOT exactly 0 in float, which would otherwise flip an LSB and break present-parity). */\n  float bite  = (b > 0.62 && b < 1.0) ? sin(((b - 0.62) / 0.38) * 3.14159265) : 0.0;   \n  float press = clamp(b + bite * 0.16, 0.0, 1.15);                        \n\n  /* THE DEBOSS NORMAL. The glyph is pressed IN, so the surface tilts down into it: the gradient (paper→ink)\n     is the outward slope. Flatter uRelief → steeper walls → a deeper-looking press. Scaled by press so the\n     sheet is FLAT (no tilt) until the stamp bites. */\n  vec3 N = normalize(vec3(-gx * press, -gy * press, uRelief));\n\n  /* THE RAKING LIGHT. Low azimuth, grazing elevation, azimuth breathing on uTime — the whole point. */\n  float a = uTime * uSweepSpeed;\n  float az = 0.9 + sin(a) * uSweepAmp;              \n  vec3 L = normalize(vec3(cos(az), sin(az), 0.55)); \n  float lit = dot(N, L);                            \n\n  /* THE SHEET. Kraft cream + a whisper of tooth, plus a broad soft gradient that reads as one low lamp\n     washing across the paper from the light's direction (makes the flat areas feel lit, not printed-flat). */\n  float grain = (vnoise(vUv * vec2(220.0, 220.0)) - 0.5) * uGrain;\n  vec3 col = uPaper * (1.0 + grain);\n  float lamp = 0.5 + 0.5 * dot(normalize(vec2(cos(az), sin(az))), (vUv - 0.5));\n  col *= mix(0.94, 1.05, lamp);\n\n  /* INK. A little in the body of the impression (kept low so copy stays legible on top), more concentrated\n     at the bitten edges where real ink pools. */\n  col = mix(col, uInk, clamp((m * uInkFill + edge * uInkEdge) * press, 0.0, 1.0));\n\n  /* THE DEBOSS LIPS. The wall facing the light catches a warm highlight; the far wall drops into shadow.\n     Both live on the edge term (the walls), and both track the sweeping azimuth — this is the breathing.\n     Scaled by press so they only appear as the impression bites. */\n  col += edge * press * max(lit, 0.0)  * 0.42 * vec3(1.0, 0.985, 0.95);   \n  col -= edge * press * max(-lit, 0.0) * 0.34 * vec3(1.0, 1.0, 1.0);      \n  col  = max(col, vec3(0.0));\n\n  /* LINEAR out — the post-filmic pass tonemaps (ACES), grades, dithers and sRGB-encodes downstream. */\n  gl_FragColor = vec4(col, 1.0);\n}", Hn = new e.Color(.91, .84, .71), Un = new e.Color(.045, .038, .03), Wn = {
	tint: new e.Color(.98, .95, .92),
	lift: new e.Color(0, 0, 0),
	sat: 1,
	contrast: 1.12
};
function Gn(t, n, r) {
	let i = document.createElement("canvas").getContext("2d");
	i.font = `${r} 820px ${n}`;
	let a = i.measureText(t), o = a.actualBoundingBoxAscent || 820 * .72, s = a.actualBoundingBoxDescent || 820 * .24, c = (a.actualBoundingBoxLeft || 0) + (a.actualBoundingBoxRight || a.width), l = 820 * .16, u = Math.max(2, Math.ceil(c + l * 2)), d = Math.max(2, Math.ceil(o + s + l * 2)), f = document.createElement("canvas");
	f.width = u, f.height = d;
	let p = f.getContext("2d");
	p.fillStyle = "#000", p.fillRect(0, 0, u, d), p.fillStyle = "#fff", p.textAlign = "center", p.textBaseline = "alphabetic", p.font = `${r} 820px ${n}`, p.fillText(t, u / 2, l + o);
	let m = new e.CanvasTexture(f);
	return m.colorSpace = e.NoColorSpace, m.minFilter = e.LinearFilter, m.magFilter = e.LinearFilter, m.generateMipmaps = !1, m.wrapS = e.ClampToEdgeWrapping, m.wrapT = e.ClampToEdgeWrapping, m.needsUpdate = !0, {
		tex: m,
		w: u,
		h: d
	};
}
function Kn(t, { text: n = "&", fontStack: r = "Georgia, \"Times New Roman\", \"Times\", serif", weight: i = 700, textScale: a = .62, maxWidth: o = .82, paper: s = Hn, ink: c = Un, grain: l = .05, inkFill: u = .3, inkEdge: d = .55, relief: f = .32, sweepAmp: p = .55, sweepSpeed: m = .16, filmic: h = Wn } = {}) {
	let g = new e.Scene(), _ = new e.OrthographicCamera(-1, 1, 1, -1, 0, 1), v = Gn(n, r, i), y = {
		uTime: { value: 0 },
		uResolution: { value: new e.Vector2(t.drawBuffer.x, t.drawBuffer.y) },
		uText: { value: v.tex },
		uTextAspect: { value: new e.Vector2(v.w, v.h) },
		uTextScale: { value: a },
		uMaxWidth: { value: o },
		uPaper: { value: new e.Color().copy(s) },
		uInk: { value: new e.Color().copy(c) },
		uGrain: { value: l },
		uInkFill: { value: u },
		uInkEdge: { value: d },
		uRelief: { value: f },
		uSweepAmp: { value: p },
		uSweepSpeed: { value: m },
		uBuild: { value: 1 }
	}, b = new e.ShaderMaterial({
		vertexShader: J,
		fragmentShader: Vn,
		uniforms: y,
		depthTest: !1,
		depthWrite: !1
	}), x = new e.PlaneGeometry(2, 2), S = new e.Mesh(x, b);
	S.frustumCulled = !1, g.add(S);
	function C(e, n) {
		y.uTime.value = n, y.uResolution.value.set(t.drawBuffer.x, t.drawBuffer.y);
	}
	function w() {
		x.dispose(), b.dispose(), v.tex.dispose(), g.remove(S);
	}
	function T(e) {
		y.uBuild.value = e < 0 ? 0 : e > 1 ? 1 : e;
	}
	return {
		scene: g,
		camera: _,
		update: C,
		dispose: w,
		usesBloom: !1,
		tone: "bright",
		filmic: h,
		setBuild: T
	};
}
//#endregion
//#region src/shaders/cathedral-light.frag
var qn = "precision highp float;\n\nvarying vec2 vUv;\n\nuniform float uTime;\nuniform vec2  uResolution;   \nuniform vec2  uSource;       \nuniform vec2  uWindow;       \nuniform vec3  uShadow;       \nuniform vec3  uLight;        \nuniform float uRayFreq;      \nuniform float uDensity;      \nuniform float uFalloff;      \nuniform float uDust;         \n\n/* hash + value noise + a little fbm — the inline pattern the other engine shaders use (no shared lib). */\nfloat hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat vnoise(vec2 p) {\n  vec2 i = floor(p), f = fract(p);\n  vec2 u = f * f * (3.0 - 2.0 * f);\n  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),\n             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);\n}\nfloat fbm(vec2 p) {\n  float v = 0.0, a = 0.5;\n  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.02; a *= 0.5; }\n  return v;\n}\n\nvoid main() {\n  float aspect = uResolution.x / max(uResolution.y, 1.0);\n  vec2 auv = vec2(vUv.x * aspect, vUv.y);          \n  vec2 asrc = vec2(uSource.x * aspect, uSource.y);\n  vec2 awin = vec2(uWindow.x * aspect, uWindow.y);\n\n  /* THE RAY BACK TO THE SOURCE. Its angle indexes the shaft noise; its length drives the falloff. */\n  vec2 back = auv - asrc;\n  float dist = length(back);\n  float ang  = atan(back.y, back.x);\n\n  /* SHAFTS — noise on the angle = streaks fanning from the source; the second axis drifts slowly along the\n     beam so the shafts breathe rather than sit frozen. Two octaves at different angular scales = fine rays\n     inside broad ones. */\n  float s1 = fbm(vec2(ang * uRayFreq,        dist * 1.5 - uTime * 0.04));\n  float s2 = fbm(vec2(ang * uRayFreq * 2.7,  dist * 2.5 + uTime * 0.02));\n  float shaftNoise = s1 * 0.7 + s2 * 0.3;\n  float shaft = smoothstep(0.35, 0.95, shaftNoise);\n\n  /* FALLOFF — bright at the window, scattering away into the dark. */\n  float fall = exp(-dist * uFalloff);\n  float beams = shaft * fall * uDensity;\n\n  /* DIRECTIONAL BIAS — this is what makes it CATHEDRAL light and not a sunburst. Favour rays that pour\n     DOWN into the nave; dim the ones firing sideways/up. The back vector points from source to pixel, so a\n     downward shaft has a negative y; -normalize(back).y is 1 straight down, 0 sideways. */\n  float down = clamp(-normalize(back).y, 0.0, 1.0);\n  beams *= mix(0.12, 1.0, smoothstep(0.15, 0.9, down));\n\n  /* THE WINDOW — a warm glow where the light enters. Kept tight + mostly at the frame's top edge (the\n     source sits just above the frame) so it reads as light ENTERING from a high opening, not a sun. */\n  float wd = length(auv - awin);\n  float glow = exp(-wd * wd * 44.0) * 1.7 + exp(-wd * 9.0) * 0.28;\n\n  /* DUST — a few drifting motes, only visible where a shaft lights them. Cheap: hashed cells scrolled down\n     slowly, a soft dot per cell, gated by the local beam intensity so they twinkle inside the light only. */\n  vec2 dcell = auv * 26.0 + vec2(0.0, uTime * 0.5);\n  vec2 gi = floor(dcell), gf = fract(dcell);\n  float h = hash(gi);\n  vec2 motePos = vec2(h, fract(h * 41.7));\n  float mote = smoothstep(0.16, 0.0, length(gf - motePos)) * step(0.82, h);\n  float dust = mote * (beams + glow * 0.2) * uDust;\n\n  /* AMBIENT BOUNCE — a faint warm wash spilling from the opening into the nave. It reads as a lit interior\n     rather than a black void, and (measured) it lifts the frame's MEAN warm enough to keep the scene mean-RGB\n     DISTINCT from the ring's other near-black scenes (Aurora/Observatory) — a downscaled mean is blind to the\n     bright-but-small shafts, so the dark scenes collapse together without this. It stays a WASH, not a fill:\n     strongest near the opening, gone by the lower nave, so the drama (dark below, light above) survives. */\n  float amb = exp(-dist * 0.8) * 0.16 + (1.0 - vUv.y) * 0.02;\n\n  /* COMPOSE (LINEAR). Warm light scaled past 1 in the core so the director's bloom blooms it. */\n  vec3 col = uShadow;\n  col += uLight * (beams * 1.6 + glow + amb);\n  col += uLight * dust * 3.0;\n\n  gl_FragColor = vec4(max(col, 0.0), 1.0);\n}", Jn = new e.Color(.006, .008, .013), Yn = new e.Color(1, .66, .34), Xn = {
	tint: new e.Color(1, .9, .74),
	lift: new e.Color(0, 0, 0),
	sat: 1.08,
	contrast: 1.15
};
function Zn(t, { shadow: n = Jn, light: r = Yn, source: i = new e.Vector2(.42, 1.34), windowPos: a = new e.Vector2(.44, 1.02), rayFreq: o = 7, density: s = 1, falloff: c = 1.2, dust: l = 1, filmic: u = Xn } = {}) {
	let d = new e.Scene(), f = new e.OrthographicCamera(-1, 1, 1, -1, 0, 1), p = {
		uTime: { value: 0 },
		uResolution: { value: new e.Vector2(t.drawBuffer.x, t.drawBuffer.y) },
		uSource: { value: i.clone() },
		uWindow: { value: a.clone() },
		uShadow: { value: new e.Color().copy(n) },
		uLight: { value: new e.Color().copy(r) },
		uRayFreq: { value: o },
		uDensity: { value: s },
		uFalloff: { value: c },
		uDust: { value: l }
	}, m = new e.ShaderMaterial({
		vertexShader: J,
		fragmentShader: qn,
		uniforms: p,
		depthTest: !1,
		depthWrite: !1
	}), h = new e.PlaneGeometry(2, 2), g = new e.Mesh(h, m);
	g.frustumCulled = !1, d.add(g);
	function _(e, n) {
		p.uTime.value = n, p.uResolution.value.set(t.drawBuffer.x, t.drawBuffer.y);
	}
	function v() {
		h.dispose(), m.dispose(), d.remove(g);
	}
	return {
		scene: d,
		camera: f,
		update: _,
		dispose: v,
		usesBloom: !0,
		tone: "dark",
		filmic: u
	};
}
//#endregion
//#region src/shaders/first-light.frag
var Qn = "precision highp float;\n\nvarying vec2 vUv;\n\nuniform float uTime;\nuniform vec2  uResolution;   \nuniform float uSpeed;        \nuniform float uHorizon;      \nuniform vec3  uNightZenith;  \nuniform vec3  uNightHorizon; \nuniform vec3  uRose;         \nuniform vec3  uGold;         \nuniform vec3  uDayZenith;    \nuniform vec3  uLand;         \nuniform float uStarBright;   \n\nfloat hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat vnoise(vec2 p) {\n  vec2 i = floor(p), f = fract(p);\n  vec2 u = f * f * (3.0 - 2.0 * f);\n  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),\n             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);\n}\nfloat fbm(vec2 p) {\n  float v = 0.0, a = 0.5;\n  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }\n  return v;\n}\n\nconst float PI = 3.14159265;\n\nvoid main() {\n  float aspect = uResolution.x / max(uResolution.y, 1.0);\n\n  /* THE SCALAR. sin(phase*PI) is 0 at phase 0 and 1 (seamless loop) and 1 at the middle. A gentle power\n     shape holds the blue hour a touch longer and makes the gold peak brief — restraint. */\n  float phase = fract(uTime * uSpeed);\n  float sunH  = pow(sin(phase * PI), 2.2);           \n                                                     \n                                                     \n\n  /* Mood terms derived from the one scalar. Warmth kicks in LATE (only as the limb nears breaking). */\n  float warm  = smoothstep(0.34, 0.95, sunH);        \n  float rise  = smoothstep(0.16, 0.62, sunH);        \n  float sunY  = uHorizon - 0.06 + sunH * 0.20;       \n\n  /* ── SKY ── a vertical gradient, zenith→horizon, warming + lifting with sunH. */\n  float sky = smoothstep(uHorizon, 1.0, vUv.y);       \n  vec3 zenith  = mix(uNightZenith, uDayZenith, sunH * 0.6);\n  vec3 horizonC = mix(uNightHorizon, uRose, rise);\n  horizonC = mix(horizonC, uGold, smoothstep(0.55, 1.0, sunH));\n  vec3 col = mix(horizonC, zenith, pow(sky, 0.8));\n\n  /* A soft warm glow pooled at the horizon where the light comes from — widens + warms as dawn breaks. */\n  float glowBand = exp(-max(vUv.y - uHorizon, 0.0) * mix(9.0, 3.5, warm));\n  col += uGold * glowBand * (0.10 + 0.9 * warm) * (0.4 + 0.6 * rise);\n\n  /* ── STARS ── faint points high in the sky, fading as it brightens. Cheap hashed cells. */\n  float starFade = (1.0 - smoothstep(0.12, 0.5, sunH)) * smoothstep(uHorizon + 0.1, 0.6, vUv.y);\n  vec2 sc = vec2(vUv.x * aspect, vUv.y) * 90.0;\n  vec2 si = floor(sc);\n  float sh = hash(si);\n  float star = step(0.985, sh) * smoothstep(0.09, 0.0, length(fract(sc) - 0.5));\n  float twinkle = 0.6 + 0.4 * sin(uTime * 2.0 + sh * 40.0);\n  col += vec3(0.7, 0.8, 1.0) * star * starFade * twinkle * uStarBright;   \n                                                     \n\n  /* ── SUN ── a warm disc rising through the horizon; one soft HDR core for the bloom. Aspect-corrected\n     so it stays round. Only contributes near/after the limb break. */\n  vec2 sunP = vec2((vUv.x - 0.5) * aspect, vUv.y - sunY);\n  float sd = length(sunP);\n  float disc = smoothstep(0.045, 0.030, sd);          \n  float halo = exp(-sd * 7.0);                        \n  float reveal = smoothstep(0.18, 0.5, sunH);         \n  col += uGold * halo * 0.7 * reveal;\n  col += vec3(1.5, 1.05, 0.6) * disc * reveal;        \n\n  /* ── HILLS ── a low, minimal rolling silhouette (a couple of smooth undulations + a little noise). NOT\n     dunes: gentle sine swells, not sharp crests. Everything below the profile is the dark land. */\n  float hills = uHorizon\n              + sin(vUv.x * 3.1 + 1.3) * 0.018\n              + sin(vUv.x * 6.7 + 4.0) * 0.010\n              + (fbm(vec2(vUv.x * 4.0, 0.0)) - 0.5) * 0.030;\n  float land = smoothstep(hills + 0.004, hills - 0.004, vUv.y);   \n  vec3 landC = mix(uLand, uLand + uGold * 0.06, warm);            \n  col = mix(col, landC, land);\n\n  /* ── MIST ── a low soft band drifting just above the land; thick + cool in the blue hour, thinning and\n     glowing gold as the light floods. Sits over the ridge line so the land reads as behind it. */\n  float mband = exp(-abs(vUv.y - (uHorizon + 0.03)) * 16.0);\n  float drift = fbm(vec2(vUv.x * 2.2 - uTime * 0.03, uTime * 0.02 + 3.0));\n  float mist  = mband * (0.35 + 0.4 * drift) * mix(0.9, 0.5, warm);\n  vec3 mistC  = mix(mix(uNightHorizon, uRose, rise), uGold, warm * 0.7) + vec3(0.02);\n  col = mix(col, mistC, clamp(mist, 0.0, 0.85));\n\n  gl_FragColor = vec4(max(col, 0.0), 1.0);\n}", $n = new e.Color(.025, .045, .12), er = new e.Color(.09, .15, .3), tr = new e.Color(.32, .14, .15), nr = new e.Color(.9, .52, .21), rr = new e.Color(.14, .22, .36), ir = new e.Color(.008, .012, .022), ar = {
	tint: new e.Color(1, .98, .95),
	lift: new e.Color(0, 0, 0),
	sat: 1,
	contrast: 1.06
};
function or(t, { speed: n = .02, horizon: r = .3, starBrightness: i = .85, nightZenith: a = $n, nightHorizon: o = er, rose: s = tr, gold: c = nr, dayZenith: l = rr, land: u = ir, filmic: d = ar } = {}) {
	let f = new e.Scene(), p = new e.OrthographicCamera(-1, 1, 1, -1, 0, 1), m = {
		uTime: { value: 0 },
		uResolution: { value: new e.Vector2(t.drawBuffer.x, t.drawBuffer.y) },
		uSpeed: { value: n },
		uHorizon: { value: r },
		uNightZenith: { value: new e.Color().copy(a) },
		uNightHorizon: { value: new e.Color().copy(o) },
		uRose: { value: new e.Color().copy(s) },
		uGold: { value: new e.Color().copy(c) },
		uDayZenith: { value: new e.Color().copy(l) },
		uLand: { value: new e.Color().copy(u) },
		uStarBright: { value: i }
	}, h = new e.ShaderMaterial({
		vertexShader: J,
		fragmentShader: Qn,
		uniforms: m,
		depthTest: !1,
		depthWrite: !1
	}), g = new e.PlaneGeometry(2, 2), _ = new e.Mesh(g, h);
	_.frustumCulled = !1, f.add(_);
	function v(e, n) {
		m.uTime.value = n, m.uResolution.value.set(t.drawBuffer.x, t.drawBuffer.y);
	}
	function y() {
		g.dispose(), h.dispose(), f.remove(_);
	}
	return {
		scene: f,
		camera: p,
		update: v,
		dispose: y,
		usesBloom: !0,
		tone: "dark",
		filmic: d
	};
}
//#endregion
//#region src/shaders/image-transition.frag
var sr = "precision highp float;\n\nvarying vec2 vUv;\n\nuniform sampler2D uBefore;\nuniform sampler2D uAfter;\nuniform float uProgress;    \nuniform float uTime;        \nuniform vec2  uQuadRes;     \nuniform vec2  uBeforeRes;   \nuniform vec2  uAfterRes;    \nuniform float uMelt;        \nuniform float uWidth;       \n\n/* uMeltAmp — the MASTER \"how liquid is this transition at all\" scalar (Lesson Z).\n   ------------------------------------------------------------\n   Why this exists, and why it is a SEPARATE dial from uMelt: a real client finding. The liquid melt is\n   gorgeous on dark, moody sets — but on LIGHT, high-contrast photographs (an elegant salon reel) the\n   sideways UV displacement smears bright/dark edges into harsh HORIZONTAL STREAKING, and the photos never\n   settle enough to read. The melt is not vibe-agnostic; elegant brands need a calm alternative.\n\n   So uMeltAmp collapses the whole liquid apparatus toward a plain opacity crossfade:\n     • 1.0 = the melt EXACTLY as before — every term below is multiplied by 1.0, a true no-op, so the\n       default is byte-identical and no baseline is disturbed.\n     • 0.0 = a pure cross-DISSOLVE: the blend becomes spatially UNIFORM (every pixel at the same opacity,\n       = uProgress) instead of a wobbling wipe front, the drag displacement is scaled to nothing (no\n       streak), and the wet-edge glow is switched off. Two stills fading through each other, nothing more.\n   uMelt still exists and still tunes the drag WITHIN a melt; uMeltAmp decides whether there is a melt at\n   all. When uMeltAmp is 0 the value of uMelt no longer matters — the crossfade overrides it, by design\n   (we layer a master switch on top; we do not average the two into a muddy third thing). */\nuniform float uMeltAmp;\n\n/* Cheap value noise — enough to make the front organic; a full fbm would be wasted here. */\nfloat hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat vnoise(vec2 p) {\n  vec2 i = floor(p), f = fract(p);\n  vec2 u = f * f * (3.0 - 2.0 * f);\n  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),\n             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);\n}\n\n/* object-fit: cover, in UV space. Scale the axis with slack, then recentre.\n   The max(.,1.0) on BOTH numerators is the last line of defense (Lesson Z2b): if a degenerate box\n   dimension (a 0-width container caught mid-layout) ever reaches boxRes.x, an unclamped 0 makes\n   boxA = 0 → s.x = boxA/imgA = 0 → the whole x axis collapses to a horizontal-streak smear. Clamping\n   to ≥1 turns that into a merely-wrong crop for the one bad frame instead of a full collapse, and is a\n   true no-op for every real photo/box (all ≥1), so no rendered baseline shifts. */\nvec2 coverUv(vec2 uv, vec2 imgRes, vec2 boxRes) {\n  float imgA = max(imgRes.x, 1.0) / max(imgRes.y, 1.0);\n  float boxA = max(boxRes.x, 1.0) / max(boxRes.y, 1.0);\n  vec2 s = vec2(1.0);\n  if (imgA > boxA) s.x = boxA / imgA;   \n  else             s.y = imgA / boxA;   \n  return (uv - 0.5) * s + 0.5;\n}\n\nvoid main() {\n  /* THE FRONT — a wobbling boundary, not a line. */\n  float n = vnoise(vec2(vUv.y * 3.2, uTime * 0.10)) * 0.5\n          + vnoise(vec2(vUv.y * 8.0 + 4.0, uTime * 0.16)) * 0.25;\n\n  /* Bias the front so progress 0 and 1 are FULLY clean: at the ends the noise must not leave a stray\n     sliver of the other image on screen. Remapping into a slightly over-scanned range does that. */\n  float p = uProgress * (1.0 + uWidth * 2.0) - uWidth;\n  float front = vUv.x + (n - 0.375) * 0.13 - p;\n\n  /* THE BAND — how much of the picture is currently mid-melt (the wobbly wipe mask). */\n  float m = 1.0 - smoothstep(-uWidth, uWidth, front);   \n\n  /* THE MASTER LERP. Blend between a UNIFORM opacity (uProgress everywhere — a crossfade) and the wipe\n     mask m, by uMeltAmp. At uMeltAmp = 1.0 this returns m exactly (mix(a,b,1.0) == b, bit-for-bit), so\n     the melt is untouched; at 0.0 it returns uProgress, a flat cross-dissolve with no spatial front. */\n  float mask = mix(uProgress, m, uMeltAmp);\n\n  /* THE DRAG — strongest inside the band, zero at either end. This is the liquid part: we pull the\n     sampled coordinates sideways (and a little vertically) so the front looks like it is physically\n     pushing the old image out of the way. */\n  float band = 1.0 - abs(front) / max(uWidth, 1e-4);\n  band = clamp(band, 0.0, 1.0);\n  /* uMeltAmp gates the drag too: at 1.0 this is band*band*uMelt unchanged; at 0.0 the drag is zero, so\n     push is zero, so both images are sampled at the same cover-fit UV — a crossfade, no sideways smear. */\n  float drag = band * band * uMelt * uMeltAmp;\n\n  vec2 push = vec2(drag * 0.16, (n - 0.5) * drag * 0.10);\n\n  vec2 uvB = coverUv(vUv + push,        uBeforeRes, uQuadRes);   \n  vec2 uvA = coverUv(vUv - push * 0.45, uAfterRes,  uQuadRes);   \n\n  vec3 before = texture2D(uBefore, clamp(uvB, 0.0, 1.0)).rgb;\n  vec3 after  = texture2D(uAfter,  clamp(uvA, 0.0, 1.0)).rgb;\n\n  vec3 col = mix(before, after, mask);\n\n  /* A whisper of brightness right at the melting front — the wet edge where the two liquids meet.\n     Kept subtle: this is a photo, and a glowing seam would look like a filter. (Added in LINEAR, before\n     the encode below, so it behaves like light and not like a paint overlay.) uMeltAmp switches it off in\n     crossfade mode — there is no front for it to trace, so at 1.0 it is times 1.0 (unchanged), at 0.0 gone. */\n  col += vec3(1.0, 0.98, 0.96) * band * band * 0.10 * uMelt * uMeltAmp;\n\n  /* ENCODE — see the header. Everything above is LINEAR light; the screen wants sRGB. This is the exact\n     IEC 61966-2-1 transfer curve (not a lazy pow(1/2.2), which is visibly wrong in the deep shadows). */\n  col = mix(col * 12.92,\n            1.055 * pow(max(col, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055,\n            step(vec3(0.0031308), col));\n\n  gl_FragColor = vec4(col, 1.0);\n}";
//#endregion
//#region src/photo-path.js
function cr() {
	try {
		let e = document.createElement("canvas");
		return !!(e.getContext("webgl2") || e.getContext("webgl"));
	} catch {
		return !1;
	}
}
function lr() {
	return typeof window < "u" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : !1;
}
function ur(e, t, n) {
	let r = document.createElement("img");
	return r.src = t, r.alt = n || "", r.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;", e.appendChild(r), e.setAttribute("data-photo-path", "fallback-image"), r;
}
function dr(t, n) {
	let r = n || new e.TextureLoader();
	return r.setCrossOrigin("anonymous"), new Promise((n, i) => {
		r.load(t, (t) => {
			t.colorSpace = e.SRGBColorSpace, t.minFilter = e.LinearFilter, t.magFilter = e.LinearFilter, t.generateMipmaps = !1, t.wrapS = e.ClampToEdgeWrapping, t.wrapT = e.ClampToEdgeWrapping, t.needsUpdate = !0, n(t);
		}, void 0, i);
	});
}
function fr(e) {
	let t = !0, n = typeof IntersectionObserver < "u" ? new IntersectionObserver((e) => {
		t = e.some((e) => e.isIntersecting);
	}) : null;
	return n?.observe(e), {
		get visible() {
			return t;
		},
		dispose() {
			n?.disconnect();
		}
	};
}
//#endregion
//#region src/createBeforeAfter.js
function pr(e, t, n) {
	let r = ur(e, t, n);
	return e.setAttribute("data-before-after", "fallback-image"), {
		setProgress() {},
		getProgress() {
			return 1;
		},
		update() {},
		dispose() {
			r.remove();
		},
		canvas: null,
		fallback: !0
	};
}
async function mr(t, { before: n, after: r, melt: i = 1, width: a = .18, progress: o = 0, mode: s = "pointer", autoMs: c = 4200, holdMs: l = 1400, label: u = "Before and after", alt: d = "", step: f = .05 } = {}) {
	if (!t) throw Error("createBeforeAfter: container is required");
	if (!n || !r) throw Error("createBeforeAfter: before and after image URLs are required");
	let p;
	try {
		if (!cr()) return pr(t, r, d);
		p = await Ce({
			container: t,
			lean: !0
		});
	} catch (e) {
		return console.warn("[createBeforeAfter] WebGL unavailable — showing the after image.", e), pr(t, r, d);
	}
	let { renderer: m, drawBuffer: h } = p, g = new e.Scene(), _ = new e.OrthographicCamera(-1, 1, 1, -1, 0, 1), v = new e.ShaderMaterial({
		vertexShader: J,
		fragmentShader: sr,
		uniforms: {
			uBefore: { value: null },
			uAfter: { value: null },
			uProgress: { value: o },
			uTime: { value: 0 },
			uQuadRes: { value: new e.Vector2(h.x, h.y) },
			uBeforeRes: { value: new e.Vector2(1, 1) },
			uAfterRes: { value: new e.Vector2(1, 1) },
			uMelt: { value: i },
			uWidth: { value: a },
			uMeltAmp: { value: 1 }
		},
		depthTest: !1,
		depthWrite: !1
	}), y = new e.PlaneGeometry(2, 2), b = new e.Mesh(y, v);
	b.frustumCulled = !1, g.add(b);
	let x = new e.TextureLoader(), S, C;
	try {
		[S, C] = await Promise.all([dr(n, x), dr(r, x)]);
	} catch (e) {
		return console.warn("[createBeforeAfter] an image failed to load — showing the after image.", e), p.dispose?.(), t.innerHTML = "", pr(t, r, d);
	}
	v.uniforms.uBefore.value = S, v.uniforms.uAfter.value = C, v.uniforms.uBeforeRes.value.set(S.image.width, S.image.height), v.uniforms.uAfterRes.value.set(C.image.width, C.image.height), t.setAttribute("role", "slider"), t.setAttribute("tabindex", "0"), t.setAttribute("aria-label", u), t.setAttribute("aria-valuemin", "0"), t.setAttribute("aria-valuemax", "100"), t.setAttribute("data-before-after", "webgl"), t.style.touchAction = "pan-y";
	let w = Math.min(1, Math.max(0, o));
	function T(e, n) {
		w = Math.min(1, Math.max(0, e)), v.uniforms.uProgress.value = w, t.setAttribute("aria-valuenow", String(Math.round(w * 100))), n && (N = !1);
	}
	T(w);
	let E = (e) => {
		let n = t.getBoundingClientRect();
		return (e - n.left) / Math.max(n.width, 1);
	}, D = !1, O = (e) => {
		D = !0, t.setPointerCapture?.(e.pointerId), T(E(e.clientX), !0);
	}, k = (e) => {
		D && T(E(e.clientX), !0);
	}, A = (e) => {
		D = !1, t.releasePointerCapture?.(e.pointerId);
	};
	t.addEventListener("pointerdown", O), t.addEventListener("pointermove", k), t.addEventListener("pointerup", A), t.addEventListener("pointercancel", A);
	let j = (e) => {
		let t = null;
		(e.key === "ArrowRight" || e.key === "ArrowUp") && (t = w + f), (e.key === "ArrowLeft" || e.key === "ArrowDown") && (t = w - f), e.key === "Home" && (t = 0), e.key === "End" && (t = 1), t !== null && (e.preventDefault(), T(t, !0));
	};
	t.addEventListener("keydown", j);
	let M = lr(), N = s === "auto" && !M, P = (c + l) * 2;
	function F(e) {
		let t = e % P;
		return t < l ? 0 : t < l + c ? (t - l) / c : t < l * 2 + c ? 1 : 1 - (t - l * 2 - c) / c;
	}
	let I = null, L = !1, ee = null, te = fr(t);
	function R(e) {
		ee === null && (ee = e);
		let n = e - ee;
		v.uniforms.uTime.value = n * .001, N && !D && T(F(n)), (h.x < 1 || h.y < 1) && t.clientWidth >= 1 && t.clientHeight >= 1 && p.resize(), h.x >= 1 && h.y >= 1 && v.uniforms.uQuadRes.value.set(h.x, h.y), m.setRenderTarget(null), m.render(g, _);
	}
	function z(e) {
		L || (I = requestAnimationFrame(z), te.visible && (p.frameStart(), R(e), p.frameEnd()));
	}
	I = requestAnimationFrame(z);
	let B = () => p.resize();
	window.addEventListener("resize", B, { passive: !0 });
	function V() {
		L = !0, I !== null && cancelAnimationFrame(I), te.dispose(), window.removeEventListener("resize", B), t.removeEventListener("pointerdown", O), t.removeEventListener("pointermove", k), t.removeEventListener("pointerup", A), t.removeEventListener("pointercancel", A), t.removeEventListener("keydown", j), S.dispose(), C.dispose(), v.dispose(), y.dispose(), g.remove(b), p.dispose?.();
	}
	function H(e) {
		return M ? (N = !1, !1) : (N = !!e, N && (ee = null), N);
	}
	return {
		setProgress: (e) => T(e, !0),
		getProgress: () => w,
		setAuto: H,
		isReducedMotion: () => M,
		update: R,
		dispose: V,
		canvas: m.domElement,
		fallback: !1
	};
}
//#endregion
//#region src/createLookReel.js
var hr = (e) => e * e * (3 - 2 * e);
async function gr(t, { images: n = [], holdMs: r = 2600, meltMs: i = 1600, melt: a = 1, width: o = .18, transition: s = "melt", maxResident: c = 6, alt: l = "", ariaHidden: u = !0 } = {}) {
	if (!t) throw Error("createLookReel: container is required");
	if (!Array.isArray(n) || n.length === 0) throw Error("createLookReel: images must be a non-empty array of URLs");
	let d = s === "crossfade" ? 0 : 1;
	if (!cr()) {
		let e = ur(t, n[0], l);
		return t.setAttribute("data-look-reel", "fallback-image"), {
			update() {},
			pause() {},
			resume() {},
			dispose() {
				e.remove();
			},
			get index() {
				return 0;
			},
			get count() {
				return n.length;
			},
			vram: () => 0,
			fallback: !0
		};
	}
	let f;
	try {
		f = await Ce({
			container: t,
			lean: !0
		});
	} catch (e) {
		console.warn("[createLookReel] WebGL unavailable — showing the first image.", e);
		let r = ur(t, n[0], l);
		return t.setAttribute("data-look-reel", "fallback-image"), {
			update() {},
			pause() {},
			resume() {},
			dispose() {
				r.remove();
			},
			get index() {
				return 0;
			},
			get count() {
				return n.length;
			},
			vram: () => 0,
			fallback: !0
		};
	}
	let { renderer: p, drawBuffer: m } = f, h = new e.TextureLoader(), g = n.slice(), _ = /* @__PURE__ */ new Map(), v = /* @__PURE__ */ new Set();
	async function y(e) {
		if (v.has(e)) return null;
		if (_.has(e)) return _.get(e);
		try {
			let t = await dr(e, h);
			return _.set(e, t), x(), t;
		} catch {
			console.warn("[createLookReel] image failed to load; skipping it:", e), v.add(e);
			let t = g.indexOf(e);
			return t >= 0 && g.splice(t, 1), null;
		}
	}
	let b = /* @__PURE__ */ new Set();
	function x() {
		if (!(_.size <= c)) for (let [e, t] of _) {
			if (_.size <= c) break;
			b.has(e) || (t.dispose(), _.delete(e));
		}
	}
	let S = 0, C = null;
	for (; C === null && g.length;) C = await y(g[0]);
	if (!C) {
		console.warn("[createLookReel] no image could be loaded — falling back."), f.dispose?.(), t.innerHTML = "";
		let e = ur(t, n[0], l);
		return {
			update() {},
			pause() {},
			resume() {},
			dispose() {
				e.remove();
			},
			get index() {
				return 0;
			},
			get count() {
				return 0;
			},
			vram: () => 0,
			fallback: !0
		};
	}
	let w = new e.Scene(), T = new e.OrthographicCamera(-1, 1, 1, -1, 0, 1), E = new e.ShaderMaterial({
		vertexShader: J,
		fragmentShader: sr,
		uniforms: {
			uBefore: { value: C },
			uAfter: { value: C },
			uProgress: { value: 0 },
			uTime: { value: 0 },
			uQuadRes: { value: new e.Vector2(m.x, m.y) },
			uBeforeRes: { value: new e.Vector2(C.image.width, C.image.height) },
			uAfterRes: { value: new e.Vector2(C.image.width, C.image.height) },
			uMelt: { value: a },
			uWidth: { value: o },
			uMeltAmp: { value: d }
		},
		depthTest: !1,
		depthWrite: !1
	}), D = new e.PlaneGeometry(2, 2), O = new e.Mesh(D, E);
	O.frustumCulled = !1, w.add(O), u && t.setAttribute("aria-hidden", "true"), t.setAttribute("data-look-reel", "webgl");
	let k = lr(), A = "hold", j = 0, M = -1, N = null, P = !1;
	function F() {
		if (P || k || g.length < 2) return;
		let e = g[(S + 1) % g.length];
		P = !0, y(e).then((t) => {
			P = !1, t && (M = g.indexOf(e), N = t);
		}).catch(() => {
			P = !1;
		});
	}
	F();
	let I = fr(t), L = null, ee = !1, te = !1, R = null;
	function z(e) {
		if (j += e, A === "hold") {
			if (k || g.length < 2 || j < r) return;
			if (!N) {
				F();
				return;
			}
			b = new Set([g[S], g[M]]), E.uniforms.uAfter.value = N, E.uniforms.uAfterRes.value.set(N.image.width, N.image.height), A = "melt", j = 0;
			return;
		}
		let t = Math.min(1, j / i);
		E.uniforms.uProgress.value = hr(t), !(t < 1) && (S = M, C = N, N = null, M = -1, E.uniforms.uBefore.value = C, E.uniforms.uBeforeRes.value.set(C.image.width, C.image.height), E.uniforms.uProgress.value = 0, b = new Set([g[S]]), x(), A = "hold", j = 0, F());
	}
	function B(e) {
		let n = R === null ? 0 : e - R;
		R = e, E.uniforms.uTime.value = e * .001, (m.x < 1 || m.y < 1) && t.clientWidth >= 1 && t.clientHeight >= 1 && f.resize(), m.x >= 1 && m.y >= 1 && E.uniforms.uQuadRes.value.set(m.x, m.y), te || z(n), p.setRenderTarget(null), p.render(w, T);
	}
	function V(e) {
		if (!ee) {
			if (L = requestAnimationFrame(V), !I.visible) {
				R = null;
				return;
			}
			f.frameStart(), B(e), f.frameEnd();
		}
	}
	L = requestAnimationFrame(V);
	let H = () => f.resize();
	window.addEventListener("resize", H, { passive: !0 });
	function U() {
		let e = 0;
		for (let t of _.values()) {
			let n = t.image;
			n && n.width && (e += n.width * n.height * 4);
		}
		return e;
	}
	function W() {
		ee = !0, L !== null && cancelAnimationFrame(L), I.dispose(), window.removeEventListener("resize", H);
		for (let e of _.values()) e.dispose();
		_.clear(), E.dispose(), D.dispose(), w.remove(O), f.dispose?.();
	}
	return {
		update: B,
		dispose: W,
		pause() {
			te = !0;
		},
		resume() {
			te = !1;
		},
		get index() {
			return S;
		},
		get count() {
			return g.length;
		},
		get progress() {
			return E.uniforms.uProgress.value;
		},
		get transition() {
			return d === 0 ? "crossfade" : "melt";
		},
		isReducedMotion: () => k,
		residentCount: () => _.size,
		vram: U,
		canvas: p.domElement,
		fallback: !1
	};
}
//#endregion
export { e as THREE, Et as createAurora, Y as createBeautyPresenter, mr as createBeforeAfter, Qe as createBuildIn, Ye as createCameraDirector, Zn as createCathedralLight, Bn as createCaustics, yt as createConstellation, st as createDuskSilk, ht as createEdgeField, Ce as createEngineCore, or as createFirstLight, ke as createHeroDirector, Fe as createHeroWipe, Sn as createLattice, Kn as createLetterpress, On as createLiquidMetal, Fn as createLivingInk, gr as createLookReel, gn as createMaterialStudy, Gt as createObservatory, rn as createPixelMorph, Mt as createProductMoment, $e as createShadowRig, Se as showWebGLUnsupported, U as validateSunKeyframes };
