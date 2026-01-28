import * as THREE from 'three';

class EruptionHandler {
    constructor(view, parameters) {
        this.view = view;
        this.parameters = parameters;
        this.shakeAnimationId = null;

        // Add event listener for the trigger eruption button
        document.addEventListener('DOMContentLoaded', () => {
            const triggerEruptionBtn = document.getElementById('trigger-eruption-btn');
            if (triggerEruptionBtn) {
                triggerEruptionBtn.addEventListener('click', () => {
                    if (this.eruptionTriggered) {
                        this.resetToBeforeEruption();
                        this.eruptionTriggered = false;
                    } else {
                        this.determineEruptionType();
                        this.eruptionTriggered = true;
                    }
                });
            }
            // Initialize button text on page load
            parameters.updateTriggerButtonText();
        });
    }

    // Function to shake the camera with looping, varying speed and intensity, and uneven intervals
    shakeCamera() {
        // Override texture of mayon_FULL3.glb with volcano_erupted_tex.png
        const textureLoader = new THREE.TextureLoader();
        textureLoader.setPath("resources/");
        textureLoader.load('volcano_erupted_tex.png', (texture) => {
            texture.encoding = THREE.sRGBEncoding; // Ensure correct color space
            if (this.view.terrain) {
                this.view.terrain.traverse((child) => {
                    if (child.isMesh && child.material) {
                        child.material.map = texture;
                        child.material.transparent = true;
                        child.material.opacity = 0; // Start with opacity 0 for fade-in
                        child.material.needsUpdate = true;
                    }
                });
            }
        });

        // Collect fresnel materials for color interpolation
        let fresnelMaterials = [];
        const originalFresnelColor = new THREE.Color(0x00ffff); // Original cyan color
        if (this.view.terrainFresnel) {
            this.view.terrainFresnel.traverse((child) => {
                if (child.isMesh && child.userData.fresnelOutline) {
                    fresnelMaterials.push(child.material);
                    child.material.depthWrite = false;
                }
            });
        }

        const targetPosition = new THREE.Vector3(19, 14, 24);
        let isShaking = false;
        let shakeStartTime = 0;
        let shakeDuration = 0;
        let shakeIntensity = 0;
        let nextShakeTime = Date.now();
        let hasMovedToTarget = false;
        let hasTextureFadedIn = false;
        let hasColorChanged = false;

        const animateShake = () => {
            const currentTime = Date.now();

            if (!isShaking && currentTime >= nextShakeTime) {
                // Start a new shake
                isShaking = true;
                shakeStartTime = currentTime;
                shakeDuration = Math.random() * 3000 + 2000; // 2-5 seconds
                shakeIntensity = Math.random() * 0.4 + 0.1; // 0.1-0.5
            }

            if (isShaking) {
                const elapsed = currentTime - shakeStartTime;
                const progress = elapsed / shakeDuration;

                if (progress < 1) {
                    // Calculate fade factor for fade-in and fade-out effect
                    const fadeFactor = Math.sin(progress * Math.PI);

                    // Fade in the new texture opacity (only on first shake)
                    if (!hasTextureFadedIn && this.view.terrain) {
                        this.view.terrain.traverse((child) => {
                            if (child.isMesh && child.material && child.material.map) {
                                child.material.opacity = progress; // Gradually increase opacity from 0 to 1
                                child.material.needsUpdate = true;
                            }
                        });
                    }

                    // Gradually change fresnel color based on eruption type (only on first shake)
                    if (!hasColorChanged) {
                        let targetFresnelColor;
                        if (this.isType1Eruption) {
                            targetFresnelColor = new THREE.Color(0xffa500); // Orange for Type 1
                        } else if (this.isType2Eruption) {
                            targetFresnelColor = new THREE.Color(0xff0000); // Red for Type 2
                        } else if (this.isType3Eruption) {
                            targetFresnelColor = new THREE.Color(0x8b0000); // Deep red for Type 3
                        } else {
                            targetFresnelColor = new THREE.Color(0xff0000); // Default to red
                        }
                        const currentFresnelColor = new THREE.Color();
                        currentFresnelColor.lerpColors(originalFresnelColor, targetFresnelColor, progress);
                        fresnelMaterials.forEach(material => {
                            material.uniforms.fresnelColor.value.copy(currentFresnelColor);
                        });
                    }

                    // Generate random offsets for shake, multiplied by fade factor (reduced intensity for slower shake)
                    const offsetX = (Math.random() - 0.5) * shakeIntensity * fadeFactor * 0.5;
                    const offsetY = (Math.random() - 0.5) * shakeIntensity * fadeFactor * 0.5;
                    const offsetZ = (Math.random() - 0.5) * shakeIntensity * fadeFactor * 0.5;

                    if (!hasMovedToTarget) {
                        // First shake: interpolate position from original to target
                        const originalPosition = this.view.camera.position.clone();
                        const lerpedPosition = new THREE.Vector3();
                        lerpedPosition.lerpVectors(originalPosition, targetPosition, progress);

                        this.view.camera.position.set(
                            lerpedPosition.x + offsetX,
                            lerpedPosition.y + offsetY,
                            lerpedPosition.z + offsetZ
                        );
                    } else {
                        // Subsequent shakes: shake around target position
                        this.view.camera.position.set(
                            targetPosition.x + offsetX,
                            targetPosition.y + offsetY,
                            targetPosition.z + offsetZ
                        );
                    }

                    this.shakeAnimationId = requestAnimationFrame(animateShake);
                } else {
                    // End of shake
                    isShaking = false;
                    // Always reset to target position after shake
                    this.view.camera.position.copy(targetPosition);
                    if (!hasMovedToTarget) {
                        hasMovedToTarget = true;
                        hasTextureFadedIn = true;
                        hasColorChanged = true;
                    }
                    // Set next shake time with random delay (3-10 seconds)
                    nextShakeTime = currentTime + Math.random() * 7000 + 3000;
                    this.shakeAnimationId = requestAnimationFrame(animateShake);
                }
            } else {
                // Not shaking, continue looping
                this.shakeAnimationId = requestAnimationFrame(animateShake);
            }
        }

        animateShake();
    };

