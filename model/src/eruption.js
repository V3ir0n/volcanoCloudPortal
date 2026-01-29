import * as THREE from 'three';
import {eruptiveRegimes, eruptionFeatures} from './constants.js';
import {SoundHandler} from './soundHandler.js';

const regimePoints = eruptiveRegimes.map(v=>{
    const p = new THREE.Vector2(v.depth, v.gas);
    p.regime = v.regime;
    return p;
});

class EruptionHandler {
    constructor(view, parameters) {
        this.view = view;
        this.parameters = parameters;
        this.shakeAnimationId = null;

        // Figure out what sounds are defined. Ugly, but better than hardcoding
        // in both locations.
        const sounds = [];
        for (var prop in eruptionFeatures) {
            if (Object.prototype.hasOwnProperty.call(eruptionFeatures, prop)) {
                if (eruptionFeatures[prop].sound) {
                    sounds.push(eruptionFeatures[prop].sound)
                }
            }
        }

        this.soundHandler = new SoundHandler(sounds);
    }

    getRegime() {
        // This happens to be the the distance between depth steps
        const maxDist = 2.5;

        const p = new THREE.Vector2(
            this.parameters["depth"],
            this.parameters["gasDensity"]
        );

        let minDistSq = maxDist * maxDist;
        let closest;

        for (const r of regimePoints) {
            const distSq = p.distanceToSquared(r);
            if (distSq < minDistSq) {
                minDistSq = distSq
                closest = r;
            }
        }

        console.log(`Depth ${p.x}, gas: ${p.y}, min dist: ${Math.sqrt(minDistSq)}`)

        if (closest === undefined) {
            return undefined
        }

        return closest.regime;
    }

    // Function to shake the camera with looping, varying speed and intensity, and uneven intervals
    shakeCamera(intensity) {
        // Override texture of mayon_FULL3.glb with volcano_erupted_tex.png
        const textureLoader = new THREE.TextureLoader();
        textureLoader.setPath("resources/");
        textureLoader.load('volcano_lava.png', (texture) => {
            texture.encoding = THREE.sRGBEncoding; // Ensure correct color space
            if (this.view.terrain) {
                this.view.terrain.traverse((child) => {
                    if (child.isMesh && child.material) {
                        child.material.map = texture;
                        child.material.needsUpdate = true;
                    }
                });
            }
        });

        let isShaking = false;
        let shakeStartTime = 0;
        let shakeDuration = 0;
        let shakeIntensity = 0;
        let nextShakeTime = Date.now();
        let hasMovedToTarget = false;
        let hasTextureFadedIn = false;
        let hasColorChanged = false;

        const maxIntensity = 0.5;
        const minIntensity = 0.1;

        const animateShake = () => {
            const currentTime = Date.now();

            if (!isShaking && currentTime >= nextShakeTime) {
                // Start a new shake
                isShaking = true;
                shakeStartTime = currentTime;
                shakeDuration = Math.random() * 2000 + 1000; // 1-3 seconds
                shakeIntensity = intensity * Math.random() * (maxIntensity-minIntensity) + minIntensity;
            }

            if (isShaking) {
                const elapsed = currentTime - shakeStartTime;
                const progress = elapsed / shakeDuration;

                if (progress < 1) {
                    // Calculate fade factor for fade-in and fade-out effect
                    const fadeFactor = Math.sin(progress * Math.PI);


                    // Generate random offsets for shake, multiplied by fade factor (reduced intensity for slower shake)
                    const offsetX = (Math.random() - 0.5) * shakeIntensity * fadeFactor * 0.5;
                    const offsetY = (Math.random() - 0.5) * shakeIntensity * fadeFactor * 0.5;
                    const offsetZ = (Math.random() - 0.5) * shakeIntensity * fadeFactor * 0.5;

                    this.view.camera.position.add(new THREE.Vector3(
                        offsetX, offsetY, offsetZ
                    ));

                    this.shakeAnimationId = requestAnimationFrame(animateShake);
                } else {
                    // End of shake
                    isShaking = false;

                    if (!hasMovedToTarget) {
                        hasMovedToTarget = true;
                        hasTextureFadedIn = true;
                        hasColorChanged = true;
                    }
                    // Set next shake time with random delay (5-10 seconds)
                    nextShakeTime = currentTime + Math.random() * 5000 + 5000;
                    this.shakeAnimationId = requestAnimationFrame(animateShake);
                }
            } else {
                // Not shaking, continue looping
                this.shakeAnimationId = requestAnimationFrame(animateShake);
            }
        }

        animateShake();
    };

    updateEruption(regime = this.getRegime()) {
        if (regime === undefined) {
            console.warn("Unknown regime");
            return;
        }

        const features = eruptionFeatures[regime];

        // Update sound
        this.soundHandler.setSound(features.sound);

        // Update infobox
        const infoboxDiv = document.getElementById('infobox');
        if (infoboxDiv) {
            infoboxDiv.style.opacity = '0';
            setTimeout(() => {
                infoboxDiv.innerHTML = features.infoBoxText,
                infoboxDiv.style.opacity = '1';
            }, 250);
        }

        // Stop any ongoing shake
        this.stopShake();

        if (features.shakeIntensity) {
            this.shakeCamera(features.shakeIntensity);
        }

        // Update smoke textures
        this.view.smoke.smokeType = features.smoke;

        this.view.ash.ashAmount = features.ashAmount;
    }

