import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';


class MeasurementView {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.canvas.width =  window.innerWidth;
        this.canvas.height = window.innerHeight;

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            canvas: this.canvas,
            alpha: true
        });
        this.renderer.setSize(this.canvas.width, this.canvas.height);

        // Setup raycaster (used to check for clicked objects)
        this.raycaster = new THREE.Raycaster();

        // Setup scene, camera, camera controls, and lights
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, this.canvas.width / this.canvas.height, 0.01, 100);
        this.camera.position.set(0.5, 0.5, 0.2);

        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.maxPolarAngle = Math.PI / (2.1);

        this.ambientLight = new THREE.AmbientLight(0xFFFFFF, 1);
        this.scene.add(this.ambientLight);

        this.pointLight = new THREE.PointLight(0xFFFFFF, 500);
        this.pointLight.position.set(0, 1, 0);
        this.scene.add(this.pointLight);

        // Update canvas and renderer when window is resized
        window.onresize = () => {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
            this.camera.aspect = this.canvas.width / this.canvas.height;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(this.canvas.width, this.canvas.height);
        };

        // Render whenever camera is moved
        this.controls.addEventListener("change", () => this.render());


        const loader = new GLTFLoader();
        loader.load("../resources/terrainMeshes/mayon.glb", gltf=> {
            const model = gltf.scene;
            this.scene.add(model);
            this.render();
        });

        this.render();
    }

    /**
     * Render the scene, should be called whenever something changes
     */
    render() {
        this.renderer.render(this.scene, this.camera);
    }
}

new MeasurementView(document.getElementById("threeCanvas"));