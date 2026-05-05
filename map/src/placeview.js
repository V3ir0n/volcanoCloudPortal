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
 * @param {{ title: string, observatory: string, altitude: string, raw: object }} place
 */
export function renderPlaceView(container, place, latLng) {
  if (!container) return;

  container.innerHTML = "";

  // Volcano info
  const infoEl = document.createElement("div");
  infoEl.className = "volcano-info";
  infoEl.innerHTML = `
    <p><strong>Altitude:</strong> ${place.altitude || "Unknown altitude"}</p>
    <p><strong>Observatory:</strong> ${place.observatory || "Unknown observatory"}</p>
  `;
  container.appendChild(infoEl);

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

  // Sets up the 3D volcano model
  // Function called upon in renderPlaceView main.js330. 
  loadVolcanoModel() {
    const loader = new GLTFLoader().setPath("resources/terrainMeshes/");
    const filename = `${this.place.name}.glb`;
    loader.load(filename, gltf => {
      const model = gltf.scene;
      this.scene.add(model);

/* 
--------------
FOR CALCULATION OF SCALE (remove code later)
 */
      const boundingBox = new THREE.Box3();
      boundingBox.expandByObject(model);
      console.log("terrain X range:", boundingBox.min.x, "to", boundingBox.max.x);
      console.log("terrain Z range:", boundingBox.min.z, "to", boundingBox.max.z);
      
      let maxY = -Infinity, peakX = 0, peakZ = 0;
      model.traverse(child => {
        if (child.isMesh) {
          const pos = child.geometry.attributes.position;
          for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            if (y > maxY) { maxY = y; peakX = pos.getX(i); peakZ = pos.getZ(i); }
          }
        }
      });
      console.log("peak at scene:", peakX.toFixed(4), peakZ.toFixed(4));


      // RED MARKER FOR CORNER
      if (this.place.name === "arenal") {
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(0.02),
          new THREE.MeshBasicMaterial({ color: 0xff0000 })
        );
        marker.position.set(-0.877, 0.1, 0.816);
        this.scene.add(marker);
        this.render();
      }
      /*
------------------------------------'
----------------------------'
*/
      model.position.sub(
        new THREE.Vector3(0, boundingBox.min.y, 0)
      );
      this.render();
      this.loadStationSprites();

      
    }, undefined, () => {

      // On error (file not found)
      const tokenMapbox = prompt(`The terrain for the volcano ${this.place.title} is not saved. Input a mapbox token to download. To avoid this in the future, save the downloaded file to ./resources/terrainMeshes/`);
      if (!tokenMapbox) {
        return;
      }
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

  //Fetches station lat/lon from stations.json and adds them to the scene. 
  //Called after the volcano model is loaded in loadVolcanoModel().
  loadStationSprites() {
    const texture = new THREE.TextureLoader().load("resources/circle.png");
    fetch("resources/stations.json")
      .then(r => r.json())
      .then(stations => {
        stations
          .filter(s => s.volcanoKey === this.place.name)
          .forEach(s => {
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture }));
            sprite.scale.set(0.1, 0.1, 0.1);
            const { x, z } = latLonToScene(s.lat, s.lng, this.latLng[0], this.latLng[1]);
            /* remove later*/ console.log(`${s.name} (${s.lat}, ${s.lng}) -> scene (${x.toFixed(4)}, ${z.toFixed(4)})`);
            /* remove later*/ console.log("volcano center latLng:", this.latLng);
            sprite.position.set(x, 0.15, z);
            this.scene.add(sprite);
          });
        this.render();
      });
  }

  /**
   * Render the scene, should be called whenever something changes
   */
  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

// Converter for station lat/lon to scene x/z coordinates
function latLonToScene(targetLat, targetLon, centerLat, centerLon) {
  const radiusKm = 6.0;
  const kmPerDegLat = 111.32;
  const kmPerDegLon = 111.32 * Math.cos(centerLat * Math.PI / 180);
  const dx = (targetLon - centerLon) * kmPerDegLon;
  const dy = (targetLat - centerLat) * kmPerDegLat;
  return { x: dx / radiusKm, z: -dy / radiusKm };
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