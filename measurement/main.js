import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// ── Background sky color (toggleable via the "Background" checkbox, see
// _initUI) — separate from the terrain mesh, which always stays visible.
// The "on" state is semi-transparent (needs renderer alpha:true, see
// _initRenderer) so the page's own cream background softens it. ──
const BG_COLOR_ON = 0x071a29;   // darker sky blue
const BG_COLOR_ON_ALPHA = 0.45;
const BG_COLOR_OFF = 0xffffff;  // matches the Volcanic gases page

// ── Scan parameters ───────────────────────────────────────────────────────────
const N = 25;
const CD_MAX = 300;          // ppm·m, fixed chart axis scale shared by both scan modes
const STEP_MS = 420;         // ms between each revealed slice

// Per-mode plume profile: a conical scanner's cone sweeps through the plume's
// core (narrow, high peak); a flat scanner's single vertical plane crosses a
// broader swath of it (wider, lower peak, tapering close to zero out toward
// the horizon-end scan angles).
//
// The flat peak is derived from the conical one via the standard slant-to-
// vertical column density relationship, VCD = SCD·cos(θ): the conical scan's
// peak sits almost exactly at the top of its arc (φ≈90°), where — because the
// cone's axis is horizontal with a 60° half-angle — the ray's angle from
// vertical is exactly 30°. So the conical peak is a slant column density (SCD)
// measured at 30° off vertical, and the flat scan (which crosses the plume
// near-vertically) reads close to the true vertical column density (VCD):
// VCD = SCD·cos(30°). The spread stays ~2.2x wider, matching a single flat
// plane crossing a broader swath of the plume than the cone's core.
const CONICAL_HALF_DEG = 60;
const FLAT_ANGLE_FROM_VERTICAL_DEG = 90 - CONICAL_HALF_DEG; // 30°
// coreFalloff: how quickly _sliceCD fades from peak as a ray's closest
// approach moves away from the plume's centerline (see _sliceProximity) —
// the geometry-driven counterpart to the old abstract "sig" width.
const CONICAL_PROFILE = { t: 0.45, sig: 0.06, coreFalloff: 0.45, peak: 300 };
const SCAN_PROFILES = {
    conical: CONICAL_PROFILE,
    flat: {
        t: CONICAL_PROFILE.t,
        sig: CONICAL_PROFILE.sig * 2.2,
        coreFalloff: CONICAL_PROFILE.coreFalloff * 2.2,
        peak: CONICAL_PROFILE.peak * Math.cos(FLAT_ANGLE_FROM_VERTICAL_DEG * Math.PI / 180),
    },
};

// 60° half-cone opening toward +Z (volcano): tip at origin, arc sweeps upper semicircle.
// Matches placeview.js createStationMarker(60) — 3D shape, visible from all angles.
const CONE_HALF_RAD = CONICAL_HALF_DEG * Math.PI / 180;   // half-angle 60° → tan(60°) = 1.732

// World-space direction the plume drifts in, roughly horizontal.
const WIND_DIR = new THREE.Vector3(1, 0, 3).normalize();

// ── Scan cone color (user-selectable, shared with the map view via localStorage) ──
const CONE_COLOR_KEY = 'scanConeColor';
const DEFAULT_CONE_COLOR = '#808080';
function getStoredConeColor(defaultColor = DEFAULT_CONE_COLOR) {
    return localStorage.getItem(CONE_COLOR_KEY) || defaultColor;
}

// Builds a scan-cone-shaped swatch button: a hidden native <input type="color">
// (so the OS picker still works) overlaid with an SVG fan icon that renders in
// the currently picked color, standing in for the plain browser swatch.
function createConeColorPicker(onChange) {
    const wrap = document.createElement('div');
    wrap.title = 'Beam cone color';
    wrap.className = 'cone-color-picker btn btn--pill btn--outline';

    const label = document.createElement('span');
    label.textContent = 'Beam color';
    wrap.appendChild(label);

    const NS = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(NS, 'svg');
    icon.setAttribute('viewBox', '0 0 32 24');
    icon.setAttribute('width', '26');
    icon.setAttribute('height', '20');
    icon.style.pointerEvents = 'none';

    const fan = document.createElementNS(NS, 'path');
    fan.setAttribute('d', 'M2,22 A14,14 0 0 1 30,22 Z');
    fan.setAttribute('fill-opacity', '0.55');
    icon.appendChild(fan);

    [135, 90, 45].forEach(deg => {
        const rad = deg * Math.PI / 180;
        const line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', '16');
        line.setAttribute('y1', '22');
        line.setAttribute('x2', (16 + 14 * Math.cos(rad)).toFixed(2));
        line.setAttribute('y2', (22 - 14 * Math.sin(rad)).toFixed(2));
        line.setAttribute('stroke-width', '1');
        icon.appendChild(line);
    });

    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', '16');
    dot.setAttribute('cy', '22');
    dot.setAttribute('r', '3');
    dot.setAttribute('fill', '#e0a500');
    icon.appendChild(dot);
    wrap.appendChild(icon);

    const applyColor = hex => {
        fan.setAttribute('fill', hex);
        fan.setAttribute('stroke', hex);
        icon.querySelectorAll('line').forEach(l => l.setAttribute('stroke', hex));
    };

    const input = document.createElement('input');
    input.type = 'color';
    input.value = getStoredConeColor();
    input.setAttribute('list', 'coneColorPresets');
    input.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; opacity:0; border:0; padding:0; margin:0; cursor:pointer;';
    input.addEventListener('input', () => {
        localStorage.setItem(CONE_COLOR_KEY, input.value);
        applyColor(input.value);
        onChange(input.value);
    });
    wrap.appendChild(input);

    // Suggested-color swatch: the closest a web page can get to seeding the
    // OS color picker's custom-color slots (there's no API for that).
    const presets = document.createElement('datalist');
    presets.id = 'coneColorPresets';
    presets.innerHTML = `<option value="${DEFAULT_CONE_COLOR}" label="Default"></option>`;
    wrap.appendChild(presets);

    applyColor(input.value);
    return wrap;
}

