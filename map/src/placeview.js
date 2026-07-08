import * as THREE from "three";
import ThreeGeo from "../libs/three-geo-esm.js";
import {OrbitControls}
from "three/addons/controls/OrbitControls.js";
import {GLTFLoader}
from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder }
from 'three/addons/libs/meshopt_decoder.module.js';
import {GLTFExporter}
from 'three/addons/exporters/GLTFExporter.js';

const defaultRadiusKm = 10; // radius for fetching terrain data, can be adjusted if needed

// Scan cone color (user-selectable, shared with the measurement view via localStorage)
const CONE_COLOR_KEY = "scanConeColor";
const DEFAULT_CONE_COLOR = "#808080";
function getStoredConeColor(defaultColor = DEFAULT_CONE_COLOR) {
  return localStorage.getItem(CONE_COLOR_KEY) || defaultColor;
}

// Builds a scan-cone-shaped swatch button: a hidden native <input type="color">
// (so the OS picker still works) overlaid with an SVG fan icon that renders in
// the currently picked color, standing in for the plain browser swatch.
export function createConeColorPicker(onChange) {
  const wrap = document.createElement("div");
  wrap.className = "cone-color-swatch btn btn--pill btn--outline";
  wrap.title = "Beam cone color";

  const label = document.createElement("span");
  label.textContent = "Beam color";
  wrap.appendChild(label);

  const NS = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(NS, "svg");
  icon.setAttribute("viewBox", "0 0 32 24");
  icon.setAttribute("width", "30");
  icon.setAttribute("height", "22");
  icon.style.pointerEvents = "none";
  icon.style.flexShrink = "0";

  const fan = document.createElementNS(NS, "path");
  fan.setAttribute("d", "M2,22 A14,14 0 0 1 30,22 Z");
  fan.setAttribute("fill-opacity", "0.55");
  icon.appendChild(fan);

  [135, 90, 45].forEach(deg => {
    const rad = deg * Math.PI / 180;
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", "16");
    line.setAttribute("y1", "22");
    line.setAttribute("x2", (16 + 14 * Math.cos(rad)).toFixed(2));
    line.setAttribute("y2", (22 - 14 * Math.sin(rad)).toFixed(2));
    line.setAttribute("stroke-width", "1");
    icon.appendChild(line);
  });

  const dot = document.createElementNS(NS, "circle");
  dot.setAttribute("cx", "16");
  dot.setAttribute("cy", "22");
  dot.setAttribute("r", "3");
  dot.setAttribute("fill", "#FF6B35");
  icon.appendChild(dot);
  wrap.appendChild(icon);

  const applyColor = hex => {
    fan.setAttribute("fill", hex);
    fan.setAttribute("stroke", hex);
    icon.querySelectorAll("line").forEach(l => l.setAttribute("stroke", hex));
  };

  const input = document.createElement("input");
  input.type = "color";
  input.value = getStoredConeColor();
  input.setAttribute("list", "coneColorPresets");
  input.addEventListener("input", () => {
    localStorage.setItem(CONE_COLOR_KEY, input.value);
    applyColor(input.value);
    onChange(input.value);
  });
  wrap.appendChild(input);

  // Suggested-color swatch: the closest a web page can get to seeding the
  // OS color picker's custom-color slots (there's no API for that).
  const presets = document.createElement("datalist");
  presets.id = "coneColorPresets";
  presets.innerHTML = `<option value="${DEFAULT_CONE_COLOR}" label="Default"></option>`;
  wrap.appendChild(presets);

  applyColor(input.value);
  return wrap;
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
  infoEl.innerHTML = `<p><strong>Altitude:</strong> ${place.altitude || "Unknown altitude"}</p>`;

  const obsP = document.createElement("p");
  obsP.innerHTML = "<strong>Observatory:</strong> ";
  const obsLabel = place.observatory || "Unknown observatory";
  if (place.observatoryUrl) {
    const obsLink = document.createElement("a");
    obsLink.href = place.observatoryUrl;
    obsLink.target = "_blank";
    obsLink.rel = "noopener noreferrer";
    obsLink.textContent = obsLabel;
    obsP.appendChild(obsLink);
  } else {
    obsP.appendChild(document.createTextNode(obsLabel));
  }
  infoEl.appendChild(obsP);

  container.appendChild(infoEl);

  // THREE canvas
  const canvas = document.createElement("canvas");
  container.appendChild(canvas);

  return new VolcanoView(canvas, place, latLng);
}

