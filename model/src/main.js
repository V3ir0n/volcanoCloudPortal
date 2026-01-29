import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

import {Smoke} from './smoke.js';
import {Ash} from './ash.js';
import {VolcanoParameters} from './parameters.js';
import {EruptionHandler} from './eruption.js';

document.addEventListener('DOMContentLoaded', () => {
    const backgroundMusic = document.getElementById('background-music');
    const audioToggle = document.getElementById('audioToggle');
    const refreshBtn = document.getElementById('refresh-btn');
    const cameraControlsToggle = document.getElementById('cameraControlsToggle');

    if (backgroundMusic) {
        backgroundMusic.pause();
    }

    if (audioToggle) {
        // Hardcode audio to be turned off by default, need to be started by user action
        audioToggle.checked = false
        toggleAudio(audioToggle.checked);
        audioToggle.addEventListener('change', () => {
            toggleAudio(audioToggle.checked);
        });
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            location.reload();
        });
    }

    if (cameraControlsToggle) {
        toggleCameraControls(cameraControlsToggle.checked);
        cameraControlsToggle.addEventListener('change', () => {
            toggleCameraControls(cameraControlsToggle.checked);
        });
    }
});

// Raycaster for click detection
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function toggleAudio(enable) {
    if (view && view.eruptionHandler) {
        if (enable) {
            view.eruptionHandler.soundHandler.resume();
        } else {
            view.eruptionHandler.soundHandler.pause();
        }
    }
}

// Function to toggle camera controls (re-introduced)
function toggleCameraControls(enable) {
    if (view.controls) {
        view.controls.enabled = enable;
        const button = document.getElementById('toggle-camera-btn');
        if (view.controls.enabled) {
            // Apply specified limits when controls are enabled
            view.controls.minPolarAngle = Math.PI/3; // 60 degrees (from top)
            view.controls.maxPolarAngle = 2 * Math.PI/3; // 120 degrees (from top)
            view.controls.minAzimuthAngle = -Math.PI/3; // 60 degrees (from front)
            view.controls.maxAzimuthAngle = Math.PI/3; // 60 degrees (from front)
            view.controls.enablePan = true; // Enable pan when controls are on
        } else {
            // Reset limits and disable pan when controls are off
            view.controls.minPolarAngle = 0; // Full range
            view.controls.maxPolarAngle = Math.PI; // Full range
            view.controls.minAzimuthAngle = -Infinity; // Full range
            view.controls.maxAzimuthAngle = Infinity; // Full range
            view.controls.enablePan = false; // Disable pan when controls are off
        }
        console.log('Camera controls ' + (view.controls.enabled ? 'enabled' : 'disabled'));
    }
}

