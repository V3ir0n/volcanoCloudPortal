import * as THREE from "three";
import ThreeGeo from "../libs/three-geo-esm.js";
import {OrbitControls}
from "three/addons/controls/OrbitControls.js";
import {GLTFLoader}
from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter}
from 'three/addons/exporters/GLTFExporter.js';

let stationsCache = null;
async function loadStations() {
  if (stationsCache) return stationsCache;
  const resp = await fetch('resources/stations.json');
  stationsCache = await resp.json();
  return stationsCache;
}

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

  // Tooltip shown when hovering a station marker
  const tooltip = document.createElement("div");
  tooltip.className = "station-tooltip";
  container.style.position = "relative";
  container.appendChild(tooltip);

  new VolcanoView(canvas, place, latLng, tooltip);
}

class VolcanoView {
  constructor(canvasElement, place, latLng, tooltip) {
    this.place = place;
    this.latLng = latLng;
    this.tooltip = tooltip;
    this.stationMarkers = [];

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

    // Station hover tooltip
    this.canvas.addEventListener("mousemove", e => this.onMouseMove(e));
    this.canvas.addEventListener("mouseleave", () => { this.tooltip.style.display = "none"; });

    this.loadVolcanoModel();

    this.render();

  }

  loadVolcanoModel() {
    const loader = new GLTFLoader().setPath("resources/terrainMeshes/");
    const filename = `${this.place.name}.glb`;
    loader.load(filename, gltf => {
      const model = gltf.scene;
      this.scene.add(model);

      const boundingBox = new THREE.Box3();
      boundingBox.expandByObject(model);

      model.position.sub(
        new THREE.Vector3(0, boundingBox.min.y, 0)
      );

      this.addPeakMarker(model);

      loadStations().then(stations => {
        this.addStationMarkers(model, stations);
        this.render();
      });

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

        this.addPeakMarker(terrain);

        loadStations().then(stations => {
          this.addStationMarkers(terrain, stations);
          this.render();
        });

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
  //CLAUDE MARKER
  /**
   * Finds the highest vertex in the terrain object and places a red pin marker there.
   */
  addPeakMarker(terrainObject) {
    terrainObject.updateWorldMatrix(true, true);

    let maxY = -Infinity;
    let peakX = 0;
    let peakZ = 0;
    const v = new THREE.Vector3();

    terrainObject.traverse(child => {
      if (!child.isMesh || !child.geometry) return;
      const pos = child.geometry.attributes.position;
      const mat = child.matrixWorld;
      for (let i = 0; i < pos.count; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mat);
        if (v.y > maxY) {
          maxY = v.y;
          peakX = v.x;
          peakZ = v.z;
        }
      }
    });

    if (maxY === -Infinity) return;

    const mat = new THREE.MeshStandardMaterial({ color: 0xff2200, roughness: 0.4 });

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.025, 16, 16), mat);
    head.position.y = 0.06;

    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.06, 8), mat);
    stick.position.y = 0.03;

    this.marker = new THREE.Group();
    this.marker.add(head, stick);
    this.marker.position.set(peakX, maxY, peakZ);
    this.scene.add(this.marker);
  }
  //END CLAUDE MARKER

  /**
   * Places a blue pin marker on the terrain surface for each NOVAC station
   * belonging to this volcano. Lat/lng are projected using the same coordinate
   * system ThreeGeo uses when generating the terrain tiles (radius 6 km, unitsSide 1).
   */
  addStationMarkers(terrainObject, allStations) {
    const volcStations = allStations.filter(s => s.volcanoKey === this.place.name);
    if (!volcStations.length) return;

    terrainObject.updateWorldMatrix(true, true);

    // Collect terrain meshes for raycasting
    const meshes = [];
    terrainObject.traverse(child => { if (child.isMesh) meshes.push(child); });

    const [volcLat, volcLng] = this.latLng;

    // ThreeGeo bbox: extends `radius` km in NW and SE directions from center,
    // giving a square bbox with half-side = radius / sqrt(2).
    const radius = 6.0;
    const halfSide = radius / Math.sqrt(2);
    const kmPerLat = 111.32;
    const kmPerLng = 111.32 * Math.cos(volcLat * Math.PI / 180);
    const minLat = volcLat - halfSide / kmPerLat;
    const maxLat = volcLat + halfSide / kmPerLat;
    const minLng = volcLng - halfSide / kmPerLng;
    const maxLng = volcLng + halfSide / kmPerLng;

    const downRay = new THREE.Raycaster();
    const stationMat = new THREE.MeshStandardMaterial({ color: 0x2196f3, roughness: 0.4 });

    for (const station of volcStations) {
      // ThreeGeo _projectCoord, then account for rotation.x = -PI/2 baked into GLB
      const x = (station.lng - minLng) / (maxLng - minLng) - 0.5;
      const projY = -0.5 + (maxLat - station.lat) / (maxLat - minLat);
      const z = -projY;

      // Snap to terrain surface
      downRay.set(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0));
      const hits = downRay.intersectObjects(meshes, false);
      const surfaceY = hits.length > 0 ? hits[0].point.y : 0;

      const head = new THREE.Mesh(new THREE.SphereGeometry(0.015, 12, 12), stationMat);
      head.position.y = 0.04;

      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.04, 8), stationMat);
      stick.position.y = 0.02;

      const pin = new THREE.Group();
      pin.add(head, stick);
      pin.position.set(x, surfaceY, z);
      pin.userData = { station };
      this.scene.add(pin);
      this.stationMarkers.push(pin);
    }
  }

  /**
   * On mouse move over the canvas, highlight the nearest station marker
   * and show a tooltip with station details.
   */
  onMouseMove(event) {
    if (!this.stationMarkers.length) return;
    const rect = this.canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(mouse, this.camera);

    const objects = this.stationMarkers.flatMap(g => g.children);
    const hits = this.raycaster.intersectObjects(objects, false);

    if (hits.length > 0) {
      const s = hits[0].object.parent.userData.station;
      this.tooltip.innerHTML =
        `<strong>${s.name}</strong><br>` +
        `${s.spectrometerType} · ${s.serial}<br>` +
        `Alt: ${s.altitude} m`;
      this.tooltip.style.display = "block";
      this.tooltip.style.left = (event.clientX - rect.left + 14) + "px";
      this.tooltip.style.top = (event.clientY - rect.top - 10) + "px";
    } else {
      this.tooltip.style.display = "none";
    }
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
