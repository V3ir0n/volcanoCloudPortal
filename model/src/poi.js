window.isInsideView = false;
window.isAnimatingCamera = false;

const redCubeGeometry = new THREE.BoxGeometry(1, 1, 1);
const redCubeMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
const redCube = new THREE.Mesh(redCubeGeometry, redCubeMaterial);
redCube.userData.isRedCube = true;
redCube.userData.isGlowing = false;

// Position the red cube in front of the slice model
redCube.position.set(-4, -3, 5);

window.scene.add(redCube);

// Fade animation function for volcano slice
function fadeVolcano(out) {
    console.log('fadeVolcano called with out:', out, 'isFadingVolcano:', window.isFadingVolcano);
    if (!window.volcano || window.isFadingVolcano) return;

    window.isFadingVolcano = true;
    console.log('isFading set to true');

    // Temporarily disable controls to allow camera animation
    const controlsWereEnabled = window.controls.enabled;
    window.controls.enabled = false;

    const startPosition = window.camera.position.clone();
    const endPosition = out ? new THREE.Vector3(15, 14.15, 25) : new THREE.Vector3(4, 2, 41); // Initial position for fade out, inside for fade in

    // Ensure volcano is visible and set initial opacity for fade-in
    if (!out) {
        console.log('Fading in: setting volcano visible.');
        window.volcano.visible = true;
        window.volcano.traverse(child => {
            if(child.isMesh) {
                // Ensure material is transparent to allow fading
                child.material.transparent = true;
                child.material.opacity = 0;
            }
        });
    }

    const duration = 1500; // 1.5 seconds for the animation
    let startTime = null;

    function animationStep(timestamp) {
        if (startTime === null) {
            startTime = timestamp;
        }
        const elapsedTime = timestamp - startTime;
        const linearProgress = Math.min(elapsedTime / duration, 1);
        // Apply ease-in-out function for smoother animation
        const easedProgress = 0.5 * (1 - Math.cos(linearProgress * Math.PI));

        console.log('Animation step - progress:', easedProgress);

        // Interpolate camera position and update its view
        window.camera.position.lerpVectors(startPosition, endPosition, easedProgress);
        if (out) {
            window.camera.lookAt(0, 0, 0);
        } else if (window.volcano) {
            window.camera.lookAt(window.volcano.position);
        }

        // Interpolate volcano opacity
        const opacity = out ? 1 - easedProgress : easedProgress;
        window.volcano.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material.opacity = opacity;
            }
        });

        if (linearProgress < 1) {
            requestAnimationFrame(animationStep);
        } else {
            // Animation complete
            console.log('Animation complete.');
            window.isFadingVolcano = false;
            // Ensure camera is precisely at endPosition
            window.camera.position.copy(endPosition);
            // Set controls target to appropriate position
            if (out) {
                window.controls.target.set(0, 0, 0);
                window.camera.position.set(15, 14, 25);
            } else {
                window.controls.target.copy(window.volcano.position);
            }
            // Sync controls internal state with new camera position
            window.controls.update();
            // Restore controls to previous state
            window.controls.enabled = controlsWereEnabled;
            // Update inside view state
            window.isInsideView = !out;
            // Volcano remains visible at all times
        }
    }

    console.log('Starting animation frame request.');
    requestAnimationFrame(animationStep);
}

// Fade animation function
function fadeTerrain(out) {
    console.log('fadeTerrain called with out:', out, 'isFadingTerrain:', window.isFadingTerrain);
    if (!window.terrain || window.isFadingTerrain) return;

    window.isFadingTerrain = true;
    console.log('isFading set to true');

    const startPosition = window.camera.position.clone();
    const endPosition = out ? new THREE.Vector3(15, 5, 25) : new THREE.Vector3(15, 14, 25); // Inside position for fade out, initial for fade in

    // Ensure terrain and Fresnel clone are visible and set initial opacity/intensity for fade-in
    if (!out) {
        console.log('Fading in: adding terrain and Fresnel clone back to scene if needed.');
        window.terrain.traverse(child => {
            if(child.isMesh) {
                // Ensure material is transparent to allow fading
                child.material.transparent = true;
                child.material.opacity = 0;
            }
        });
        if (window.terrainFresnel) {
            window.terrainFresnel.traverse(child => {
                if (child.isMesh && child.material && child.material.uniforms) {
                    child.material.uniforms.fresnelIntensity.value = 0;
                }
            });
        }
        if (!window.scene.children.includes(window.terrain)) {
            window.scene.add(window.terrain);
        }
        if (window.terrainFresnel && !window.scene.children.includes(window.terrainFresnel)) {
            window.scene.add(window.terrainFresnel);
        }
        window.terrain.visible = true;
        if (window.terrainFresnel) {
            window.terrainFresnel.visible = true;
        }
    }

    const duration = 1500; // 1.5 seconds for the animation
    let startTime = null;

    function animationStep(timestamp) {
        if (startTime === null) {
            startTime = timestamp;
        }
        const elapsedTime = timestamp - startTime;
        const linearProgress = Math.min(elapsedTime / duration, 1);
        // Apply ease-in-out function for smoother animation
        const easedProgress = 0.5 * (1 - Math.cos(linearProgress * Math.PI));

        console.log('Animation step - progress:', easedProgress);

        // Interpolate terrain opacity and Fresnel intensity
        const opacity = out ? 1 - easedProgress : easedProgress;
        const fresnelIntensity = out ? 0.75 * (1 - easedProgress) : 0.75 * easedProgress;
        window.terrain.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material.opacity = opacity;
            }
        });
        if (window.terrainFresnel) {
            window.terrainFresnel.traverse((child) => {
                if (child.isMesh && child.material && child.material.uniforms) {
                    child.material.uniforms.fresnelIntensity.value = fresnelIntensity;
                }
            });
        }

        if (linearProgress < 1) {
            requestAnimationFrame(animationStep);
        } else {
            // Animation complete
            console.log('Animation complete.');
            window.isFadingTerrain = false;
            if (out) {
                console.log('Fading out: setting terrain and Fresnel clone invisible and removing from scene.');
                window.terrain.visible = false;
                window.scene.remove(window.terrain);
                if (window.terrainFresnel) {
                    window.terrainFresnel.visible = false;
                    window.scene.remove(window.terrainFresnel);
                }
            }
        }
    }

    console.log('Starting animation frame request.');
    requestAnimationFrame(animationStep);
}

