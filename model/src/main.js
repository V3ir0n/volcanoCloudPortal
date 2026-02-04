import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

import {Smoke} from './smoke.js';
import {Ash} from './ash.js';
import {VolcanoParameters} from './parameters.js';
import {EruptionHandler} from './eruption.js';
import {AnnotationHandler} from './annotationHandler.js';
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
        this.canvas = document.getElementById("threeCanvas");
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            canvas: this.canvas
        });
        this.renderer.setClearColor(0xffffff); // White background
        this.renderer.setSize(window.innerWidth, window.innerHeight);

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
        this.volcano = null;

        const textureLoader = new THREE.TextureLoader();
        textureLoader.setPath("resources/");
        textureLoader.load('volcano_lava.png', (texture) => {
            texture.encoding = THREE.sRGBEncoding; // Ensure correct color space
            this.lavaTexture = texture;
        });


        // Load terrain model (single instance)
        loader.load('mayon_FULL3.glb', ({ scene: terrainModel }) => {
            terrainModel.position.set(0, 0.15, 0); // Separated position to avoid overlap
            terrainModel.scale.set(0.25, 0.25, 0.25);
            terrainModel.rotation.set(0, -135, 0);

            // Store the original textyre for resetting
            terrainModel.traverse((child) => {
                if (child.isMesh) {
                    this.noLavaTexture = child.material.map.clone();
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

        const infoboxDiv = document.getElementById('infobox');
        let infoBoxTextBackup;
        this.annotationHandler = new AnnotationHandler(
            this.canvas, this.camera, this.scene, annotation=>{
                // On annotation selected
                infoBoxTextBackup = infoboxDiv.innerHTML
                infoboxDiv.innerHTML = annotation.infoBoxText;
            }, ()=>{
                // On annotation closed
                // Reset infobox
                this.eruptionHandler.updateEruption();
            }
        );

        // Handle window resize
        window.addEventListener('resize', () => {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
            this.camera.aspect = this.canvas.width / this.canvas.height;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(this.canvas.width, this.canvas.height);
        });

        // Start animation loop
        this.renderer.setAnimationLoop(()=>this.animate());
    }

    removeLava() {
        if (!this.terrain) {
            return
        }

        // This will stop animation loop in addLava (if ongoing)
        this.terrain.userData.shouldHaveLava = false;

        // Reset texture
        const terrainMesh = this.terrain.children[0];
        terrainMesh.material.map = this.noLavaTexture.clone();
        terrainMesh.material.needsUpdate = true;
    }

    addLava() {
        if (!this.terrain) {
            return
        }
        this.terrain.userData.shouldHaveLava = true;
        const terrainMesh = this.terrain.children[0];

        // Create a grid to load in incrementally
        const textureWidth = 1386;
        const textureHeight = 1381;
        const origin = new THREE.Vector2(710, 775);
        const d = 20;

        const grid = [];
        for (let i=0; i+d<textureWidth; i+=d) {
            for (let j=0; j+d<textureHeight; j+=d) {
                grid.push({
                    box: new THREE.Box2(
                        new THREE.Vector2(i,j),
                        new THREE.Vector2(i+d,j+d)
                    ),
                    dist: new THREE.Vector2(
                        i + (d/2),
                        j + (d/2)
                    ).distanceToSquared(origin)
                });
            }
        }

        // Cells closest to summit should be last
        grid.sort((a,b) => b.dist - a.dist);

        let dist = 0;
        const animateLava = () => {
            if (!this.terrain.userData.shouldHaveLava) {
                return;
            }
            while (grid.slice(-1)[0].dist <= dist) {
                const box = grid.pop().box;
                this.renderer.copyTextureToTexture(
                    this.lavaTexture,
                    terrainMesh.material.map,
                    box, box.min
                );
                terrainMesh.material.needsUpdate = true;
            }

            if (grid.length > 0) {
                dist += d*d;
                requestAnimationFrame(animateLava);
            }
        }
        animateLava();
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
                            requestAnimationFrame(()=>stretch(targetFactor));
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