class VolcanoView {
  constructor(canvasElement, place, latLng) {
    this.place = place;
    this.latLng = latLng;
    this.radiusKm = defaultRadiusKm;
    this.coneColor = getStoredConeColor();
    this.coneWireMats = [];
    this.terrainTransform = {
      center: new THREE.Vector3(0, 0, 0),
      scaleX: 1,
      scaleZ: 1
    };
    // Setup canvas and renderer
    this.canvas = canvasElement;
    this.canvas.width = this.canvas.parentElement.clientWidth;
    this.canvas.height = 320; //space above the canvas for volcano info, can be adjusted if needed

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
  loadVolcanoModel() {
    const loader = new GLTFLoader().setPath("resources/terrainMeshes/");
    loader.setMeshoptDecoder(MeshoptDecoder);
    this.radiusKm = this.place.raw?.meshRadiusKm ?? defaultRadiusKm;
    const encodedName = `${this.place.name}_${this.radiusKm}km.glb`;
    const plainName   = `${this.place.name}.glb`;

    const tryLoad = (filename, onError) => loader.load(filename, gltf => {
      const match = filename.match(/_(\d+(?:\.\d+)?)km\.glb$/);
      if (match) this.radiusKm = parseFloat(match[1]);
      this._onTerrainLoaded(gltf, filename);
    }, undefined, onError);

    tryLoad(encodedName, () => tryLoad(plainName, () => this._downloadTerrain()));
  }

  _onTerrainLoaded(gltf, filename) {
    const model = gltf.scene;
    this.scene.add(model);

    const boundingBox = new THREE.Box3();
    boundingBox.expandByObject(model);

    const terrainCenter = boundingBox.getCenter(new THREE.Vector3());
    this.terrainTransform.center.copy(terrainCenter);

    const size = boundingBox.getSize(new THREE.Vector3());
    const dist = Math.max(size.x, size.z) * 0.8;
    this.markerScale = dist / 1.1; // scale markers relative to terrain footprint
    const angle = Math.PI / 6;
    this.camera.position.set(
      terrainCenter.x,
      terrainCenter.y + dist * Math.sin(angle),
      terrainCenter.z + dist * Math.cos(angle)
    );
    this.controls.target.copy(terrainCenter);
    this.controls.update();

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
      x: peakX, z: peakZ, y: maxY,
      terrainCenter: terrainCenter.toArray(),
      radiusKm: this.radiusKm
    });

    model.position.sub(new THREE.Vector3(0, 0, 0));
    this.loadStationSprites(model);
    this.render();
  }

  _downloadTerrain() {
    const tokenMapbox = prompt(`on terrain for the volcano ${this.place.title} is not saved. Input a mapbox token to download. To avoid this in the future, save the downloaded file to ./resources/terrainMeshes/`);
    if (!tokenMapbox) return;

    const tgeo = new ThreeGeo({ tokenMapbox });
    tgeo.getTerrainRgb(
      this.latLng,
      this.radiusKm,
      13
    ).then(terrain => {
      terrain.rotation.x = -Math.PI / 2;
      this.scene.add(terrain);
      this.render();

      const filename = `${this.place.name}_${this.radiusKm}km.glb`;
      const gltfExporter = new GLTFExporter();
      gltfExporter.parse(
        terrain,
        result => saveArrayBuffer(result, filename),
        error => console.log("An error happened during parsing", error),
        { binary: true }
      );
    });
  }