    // Function to stop the camera shake animation
   stopShake() {
        if (this.shakeAnimationId) {
            cancelAnimationFrame(this.shakeAnimationId);
            this.shakeAnimationId = null;
        }
    };

    // Function to reset the scene to before eruption
    resetToBeforeEruption() {
        this.eruptionOngoing = false;
        this.stopShake();
        console.log('Resetting to before eruption');

        const mildSfx = document.getElementById('mild_eruption_sfx');
        const strongSfx = document.getElementById('strong_eruption_sfx');
        const backgroundMusic = document.getElementById('background-music');

        // Switch back to default music if sound is enabled
        if (document.getElementById('audioToggle').checked) {
            if (backgroundMusic && backgroundMusic.paused) {
                backgroundMusic.play();
            }
        }

        // Stop sound effects
        if (mildSfx) mildSfx.pause();
        if (strongSfx) strongSfx.pause();

        // Reset smoke particles
        if (this.view.smoke.smokeParticles) {
            this.view.smoke.smokeParticles.forEach(particle => {
                particle.visible = false;
            });
        }

        // Reset ash particles
        if (this.view.ash.ashParticles) {
            this.view.ash.ashParticles.forEach(particle => {
                particle.userData.isActive = false;
                particle.visible = false;
                if (particle.material) {
                    particle.material.visible = false;
                }
            });
        }

        // Reset eruption flags
        this.isType1Eruption = false;
        this.isType2Eruption = false;
        this.isType3Eruption = false;

        // Reset smoke textures
        this.view.smoke.currentSmokeTextures = this.view.smoke.loadedTextures;
        // Reset camera position
        this.view.camera.position.set(15, 14, 25);
        this.view.camera.lookAt(0, 0, 0);
        // Reset terrain texture and opacity
        if (this.view.terrain && this.view.originalTerrainMaterial) {
            this.view.terrain.traverse((child) => {
                if (child.isMesh) {
                    child.material = this.view.originalTerrainMaterial.clone();
                    child.material.transparent = false;
                    child.material.opacity = 1.0;
                }
            });
            // Ensure terrain is added back to scene and visible
            if (!this.view.scene.children.includes(this.view.terrain)) {
                this.view.scene.add(this.view.terrain);
            }
            this.view.terrain.visible = true;
            // Reset Fresnel colors
            if (this.view.terrainFresnel) {
                this.view.terrainFresnel.traverse((child) => {
                    if (child.isMesh && child.userData.fresnelOutline) {
                        child.material.uniforms.fresnelColor.value.setHex(0x00ffff);
                        child.material.uniforms.fresnelIntensity.value = 0.75;
                        child.material.depthWrite = true;
                    }
                });
                // Ensure terrainFresnel is added back to scene and visible
                if (!this.view.scene.children.includes(this.view.terrainFresnel)) {
                    this.view.scene.add(this.view.terrainFresnel);
                }
                this.view.terrainFresnel.visible = true;
            }
        }
        // Reset fade flags to allow future animations
        this.view.isFadingTerrain = false;
        this.view.isFadingVolcano = false;
        this.view.isAnimatingCamera = false;
        // Reset view state
        this.view.isInsideView = false;
        // Reload volcano slice model if it was removed
        if (!this.view.volcano) {
            const loader = new THREE.GLTFLoader();
            loader.load('mayon_slice_FULL3.glb', function (gltf) {
                this.view.volcano = gltf.scene;
                this.view.volcano.position.set(0, 0, 0);
                this.view.volcano.scale.set(0.25, 0.25, 0.25);
                this.view.volcano.rotation.set(0, -135, 0);
                // Enable transparency for fade animation
                this.view.volcano.traverse((child) => {
                    if (child.isMesh) {
                        child.material.transparent = true;
                        child.material.opacity = 1.0;

                        // Mark this mesh as processed to avoid infinite recursion
                        child.userData.fresnelProcessed = true;

                        // Store original vertices for stretching
                        const geometry = child.geometry;
                        if (geometry.isBufferGeometry && geometry.attributes.position) {
                            geometry.userData.originalVertices = geometry.attributes.position.array.slice();
                        }
                    }
                });

                this.view.scene.add(this.view.volcano);
            });
        }
        // Reset infobox
        const infoboxDiv = document.getElementById('infobox');
        if (infoboxDiv) {
            infoboxDiv.style.opacity = '0';
        }
        // Update button text back to trigger mode
        const btn = document.getElementById('trigger-eruption-btn');
        if (btn) {
            btn.textContent = 'Trigger Eruption';
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
        }
        // Update trigger button text based on current parameters
        this.parameters.updateTriggerButtonText();
    }



}

export {EruptionHandler, eruptiveRegimes};