    // Placeholder functions for different eruption types
    type1_eruption() {
        console.log('Type 1 Eruption: High temperature, low gas, shallow depth');
        const btn = document.getElementById('trigger-eruption-btn');
        if (btn) btn.textContent = 'Trigger Eruption Type 1';
        // Volcano remains visible at all times
        // Reset other eruption flags
        this.isType2Eruption = false;
        this.isType3Eruption = false;
        // Set eruption flag for smoke behavior
        this.isType1Eruption = true;
        // Update infobox with Passive Degassing description
        const infoboxDiv = document.getElementById('infobox');
        if (infoboxDiv) {
            infoboxDiv.style.opacity = '0';
            setTimeout(() => {
                infoboxDiv.textContent = 'Passive Degassing\n\nPassive degassing is characterized by the continuous release of volcanic gases such as water vapor (H₂O), carbon dioxide (CO₂), and sulfur dioxide (SO₂) from magma at shallow depth. The magma remains low in viscosity and gas escapes without significant fragmentation, producing a visible steam plume with little or no ash. This activity often reflects an open conduit system and relatively low internal pressure.';
                infoboxDiv.style.opacity = '1';
            }, 250);
        }
        // Adjust smoke parameters for type1 eruption: temperature mid-high, gas density medium, volcano depth high
        this.parameters.temperature = 15; // mid-high temperature
        this.parameters.gasDensity = 31; // medium gas density
        this.parameters.volcanoStretch = 2.8; // high depth
        this.shakeCamera();
    }

    type2_eruption() {
        console.log('Type 2 Eruption: Medium to high temperature, high gas, high depth');
        const btn = document.getElementById('trigger-eruption-btn');
        if (btn) btn.textContent = 'Trigger Eruption Type 2';
        // Volcano remains visible at all times
        // Reset other eruption flags
        this.isType1Eruption = false;
        this.isType3Eruption = false;
        // Set eruption flag for smoke and ash behavior
        this.isType2Eruption = true;
        // Update infobox with Strombolian Eruption description
        const infoboxDiv = document.getElementById('infobox');
        if (infoboxDiv) {
            infoboxDiv.style.opacity = '0';
            setTimeout(() => {
                infoboxDiv.textContent = 'Strombolian Eruption\n\nStrombolian eruptions result from the periodic ascent and bursting of large gas bubbles (gas slugs) within basaltic to andesitic magma. When these bubbles reach the surface, they fragment the magma, ejecting incandescent lava clasts and moderate amounts of ash. The eruption style is intermittent and moderately energetic, producing discrete explosions and a sustained but relatively low eruption column.';
                infoboxDiv.style.opacity = '1';
            }, 250);
        }
        // Adjust smoke parameters for type2 eruption: temperature medium-high, gas density high, volcano depth high
        this.parameters.temperature = 17; // medium-high temperature
        this.parameters.gasDensity = 45; // high gas density
        this.parameters.volcanoStretch = 2.8; // high depth
        this.shakeCamera();
    }

