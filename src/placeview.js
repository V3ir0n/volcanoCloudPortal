import * as THREE from "three";
import ThreeGeo from "../libs/three-geo-esm.js";
import {OrbitControls}
from "three/addons/controls/OrbitControls.js";
import {GLTFLoader}
from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter}
from 'three/addons/exporters/GLTFExporter.js';

/**
 * Render a place view into the given container.
 * @param {HTMLElement} container - The .panel-body element.
 * @param {{ title: string, description: string, raw: object }} place
 */
export function renderPlaceView(container, place, latLng) {
  if (!container) return;

  container.innerHTML = "";

  // Description
  const descP = document.createElement("p");
  descP.className = "place-description";
  descP.textContent = place.description || "";
  container.appendChild(descP);

  // THREE canvas
  const canvas = document.createElement("canvas");
  container.appendChild(canvas);

  new VolcanoView(canvas, place, latLng);
}

class VolcanoView {
  constructor(canvasElement, place, latLng) {
    this.place = place;
    this.latLng = latLng;
    // Setup canvas and renderer
    this.canvas = canvasElement;
    this.canvas.width = this.canvas.parentElement.clientWidth;
    this.canvas.height = 500;

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
      this.canvas.width = this.canvas.parentElement.clientWidth;
      this.camera.aspect = this.canvas.width / this.canvas.height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.canvas.width, this.canvas.height);
      this.render();
    };

    // Render whenever camera is moved
    this.controls.addEventListener("change", () => this.render());

    this.loadVolcanoModel();

    this.render();

  }

  loadVolcanoModel() {
    const loader = new GLTFLoader().setPath("resources/terrainMeshes/");
    const filename = `${this.place.title}.glb`;
    loader.load(filename, gltf => {
      const model = gltf.scene;
      this.scene.add(model);

      const boundingBox = new THREE.Box3();
      boundingBox.expandByObject(model);

      model.position.sub(
        new THREE.Vector3(0, boundingBox.min.y, 0)
      );
      this.render();
    }, undefined, () => {

      // On error (file not found)
      const tokenMapbox = prompt(`The terrain for the volcano ${this.place.title} is not saved. Input a mapbox token to download. To avoid this in the future, save the downloaded file to ./resources/terrainMeshes/`);
      const tgeo = new ThreeGeo({
        tokenMapbox: tokenMapbox,
      });
      tgeo.getTerrainRgb(
        this.latLng, // [lat, lng]
        6.0, // radius of bounding circle (km)
        13 // zoom resolution
      ).then(terrain => {
        terrain.rotation.x = -Math.PI / 2;
        this.scene.add(terrain);
        this.render();

        const gltfExporter = new GLTFExporter();
        gltfExporter.parse(
          terrain,
          function(result) {
            saveArrayBuffer(result, filename);
          },
          error => console.log("An error happened during parsing", error), {
            binary: true
          }
        );
      });
    });
  }

  /**
   * Render the scene, should be called whenever something changes
   */
  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

/**
 * Saves a blob as a file
 * @param {Blob} blob
 * @param {string} filename
 */
function saveBlob(blob, filename) {
  const link = document.createElement("a");
  link.style.display = "none";
  document.body.appendChild(link);

  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

function saveArrayBuffer(buffer, filename) {
  saveBlob(new Blob([buffer], {
    type: "application/octet-stream"
  }), filename);
}