// ── Slice math (per-slice column density & scan angle) ────────────────────────
// φ=0 (left, +X local) → −90°; φ=π (right, −X local) → +90°
// (forward = local +Z toward the volcano, up = +Y ⇒ right = forward×up = local −X)
function sliceScanAngle(i) {
    return ((i + 0.5) / N) * 180 - 90;
}

// ── Heatmap color mapping ──────────────────────────────────────────────────────
// White → yellow → orange → red → dark red heatmap. Unlike HEAT_PALETTE in
// map/src/main.js (discrete bands, since it classifies distinct stations), this
// interpolates smoothly between stops: the scan's plume profile is a continuous
// Gaussian, and with a narrow spread only 1-2 slices actually fall in each
// discrete band's range, so flooring to a hard band was skipping straight from
// white to red/dark-red without ever showing yellow/orange. The scene clears
// to a light blue by default (BG_COLOR_ON, toggleable — see _initUI's
// "Background" checkbox), so "outside the plume" slices (plain white) still
// stand out against it; toggled off, it falls back to white (BG_COLOR_OFF,
// matching the Volcanic gases page), where those slices blend in instead.
const CD_COLOR_STOPS = ["#ffffff", "#FEF001", "#fdba01", "#ff5e00", "#e0341f", "#8b0000"]
    .map(hex => new THREE.Color(hex));

function cdColor(cd) {
    const t = Math.min(1, Math.max(0, cd / CD_MAX));
    const segCount = CD_COLOR_STOPS.length - 1;
    const scaled = t * segCount;
    const idx = Math.min(segCount - 1, Math.floor(scaled));
    const localT = scaled - idx;
    return new THREE.Color().lerpColors(CD_COLOR_STOPS[idx], CD_COLOR_STOPS[idx + 1], localT);
}

// Low-concentration (white) slices fade in more than high-concentration
// (warm) ones, so an empty part of the sweep reads as faint/see-through
// while the actual plume signal stays clearly visible. Used for the 3D
// scan-plane slices (see the MeshBasicMaterial below); the flat chart bars
// and transmittance line use cdColorCss directly, unaffected.
const CD_MIN_OPACITY = 0.15;
const CD_MAX_OPACITY = 0.6;
function cdOpacity(cd) {
    const t = Math.min(1, Math.max(0, cd / CD_MAX));
    return CD_MIN_OPACITY + (CD_MAX_OPACITY - CD_MIN_OPACITY) * t;
}

function cdColorCss(cd) {
    // getHexString() converts three.js's internal linear-light r/g/b back to sRGB.
    // Building "rgb(r*255,...)" straight from those linear values (as this used to)
    // silently darkens every color — worst for the darkest stop, whose intended
    // #8b0000 (139,0,0) rendered as roughly rgb(66,0,0), nearly invisible against
    // the chart panel's near-black background.
    return `#${cdColor(cd).getHexString()}`;
}

// ── SO2 transmittance spectrum ─────────────────────────────────────────────────
// SO2_transmission.csv columns are the modelled transmittance at each
// wavelength for a set of column densities (ppm·m); it ramps CD_0..CD_1000
// then mirrors back down, so only the first ascending half is unique.
const CSV_CD_STEPS = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

function parseTransmissionCsv(text) {
    const rows = text.trim().split('\n').slice(1);
    const wavelengths = new Float64Array(rows.length);
    const trans = CSV_CD_STEPS.map(() => new Float64Array(rows.length));
    rows.forEach((line, r) => {
        const cols = line.split(',');
        wavelengths[r] = parseFloat(cols[0]);
        for (let s = 0; s < CSV_CD_STEPS.length; s++) {
            trans[s][r] = parseFloat(cols[s + 1]);
        }
    });
    return { wavelengths, trans };
}

// The demo's scan tops out at CD_MAX (ppm·m) while the CSV spans 0-1000, so
// scale the peak scan CD onto the CSV's full range to get a visible dip.
const CSV_CD_SCALE = CSV_CD_STEPS[CSV_CD_STEPS.length - 1] / CD_MAX;

// Linear interpolation of the transmittance spectrum at an arbitrary column density
function transmittanceAt(spectrum, cd) {
    const steps = CSV_CD_STEPS;
    const clamped = Math.min(steps[steps.length - 1], Math.max(0, cd * CSV_CD_SCALE));
    let i = 0;
    while (i < steps.length - 2 && steps[i + 1] < clamped) i++;
    const lo = steps[i], hi = steps[i + 1];
    const frac = hi === lo ? 0 : (clamped - lo) / (hi - lo);
    const a = spectrum.trans[i], b = spectrum.trans[i + 1];
    const n = spectrum.wavelengths.length;
    const out = new Float64Array(n);
    for (let k = 0; k < n; k++) out[k] = a[k] + (b[k] - a[k]) * frac;
    return out;
}

// ── Smoke puff texture (soft radial gradient, cached & reused across sprites) ──
let smokeTexture = null;
function getSmokeTexture() {
    if (smokeTexture) return smokeTexture;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const c = size / 2;
    const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
    gradient.addColorStop(0,   'rgba(225,225,230,0.8)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.4)');
    gradient.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    smokeTexture = new THREE.CanvasTexture(canvas);
    return smokeTexture;
}

// ── Main view class ───────────────────────────────────────────────────────────
class MeasurementView {
    constructor() {
        this.sliceMeshes = [];
        this.barEls = [];
        this.currentSlice = 0;
        this.animating = false;
        this.ready = false;
        this.scanMode = 'conical';

        this.spectrum = null;

        this._initRenderer();
        this._initScene();
        this._initChart();
        this._initTransmittanceChart();
        this._initScanModeUI();
        this._initUI();
        this._loadTerrain();
        this._loadSpectrum();

        this.renderer.setAnimationLoop(() => {
            this.renderer.render(this.scene, this.camera);
        });
    }