    type3_eruption() {
        console.log('Type 3 Eruption: Medium temperature, high gas density, low-medium depth');
        const btn = document.getElementById('trigger-eruption-btn');
        if (btn) btn.textContent = 'Trigger Eruption Type 3';
        // Volcano remains visible at all times
        // Reset other eruption flags
        this.isType1Eruption = false;
        this.isType2Eruption = false;
        // Set eruption flag for smoke and ash behavior
        this.isType3Eruption = true;
        // Update infobox with Vulcanian Eruption description
        const infoboxDiv = document.getElementById('infobox');
        if (infoboxDiv) {
            infoboxDiv.style.opacity = '0';
            setTimeout(() => {
                infoboxDiv.textContent = 'Vulcanian Eruption\n\nVulcanian eruptions are short-lived but highly explosive events driven by the sudden release of overpressurized gas beneath a temporarily sealed volcanic conduit. The magma is more viscous, inhibiting gas escape until pressure exceeds the strength of the overlying material. This leads to violent fragmentation, generating dense ash clouds, high eruption columns, and ballistic ejecta, posing significant hazards near the volcano.';
                infoboxDiv.style.opacity = '1';
            }, 250);
        }
        // Switch back to default smoke textures
        this.view.smoke.currentSmokeTextures = this.view.smoke.loadedTextures;
        // Adjust smoke parameters for type3 eruption: temperature medium, gas density high, volcano depth low-medium
        this.parameters.temperature = 11; // medium temperature
        this.parameters.gasDensity = 45; // high gas density
        this.parameters.volcanoStretch = 1.8; // low-medium depth
        this.shakeCamera();
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
        this.stopShake();
        console.log('Resetting to before eruption');

        // Stop sounds
        const mildSfx = document.getElementById('mild_eruption_sfx');
        const strongSfx = document.getElementById('strong_eruption_sfx');
        if (mildSfx) mildSfx.pause();
        if (strongSfx) strongSfx.pause();

        // Switch back to default music if it was playing before eruption
        const backgroundMusic = document.getElementById('background-music');
        if (strongSfx) strongSfx.pause();
        if (backgroundMusic && backgroundMusic.paused) {
            backgroundMusic.play();
        }

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
        // Reset parameters to defaults
        this.parameters.temperature = 10;
        this.parameters.gasDensity = 30;
        this.parameters.volcanoStretch = 2.0;
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
            setTimeout(() => {
                infoboxDiv.textContent = 'Infobox';
                infoboxDiv.style.opacity = '1';
            }, 250);
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

    // Function to determine eruption type based on parameters
    determineEruptionType() {
        console.log('determineEruptionType called');
        const type = this.parameters.getEruptionType();

        // Switch to strong eruption sfx if music is playing
        const backgroundMusic = document.getElementById('background-music');
        const strongSfx = document.getElementById('strong_eruption_sfx');
        if (backgroundMusic && !backgroundMusic.paused) {
            backgroundMusic.pause();
            if (strongSfx) strongSfx.play();
        }

        if (type === 'Type 1') {
            this.type1_eruption();
            // After eruption, change button to reset mode
            const btn = document.getElementById('trigger-eruption-btn');
            if (btn) {
                btn.textContent = 'Reset to Before';
            }
        } else if (type === 'Type 2') {
            this.type2_eruption();
            // After eruption, change button to reset mode
            const btn = document.getElementById('trigger-eruption-btn');
            if (btn) {
                btn.textContent = 'Reset to Before';
            }
        } else if (type === 'Type 3') {
            this.type3_eruption();
            // After eruption, change button to reset mode
            const btn = document.getElementById('trigger-eruption-btn');
            if (btn) {
                btn.textContent = 'Reset to Before';
            }
        } else {
            // No eruption possible
            console.log('No Eruption');
        }
    }

}

export {EruptionHandler};