class View {
    constructor() {

        this.parameters = new VolcanoParameters(this);

        // Initialize Three.js scene
        this.scene = new THREE.Scene();

        this.scene.fog = new THREE.Fog(0x000000, 100, 400); // Enhanced fog for smooth fadeout
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer();
        this.renderer.setClearColor(0xffffff); // White background
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        document.getElementById('container').appendChild(this.renderer.domElement);

        // Add custom skybox with gradient and subtle fog
        const skyGeometry = new THREE.SphereGeometry(500, 32, 32);
        const skyMaterial = new THREE.ShaderMaterial({
            uniforms: {
                topColor: { value: new THREE.Color(0x0172ad) },
                bottomColor: { value: new THREE.Color(0xffffff) }
            },
            vertexShader: `
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPosition.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 topColor;
                uniform vec3 bottomColor;
                varying vec3 vWorldPosition;

                void main() {
                    // Create vertical gradient based on height
                    float h = normalize(vWorldPosition).y * 0.5 + 0.5;
                    vec3 color = mix(bottomColor, topColor, smoothstep(0.0, 1.0, h));

                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            side: THREE.BackSide
        });

        const sky = new THREE.Mesh(skyGeometry, skyMaterial);
        this.scene.add(sky);

        this.eruptionHandler = new EruptionHandler(this, this.parameters);

        this.smoke = new Smoke(this.camera, this.parameters);
        this.scene.add(this.smoke);
        this.smoke.createSmokeParticles();

        this.ash = new Ash(this.camera, this.parameters, this.eruptionHandler);
        this.scene.add(this.ash);
        this.ash.createAshParticles();

        this.eruptionHandler.updateEruption();

        // Add controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enabled = false; // Default to off
        this.camera.position.set(15, 14, 25);
        this.camera.lookAt(0, 0, 0);
        this.controls.update();


        // Add enhanced lighting for better global illumination
        // Ambient light for base illumination (increased for more consistent lighting)
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
        this.scene.add(ambientLight);

        // Hemisphere light for natural sky/ground lighting (increased intensity)
        const hemisphereLight = new THREE.HemisphereLight(0x87CEEB, 0x8B4513, 1.2);
        this.scene.add(hemisphereLight);

        // Main directional light (sun) - aimed between both models (increased intensity)
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.4);
        directionalLight.position.set(5, 25, 5);
        directionalLight.lookAt(-7.5, 0, 7.5); // Looking at midpoint between terrain and volcano
        this.scene.add(directionalLight);

        // Additional fill light from opposite direction
        const fillLight = new THREE.DirectionalLight(0xfff8dc, 1.0);
        fillLight.position.set(-15, 20, -15);
        fillLight.lookAt(-7.5, 0, 7.5); // Also aimed at midpoint
        this.scene.add(fillLight);

        // Secondary directional light for enhanced global illumination
        const directionalLight2 = new THREE.DirectionalLight(0xfff4e6, 1.2);
        directionalLight2.position.set(-10, 30, 10);
        directionalLight2.lookAt(0, 0, 0); // Focused on volcano model area
        this.scene.add(directionalLight2);

        // Point lights for more even global illumination (positioned to cover both models)
        const pointLight1 = new THREE.PointLight(0xffffff, 1.2, 150);
        pointLight1.position.set(10, 20, 10); // Near volcano slice
        this.scene.add(pointLight1);

        const pointLight2 = new THREE.PointLight(0xffffff, 1.2, 150);
        pointLight2.position.set(-20, 20, 20); // Near terrain model
        this.scene.add(pointLight2);

        const pointLight3 = new THREE.PointLight(0xffffff, 1.0, 150);
        pointLight3.position.set(-5, 25, 15); // Additional light for terrain area
        this.scene.add(pointLight3);

        const pointLight4 = new THREE.PointLight(0xffffff, 1.0, 150);
        pointLight4.position.set(5, 25, -5); // Additional light for volcano area
        this.scene.add(pointLight4);

        // Enhanced point lights specifically for volcano model global illumination
        const volcanoPointLight1 = new THREE.PointLight(0xfff4e6, 1.5, 100);
        volcanoPointLight1.position.set(8, 15, 8); // Warm light near volcano
        this.scene.add(volcanoPointLight1);

        const volcanoPointLight2 = new THREE.PointLight(0xffd700, 1.3, 100);
        volcanoPointLight2.position.set(-8, 12, 8); // Golden warm light
        this.scene.add(volcanoPointLight2);

        const volcanoPointLight3 = new THREE.PointLight(0xfff4e6, 1.4, 100);
        volcanoPointLight3.position.set(0, 18, -8); // Front warm light
        this.scene.add(volcanoPointLight3);

        const volcanoPointLight4 = new THREE.PointLight(0xffffff, 1.1, 100);
        volcanoPointLight4.position.set(0, 25, 0); // Top light for better illumination
        this.scene.add(volcanoPointLight4);

        // Spotlight for dramatic accent lighting on volcano
        const volcanoSpotLight = new THREE.SpotLight(0xfff4e6, 2.0, 200);
        volcanoSpotLight.position.set(15, 30, 15);
        volcanoSpotLight.angle = Math.PI / 6;
        volcanoSpotLight.penumbra = 0.3;
        volcanoSpotLight.decay = 2;
        volcanoSpotLight.distance = 200;
        volcanoSpotLight.target.position.set(0, 0, 0); // Focused on volcano
        this.scene.add(volcanoSpotLight);
        this.scene.add(volcanoSpotLight.target);


        // GLTF Loader
        const loader = new GLTFLoader();
        loader.setPath("resources/");

        // Variables for fade animation
        this.terrain = null;
        this.originalTerrainMaterial = null;
        this.isFadingTerrain = false;
        this.isFadingVolcano = false;
        this.volcano = null;


        // Load terrain model (single instance)
        loader.load('mayon_FULL3.glb', ({ scene: terrainModel }) => {
            terrainModel.position.set(0, 0.15, 0); // Separated position to avoid overlap
            terrainModel.scale.set(0.25, 0.25, 0.25);
            terrainModel.rotation.set(0, -135, 0);

            // Store the original material for resetting
            terrainModel.traverse((child) => {
                if (child.isMesh && !this.originalTerrainMaterial) {
                    this.originalTerrainMaterial = child.material.clone();
                }
            });

            this.scene.add(terrainModel);
            //this.scene.add(terrainFresnel);
            console.log(terrainModel);
            terrainModel.name = 'Terrain';
            this.terrain = terrainModel;

            this.setTerrainOpacity(0.8);

        }, undefined, function (error) {
            console.error('An error happened loading terrain:', error);
        });


        // Load volcano slice model
        loader.load('mayon_slice_FULL3.glb', gltf => {
            this.volcano = gltf.scene;
            this.volcano.position.set(0, 0, 0);
            this.volcano.scale.set(0.25, 0.25, 0.25); // Reverted scale back to original 0.25
            this.volcano.rotation.set(0,-135, 0);

            // Enable transparency for fade animation
            this.volcano.traverse((child) => {
                if (child.isMesh) {
                    child.material.transparent = true;
                    child.material.opacity = 1.0;

                    // Mark this mesh as processed to avoid infinite recursion
                    child.userData.fresnelProcessed = true;

                    // Store original vertices for stretching
                    const geometry = child.geometry;
                    if (geometry.isBufferGeometry && geometry.attributes.position) {
                        geometry.userData.originalVertices = geometry.attributes.position.array.slice();
                        geometry.userData.currentStretch = 1;
                    }
                }
            });



            this.scene.add(this.volcano);
            this.volcano.visible = true; // Always visible
            console.log(this.volcano);


            view.stretchVolcano();
        }, undefined, function (error) {
            console.error('An error happened loading volcano:', error);
        });

        this.isInsideView = false;
        this.isAnimatingCamera = false;

        const redCubeGeometry = new THREE.BoxGeometry(1, 1, 1);
        const redCubeMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const redCube = new THREE.Mesh(redCubeGeometry, redCubeMaterial);
        redCube.userData.isRedCube = true;
        redCube.userData.isGlowing = false;

        // Position the red cube in front of the slice model
        redCube.position.set(-4, -3, 5);

        this.scene.add(redCube);

        window.addEventListener('click', event=>this.onMouseClick(event));

        document.getElementById('toggle-visibility-btn').addEventListener('click', () => {
            console.log('Look inside Volcano button clicked. isInsideView:', this.isInsideView);
            if (this.volcano && this.terrain) {
                if (this.isInsideView) {
                    // Go outside: fade in terrain and animate camera to default
                    //this.fadeTerrain(false);
                    this.animateCameraToDefault();
                } else {
                    // Go inside: fade in slice and fade out terrain
                    this.fadeVolcano(false);
                    //this.fadeTerrain(true);
                }
            }
        });

        // Handle window resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // Start animation loop
        this.renderer.setAnimationLoop(()=>this.animate());
    }

    setTerrainOpacity(opacity) {
        console.log(`Setting terrain opacity to ${opacity}.`)
        if (this.terrain) {
            this.terrain.traverse(child => {
                if(child.isMesh) {
                    // Ensure material is transparent to allow fading
                    child.material.transparent = true;

                    child.material.userData.targetOpacity = opacity;

                    const animateOpacity = () => {
                        const diff = child.material.userData.targetOpacity - child.material.opacity;

                        if (Math.abs(diff) < 0.01) {
                            child.material.opacity = child.material.userData.targetOpacity;
                            console.log("done");
                        } else {
                            child.material.opacity += diff * 0.01;
                            requestAnimationFrame(animateOpacity);
                        }
                    }
                    animateOpacity();
                }
            });
        }
    }

    onMouseClick(event) {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, this.camera);
        const intersects = raycaster.intersectObjects(this.scene.children, true);

        const redCubeIntersect = intersects.find(intersect => intersect.object.userData.isRedCube);

        if (redCubeIntersect) {
            const redCube = redCubeIntersect.object;
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

    // Function to update the trigger button text based on current parameters
    checkEruption() {
        const regime = this.eruptionHandler.getRegime();
        if (this.eruptionHandler.previousRegime != regime) {
            this.eruptionHandler.updateEruption(regime);
            this.eruptionHandler.previousRegime = regime;
        }
    };

    stretchVolcano() {
        if (!this.volcano) {
            return;
        }

        const {min, max} = this.parameters.getLim("depth");
        const stretchFactor = (this.parameters.depth - min) / (max-min);

        // Set smoke depth factor based on volcano stretch.
        // Deeper volcano (higher stretch value) means smaller factor, hence less vertical force for smoke.
        // window.smokeDepthFactor = 1.0 / stretchSliderValue; // Removed: Logic moved to smoke.js

        this.volcano.traverse((child) => {
            if (child.isMesh) {
                const geometry = child.geometry;
                if (geometry.isBufferGeometry && geometry.userData.originalVertices) {

                    const stretch = () => {

                        const targetFactor = geometry.userData.targetFactor;
                        const currentStretch = geometry.userData.currentStretch;
                        const newStretch = currentStretch + 0.05*(targetFactor-currentStretch);
                        console.log(newStretch);
                        geometry.userData.currentStretch = newStretch;
                        const positions = geometry.attributes.position.array;
                        const originalPositions = geometry.userData.originalVertices;
                        const stretchAmount = newStretch - 1.0;
                        const maxDisplacement = 30;

                        const stretchMin = 90;
                        const stretchMax = 35;

                        for (let i = 0; i < originalPositions.length; i += 3) {
                            const originalX = originalPositions[i];
                            const originalY = originalPositions[i + 1];
                            const originalZ = originalPositions[i + 2];

                            // Reset positions to original state before applying transformation
                            positions[i] = originalX;
                            positions[i + 1] = originalY;
                            positions[i + 2] = originalZ;

                            let t = 0;
                            if (originalZ >= stretchMax) {
                                // Vertices above the stretch max are fully displaced.
                                t = 1;
                            } else if (originalZ >= stretchMin) {

                            // if (originalZ > stretchMin && originalZ <= stretchMax) {
                                // Vertices inside the stretch range are displaced proportionally.
                                t = (originalZ - stretchMin) / (stretchMax - stretchMin);
                            }

                            // Apply displacement to stretch the model along the Z-axis
                            if (t > 0) {
                                const displacement = t * stretchAmount * maxDisplacement;
                                positions[i + 2] += displacement;
                            }
                        }
                        geometry.attributes.position.needsUpdate = true;

                        if (Math.abs(newStretch - targetFactor) > 0.01) {
                            requestAnimationFrame(()=>stretch(targetFactor))
                        } else {
                            geometry.userData.currentStretch = targetFactor;
                        }
                    }

                    geometry.userData.targetFactor = stretchFactor;
                    stretch();

                }
            }
        });
    }

    // Fade animation function for volcano slice
    fadeVolcano(out) {
        console.log('fadeVolcano called with out:', out, 'isFadingVolcano:', this.isFadingVolcano);
        if (!this.volcano || this.isFadingVolcano) return;

        this.isFadingVolcano = true;
        console.log('isFading set to true');

        // Temporarily disable controls to allow camera animation
        const controlsWereEnabled = this.controls.enabled;
        this.controls.enabled = false;

        const startPosition = this.camera.position.clone();
        const endPosition = out ? new THREE.Vector3(15, 14.15, 25) : new THREE.Vector3(4, 2, 41); // Initial position for fade out, inside for fade in

        // Ensure volcano is visible and set initial opacity for fade-in
        if (!out) {
            console.log('Fading in: setting volcano visible.');
            this.volcano.visible = true;
            this.volcano.traverse(child => {
                if(child.isMesh) {
                    // Ensure material is transparent to allow fading
                    child.material.transparent = true;
                    child.material.opacity = 0;
                }
            });
        }

        const duration = 1500; // 1.5 seconds for the animation
        let startTime = null;

        const animationStep = timestamp => {
            if (startTime === null) {
                startTime = timestamp;
            }
            const elapsedTime = timestamp - startTime;
            const linearProgress = Math.min(elapsedTime / duration, 1);
            // Apply ease-in-out function for smoother animation
            const easedProgress = 0.5 * (1 - Math.cos(linearProgress * Math.PI));

            console.log('Animation step - progress:', easedProgress);

            // Interpolate camera position and update its view
            this.camera.position.lerpVectors(startPosition, endPosition, easedProgress);
            if (out) {
                this.camera.lookAt(0, 0, 0);
            } else if (this.volcano) {
                this.camera.lookAt(this.volcano.position);
            }

            // Interpolate volcano opacity
            const opacity = out ? 1 - easedProgress : easedProgress;
            this.volcano.traverse((child) => {
                if (child.isMesh && child.material) {
                    child.material.opacity = opacity;
                }
            });

            if (linearProgress < 1) {
                requestAnimationFrame(animationStep);
            } else {
                // Animation complete
                console.log('Animation complete.');
                this.isFadingVolcano = false;
                // Ensure camera is precisely at endPosition
                this.camera.position.copy(endPosition);
                // Set controls target to appropriate position
                if (out) {
                    this.controls.target.set(0, 0, 0);
                    this.camera.position.set(15, 14, 25);
                } else {
                    this.controls.target.copy(this.volcano.position);
                }
                // Sync controls internal state with new camera position
                this.controls.update();
                // Restore controls to previous state
                this.controls.enabled = controlsWereEnabled;
                // Update inside view state
                this.isInsideView = !out;
                // Volcano remains visible at all times
            }
        }

        console.log('Starting animation frame request.');
        requestAnimationFrame(animationStep);
    }

    // Fade animation function
    fadeTerrain(out) {
        console.log('fadeTerrain called with out:', out, 'isFadingTerrain:', this.isFadingTerrain);
        if (!this.terrain || this.isFadingTerrain) return;

        this.isFadingTerrain = true;
        console.log('isFading set to true');

        const startPosition = this.camera.position.clone();
        const endPosition = out ? new THREE.Vector3(15, 5, 25) : new THREE.Vector3(15, 14, 25); // Inside position for fade out, initial for fade in

        // Ensure terrain and Fresnel clone are visible and set initial opacity/intensity for fade-in
        if (!out) {
            console.log('Fading in: adding terrain and Fresnel clone back to scene if needed.');
            this.terrain.traverse(child => {
                if(child.isMesh) {
                    // Ensure material is transparent to allow fading
                    child.material.transparent = true;
                    child.material.opacity = 0;
                }
            });
            if (this.terrainFresnel) {
                this.terrainFresnel.traverse(child => {
                    if (child.isMesh && child.material && child.material.uniforms) {
                        child.material.uniforms.fresnelIntensity.value = 0;
                    }
                });
            }
            if (!this.scene.children.includes(this.terrain)) {
                this.scene.add(this.terrain);
            }
            if (this.terrainFresnel && !this.scene.children.includes(this.terrainFresnel)) {
                this.scene.add(this.terrainFresnel);
            }
            this.terrain.visible = true;
            if (this.terrainFresnel) {
                this.terrainFresnel.visible = true;
            }
        }

        const duration = 1500; // 1.5 seconds for the animation
        let startTime = null;

        const animationStep = timestamp => {
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
            this.terrain.traverse((child) => {
                if (child.isMesh && child.material) {
                    child.material.opacity = opacity;
                }
            });
            if (this.terrainFresnel) {
                this.terrainFresnel.traverse((child) => {
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
                this.isFadingTerrain = false;
                if (out) {
                    console.log('Fading out: setting terrain and Fresnel clone invisible and removing from scene.');
                    this.terrain.visible = false;
                    this.scene.remove(this.terrain);
                    if (this.terrainFresnel) {
                        this.terrainFresnel.visible = false;
                        this.scene.remove(this.terrainFresnel);
                    }
                }
            }
        }

        console.log('Starting animation frame request.');
        requestAnimationFrame(animationStep);
    }

    // Animate camera to default position
    animateCameraToDefault() {
        console.log('animateCameraToDefault called. isAnimatingCamera:', this.isAnimatingCamera);
        if (this.isAnimatingCamera) return;

        this.isAnimatingCamera = true;
        console.log('isAnimatingCamera set to true');

        // Temporarily disable controls to allow camera animation
        const controlsWereEnabled = this.controls.enabled;
        this.controls.enabled = false;

        const startPosition = this.camera.position.clone();
        const endPosition = new THREE.Vector3(15, 14, 25);

        const duration = 1500; // 1.5 seconds for the animation
        let startTime = null;

        const animationStep = timestamp => {
            if (startTime === null) {
                startTime = timestamp;
            }
            const elapsedTime = timestamp - startTime;
            const linearProgress = Math.min(elapsedTime / duration, 1);
            // Apply ease-in-out function for smoother animation
            const easedProgress = 0.5 * (1 - Math.cos(linearProgress * Math.PI));

            console.log('Camera animation step - progress:', easedProgress);

            // Interpolate camera position
            this.camera.position.lerpVectors(startPosition, endPosition, easedProgress);
            this.camera.lookAt(0, 0, 0);

            if (linearProgress < 1) {
                requestAnimationFrame(animationStep);
            } else {
                // Animation complete
                console.log('Camera animation complete.');
                this.isAnimatingCamera = false;
                // Set controls target to default
                this.controls.target.set(0, 0, 0);
                this.camera.position.set(15, 14, 25);
                this.camera.lookAt(0, 0, 0);
                // Temporarily set full range to allow setting position
                this.controls.minAzimuthAngle = -Infinity;
                this.controls.maxAzimuthAngle = Infinity;
                this.controls.minPolarAngle = 0;
                this.controls.maxPolarAngle = Math.PI;
                // Sync controls internal state with new camera position
                this.controls.update();
                // Ensure position is maintained after controls update
                this.camera.position.set(15, 14, 25);
                this.camera.lookAt(0, 0, 0);
                // Restore controls to previous state
                this.controls.enabled = controlsWereEnabled;
                // Update inside view state
                this.isInsideView = false;
            }
        }

        console.log('Starting camera animation frame request.');
        requestAnimationFrame(animationStep);
    }

    // Animation loop
    animate() {
        // Update smoke
        this.smoke.update();
        this.ash.update();

        // Update controls only if not fading or animating camera
        if (!this.isFadingTerrain && !this.isFadingVolcano && !this.isAnimatingCamera) {
            this.controls.update();
        }

        // Render the scene
        this.renderer.render(this.scene, this.camera);
    }
}



// Custom Fresnel shader material for edge glow effect
function createFresnelMaterial(fresnelColor = new THREE.Color(0x00ffff), fresnelPower = 2.0, fresnelIntensity = 1.0) {
    const vertexShader = `
        varying vec3 vNormal;
        varying vec3 vViewPosition;

        void main() {
            vNormal = normalize(normalMatrix * normal);
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            vViewPosition = -mvPosition.xyz;
            gl_Position = projectionMatrix * mvPosition;
        }
    `;

    const fragmentShader = `
        precision mediump float;
        uniform vec3 fresnelColor;
        uniform float fresnelPower;
        uniform float fresnelIntensity;

        varying vec3 vNormal;
        varying vec3 vViewPosition;

        void main() {
            // Calculate Fresnel effect
            vec3 viewDirection = normalize(vViewPosition);
            vec3 normal = normalize(vNormal);
            float fresnel = 1.0 - max(0.0, dot(normal, viewDirection));
            fresnel = pow(fresnel, fresnelPower);

            // Modulate intensity based on camera distance
            float cameraDistance = length(vViewPosition); // Corrected: use vViewPosition for distance from camera
            float distanceFactor = clamp(cameraDistance / 50.0, 0.1, 1.0);

            // Use smoothstep for a blurred transition
            float alpha = smoothstep(0.1, 0.7, fresnel) * fresnelIntensity * distanceFactor;

            gl_FragColor = vec4(fresnelColor.rgb, alpha); // Corrected: use fresnelColor and alpha
        }
    `;

    const uniforms = {
        fresnelColor: { value: fresnelColor },
        fresnelPower: { value: fresnelPower },
        fresnelIntensity: { value: fresnelIntensity }
    };

    const shaderMaterial = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        transparent: true,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending,
        depthWrite: false
    });

    return shaderMaterial;
}

const view = new View();