    // Column density for slice i: driven by how close that slice's actual 3D
    // ray gets to the plume's centerline (see _recomputeSliceProximities), so
    // the warm colors are guaranteed to line up with where the sweep
    // geometrically enters/exits the plume, fading smoothly at the edges
    // rather than being switched on/off against an unrelated value. With
    // only N discrete ray directions, the single closest one essentially
    // never lands exactly on the centerline (prox=0) — cd is normalized
    // relative to whichever slice got closest, so that slice always reaches
    // the profile's true peak instead of falling visibly short of it. Falls
    // back to an abstract profile shape only before the terrain/plume/
    // station have loaded (e.g. the very first chart build) —
    // _updateChartBars() re-syncs once ready.
    _sliceCD(i) {
        const p = SCAN_PROFILES[this.scanMode];
        if (!this._sliceProx) this._recomputeSliceProximities();
        const prox = this._sliceProx[i];
        if (!isFinite(prox)) {
            const t = (i + 0.5) / N;
            return p.peak * Math.exp(-((t - p.t) ** 2) / (2 * p.sig ** 2));
        }
        const rel = prox - this._sliceBestProx; // 0 for whichever slice got closest
        return p.peak * Math.exp(-(rel * rel) / (2 * p.coreFalloff * p.coreFalloff));
    }

    // Computes and caches _sliceProximity(i) for every slice under the
    // current mode/geometry, plus the smallest (closest) value found — call
    // whenever the mode or station/fan geometry changes, before _sliceCD
    // is used again.
    _recomputeSliceProximities() {
        this._sliceProx = [];
        let best = Infinity;
        for (let i = 0; i < N; i++) {
            const prox = this._sliceProximity(i);
            this._sliceProx.push(prox);
            if (isFinite(prox) && prox < best) best = prox;
        }
        this._sliceBestProx = best;
    }

    // Closest approach (normalized) of slice i's ray to the plume's
    // centerline, sampled along the ray from station to rim. Reuses the same
    // rise/drift/spread formula _buildPlume scatters its sprites with (minus
    // the jitter) as the plume's deterministic "tube" shape.
    _sliceProximity(i) {
        if (!this.summit || !this._plumeHeight || !this._fanGroup || !this._fanParams || !this._fanOrigin) return Infinity;
        const { r, coneLen, R } = this._fanParams;
        const phiMid = ((i + 0.5) / N) * Math.PI;
        const localPoint = new THREE.Vector3(...this._fanPoint(phiMid, r, coneLen, R));
        const worldPoint = this._fanGroup.localToWorld(localPoint.clone());
        const origin = this._fanGroup.localToWorld(this._fanOrigin.clone());

        const perp = new THREE.Vector3(-WIND_DIR.z, 0, WIND_DIR.x); // horizontal, across the wind
        const plumeHeight = this._plumeHeight;
        const SAMPLES = 120;
        const sample = new THREE.Vector3();
        const center = new THREE.Vector3();
        let best = Infinity;
        for (let s = 0; s <= SAMPLES; s++) {
            sample.copy(origin).lerp(worldPoint, s / SAMPLES);
            const drift = Math.max(0, sample.clone().sub(this.summit).dot(WIND_DIR));
            const t = Math.min(1, drift / (plumeHeight * 2.0));

            center.copy(this.summit).addScaledVector(WIND_DIR, drift);
            center.y += plumeHeight * (0.05 + 0.35 * Math.sqrt(t));
            const spread = plumeHeight * (0.05 + 0.20 * t);

            const offset = sample.clone().sub(center);
            const dPerp = offset.dot(perp);
            const dUp = offset.y;
            // Sprite jitter is an ellipse: full spread across-wind, 0.35x vertically.
            const norm = Math.sqrt((dPerp / spread) ** 2 + (dUp / (spread * 0.35)) ** 2);
            if (norm < best) best = norm;
        }
        return best;
    }


