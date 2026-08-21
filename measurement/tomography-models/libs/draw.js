import * as THREE from "three";

/**
 * Draw a particle point cloud
 * @param {THREE.Vector3[]} positions List of positions for all particles
 * @param {THREE.Color[]} colors List of colours for all particles
 * @param {number} size Particle size
 * @param {boolean} sizeAttenuation If true, draw size relative to distance from camera
 * @param {string} texturePath Path to image used as texture
 * @returns {THREE.Points} Three.js Object containing the points
 */
function drawParticles(
    positions, colors, extraAttributes=[], size=0.02, sizeAttenuation = true,
     texturePath = "resources/circle.png",
    ) {
    const loader = new THREE.TextureLoader();
    const texture = loader.load(texturePath);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions.flatMap(p=>p.toArray()), 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors.flatMap(c=>c.toArray()), 3));

    for (const e of extraAttributes) {
        geometry.setAttribute(e.name, new THREE.Float32BufferAttribute(e.flattenedItems, e.itemSize));
    }

    const material = new THREE.PointsMaterial({
        size: size,
        vertexColors: true,
        map: texture,
        sizeAttenuation: sizeAttenuation,
        alphaTest: 0.5
    });

    return new THREE.Points(geometry, material);
}

export {drawParticles};
