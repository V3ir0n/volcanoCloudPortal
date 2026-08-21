/*
Creates plumes in sections between summit-concentration plane and between concentration planes.
*/
import * as THREE from "three";

/**
 * Builds a smoke-like plume that fills the convex volume defined by the drifted
 * concentration grid points across all included frames.
 *
 * @param {[]}            processedData         One entry per scan frame, each with .points, .coordinates, .time
 * @param {THREE.Vector3} summitPos             Position of the volcano summit in scene coordinates
 * @param {number}        velocity              Wind speed in scene units per millisecond
 * @param {THREE.Vector3} dir                  Wind direction vector (need not be normalised)
 * @param {number}        currentFrame          Index of the frame currently displayed
 * @param {number}        concentrationThreshold Minimum SO2 concentration for a cell to be included
 * @param {number}        maxTimeDiff           How many minutes back in time to include frames
 * @returns {THREE.Group} Group of billboard sprites forming the smoke plume
 */

// --- Tunable parameters ---
const BASE_SIZE      = 0.07;  // puff diameter in scene units
const OPACITY        = 0.04;  // per-sprite opacity (overlaps accumulate)
const NUM_MATS       = 6;     // rotation variants so adjacent puffs look different
const SPRITES_PER_PT = 8;     // average sprites per hull point
const MAX_SPRITES    = 2000;  // hard cap to avoid performance issues
const MIN_SPRITES    = 400;   // minimum sprites even for sparse datasets
const SLAB_FRACTION  = 0.15;  // exclusion zone half-thickness as fraction of BASE_SIZE
const SUMMIT_WEIGHT  = 14;    // extra summit copies so that the plume is visible between summit and first plane

// Cached smoke puff texture — created once, reused across all calls
let smokeTexture = null;

// Generates a soft radial gradient on a canvas and returns it as a Three.js texture
function getSmokeTexture() {
    if (smokeTexture) return smokeTexture;          // return cached copy if already created
    const size = 128;                               // texture resolution in pixels
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const c = size / 2;                            // center of the canvas
    const gradient = ctx.createRadialGradient(c, c, 0, c, c, c); // radial gradient from center to edge
    gradient.addColorStop(0,   'rgba(195, 195, 195,0.8)');  // opaque white at center
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.4)');// semi-transparent mid
    gradient.addColorStop(1,   'rgba(255,255,255,0)');  // fully transparent at edge
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);                // fill the whole canvas with the gradient
    smokeTexture = new THREE.CanvasTexture(canvas);
    return smokeTexture;
}


function makePlumeMesh(processedData, summitPos, velocity, dir, currentFrame) {
    const filteredPoints = [summitPos]; // hull seed — starts with summit so plume is always anchored there
    const planeDepths = [];             // mean depth along dir for each frame, used to carve out sprite-free slabs
    const dirNorm = dir.clone().normalize(); // unit vector in wind direction, used for depth projections
    const margin = 1.001;              // tiny outward push to prevent z-fighting with the concentration planes

    // Collect all concentration grid points from past frames, shifted to their current wind-drifted positions
    processedData.forEach((d, di) => {
        if (currentFrame >= di) {                               // only include frames up to the current one
            const dt = processedData[currentFrame].time - d.time; // time since this frame was captured (ms)
            const drift = dir.clone().multiplyScalar(dt * velocity); // how far the gas has moved since measurement
            // Use the same relative threshold as the concentration planes (1% of frame max)
            const maxConc = Math.max(...d.points.map(p => p.Concentration));
            const threshold = maxConc * 0.01;
            let depthSum = 0, count = 0;
            d.points.forEach((p, i) => {
                if (p.Concentration > threshold) {                   // skip low-SO2 cells (same as plane filter)
                    const pos = d.coordinates[i].clone().add(drift); // current world position of this gas parcel
                    pos.multiplyScalar(margin);                      // nudge outward to avoid z-fighting
                    filteredPoints.push(pos);
                    depthSum += pos.dot(dirNorm);                    // accumulate depth for mean calculation
                    count++;
                }
            });
            if (count > 0) planeDepths.push(depthSum / count); // store mean depth of this frame's plane
        }
    });

    const group = new THREE.Group();
    if (filteredPoints.length < 2) return group; // nothing to draw if too few points

    // summitPos appears only once.
    // Adding extra summit copies is necessary to create more than just one dot of smoke
    const summitCopies = Math.max(1, Math.round((filteredPoints.length - 1) / SUMMIT_WEIGHT));
    for (let k = 0; k < summitCopies; k++) filteredPoints.push(summitPos);

    const n = filteredPoints.length;
    const numSprites = Math.min(MAX_SPRITES, Math.max(MIN_SPRITES, n * SPRITES_PER_PT)); // scale with dataset size
    const slabThickness = BASE_SIZE * SLAB_FRACTION; // half-width of the no-sprite zone around each plane

    // Pre-build a small set of materials at evenly-spaced rotations so overlapping
    // puffs don't all look like the same stamp
    const materials = Array.from({length: NUM_MATS}, (_, k) => new THREE.SpriteMaterial({
        map: getSmokeTexture(),
        color: 0xffffff,
        opacity: OPACITY,
        transparent: true,
        depthWrite: false,              // don't block objects behind the sprite
        rotation: (k / NUM_MATS) * Math.PI, // evenly spaced rotations from 0 to 180°
    }));

    // Place sprites at random points inside the convex hull.
    // A random convex combination of 3 hull points is always inside the hull,
    // and fills a triangle area rather than just a line, giving better volume coverage.
    let placed = 0;
    const maxAttempts = numSprites * 4; // allow extra attempts to compensate for slab rejections
    for (let attempt = 0; attempt < maxAttempts && placed < numSprites; attempt++) {
        const p1 = filteredPoints[Math.floor(Math.random() * n)]; // three random hull points
        const p2 = filteredPoints[Math.floor(Math.random() * n)];
        const p3 = filteredPoints[Math.floor(Math.random() * n)];
        const w1 = Math.random(), w2 = Math.random(), w3 = Math.random(); // random weights
        const wSum = w1 + w2 + w3;                                         // normalise to sum to 1
        const pos = new THREE.Vector3()
            .addScaledVector(p1, w1 / wSum)  // weighted average = point inside the triangle p1-p2-p3
            .addScaledVector(p2, w2 / wSum)
            .addScaledVector(p3, w3 / wSum);

        // Reject sprites that land too close to a concentration plane so the planes stay visible
        const depth = pos.dot(dirNorm);
        if (planeDepths.some(pd => Math.abs(depth - pd) < slabThickness)) continue;

        const sprite = new THREE.Sprite(materials[Math.floor(Math.random() * NUM_MATS)]);
        sprite.position.copy(pos);
        const s = BASE_SIZE * (0.6 + Math.random() * 0.6); // slight random size variation
        sprite.scale.set(s, s, 1); // sprites are always camera-facing so only x/y scale matters
        group.add(sprite);
        placed++;
    }

    return group;
}

export {makePlumeMesh};
