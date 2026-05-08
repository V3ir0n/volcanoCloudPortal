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
    this.terrainTransform = {
      center: new THREE.Vector3(0, 0, 0),
      scaleX: 1,
      scaleZ: 1
    };
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

      const boundingBox = new THREE.Box3();
      boundingBox.expandByObject(model);

      //-----------------------------------------------------------------
      
      // Assume the terrain is centered on the volcano and scale it to fit a 12km x 12km area (6km radius)
      const terrainCenter = boundingBox.getCenter(new THREE.Vector3());
      const terrainWidth = boundingBox.max.x - boundingBox.min.x;
      const terrainDepth = boundingBox.max.z - boundingBox.min.z;
      const radiusKm = 6.0;
      this.terrainTransform.center.copy(terrainCenter);
      this.terrainTransform.scaleX = terrainWidth / (2 * radiusKm);
      this.terrainTransform.scaleZ = terrainDepth / (2 * radiusKm);

      console.log("terrain center:", terrainCenter);
      console.log("terrain scale:", this.terrainTransform.scaleX, this.terrainTransform.scaleZ);
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
      console.log("summit peak scene coords:", {
        x: peakX,
        z: peakZ,
        y: maxY,
        terrainCenter: terrainCenter.toArray(),
        scaleX: this.terrainTransform.scaleX,
        scaleZ: this.terrainTransform.scaleZ
      });


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
      // PINK PIN FOR SUMMIT
      const pinMat = new THREE.MeshBasicMaterial({ color: 0xff69b4 });
      const pinHead = new THREE.Mesh(new THREE.SphereGeometry(0.015), pinMat);
      const pinNeedle = new THREE.Mesh(new THREE.ConeGeometry(0.004, 0.06, 8), pinMat);
      pinNeedle.rotation.z = Math.PI;
      pinNeedle.position.y = -0.045;
      const pin = new THREE.Group();
      pin.add(pinHead);
      pin.add(pinNeedle);
      pin.position.set(0, 0.2, 0);
      this.scene.add(pin);

      /*
------------------------------------'
----------------------------'
*/
      model.position.sub(
        new THREE.Vector3(0, boundingBox.min.y, 0)
      );
      this.loadStationSprites(model);
      this.render();

      
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
//----------------------------------------------------------------------------------
  // Fetches station lat/lon from stations.json and adds 3D markers to the terrain.
  // Called after the volcano model is loaded in loadVolcanoModel().
  loadStationSprites(terrainRoot) {
    fetch("resources/stations.json")
      .then(r => r.json())
      .then(stations => {
        stations
          .filter(s => s.volcanoKey === this.place.name)
          .forEach(s => {
            const scenePos = this.latLonToScene(s.lat, s.lng);
            console.log(`station ${s.name} lat/lon=(${s.lat}, ${s.lng}) -> scene=(${scenePos.x.toFixed(4)}, ${scenePos.z.toFixed(4)})`);
            const marker = this.createStationMarker();
            const placed = this.placeObjectOnTerrainLatLon(terrainRoot, marker, s.lat, s.lng, {
              heightOffset: 0.02,
              alignWithNormal: false
            });
            if (!placed) {
              marker.position.set(scenePos.x, 0.15, scenePos.z);
            }
            this.scene.add(marker);
            console.log(`station ${s.name} placed=${placed} finalPos=(${marker.position.x.toFixed(4)}, ${marker.position.y.toFixed(4)}, ${marker.position.z.toFixed(4)})`);
          });
        this.render();
      });
  }

  createStationMarker() {
    const group = new THREE.Group();

    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.005, 0.005, 0.12, 12),
      new THREE.MeshStandardMaterial({ color: 0x0077ff, metalness: 0.2, roughness: 0.6 })
    );
    stem.position.y = 0.06;
    group.add(stem);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x3399ff, emissiveIntensity: 0.6 })
    );
    head.position.y = 0.12;
    group.add(head);

    return group;
  }

  placeObjectOnTerrain(terrainRoot, object3D, x, z, options = {}) {
    const {
      heightOffset = 0.0,
      alignWithNormal = false
    } = options;

    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(x, 100, z),
      new THREE.Vector3(0, -1, 0),
      0,
      200
    );

    const intersects = raycaster.intersectObject(terrainRoot, true);
    if (!intersects.length) {
      console.warn("No terrain intersection found at", x, z);
      return false;
    }

    const hit = intersects[0];
    object3D.position.set(x, hit.point.y + heightOffset, z);

    if (alignWithNormal && hit.face) {
      const normal = hit.face.normal.clone();
      normal.transformDirection(hit.object.matrixWorld);
      object3D.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    }

    return true;
  }

  placeObjectOnTerrainLatLon(terrainRoot, object3D, lat, lon, options = {}) {
    const { x, z } = this.latLonToScene(lat, lon);
    return this.placeObjectOnTerrain(terrainRoot, object3D, x, z, options);
  }

  latLonToScene(targetLat, targetLon) {
    const radiusKm = 6.0;
    const kmPerDegLat = 111.32;
    const kmPerDegLon = 111.32 * Math.cos(this.latLng[0] * Math.PI / 180);
    const dx = (targetLon - this.latLng[1]) * kmPerDegLon;
    const dy = (targetLat - this.latLng[0]) * kmPerDegLat;
    return {
      x: this.terrainTransform.center.x + dx * this.terrainTransform.scaleX,
      z: this.terrainTransform.center.z - dy * this.terrainTransform.scaleZ
    };
  }
  //--------------------------------------------------------------------------

  /**
   * Render the scene, should be called whenever something changes
   */
  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
//--------------------------------------------------------------------------
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