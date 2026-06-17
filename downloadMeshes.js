import { createRequire } from 'module';
import { createCanvas, ImageData } from 'canvas';
import ThreeGeo from 'three-geo';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

// es-pack-js Meta.nodeRequire needs a CJS require available on global
global.require = createRequire(import.meta.url);

// THREE.js Texture.getDataURL() checks `image instanceof ImageData`
global.ImageData = ImageData;

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

dotenv.config();

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN;
const OUTPUT_DIR = './map/resources/terrainMeshes/';
const RADIUS_KM = 10;
const ZOOM = 13;

console.log('Token loaded:', MAPBOX_TOKEN ? 'yes' : 'MISSING - check .env');

const geoJsonData = JSON.parse(fs.readFileSync('./map/resources/volcanoes.geojson', 'utf-8'));
const locations = geoJsonData.features.map(feature => ({
  title: feature.properties.name,
  lat: feature.properties.lat_deg,
  lng: feature.properties.lon_deg
}));

async function downloadTerrainMesh(location, index) {
  // isNode: true uses get-pixels/node-pixels instead of browser Image API
  const tgeo = new ThreeGeo({ tokenMapbox: MAPBOX_TOKEN, isNode: true });

  try {
    console.log(`[${index + 1}/${locations.length}] Downloading ${location.title}...`);

    const terrain = await tgeo.getTerrainRgb(
      [location.lat, location.lng],
      RADIUS_KM,
      ZOOM
    );

    terrain.rotation.x = -Math.PI / 2;

    const gltfExporter = new GLTFExporter();
    const result = await gltfExporter.parseAsync(terrain, { binary: true });

    const filename = path.join(OUTPUT_DIR, `${location.title}.glb`);
    fs.writeFileSync(filename, Buffer.from(result));
    console.log(`✓ Saved: ${location.title}.glb`);
    return filename;
  } catch (error) {
    console.error(`✗ Failed: ${location.title} - ${error.message}`);
  }
}

async function batchDownload() {
  console.log(`\n📥 Starting download of ${locations.length} meshes at ${RADIUS_KM}km radius...\n`);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  for (let i = 0; i < locations.length; i++) {
    await downloadTerrainMesh(locations[i], i);
    if (i < locations.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`\n✓ All downloads complete! Files saved to ${OUTPUT_DIR}\n`);
}

batchDownload().catch(console.error);