//----------------------------------------------------------------------------------
  // Fetches station lat/lon from stations.json and adds sprite markers to the terrain.
  // Called after the volcano model is loaded in loadVolcanoModel().
  loadStationSprites(terrainRoot) {
    // Volcano centre in scene space — used to orient each marker toward it.
    const volcCenter = this.latLonToScene(this.latLng[0], this.latLng[1]);

    fetch("resources/stations.json")
      .then(r => r.json())
      .then(stations => {
        const filtered = stations.filter(s =>
          s.volcanoKey === this.place.name &&
          s.type !== "1" // type 1 stations are never placed
        );
        const latestByLatLon = new Map();
        for (const s of filtered) {
          const key = `${s.lat},${s.lng}`;
          const existing = latestByLatLon.get(key);
          if (!existing || s.dataSince > existing.dataSince) {
            latestByLatLon.set(key, s);
          }
        }
        // Fixed cone length in km, independent of terrain mesh scale.
        // Derivation: unitsPerKm = bbox_width / (2*radiusKm), markerScale = bbox_width*0.8/1.1
        // localScale = lengthKm * unitsPerKm / markerScale → markerScale cancels → constant.
        const CONE_LENGTH_KM = 2;
        const coneLocalScale = CONE_LENGTH_KM * 1.1 / (1.6 * this.radiusKm);

        [...latestByLatLon.values()].forEach(s => {
            if (s.coneAngle === 0) return; // don't place a station marker at all

            const marker = this.createStationMarker(s.coneAngle ?? 90); // if coneangle is missing use 90
            const placed = this.placeObjectOnTerrainLatLon(terrainRoot, marker, s.lat, s.lng, { heightOffset: 0.025 });
            if (!placed) marker.position.copy(this.latLonToScene(s.lat, s.lng, s.altitude));

            // Rotate the marker around the vertical (Y) axis so it faces the volcano.
            // atan2(dx, dz) gives the Y-rotation from +Z toward the volcano in the XZ plane.
            const dx = volcCenter.x - marker.position.x;
            const dz = volcCenter.z - marker.position.z;
            marker.rotation.y = Math.atan2(dx, dz);

            const cone = marker.getObjectByName('scanCone');
            if (cone) cone.scale.setScalar(coneLocalScale);

            this.scene.add(marker);
          });
        this.render();
      });
  }

  // Builds a 3D station marker: a cuboid body + half-cone wireframe for the scanning plane.
  // Matches the tomography visualiser style. The cone tip is at the group origin and opens
  // toward +Z; the caller rotates the group so +Z faces the volcano.
  createStationMarker(coneAngle) {
    const group = new THREE.Group();
    group.scale.setScalar(this.markerScale ?? 1);

    // Cuboid body (proportions 1.5 : 1 : 3, deepest axis toward volcano)
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    group.add(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.023, 0.07), mat));

    const wireMat = new THREE.LineBasicMaterial({ color: this.coneColor, opacity: 0.5, transparent: true }); //color on cone
    this.coneWireMats.push(wireMat);
    let scanShape;

    if (coneAngle === 90) {
      // Vertical semicircle in the XY plane, flat face toward +Z (volcano).
      // Spokes from center to arc points, plus arc segments — same style as the cone.
      const N = 20;
      const positions = [];
      for (let i = 0; i <= N; i++) {
        const θ = (i / N) * Math.PI; // 0 → π (right → top → left)
        positions.push(0, 0, 0,  Math.cos(θ), Math.sin(θ), 0); // spoke
      }
      for (let i = 0; i < N; i++) {
        const θ1 = (i / N) * Math.PI;
        const θ2 = ((i + 1) / N) * Math.PI;
        positions.push(Math.cos(θ1), Math.sin(θ1), 0,  Math.cos(θ2), Math.sin(θ2), 0); // arc
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      scanShape = new THREE.LineSegments(geom, wireMat);
    } else if (coneAngle > 0) {
      // Half-cone wireframe, tip at origin, opens toward +Z.
      const height = 1;
      const radius = height * Math.tan((coneAngle / 1) * Math.PI / 180);
      const coneGeom = new THREE.ConeGeometry(radius, height, 20, 1, true, 1.5 * Math.PI, Math.PI);
      coneGeom.translate(0, -height / 2, 0);
      coneGeom.rotateX(-Math.PI / 2);
      scanShape = new THREE.LineSegments(new THREE.EdgesGeometry(coneGeom), wireMat);
    }

    if (scanShape) {
      scanShape.name = 'scanCone';
      group.add(scanShape);
    }

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

  //converting latlon to scene coordinates, with optional altitude in meters. Called in placeObjectOnTerrainLatLon() when placing station markers, and also logged for the summit pin to check if it is placed correctly.
  latLonToScene(targetLat, targetLon, altitudeMeters = 0) {
    const tgeo = new ThreeGeo();
    const { proj, unitsPerMeter } = tgeo.getProjection(this.latLng, this.radiusKm);
    const pos2D = new THREE.Vector2(...proj([targetLat, targetLon]));
    return new THREE.Vector3(pos2D.x, altitudeMeters * unitsPerMeter, -pos2D.y);
  }
  //--------------------------------------------------------------------------

  // Updates the color of every scan cone wireframe currently in the scene.
  setConeColor(hex) {
    this.coneColor = hex;
    this.coneWireMats.forEach(m => m.color.set(hex));
    this.render();
  }

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