import * as THREE from 'three';

function setupLights(scene) {
    // Add enhanced lighting for better global illumination
    // Ambient light for base illumination (increased for more consistent lighting)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambientLight);

    // Hemisphere light for natural sky/ground lighting (increased intensity)
    const hemisphereLight = new THREE.HemisphereLight(0x87CEEB, 0x8B4513, 1.2);
    scene.add(hemisphereLight);

    // Main directional light (sun) - aimed between both models (increased intensity)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.4);
    directionalLight.position.set(5, 25, 5);
    directionalLight.lookAt(-7.5, 0, 7.5); // Looking at midpoint between terrain and volcano
    scene.add(directionalLight);

    // Additional fill light from opposite direction
    const fillLight = new THREE.DirectionalLight(0xfff8dc, 1.0);
    fillLight.position.set(-15, 20, -15);
    fillLight.lookAt(-7.5, 0, 7.5); // Also aimed at midpoint
    scene.add(fillLight);

    // Secondary directional light for enhanced global illumination
    const directionalLight2 = new THREE.DirectionalLight(0xfff4e6, 1.2);
    directionalLight2.position.set(-10, 30, 10);
    directionalLight2.lookAt(0, 0, 0); // Focused on volcano model area
    scene.add(directionalLight2);

    // Point lights for more even global illumination (positioned to cover both models)
    const pointLight1 = new THREE.PointLight(0xffffff, 1.2, 150);
    pointLight1.position.set(10, 20, 10); // Near volcano slice
    scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0xffffff, 1.2, 150);
    pointLight2.position.set(-20, 20, 20); // Near terrain model
    scene.add(pointLight2);

    const pointLight3 = new THREE.PointLight(0xffffff, 1.0, 150);
    pointLight3.position.set(-5, 25, 15); // Additional light for terrain area
    scene.add(pointLight3);

    const pointLight4 = new THREE.PointLight(0xffffff, 1.0, 150);
    pointLight4.position.set(5, 25, -5); // Additional light for volcano area
    scene.add(pointLight4);

    // Enhanced point lights specifically for volcano model global illumination
    const volcanoPointLight1 = new THREE.PointLight(0xfff4e6, 1.5, 100);
    volcanoPointLight1.position.set(8, 15, 8); // Warm light near volcano
    scene.add(volcanoPointLight1);

    const volcanoPointLight2 = new THREE.PointLight(0xffd700, 1.3, 100);
    volcanoPointLight2.position.set(-8, 12, 8); // Golden warm light
    scene.add(volcanoPointLight2);

    const volcanoPointLight3 = new THREE.PointLight(0xfff4e6, 1.4, 100);
    volcanoPointLight3.position.set(0, 18, -8); // Front warm light
    scene.add(volcanoPointLight3);

    const volcanoPointLight4 = new THREE.PointLight(0xffffff, 1.1, 100);
    volcanoPointLight4.position.set(0, 25, 0); // Top light for better illumination
    scene.add(volcanoPointLight4);

    // Spotlight for dramatic accent lighting on volcano
    const volcanoSpotLight = new THREE.SpotLight(0xfff4e6, 2.0, 200);
    volcanoSpotLight.position.set(15, 30, 15);
    volcanoSpotLight.angle = Math.PI / 6;
    volcanoSpotLight.penumbra = 0.3;
    volcanoSpotLight.decay = 2;
    volcanoSpotLight.distance = 200;
    volcanoSpotLight.target.position.set(0, 0, 0); // Focused on volcano
    scene.add(volcanoSpotLight);
    scene.add(volcanoSpotLight.target);
}

export {setupLights};