    // ── Renderer setup ──────────────────────────────────────────────────────
    _initRenderer() {
        this.canvas = document.getElementById('threeCanvas');
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, canvas: this.canvas });
        this.renderer.setClearColor(BG_COLOR_ON, BG_COLOR_ON_ALPHA);
        this._resize();
        window.addEventListener('resize', () => this._resize());
    }

    _resize() {
        const w = window.innerWidth, h = window.innerHeight;
        this.canvas.width = w;
        this.canvas.height = h;
        if (this.camera) {
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
        }
        this.renderer.setSize(w, h);
    }

    // ── Scene, camera & lighting setup ──────────────────────────────────────
    _initScene() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100);
        this.camera.position.set(0.5, 0.5, 0.5);

        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.maxPolarAngle = Math.PI / 2.1;

        this.scene.add(new THREE.AmbientLight(0xffffff, 1.2));
        const pt = new THREE.PointLight(0xffffff, 300);
        pt.position.set(0, 2, 0);
        this.scene.add(pt);
    }

    // ── Terrain loading (finds summit, positions camera, builds plume & station) ──
    _loadTerrain() {
        const loader = new GLTFLoader();
        loader.setMeshoptDecoder(MeshoptDecoder);
        loader.load('../map/resources/terrainMeshes/mayon_13km.glb', gltf => {
            const model = gltf.scene;
            this.scene.add(model);
            this._terrainModel = model;

            const bbox = new THREE.Box3().setFromObject(model);
            const center = bbox.getCenter(new THREE.Vector3());
            const size = bbox.getSize(new THREE.Vector3());
            const extent = Math.max(size.x, size.z);

            // Position camera to give a nice starting view
            const d = extent * 0.9;
            this.camera.position.set(center.x + d * 0.7, center.y + d * 0.8, center.z + d * 0.7);
            this.controls.target.copy(center);
            this.controls.update();

            // Find summit peak in world space so it matches station coordinates
            let peakY = -Infinity, peakX = center.x, peakZ = center.z;
            const _wp = new THREE.Vector3();
            model.traverse(child => {
                if (!child.isMesh) return;
                const pos = child.geometry.attributes.position;
                for (let i = 0; i < pos.count; i++) {
                    _wp.fromBufferAttribute(pos, i);
                    child.localToWorld(_wp);
                    if (_wp.y > peakY) {
                        peakY = _wp.y;
                        peakX = _wp.x;
                        peakZ = _wp.z;
                    }
                }
            });
            this.summit = new THREE.Vector3(peakX, peakY, peakZ);

            this._buildPlume(this.summit, extent * 0.38);
            this._buildStation(model, bbox, center, size, extent);
            // The chart's initial bars were built via _sliceCD's abstract
            // fallback (geometry wasn't ready yet) — now that it is, re-sync
            // them to the real geometry-based column densities.
            this._updateChartBars();
            this.ready = true;
            this.playBtn.disabled = false;
        }, undefined, err => console.error('Failed to load terrain:', err));
    }

    // ── Station marker & scan cone geometry ─────────────────────────────────
    _buildStation(terrain, bbox, center, size, extent) {
        // Sit directly on the downwind ray from the summit (same direction the
        // plume drifts in _buildPlume) so the plume centerline passes straight
        // over the station instead of drifting past it off to one side.
        const downwindDist = extent * 0.45;
        const sx = this.summit.x + WIND_DIR.x * downwindDist;
        const sz = this.summit.z + WIND_DIR.z * downwindDist;

        const ray = new THREE.Raycaster(
            new THREE.Vector3(sx, bbox.max.y + 1, sz),
            new THREE.Vector3(0, -1, 0)
        );
        const hits = ray.intersectObject(terrain, true);
        const sy = hits.length ? hits[0].point.y : bbox.min.y;

        const group = new THREE.Group();
        group.position.set(sx, sy, sz);
        // Rotate so local +Z faces the volcano summit
        group.rotation.y = Math.atan2(this.summit.x - sx, this.summit.z - sz);

        // Cone length: extend 1.1× past the summit so rays go through the plume
        const horizDist = Math.sqrt((this.summit.x - sx) ** 2 + (this.summit.z - sz) ** 2);
        const distToSummit = Math.sqrt(horizDist ** 2 + (this.summit.y - sy) ** 2);
        const coneLen = distToSummit * 0.6;
        const r = coneLen * Math.tan(CONE_HALF_RAD);  // base radius at tip of cone
        const R = Math.sqrt(r * r + coneLen * coneLen); // distance from tip to rim, either mode

        // Small instrument: upright mast + horizontal telescope tube on top,
        // echoing the antenna-like "Remote sensing" icon, instead of a plain
        // box. The scan fan's tip sits at the telescope's height (see
        // _fanOrigin below), not the ground.
        const bs = extent * 0.018;
        const instMat = new THREE.MeshStandardMaterial({ color: 0x4d4d4d }); // mast/antenna: dark gray
        // Unlit (MeshBasicMaterial), not MeshStandardMaterial like the other
        // parts: at this dark a color, per-face lighting differences would
        // make some faces (or stations facing away from the light) render
        // as nearly pure black instead of a consistent blue.
        const boxMat = new THREE.MeshBasicMaterial({ color: 0x3d7ea6 }); // box: lighter blue, for visibility
        const telescopeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a }); // telescope/antenna: black
        const mastH = bs * 3;
        const mastR = bs * 0.12;

        const mast = new THREE.Mesh(new THREE.CylinderGeometry(mastR, mastR, mastH, 8), instMat);
        mast.position.y = mastH / 2;
        group.add(mast);

        const telescopeLen = bs * 1.4;
        const telescope = new THREE.Mesh(
            new THREE.CylinderGeometry(bs * 0.18, bs * 0.18, telescopeLen, 12),
            telescopeMat
        );
        telescope.rotation.x = Math.PI / 2; // axis along local Z (horizontal, facing the volcano)
        // Pivoted near the volcano-facing end, so most of the tube's bulk
        // extends back away from the volcano rather than out toward it.
        telescope.position.set(0, mastH, -telescopeLen * 0.3);
        group.add(telescope);

        // Small electronics box mounted on (flush against) the lower third
        // of the mast, facing the volcano.
        const boxDepth = bs * 0.35;
        const mastBox = new THREE.Mesh(
            new THREE.BoxGeometry(bs * 0.6, bs * 0.5, boxDepth),
            boxMat
        );
        mastBox.position.set(0, mastH / 3, mastR + boxDepth / 2);
        group.add(mastBox);

        // Thin whip antenna on the mast, between the box and the telescope —
        // horizontal (sticking out sideways) so it reads clearly against
        // the mast instead of blending into it.
        const antennaLen = bs * 0.9;
        const antenna = new THREE.Mesh(
            new THREE.CylinderGeometry(bs * 0.03, bs * 0.03, antennaLen, 6),
            telescopeMat
        );
        antenna.rotation.z = Math.PI / 2; // axis along local X, horizontal, sideways
        antenna.position.set(mastR + antennaLen / 2, mastH * 0.65, 0);
        group.add(antenna);

        // Small vertical radiating elements crossing through the horizontal
        // rod (extending both above and below it), like a Yagi antenna's
        // prongs.
        const elementH = bs * 0.3;
        [0.1, 0.25, 0.4, 0.55, 0.7, 0.85].forEach(f => {
            const el = new THREE.Mesh(
                new THREE.CylinderGeometry(bs * 0.015, bs * 0.015, elementH, 6),
                telescopeMat
            );
            el.position.set(mastR + antennaLen * f, mastH * 0.65, 0);
            group.add(el);
        });

        this._fanGroup = group;
        this._fanParams = { r, coneLen, R };
        // The fan's tip sits near the far end of the telescope's larger rear
        // bulk (not its center, and not the shorter forward tip), and at
        // the telescope's height, not the ground.
        this._fanOrigin = new THREE.Vector3(0, mastH, -telescopeLen * 0.7);
        // group isn't in the scene graph yet, so its matrixWorld (needed by
        // _sliceProximity's localToWorld calls inside _buildFan) hasn't been
        // computed automatically — force it before the first build.
        group.updateMatrixWorld(true);
        this._buildFan();

        this.scene.add(group);
    }

    // Rim point for the current scan mode, φ sweeping [0, π] (right → top → left).
    // Conical: rim traces a flat circle at z=coneLen, so tip+rim form a true cone
    // (matches placeview.js createStationMarker(60), same 60° half-angle).
    // Flat: rim traces a semicircle of the same tip-to-rim distance R, but at
    // z=0 — the local x-y (up/right) plane, whose normal is the local z (forward)
    // axis. Forward already points upwind toward the summit (see downwindDist in
    // _buildStation), so this plane sits perpendicular to the plume's drift path,
    // the real setup for a flat-scanning instrument: the plume crosses the fixed
    // plane rather than the plane sweeping around to track it.
    // Result is relative to the fan's tip (_fanOrigin, at the telescope's
    // height), not the group's local (0,0,0) — offset already included.
    _fanPoint(phi, r, coneLen, R) {
        const o = this._fanOrigin;
        if (this.scanMode === 'flat') {
            return [o.x + R * Math.cos(phi), o.y + R * Math.sin(phi), o.z];
        }
        return [o.x + r * Math.cos(phi), o.y + r * Math.sin(phi), o.z + coneLen];
    }

    // (Re)builds the slice meshes + wireframe for the current scan mode, reusing
    // the station's existing group/position so this can be called again on a
    // mode switch without re-running the terrain raycast.
    _buildFan() {
        const { r, coneLen, R } = this._fanParams;
        const group = this._fanGroup;

        // Ray directions changed (new mode or first build) — proximities
        // (and therefore _sliceCD's normalization) must be recomputed.
        this._recomputeSliceProximities();

        this.sliceMeshes.forEach(m => {
            group.remove(m);
            m.geometry.dispose();
            m.material.dispose();
        });
        this.sliceMeshes = [];
        if (this._wireSegments) {
            group.remove(this._wireSegments);
            this._wireSegments.geometry.dispose();
        }

        // Slices: tip at _fanOrigin (telescope height), arc per _fanPoint.
        // Upper half only, visible from all angles.
        const tip = this._fanOrigin.toArray();
        for (let i = 0; i < N; i++) {
            const phi1 = (i / N) * Math.PI;
            const phi2 = ((i + 1) / N) * Math.PI;
            const cd = this._sliceCD(i);
            const p1 = this._fanPoint(phi1, r, coneLen, R);
            const p2 = this._fanPoint(phi2, r, coneLen, R);

            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.Float32BufferAttribute([
                ...tip,
                ...p1,
                ...p2,
            ], 3));

            const mat = new THREE.MeshBasicMaterial({
                color: cdColor(cd),
                side: THREE.DoubleSide,
                transparent: true,
                opacity: cdOpacity(cd),
                visible: false,
            });

            const mesh = new THREE.Mesh(geom, mat);
            this.sliceMeshes.push(mesh);
            group.add(mesh);
        }

        // Wireframe: spokes from tip to arc, plus arc segments
        const wv = [];
        for (let i = 0; i <= N; i++) {
            const phi = (i / N) * Math.PI;
            wv.push(...tip, ...this._fanPoint(phi, r, coneLen, R));
        }
        for (let i = 0; i < N; i++) {
            const phi1 = (i / N) * Math.PI;
            const phi2 = ((i + 1) / N) * Math.PI;
            wv.push(
                ...this._fanPoint(phi1, r, coneLen, R),
                ...this._fanPoint(phi2, r, coneLen, R)
            );
        }
        const wGeom = new THREE.BufferGeometry();
        wGeom.setAttribute('position', new THREE.Float32BufferAttribute(wv, 3));
        if (!this.coneWireMat) {
            this.coneWireMat = new THREE.LineBasicMaterial({
                color: getStoredConeColor(), transparent: true, opacity: 0.4
            });
        }
        this._wireSegments = new THREE.LineSegments(wGeom, this.coneWireMat);
        group.add(this._wireSegments);
    }

    // ── Bar chart SO2─────────────────────────────────────────────────────────────
    _initChart() {
        const NS = 'http://www.w3.org/2000/svg';
        const W = 268, H = 162;
        const M = { t: 8, r: 8, b: 32, l: 38 };
        const iW = W - M.l - M.r;
        const iH = H - M.t - M.b;

        const panel = document.createElement('div');
        panel.className = 'chart-panel chart-panel--cd';

        const title = document.createElement('div');
        title.textContent = 'SO₂ column density / ppm·m';
        title.className = 'chart-panel__title';
        panel.appendChild(title);

        const infoBtn = document.createElement('button');
        infoBtn.type = 'button';
        infoBtn.className = 'btn btn--icon btn--icon-sm btn--outline info-btn chart-panel__info-btn';
        infoBtn.setAttribute('aria-label', 'Column density info');
        infoBtn.textContent = 'ℹ';
        panel.appendChild(infoBtn);

        const infoDialog = document.createElement('dialog');
        infoDialog.className = 'chart-info-dialog';
        const infoCloseBtn = document.createElement('button');
        infoCloseBtn.type = 'button';
        infoCloseBtn.className = 'btn btn--icon btn--outline chart-info-dialog__close';
        infoCloseBtn.setAttribute('aria-label', 'Close');
        infoCloseBtn.textContent = '✕';
        const infoText = document.createElement('p');
        infoText.textContent = 'In atmospheric physics and remote sensing, the ppm⋅m (parts per million-meter) is a widely used unit for Slant Column Density (SCD). It represents the integrated concentration of sulfur dioxide (SO₂) along an optical path.';
        infoDialog.appendChild(infoCloseBtn);
        infoDialog.appendChild(infoText);
        document.body.appendChild(infoDialog);

        infoBtn.addEventListener('click', () => infoDialog.showModal());
        infoCloseBtn.addEventListener('click', () => infoDialog.close());
        infoDialog.addEventListener('click', (e) => {
            if (e.target === infoDialog) infoDialog.close();
        });

        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('width', W);
        svg.setAttribute('height', H);

        const g = document.createElementNS(NS, 'g');
        g.setAttribute('transform', `translate(${M.l},${M.t})`);

        const mkLine = (x1, y1, x2, y2, stroke = '#555') => {
            const el = document.createElementNS(NS, 'line');
            el.setAttribute('x1', x1); el.setAttribute('y1', y1);
            el.setAttribute('x2', x2); el.setAttribute('y2', y2);
            el.setAttribute('stroke', stroke);
            return el;
        };

        g.appendChild(mkLine(0, iH, iW, iH));  // x-axis
        g.appendChild(mkLine(0, 0, 0, iH));     // y-axis

        // Horizontal grid lines
        [100, 200, 300].forEach(v => {
            const y = iH - (v / CD_MAX) * iH;
            g.appendChild(mkLine(0, y, iW, y, '#cfc9b8'));
        });

        // X ticks: scan angle, −90 (left) → +90 (right)
        [-90, -45, 0, 45, 90].forEach(a => {
            const x = (a + 90) / 180 * iW;
            g.appendChild(mkLine(x, iH, x, iH + 4));
            const lbl = document.createElementNS(NS, 'text');
            lbl.setAttribute('x', x); lbl.setAttribute('y', iH + 14);
            lbl.setAttribute('text-anchor', 'middle');
            lbl.setAttribute('font-size', 9);
            lbl.setAttribute('fill', '#2b2b2b');
            lbl.textContent = a;
            g.appendChild(lbl);
        });

        // X axis label
        const xLbl = document.createElementNS(NS, 'text');
        xLbl.setAttribute('x', iW / 2); xLbl.setAttribute('y', H - M.t - 3);
        xLbl.setAttribute('text-anchor', 'middle');
        xLbl.setAttribute('font-size', 9);
        xLbl.setAttribute('fill', '#2b2b2b');
        xLbl.textContent = 'scan angle / deg';
        g.appendChild(xLbl);

        // Y ticks
        [0, 100, 200, 300].forEach(v => {
            const y = iH - (v / CD_MAX) * iH;
            g.appendChild(mkLine(-4, y, 0, y));
            const lbl = document.createElementNS(NS, 'text');
            lbl.setAttribute('x', -7); lbl.setAttribute('y', y + 3);
            lbl.setAttribute('text-anchor', 'end');
            lbl.setAttribute('font-size', 9);
            lbl.setAttribute('fill', '#2b2b2b');
            lbl.textContent = v;
            g.appendChild(lbl);
        });

        // Pre-create bars (invisible), one per slice
        this._chartIH = iH;
        const bw = (iW / N) * 0.82;
        this.barEls = [];
        for (let i = 0; i < N; i++) {
            const cd = this._sliceCD(i);
            const angle = sliceScanAngle(i);
            const bx = (angle + 90) / 180 * iW - bw / 2;
            const bh = Math.max(0, (cd / CD_MAX) * iH);

            const rect = document.createElementNS(NS, 'rect');
            rect.setAttribute('x', bx);
            rect.setAttribute('y', iH - bh);
            rect.setAttribute('width', bw);
            rect.setAttribute('height', bh);
            rect.setAttribute('fill', cdColorCss(cd));
            rect.setAttribute('opacity', 0);
            g.appendChild(rect);
            this.barEls.push(rect);
        }

        svg.appendChild(g);
        panel.appendChild(svg);
        // Anchored inside .scan-viewport (not fixed to the viewport) so it
        // scrolls away with the scanning view instead of staying pinned
        // over the footer/credits below.
        document.querySelector('.scan-viewport').appendChild(panel);
        this.chartPanel = panel;
    }

    _loadSpectrum() {
        fetch('./SO2_transmission.csv')
            .then(r => r.text())
            .then(text => { this.spectrum = parseTransmissionCsv(text); })
            .catch(err => console.error('Failed to load SO2 transmission spectrum:', err));
    }

    // ── Transmittance line chart (mirrors the CD bar chart, keyed by CD) ──────
    _initTransmittanceChart() {
        const NS = 'http://www.w3.org/2000/svg';
        const W = 268, H = 162;
        const M = { t: 8, r: 8, b: 32, l: 30 };
        const iW = W - M.l - M.r;
        const iH = H - M.t - M.b;
        const wMin = 300, wMax = 330;

        const panel = document.createElement('div');
        panel.className = 'chart-panel chart-panel--trans';

        const title = document.createElement('div');
        title.textContent = 'SO₂ transmittance / wavelength';
        title.className = 'chart-panel__title';
        panel.appendChild(title);

        const infoBtn = document.createElement('button');
        infoBtn.type = 'button';
        infoBtn.className = 'btn btn--icon btn--icon-sm btn--outline info-btn chart-panel__info-btn';
        infoBtn.setAttribute('aria-label', 'Transmittance info');
        infoBtn.textContent = 'ℹ';
        panel.appendChild(infoBtn);

        const infoDialog = document.createElement('dialog');
        infoDialog.className = 'chart-info-dialog';
        const infoCloseBtn = document.createElement('button');
        infoCloseBtn.type = 'button';
        infoCloseBtn.className = 'btn btn--icon btn--outline chart-info-dialog__close';
        infoCloseBtn.setAttribute('aria-label', 'Close');
        infoCloseBtn.textContent = '✕';
        const infoText = document.createElement('p');
        infoText.textContent = 'Transmittance is the capacity of a material to allow light or other electromagnetic radiation to pass through it. It is calculated as the ratio of transmitted light intensity (I) to the incident light intensity (I₀) that enters the substance, often expressed as a fraction or a percentage. It changes with wavelength because materials absorb, reflect, or scatter specific colors or frequencies of light differently. This spectral variation defines a substance\'s unique optical and color properties.';
        infoDialog.appendChild(infoCloseBtn);
        infoDialog.appendChild(infoText);
        document.body.appendChild(infoDialog);

        infoBtn.addEventListener('click', () => infoDialog.showModal());
        infoCloseBtn.addEventListener('click', () => infoDialog.close());
        infoDialog.addEventListener('click', (e) => {
            if (e.target === infoDialog) infoDialog.close();
        });

        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('width', W);
        svg.setAttribute('height', H);

        const g = document.createElementNS(NS, 'g');
        g.setAttribute('transform', `translate(${M.l},${M.t})`);

        const mkLine = (x1, y1, x2, y2, stroke = '#555') => {
            const el = document.createElementNS(NS, 'line');
            el.setAttribute('x1', x1); el.setAttribute('y1', y1);
            el.setAttribute('x2', x2); el.setAttribute('y2', y2);
            el.setAttribute('stroke', stroke);
            return el;
        };

        g.appendChild(mkLine(0, iH, iW, iH));  // x-axis
        g.appendChild(mkLine(0, 0, 0, iH));     // y-axis

        // Horizontal grid lines
        [0.25, 0.5, 0.75].forEach(v => {
            const y = iH - v * iH;
            g.appendChild(mkLine(0, y, iW, y, '#cfc9b8'));
        });

        // Y ticks: transmittance 0..1
        [0, 0.5, 1].forEach(v => {
            const y = iH - v * iH;
            g.appendChild(mkLine(-4, y, 0, y));
            const lbl = document.createElementNS(NS, 'text');
            lbl.setAttribute('x', -7); lbl.setAttribute('y', y + 3);
            lbl.setAttribute('text-anchor', 'end');
            lbl.setAttribute('font-size', 9);
            lbl.setAttribute('fill', '#2b2b2b');
            lbl.textContent = v;
            g.appendChild(lbl);
        });

        // X ticks: wavelength / nm
        [300, 310, 320, 330].forEach(w => {
            const x = ((w - wMin) / (wMax - wMin)) * iW;
            g.appendChild(mkLine(x, iH, x, iH + 4));
            const lbl = document.createElementNS(NS, 'text');
            lbl.setAttribute('x', x); lbl.setAttribute('y', iH + 14);
            lbl.setAttribute('text-anchor', 'middle');
            lbl.setAttribute('font-size', 9);
            lbl.setAttribute('fill', '#2b2b2b');
            lbl.textContent = w;
            g.appendChild(lbl);
        });

        // X axis label
        const xLbl = document.createElementNS(NS, 'text');
        xLbl.setAttribute('x', iW / 2); xLbl.setAttribute('y', H - M.t - 3);
        xLbl.setAttribute('text-anchor', 'middle');
        xLbl.setAttribute('font-size', 9);
        xLbl.setAttribute('fill', '#2b2b2b');
        xLbl.textContent = 'wavelength / nm';
        g.appendChild(xLbl);

        const path = document.createElementNS(NS, 'path');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#4fc3f7');
        path.setAttribute('stroke-width', 1.5);
        g.appendChild(path);
        this.transPath = path;
        this._transScale = { wMin, wMax, iW, iH };

        svg.appendChild(g);
        panel.appendChild(svg);
        // Anchored inside .scan-viewport (not fixed to the viewport) so it
        // scrolls away with the scanning view instead of staying pinned
        // over the footer/credits below.
        document.querySelector('.scan-viewport').appendChild(panel);
        this.transChartPanel = panel;
    }

    _updateTransmittance(cd) {
        if (!this.spectrum || !this.transPath) return;
        const curve = transmittanceAt(this.spectrum, cd);
        const { wMin, wMax, iW, iH } = this._transScale;
        const wl = this.spectrum.wavelengths;
        const n = wl.length;
        const step = Math.max(1, Math.floor(n / 300)); // downsample for a lighter path
        let d = '';
        for (let k = 0; k < n; k += step) {
            const x = ((wl[k] - wMin) / (wMax - wMin)) * iW;
            const y = iH - curve[k] * iH;
            d += (k === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
        }
        this.transPath.setAttribute('d', d);
        this.transPath.setAttribute('stroke', cdColorCss(cd));
    }

    // ── Controls (merged into .scan-mode-panel -- see _initScanModeUI) ──────
    _initUI() {
        const terrainLabel = document.createElement('label');
        terrainLabel.className = 'terrain-toggle';
        const terrainCheckbox = document.createElement('input');
        terrainCheckbox.type = 'checkbox';
        terrainCheckbox.checked = true;
        terrainCheckbox.addEventListener('change', () => {
            if (terrainCheckbox.checked) {
                this.renderer.setClearColor(BG_COLOR_ON, BG_COLOR_ON_ALPHA);
            } else {
                this.renderer.setClearColor(BG_COLOR_OFF, 1);
            }
        });
        const terrainSlider = document.createElement('span');
        terrainSlider.className = 'terrain-toggle__slider';
        terrainLabel.appendChild(terrainCheckbox);
        terrainLabel.appendChild(terrainSlider);
        terrainLabel.appendChild(document.createTextNode('Background'));
        this.scanModePanel.insertBefore(terrainLabel, this.scanModeHint);

        this.playBtn = document.createElement('button');
        this.playBtn.textContent = '▶  Start scan';
        this.playBtn.disabled = true;
        this.playBtn.className = 'btn btn--pill btn--outline scan-play-btn';
        this.playBtn.addEventListener('click', () => this._startScan());
        this.scanModePanel.insertBefore(this.playBtn, this.scanModeHint);

        this.scanModePanel.insertBefore(
            createConeColorPicker(hex => {
                if (this.coneWireMat) this.coneWireMat.color.set(hex);
            }),
            this.scanModeHint
        );
    }

    // ── Scanning geometry + all scan controls, one panel (right side) ──────
    _initScanModeUI() {
        const panel = document.createElement('div');
        panel.className = 'scan-mode-panel';

        const label = document.createElement('div');
        label.className = 'scan-mode-panel__label';
        label.textContent = 'Scanning geometry';
        panel.appendChild(label);

        const options = document.createElement('div');
        options.className = 'scan-mode-panel__options';

        this.scanModeBtns = ['conical', 'flat'].map(mode => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn--pill btn--outline scan-mode-btn';
            btn.textContent = mode === 'conical' ? 'Conical' : 'Flat';
            btn.dataset.mode = mode;
            const active = mode === this.scanMode;
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            if (active) btn.classList.add('is-active');
            btn.addEventListener('click', () => this._setScanMode(mode));
            options.appendChild(btn);
            return btn;
        });
        panel.appendChild(options);

        // Appended next, but _initUI() (which runs right after this) inserts
        // its controls (Background/Start scan/Beam color) before this node,
        // via this.scanModeHint, so those still land above it.
        const hint = document.createElement('div');
        hint.className = 'scan-mode-panel__hint';
        hint.textContent = 'You can control the view direction and zoom level';
        panel.appendChild(hint);
        this.scanModeHint = hint;

        // Previously its own standalone .scan-hint box in the lower-left --
        // appended last (after _initUI() has already run its insertBefore
        // calls against scanModeHint above), so this is the actual last
        // item in the panel regardless.
        const description = document.createElement('div');
        description.className = 'scan-mode-panel__description';
        description.textContent = 'A ground-based scanner sweeps from horizon to horizon, measuring SO₂ column density at each angle to profile the volcanic plume';
        panel.appendChild(description);

        document.querySelector('.scan-viewport').appendChild(panel);
        this.scanModePanel = panel;
    }

    // ── Animation ────────────────────────────────────────────────────────────
    _startScan() {
        if (this.animating || !this.ready) return;
        this._reset();
        this.animating = true;
        this.playBtn.disabled = true;
        this.playBtn.textContent = 'Scanning…';
        this.chartPanel.style.opacity = '1';
        this.transChartPanel.style.opacity = '1';
        this._step();
    }

    _step() {
        if (this.currentSlice >= N) {
            this.animating = false;
            this.playBtn.disabled = false;
            this.playBtn.textContent = '▶  Scan again';
            return;
        }
        // Reveal in order of increasing scan angle (−90 → +90, see sliceScanAngle)
        // so both the 3D sweep and the chart fill left to right.
        const i = this.currentSlice++;

        if (this.sliceMeshes[i]) this.sliceMeshes[i].material.visible = true;
        if (this.barEls[i]) this.barEls[i].setAttribute('opacity', 0.88);
        this._updateTransmittance(this._sliceCD(i));

        setTimeout(() => this._step(), STEP_MS);
    }

    _reset() {
        this.currentSlice = 0;
        this.sliceMeshes.forEach(m => { m.material.visible = false; });
        this.barEls.forEach(b => b.setAttribute('opacity', 0));
        this.chartPanel.style.opacity = '0';
        this.transChartPanel.style.opacity = '0';
        if (this.transPath) this.transPath.setAttribute('d', '');
    }

    // Re-heights/re-colors the pre-built bars for the current scan mode's plume
    // profile (bar x-position/width is angle-based only, so that stays put).
    _updateChartBars() {
        for (let i = 0; i < N; i++) {
            const rect = this.barEls[i];
            if (!rect) continue;
            const cd = this._sliceCD(i);
            const bh = Math.max(0, (cd / CD_MAX) * this._chartIH);
            rect.setAttribute('y', this._chartIH - bh);
            rect.setAttribute('height', bh);
            rect.setAttribute('fill', cdColorCss(cd));
        }
    }

    _setScanMode(mode) {
        if (this.scanMode === mode || this.animating) return;
        this.scanMode = mode;
        this._reset();
        if (this._fanGroup) this._buildFan();
        this._updateChartBars();
        if (this.scanModeBtns) {
            this.scanModeBtns.forEach(b => {
                const active = b.dataset.mode === mode;
                b.setAttribute('aria-pressed', active ? 'true' : 'false');
                b.classList.toggle('is-active', active);
            });
        }
    }

    // ── Plume ─────────────────────────────────────────────────────────────────
    // Static smoke-puff cloud, built once from a fixed set of drifted points —
    // same technique as the tomographic reconstructions (overlapping low-opacity
    // billboard sprites) rather than an animated particle stream. Rises briefly
    // from the vent, then drifts downwind, widening and thinning as it travels.
    _buildPlume(summit, plumeHeight) {
        const N_S = 10550;
        const BASE_SIZE = plumeHeight * 0.05;
        const OPACITY = 0.05;
        const NUM_MATS = 6; // rotation variants so overlapping puffs don't look identical

        const perp = new THREE.Vector3(-WIND_DIR.z, 0, WIND_DIR.x); // horizontal, across the wind

        const materials = Array.from({ length: NUM_MATS }, (_, k) => new THREE.SpriteMaterial({
            map: getSmokeTexture(),
            color: 0xffffff,
            opacity: OPACITY,
            transparent: true,
            depthWrite: false,
            rotation: (k / NUM_MATS) * Math.PI,
        }));

        const group = new THREE.Group();
        const pos = new THREE.Vector3();
        for (let i = 0; i < N_S; i++) {
            const t = Math.random();                                   // 0 = at the vent, 1 = fully downwind
            const rise   = plumeHeight * (0.05 + 0.35 * Math.sqrt(t));  // climbs a little, then levels off
            const drift  = plumeHeight * 2.0 * t;                       // travels mostly horizontally
            const spread = plumeHeight * (0.05 + 0.20 * t);             // cloud widens as it drifts
            const jAngle = Math.random() * Math.PI * 2;
            const jR     = spread * Math.sqrt(Math.random());

            pos.copy(summit)
                .addScaledVector(WIND_DIR, drift)
                .addScaledVector(perp, Math.cos(jAngle) * jR);
            pos.y += rise + Math.sin(jAngle) * jR * 0.35;

            const sprite = new THREE.Sprite(materials[Math.floor(Math.random() * NUM_MATS)]);
            sprite.position.copy(pos);
            const s = BASE_SIZE * (0.6 + Math.random() * 0.8);
            sprite.scale.set(s, s, 1);
            group.add(sprite);
        }

        this._plumePoints = group;
        this._plumeHeight = plumeHeight;
        this.scene.add(group);
    }
}

new MeasurementView();
