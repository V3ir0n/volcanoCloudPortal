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
const CONE_HALF_RAD = 30 * Math.PI / 180;   // half-angle 30° → tan(30°) = 0.577

function sliceCD(i) {
    const t = (i + 0.5) / N;
    return CD_MAX * Math.exp(-((t - PLUME_T) ** 2) / (2 * PLUME_SIG ** 2));
}

// φ=0 (right, +X local) → +90°; φ=π (left, −X local) → −90°
function sliceScanAngle(i) {
    return 90 - ((i + 0.5) / N) * 180;
}

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

// ── Main view class ───────────────────────────────────────────────────────────
class MeasurementView {
    constructor() {
        this.sliceMeshes = [];
        this.barEls = [];
        this.currentSlice = 0;
        this.animating = false;
        this.ready = false;

        this._initRenderer();
        this._initScene();
        this._initChart();
        this._initUI();
        this._loadTerrain();

        this.renderer.setAnimationLoop(() => {
            this._updatePlume();
            this.renderer.render(this.scene, this.camera);
        });
    }

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

    _buildStation(terrain, bbox, center, size, extent) {
        const sx = center.x + size.x * 0.35;
        const sz = center.z + size.z * 0.40;

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

        // Cone length: extend 1.5× past the summit so rays go through the plume
        const horizDist = Math.sqrt((this.summit.x - sx) ** 2 + (this.summit.z - sz) ** 2);
        const distToSummit = Math.sqrt(horizDist ** 2 + (this.summit.y - sy) ** 2);
        const coneLen = distToSummit * 1.5;
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
        title.textContent = 'Column density / ppm·m';
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

        // X ticks: angle offset from summit direction, −CONE_HALF (left) → +CONE_HALF (right)
        // x = (a + CONE_HALF) / (2*CONE_HALF) * iW
        [-90, -45, 0, 45, 90].forEach(a => {
            const x = (90 - a) / 180 * iW;
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
            const bx = (90 - angle) / 180 * iW - bw / 2;
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
        const i = this.currentSlice++;

        if (this.sliceMeshes[i]) this.sliceMeshes[i].material.visible = true;
        if (this.barEls[i]) this.barEls[i].setAttribute('opacity', 0.88);

        setTimeout(() => this._step(), STEP_MS);
    }

    _reset() {
        this.animating = false;
        this.currentSlice = 0;
        this.sliceMeshes.forEach(m => { m.material.visible = false; });
        this.barEls.forEach(b => b.setAttribute('opacity', 0));
        this.chartPanel.style.opacity = '0';
        this.playBtn.disabled = !this.ready;
        this.playBtn.textContent = '▶  Start scan';
        this.playBtn.style.opacity = this.ready ? '1' : '0.45';
        this.playBtn.style.cursor = this.ready ? 'pointer' : 'default';
    }

    // ── Plume ─────────────────────────────────────────────────────────────────
    _buildPlume(summit, plumeHeight) {
        const N_P = 60;
        const positions = new Float32Array(N_P * 3);
        const alphas    = new Float32Array(N_P);
        const sizes     = new Float32Array(N_P);

        this._plumeParticles = [];
        for (let i = 0; i < N_P; i++) {
            const life  = Math.random();
            const angle = Math.random() * Math.PI * 2;
            const speed = 0.25 + Math.random() * 0.35;
            const spread = plumeHeight * 0.1 * life;
            positions[i * 3]     = summit.x + Math.cos(angle) * spread;
            positions[i * 3 + 1] = summit.y + life * plumeHeight;
            positions[i * 3 + 2] = summit.z + Math.sin(angle) * spread;
            alphas[i] = this._plumeAlpha(life);
            sizes[i]  = plumeHeight * (0.025 + 0.1 * life);
            this._plumeParticles.push({ life, angle, speed });
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geom.setAttribute('pAlpha',   new THREE.BufferAttribute(alphas, 1));
        geom.setAttribute('pSize',    new THREE.BufferAttribute(sizes, 1));

        const mat = new THREE.ShaderMaterial({
            vertexShader: `
                attribute float pAlpha;
                attribute float pSize;
                varying float vAlpha;
                void main() {
                    vAlpha = pAlpha;
                    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = pSize * (300.0 / -mvPos.z);
                    gl_Position = projectionMatrix * mvPos;
                }
            `,
            fragmentShader: `
                varying float vAlpha;
                void main() {
                    float d = length(gl_PointCoord - vec2(0.5));
                    if (d > 0.5) discard;
                    float edge = 1.0 - smoothstep(0.28, 0.5, d);
                    gl_FragColor = vec4(0.88, 0.90, 0.94, edge * vAlpha);
                }
            `,
            transparent: true,
            depthWrite: false,
        });

        this._plumePoints  = new THREE.Points(geom, mat);
        this._plumeGeom    = geom;
        this._plumeHeight  = plumeHeight;
        this._plumeSummit  = summit.clone();
        this._lastPlumeT   = performance.now();
        this.scene.add(this._plumePoints);
    }

    _plumeAlpha(life) {
        if (life < 0.15) return (life / 0.15) * 0.7;
        if (life > 0.65) return (1 - (life - 0.65) / 0.35) * 0.7;
        return 0.7;
    }

    _updatePlume() {
        if (!this._plumeParticles) return;
        const now = performance.now();
        const dt  = Math.min((now - this._lastPlumeT) / 1000, 0.05);
        this._lastPlumeT = now;

        const pos    = this._plumeGeom.attributes.position.array;
        const alphas = this._plumeGeom.attributes.pAlpha.array;
        const sizes  = this._plumeGeom.attributes.pSize.array;
        const h = this._plumeHeight;
        const s = this._plumeSummit;

        for (let i = 0; i < this._plumeParticles.length; i++) {
            const p = this._plumeParticles[i];
            p.life += p.speed * dt;
            if (p.life >= 1) {
                p.life  = 0;
                p.angle = Math.random() * Math.PI * 2;
                p.speed = 0.25 + Math.random() * 0.35;
            }
            const spread = h * 0.1 * p.life;
            pos[i * 3]     = s.x + Math.cos(p.angle) * spread;
            pos[i * 3 + 1] = s.y + p.life * h;
            pos[i * 3 + 2] = s.z + Math.sin(p.angle) * spread;
            alphas[i] = this._plumeAlpha(p.life);
            sizes[i]  = h * (0.025 + 0.1 * p.life);
        }

        this._plumeGeom.attributes.position.needsUpdate = true;
        this._plumeGeom.attributes.pAlpha.needsUpdate   = true;
        this._plumeGeom.attributes.pSize.needsUpdate     = true;
    }
}

new MeasurementView();
