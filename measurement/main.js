import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// ── Scan parameters ───────────────────────────────────────────────────────────
const N = 25;
const CD_MAX = 150;          // ppm·m, peak column density
const PLUME_T = 0.45;        // plume centre as fraction of scan (0=right, 1=left)
const PLUME_SIG = 0.10;      // Gaussian half-width as fraction of full scan
const STEP_MS = 420;         // ms between each revealed slice

// 60° half-cone opening toward +Z (volcano): tip at origin, arc sweeps upper semicircle.
// Matches placeview.js createStationMarker(60) — 3D shape, visible from all angles.
const CONE_HALF_RAD = 60 * Math.PI / 180;   // half-angle 60° → tan(60°) = 1.732

// World-space direction the plume drifts in, roughly horizontal.
const WIND_DIR = new THREE.Vector3(1, 0, 3).normalize();

// ── Slice math (per-slice column density & scan angle) ────────────────────────
function sliceCD(i) {
    const t = (i + 0.5) / N;
    return CD_MAX * Math.exp(-((t - PLUME_T) ** 2) / (2 * PLUME_SIG ** 2));
}

// φ=0 (right, +X local) → +90°; φ=π (left, −X local) → −90°
function sliceScanAngle(i) {
    return 90 - ((i + 0.5) / N) * 180;
}

// ── Heatmap color mapping ──────────────────────────────────────────────────────
// Blue → cyan → green → yellow → red heatmap
function cdColor(cd) {
    const t = Math.min(1, Math.max(0, cd / CD_MAX));
    if (t < 0.25) return new THREE.Color(0, t / 0.25, 1);
    if (t < 0.5)  return new THREE.Color(0, 1, 1 - (t - 0.25) / 0.25);
    if (t < 0.75) return new THREE.Color((t - 0.5) / 0.25, 1, 0);
    return new THREE.Color(1, 1 - (t - 0.75) / 0.25, 0);
}

