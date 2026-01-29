import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

import {Smoke} from './smoke.js';
import {Ash} from './ash.js';
import {VolcanoParameters} from './parameters.js';
import {EruptionHandler} from './eruption.js';
import {skyMesh} from './sky.js';
import {setupLights} from './lights.js';

document.addEventListener('DOMContentLoaded', () => {
    const audioToggle = document.getElementById('audioToggle');

    if (audioToggle) {
        // Hardcode audio to be turned off by default, need to be started by user action
        audioToggle.checked = false
        toggleAudio(audioToggle.checked);
        audioToggle.addEventListener('change', () => {
            toggleAudio(audioToggle.checked);
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

        this.scene.add(skyMesh);

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
        this.camera.position.set(15, 14, 25);
        this.camera.lookAt(0, 0, 0);
        this.controls.update();

        this.controls.minPolarAngle = Math.PI/3; // 60 degrees (from top)
        this.controls.maxPolarAngle = 2 * Math.PI/3; // 120 degrees (from top)
        this.controls.minAzimuthAngle = -Math.PI/3; // 60 degrees (from front)
        this.controls.maxAzimuthAngle = Math.PI/3; // 60 degrees (from front)
        this.controls.enablePan = true; // Enable pan when controls are on

        setupLights(this.scene);

        // GLTF Loader
        const loader = new GLTFLoader();
        loader.setPath("resources/");

        // Variables for fade animation
        this.terrain = null;
        this.originalTerrainMaterial = null;
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

    // Animation loop
    animate() {
        // Update smoke
        this.smoke.update();
        this.ash.update();

        // Render the scene
        this.renderer.render(this.scene, this.camera);
    }
}

const view = new View();
