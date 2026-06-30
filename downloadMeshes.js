/*
Download all meshes for volcanoes in map/volcanoes.geojson.

Set your Mapbox token in the terminal before running:
  $env:MAPBOX_TOKEN = "your_token_here"

Then run:
  npm run download-meshes
  npm run download-meshes -- villarrica   (single volcano)
*/

import { createRequire } from 'module';
import { createCanvas, ImageData, Image } from 'canvas';
import ThreeGeo from 'three-geo';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import * as fs from 'fs';
import * as path from 'path';

// es-pack-js Meta.nodeRequire needs a CJS require available on global
global.require = createRequire(import.meta.url);

// THREE.js Texture.getDataURL() checks `image instanceof ImageData`
global.ImageData = ImageData;
global.Image = Image;

// THREE.js Texture.getDataURL() and three-geo's getPixelsDom use document/canvas
// canvas npm package lacks toBlob — add it via dataURL conversion
function makeCanvas(w = 1, h = 1) {
  const c = createCanvas(w, h);
  c.toBlob = (callback, mimeType = 'image/png') => {
    const b64 = c.toDataURL(mimeType).split(',')[1];
    callback(new Blob([Buffer.from(b64, 'base64')], { type: mimeType }));
  };
  return c;
}

global.document = {
  createElementNS: (_ns, _tag) => makeCanvas(),
  createElement: (tag) => {
    if (tag === 'canvas') return makeCanvas();
    if (tag === 'img') return new Image();
    return { href: '', download: '', click: () => {}, style: {} };
  },
  body: { appendChild: () => {}, removeChild: () => {} },
};


// GLTFExporter (binary mode) uses FileReader to read Blobs
global.FileReader = class FileReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(buf => {
      this.result = buf;
      this.onloadend?.({ target: this });
    }).catch(err => this.onerror?.(err));
  }
};

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN?.trim();
const OUTPUT_DIR = './map/resources/terrainMeshes/';
const GEOJSON_PATH = './map/resources/volcanoes.geojson';
const DEFAULT_RADIUS_KM = 10;
const STATION_BUFFER_KM = 4; // extra margin beyond the outermost station (accounts for tile quantization at zoom 13)
const ZOOM = 13;

console.log('Token loaded:', MAPBOX_TOKEN ? `yes (${MAPBOX_TOKEN.length} chars, starts: ${MAPBOX_TOKEN.slice(0, 8)}...)` : 'MISSING - set $env:MAPBOX_TOKEN in terminal');

async function testMapboxToken() {
  const url = `https://api.mapbox.com/v4/mapbox.terrain-rgb/13/1330/3143.pngraw?access_token=${MAPBOX_TOKEN}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      console.error('Mapbox error response:', text.slice(0, 300));
    }
    return res.ok;
  } catch (e) {
    console.error('Mapbox fetch failed:', e.message);
    return false;
  }
}

const geoJsonData = JSON.parse(fs.readFileSync(GEOJSON_PATH, 'utf-8'));
const stationsData = JSON.parse(fs.readFileSync('./map/resources/stations.json', 'utf-8'));

// calculates distance between two lat/lon coordinates
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// calculate the required radius to include all stations in the mesh
function computeRequiredRadius(volcanoName, centerLat, centerLng) {
  const stations = stationsData.filter(s => s.volcanoKey === volcanoName);
  if (!stations.length) return DEFAULT_RADIUS_KM;

  const maxDist = Math.max(...stations.map(s => haversineKm(centerLat, centerLng, s.lat, s.lng))); //distance between station and center
  const needed = Math.ceil(maxDist + STATION_BUFFER_KM);

  if (needed > DEFAULT_RADIUS_KM) {
    console.log(`  ↑ Expanding to ${needed}km (max station dist: ${maxDist.toFixed(1)}km)`);
    return needed;
  }
  return DEFAULT_RADIUS_KM;
}

async function downloadTerrainMesh(feature, index, total) {
  const tgeo = new ThreeGeo({ tokenMapbox: MAPBOX_TOKEN, isNode: true });
  const { name, lat_deg: lat, lon_deg: lng } = feature.properties;
  const radius = computeRequiredRadius(name, lat, lng);

  try {
    console.log(`[${index + 1}/${total}] Downloading ${name} (${radius}km)...`);

    const baseZoom = radius > 12 ? 11 : ZOOM;
    const zoomLevels = baseZoom === ZOOM ? [ZOOM, ZOOM - 1, ZOOM - 2] : [baseZoom];
    let terrain;
    for (const zoom of zoomLevels) {
      try {
        terrain = await tgeo.getTerrainRgb([lat, lng], radius, zoom);
        break;
      } catch (e) {
        if (e.message?.includes('Tile not found') && zoom !== zoomLevels[zoomLevels.length - 1]) {
          console.warn(`  zoom ${zoom} → Tile not found, retrying at ${zoom - 1}...`);
        } else {
          throw e;
        }
      }
    }

    let meshCount = 0;
    terrain.traverse(child => {
      if (child.isMesh) meshCount++;
    });
    if (meshCount === 0) throw new Error('terrain has no geometry — Mapbox token may be invalid or rate-limited');

    terrain.rotation.x = -Math.PI / 2;

    const gltfExporter = new GLTFExporter();
    const result = await gltfExporter.parseAsync(terrain, { binary: true });

    const filename = path.join(OUTPUT_DIR, `${name}_${radius}km.glb`);
    fs.writeFileSync(filename, Buffer.from(result));
    const { display_name, lat_deg, lon_deg, alt_masl, observatory, obs_acronym, country, ...yearData } = feature.properties;
    feature.properties = { name, display_name, lat_deg, lon_deg, alt_masl, observatory, obs_acronym, country, ...yearData, meshRadiusKm: radius };
    console.log(`✓ Saved: ${name}_${radius}km.glb`);
  } catch (error) {
    console.error(`✗ Failed: ${name} - ${error.message}`);
  }
}

async function batchDownload() {
  const tokenOk = await testMapboxToken();
  if (!tokenOk) { console.error('Aborting — fix Mapbox token first.'); process.exit(1); }

  const filterName = process.argv[2];
  const features = filterName
    ? geoJsonData.features.filter(f => f.properties.name === filterName)
    : geoJsonData.features;

  if (filterName && features.length === 0) {
    console.error(`✗ No volcano found with name "${filterName}"`);
    process.exit(1);
  }

  console.log(`\n📥 Downloading ${features.length} mesh(es) (default ${DEFAULT_RADIUS_KM}km)...\n`);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  for (let i = 0; i < features.length; i++) {
    await downloadTerrainMesh(features[i], i, features.length);
    if (i < features.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  fs.writeFileSync(GEOJSON_PATH, JSON.stringify(geoJsonData, null, 2));
  console.log(`\n✓ meshRadiusKm saved to volcanoes.geojson`);
  console.log(`✓ Done! Files saved to ${OUTPUT_DIR}\n`);
}

batchDownload().catch(console.error);