function cdColorCss(cd) {
    const c = cdColor(cd);
    return `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
}

// ── SO2 transmittance spectrum (loaded from CSV, keyed by column density) ────
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

        this.spectrum = null;

        this._initRenderer();
        this._initScene();
        this._initChart();
        this._initTransmittanceChart();
        this._initUI();
        this._loadTerrain();
        this._loadSpectrum();

        this.renderer.setAnimationLoop(() => {
            this.renderer.render(this.scene, this.camera);
        });
    }

    // ── Renderer setup ──────────────────────────────────────────────────────
    _initRenderer() {
        this.canvas = document.getElementById('threeCanvas');
        this.renderer = new THREE.WebGLRenderer({ antialias: true, canvas: this.canvas });
        this.renderer.setClearColor(0x0a0c10);
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
            this.ready = true;
            this.playBtn.disabled = false;
            this.playBtn.style.opacity = '1';
            this.playBtn.style.cursor = 'pointer';
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

        // Small instrument body
        const bs = extent * 0.018;
        group.add(new THREE.Mesh(
            new THREE.BoxGeometry(bs * 1.5, bs, bs * 3),
            new THREE.MeshStandardMaterial({ color: 0xdddddd })
        ));

        // 3D half-cone slices: tip at origin, arc in local XY plane at z=coneLen.
        // φ sweeps [0, π] (right → top → left) matching placeview.js createStationMarker(60).
        // Vertex arc: (r·cos φ, r·sin φ, coneLen) — upper half of cone, visible from all angles.
        for (let i = 0; i < N; i++) {
            const phi1 = (i / N) * Math.PI;
            const phi2 = ((i + 1) / N) * Math.PI;
            const cd = sliceCD(i);

            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.Float32BufferAttribute([
                0, 0, 0,
                r * Math.cos(phi1), r * Math.sin(phi1), coneLen,
                r * Math.cos(phi2), r * Math.sin(phi2), coneLen,
            ], 3));

            const mat = new THREE.MeshBasicMaterial({
                color: cdColor(cd),
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.6,
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
            wv.push(0, 0, 0,  r * Math.cos(phi), r * Math.sin(phi), coneLen);
        }
        for (let i = 0; i < N; i++) {
            const phi1 = (i / N) * Math.PI;
            const phi2 = ((i + 1) / N) * Math.PI;
            wv.push(
                r * Math.cos(phi1), r * Math.sin(phi1), coneLen,
                r * Math.cos(phi2), r * Math.sin(phi2), coneLen
            );
        }
        const wGeom = new THREE.BufferGeometry();
        wGeom.setAttribute('position', new THREE.Float32BufferAttribute(wv, 3));
        group.add(new THREE.LineSegments(
            wGeom,
            new THREE.LineBasicMaterial({ color: 0x777777, transparent: true, opacity: 0.4 })
        ));

        this.scene.add(group);
    }

    // ── Bar chart ─────────────────────────────────────────────────────────────
    _initChart() {
        const NS = 'http://www.w3.org/2000/svg';
        const W = 268, H = 162;
        const M = { t: 8, r: 8, b: 32, l: 38 };
        const iW = W - M.l - M.r;
        const iH = H - M.t - M.b;

        const panel = document.createElement('div');
        panel.style.cssText = `
            position:fixed; bottom:76px; right:20px; width:${W + 24}px;
            background:rgba(8,10,14,0.88); border:1px solid #333; border-radius:8px;
            padding:12px; box-sizing:border-box; pointer-events:none;
            opacity:0; transition:opacity 0.35s;
        `;

        const title = document.createElement('div');
        title.textContent = 'SO₂ column density / ppm·m';
        title.style.cssText = 'color:#999;font-size:11px;font-family:sans-serif;margin-bottom:6px;';
        panel.appendChild(title);

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
        [50, 100, 150].forEach(v => {
            const y = iH - (v / CD_MAX) * iH;
            g.appendChild(mkLine(0, y, iW, y, '#2a2a2a'));
        });

        // X ticks: scan angle, −90 (left) → +90 (right)
        [-90, -45, 0, 45, 90].forEach(a => {
            const x = (a + 90) / 180 * iW;
            g.appendChild(mkLine(x, iH, x, iH + 4));
            const lbl = document.createElementNS(NS, 'text');
            lbl.setAttribute('x', x); lbl.setAttribute('y', iH + 14);
            lbl.setAttribute('text-anchor', 'middle');
            lbl.setAttribute('font-size', 9);
            lbl.setAttribute('fill', '#777');
            lbl.textContent = a;
            g.appendChild(lbl);
        });

        // X axis label
        const xLbl = document.createElementNS(NS, 'text');
        xLbl.setAttribute('x', iW / 2); xLbl.setAttribute('y', H - M.t - 3);
        xLbl.setAttribute('text-anchor', 'middle');
        xLbl.setAttribute('font-size', 9);
        xLbl.setAttribute('fill', '#666');
        xLbl.textContent = 'scan angle / deg';
        g.appendChild(xLbl);

        // Y ticks
        [0, 50, 100, 150].forEach(v => {
            const y = iH - (v / CD_MAX) * iH;
            g.appendChild(mkLine(-4, y, 0, y));
            const lbl = document.createElementNS(NS, 'text');
            lbl.setAttribute('x', -7); lbl.setAttribute('y', y + 3);
            lbl.setAttribute('text-anchor', 'end');
            lbl.setAttribute('font-size', 9);
            lbl.setAttribute('fill', '#777');
            lbl.textContent = v;
            g.appendChild(lbl);
        });

        // Pre-create bars (invisible), one per slice
        const bw = (iW / N) * 0.82;
        this.barEls = [];
        for (let i = 0; i < N; i++) {
            const cd = sliceCD(i);
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
        document.body.appendChild(panel);
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
        panel.style.cssText = `
            position:fixed; bottom:300px; right:20px; width:${W + 24}px;
            background:rgba(8,10,14,0.88); border:1px solid #333; border-radius:8px;
            padding:12px; box-sizing:border-box; pointer-events:none;
            opacity:0; transition:opacity 0.35s;
        `;

        const title = document.createElement('div');
        title.textContent = 'SO₂ transmittance / wavelength';
        title.style.cssText = 'color:#999;font-size:11px;font-family:sans-serif;margin-bottom:6px;';
        panel.appendChild(title);

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
            g.appendChild(mkLine(0, y, iW, y, '#2a2a2a'));
        });

        // Y ticks: transmittance 0..1
        [0, 0.5, 1].forEach(v => {
            const y = iH - v * iH;
            g.appendChild(mkLine(-4, y, 0, y));
            const lbl = document.createElementNS(NS, 'text');
            lbl.setAttribute('x', -7); lbl.setAttribute('y', y + 3);
            lbl.setAttribute('text-anchor', 'end');
            lbl.setAttribute('font-size', 9);
            lbl.setAttribute('fill', '#777');
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
            lbl.setAttribute('fill', '#777');
            lbl.textContent = w;
            g.appendChild(lbl);
        });

        // X axis label
        const xLbl = document.createElementNS(NS, 'text');
        xLbl.setAttribute('x', iW / 2); xLbl.setAttribute('y', H - M.t - 3);
        xLbl.setAttribute('text-anchor', 'middle');
        xLbl.setAttribute('font-size', 9);
        xLbl.setAttribute('fill', '#666');
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
        document.body.appendChild(panel);
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

    // ── Controls ─────────────────────────────────────────────────────────────
    _initUI() {
        const ui = document.createElement('div');
        ui.style.cssText = 'position:fixed;bottom:20px;right:20px;display:flex;gap:8px;z-index:10;';

        this.playBtn = document.createElement('button');
        this.playBtn.textContent = '▶  Start scan';
        this.playBtn.disabled = true;
        this.playBtn.style.cssText = `
            padding:8px 20px; background:#1a5276; color:#ccc; border:none;
            border-radius:6px; font-size:13px; font-family:sans-serif;
            opacity:0.45; cursor:default; transition:background 0.15s;
        `;
        this.playBtn.addEventListener('click', () => this._startScan());
        this.playBtn.addEventListener('mouseover', () => {
            if (!this.playBtn.disabled) this.playBtn.style.background = '#2471a3';
        });
        this.playBtn.addEventListener('mouseout', () => {
            this.playBtn.style.background = '#1a5276';
        });

        const resetBtn = document.createElement('button');
        resetBtn.textContent = '↺  Reset';
        resetBtn.style.cssText = `
            padding:8px 14px; background:#2c3e50; color:#bbb; border:none;
            border-radius:6px; font-size:13px; font-family:sans-serif; cursor:pointer;
        `;
        resetBtn.addEventListener('click', () => this._reset());

        ui.appendChild(this.playBtn);
        ui.appendChild(resetBtn);
        document.body.appendChild(ui);

        const hint = document.createElement('div');
        hint.style.cssText = `
            position:fixed; bottom:20px; left:20px; z-index:10;
            color:#555; font-size:11px; font-family:sans-serif;
            max-width:220px; line-height:1.6;
        `;
        hint.textContent = 'A ground-based scanner sweeps from horizon to horizon, measuring SO₂ column density at each angle to profile the volcanic plume.';
        document.body.appendChild(hint);
    }

    // ── Animation ────────────────────────────────────────────────────────────
    _startScan() {
        if (this.animating || !this.ready) return;
        this.animating = true;
        this.currentSlice = 0;
        this.playBtn.disabled = true;
        this.playBtn.textContent = 'Scanning…';
        this.playBtn.style.opacity = '0.5';
        this.chartPanel.style.opacity = '1';
        this.transChartPanel.style.opacity = '1';
        this._step();
    }

    _step() {
        if (this.currentSlice >= N) {
            this.animating = false;
            this.playBtn.disabled = false;
            this.playBtn.textContent = '▶  Scan again';
            this.playBtn.style.opacity = '1';
            this.playBtn.style.cursor = 'pointer';
            return;
        }
        // Reveal in order of increasing scan angle (−90 → +90) so both the
        // 3D sweep and the chart fill left to right.
        const i = N - 1 - this.currentSlice++;

        if (this.sliceMeshes[i]) this.sliceMeshes[i].material.visible = true;
        if (this.barEls[i]) this.barEls[i].setAttribute('opacity', 0.88);
        this._updateTransmittance(sliceCD(i));

        setTimeout(() => this._step(), STEP_MS);
    }

    _reset() {
        this.animating = false;
        this.currentSlice = 0;
        this.sliceMeshes.forEach(m => { m.material.visible = false; });
        this.barEls.forEach(b => b.setAttribute('opacity', 0));
        this.chartPanel.style.opacity = '0';
        this.transChartPanel.style.opacity = '0';
        if (this.transPath) this.transPath.setAttribute('d', '');
        this.playBtn.disabled = !this.ready;
        this.playBtn.textContent = '▶  Start scan';
        this.playBtn.style.opacity = this.ready ? '1' : '0.45';
        this.playBtn.style.cursor = this.ready ? 'pointer' : 'default';
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
        this.scene.add(group);
    }
}

new MeasurementView();