// Animate camera to default position
function animateCameraToDefault() {
    console.log('animateCameraToDefault called. isAnimatingCamera:', window.isAnimatingCamera);
    if (window.isAnimatingCamera) return;

    window.isAnimatingCamera = true;
    console.log('isAnimatingCamera set to true');

    // Temporarily disable controls to allow camera animation
    const controlsWereEnabled = window.controls.enabled;
    window.controls.enabled = false;

    const startPosition = window.camera.position.clone();
    const endPosition = new THREE.Vector3(15, 14, 25);

    const duration = 1500; // 1.5 seconds for the animation
    let startTime = null;

    function animationStep(timestamp) {
        if (startTime === null) {
            startTime = timestamp;
        }
        const elapsedTime = timestamp - startTime;
        const linearProgress = Math.min(elapsedTime / duration, 1);
        // Apply ease-in-out function for smoother animation
        const easedProgress = 0.5 * (1 - Math.cos(linearProgress * Math.PI));

        console.log('Camera animation step - progress:', easedProgress);

        // Interpolate camera position
        window.camera.position.lerpVectors(startPosition, endPosition, easedProgress);
        window.camera.lookAt(0, 0, 0);

        if (linearProgress < 1) {
            requestAnimationFrame(animationStep);
        } else {
            // Animation complete
            console.log('Camera animation complete.');
            window.isAnimatingCamera = false;
            // Set controls target to default
            window.controls.target.set(0, 0, 0);
            window.camera.position.set(15, 14, 25);
            window.camera.lookAt(0, 0, 0);
            // Temporarily set full range to allow setting position
            window.controls.minAzimuthAngle = -Infinity;
            window.controls.maxAzimuthAngle = Infinity;
            window.controls.minPolarAngle = 0;
            window.controls.maxPolarAngle = Math.PI;
            // Sync controls internal state with new camera position
            window.controls.update();
            // Ensure position is maintained after controls update
            window.camera.position.set(15, 14, 25);
            window.camera.lookAt(0, 0, 0);
            // Restore controls to previous state
            window.controls.enabled = controlsWereEnabled;
            // Update inside view state
            window.isInsideView = false;
        }
    }

    console.log('Starting camera animation frame request.');
    requestAnimationFrame(animationStep);
}


// Raycaster for click detection
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();


function onMouseClick(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, window.camera);
    const intersects = raycaster.intersectObjects(window.scene.children, true);

    const redCubeIntersect = intersects.find(intersect => intersect.object.userData.isRedCube);

    if (redCubeIntersect) {
        const infoboxDiv = document.getElementById('infobox');
        if (redCube.userData.isGlowing) {
            redCube.material.color.setHex(0xff0000); // Back to normal red
            redCube.userData.isGlowing = false;
            infoboxDiv.textContent = 'Infobox CLOSED';
            console.log('Infobox updated to: CLOSED');
        } else {
            redCube.material.color.setHex(0xffb3b3); // Brighter red
            redCube.userData.isGlowing = true;
            infoboxDiv.textContent = 'Infobox OPEN';
            console.log('Infobox updated to: empty');
        }
    }
}

function toggleAudio() {
    const backgroundMusic = document.getElementById('background-music');
    if (!backgroundMusic) {
        console.error("Audio element with id 'background-music' not found.");
        return;
    }
    // Set properties each time to ensure they are applied
    backgroundMusic.volume = 0.05;
    backgroundMusic.playbackRate = 0.75;

    if (backgroundMusic.paused) {
        backgroundMusic.play();
    } else {
        backgroundMusic.pause();
    }
}

window.addEventListener('click', onMouseClick);
document.getElementById('toggle-visibility-btn').addEventListener('click', () => {
    console.log('Look inside Volcano button clicked. isInsideView:', window.isInsideView);
    if (window.volcano && window.terrain) {
        if (window.isInsideView) {
            // Go outside: fade in terrain and animate camera to default
            fadeTerrain(false);
            animateCameraToDefault();
        } else {
            // Go inside: fade in slice and fade out terrain
            fadeVolcano(false);
            fadeTerrain(true);
        }
    }
});
