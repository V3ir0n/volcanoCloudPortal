import * as THREE from "three";
import {OrbitControls} from "./libs/threeAddons/OrbitControls.js";
import {Lut} from "./libs/threeAddons/Lut.js";
import ThreeGeo from "./libs/three-geo-esm.js";
//import {tomoInverse} from "./src/tomoInverse.js";
import {tomoInverse} from "./src/volcanoTomography.js";
import {locateVolcano} from "./src/locateVolcano.js";
import {drawParticles} from "./libs/draw.js";
import {TomographicPlaneGeometry} from "./src/tomographicPlaneGeometry.js";
import {GLTFLoader} from "./libs/threeAddons/GLTFLoader.js";
import {GLTFExporter} from "./libs/threeAddons/GLTFExporter.js";
import {makePlumeMesh} from "./src/makePlumeMesh_2.js";
import {GUI} from "./libs/threeAddons/lil-gui.module.min.js"
import {Api} from "./src/api.js";
import {saveArrayBuffer} from "./src/utils.js";
import {exportDomeVideo} from "./src/domeExport.js";


// Same key as the map/measurement pages' "Beam color" swatch, so a color
// picked there also applies here (and vice versa).
const CONE_COLOR_KEY = "scanConeColor";
const DEFAULT_CONE_COLOR = "#808080";
function getStoredConeColor() {
    return localStorage.getItem(CONE_COLOR_KEY) || DEFAULT_CONE_COLOR;
}

// Display name/institution/lat/lon/altitude for the volcano name/info box
// (see onDataLoaded) come from the site's shared volcano database
// (map/resources/volcanoes.geojson -- also used by the map page) instead
// of a separate hardcoded list here, so it stays in sync with what's
// shown elsewhere on the site and covers every volcano the map knows
// about (55, vs. only the 5 originally pre-set examples), not just ones
// specifically added to this file.
let volcanoGeoDataPromise = null;
function loadVolcanoGeoData() {
    if (!volcanoGeoDataPromise) {
        volcanoGeoDataPromise = fetch('../../map/resources/volcanoes.geojson')
            .then(res => res.json())
            .then(geojson => {
                const byName = {};
                for (const feature of geojson.features) {
                    byName[feature.properties.name] = feature.properties;
                }
                return byName;
            })
            .catch(err => {
                console.warn('Could not load volcano info from map/resources/volcanoes.geojson', err);
                return {};
            });
    }
    return volcanoGeoDataPromise;
}
// Fallback for a volcano not in that database (src/volcanoList.js has a
// few more than the map does) -- title-cased from the internal name
// rather than the box not showing a name at all.
function displayVolcanoName(name) {
    return name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// GUI parameters
let params	= {
    assumedVelocity: 10, // Velocity in m/s
    plumeVisible: true,
    pointsVisible: true,
    planeVisible: true,
    // The 18.7MB HDR sky background wasn't copied into this self-contained
    // fork -- setBackgroundVisibility now toggles a plain color background
    // instead (see below). Overridden to true in onDataLoaded() once
    // there's an actual scene to look at; left false here so the bare
    // "Upload own data" landing page keeps its paper background instead
    // of a full-page blue wash with no scene to show yet.
    backgroundVisible: false,
    beamColor: getStoredConeColor(),
    // Tomographic-inversion thresholds -- mirror the same-named number
    // inputs above the upload field (index.html); onDataLoaded() reads
    // the DOM inputs' current values into these once the Controls panel
    // is built, so adjusting a slider there starts from whatever was set
    // before upload instead of silently resetting to these defaults.
    completenessLimit: 0.9,
    baricenterLimit: 60,
    timeDifferenceMin: 15,
    imageScaleFactor: 1,
    exportImage: ()=>{window.api.exportImage()}
};

let camera, scene, renderer, controls;
// Lighter than the original navy tint (was 0x14293b), and now only actually
// shown while the "Show background sky" toggle is on -- see
// setBackgroundVisibility below.
const BACKGROUND_COLOR = 0x4a7ba3;
const BACKGROUND_ALPHA = 0.55;
let plumeMesh = new THREE.Object3D();
let frames = [];
// Each instrument's scanning-cone wireframe material (one per station,
// added in onDataLoaded) -- collected here so the "Beam color" GUI control
// (see init()) can recolor all of them at once, however many exist.
let beamWireMats = [];
init();
render();

// configure the raycaster
const raycaster = new THREE.Raycaster();
raycaster.params.Points.threshold = 0.001;

//--------------------------Initialise scene--------------------------------------
function init() {

    // Setup renderer
    renderer = new THREE.WebGLRenderer({
        alpha: true
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const container = document.getElementById("container");
    container.appendChild(renderer.domElement);

    // Setup scene and camera
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 1e4);

    // Setup lights
    const pointLight = new THREE.PointLight(0xff0000, 100);
    pointLight.position.set(1, 1, 1);
    scene.add(pointLight);

    // ?example=<name> (or ?volcano=<name>, used by viewer.html's links from
    // the map) auto-loads the matching example button's dataset -- read
    // here (rather than where it's used further down) so the background
    // sky default below can also see it.
    const searchParams = new URLSearchParams(window.location.search);
    const exampleParam = searchParams.get("example") || searchParams.get("volcano");

    // Setup background -- sets the renderer's clear color (see
    // setBackgroundVisibility below); previously the color was set here
    // directly and unconditionally, so the "Show background sky" toggle
    // never actually had any visible effect. Left off here -- the bare
    // "Upload own data" landing page has no volcano/plume scene yet (and
    // no GUI toggle either, since that's only created once data loads),
    // so turning it on this early just washed the whole page blue with no
    // way to turn it off. onDataLoaded() turns it on once there's an
    // actual scene to look at, for both the pre-set examples and manually
    // uploaded data alike.
    setBackgroundVisibility(params.backgroundVisible);

    // And camera controls -- OrbitControls (not MapControls) so left-drag
    // rotates the view, matching the Remote sensing page's 3D viewer
    // (measurement/main.js) instead of MapControls' pan-on-left-drag,
    // rotate-on-right-drag "map navigation" scheme.
    controls = new OrbitControls(camera, renderer.domElement);
    controls.maxPolarAngle = Math.PI/2;
    controls.zoomToCursor = true;
    controls.addEventListener("change", render);

    // Keep each number input and its slider in sync with each other;
    // tomoInverse/volcanoTomography read the number inputs' values directly.
    const completenessNum = document.getElementById("completenessLimit");
    const completenessSlider = document.getElementById("completenessLimitSlider");
    completenessNum.addEventListener("input", () => completenessSlider.value = completenessNum.value);
    completenessSlider.addEventListener("input", () => completenessNum.value = completenessSlider.value);

    const baricenterNum = document.getElementById("baricenterLimit");
    const baricenterSlider = document.getElementById("baricenterLimitSlider");
    baricenterNum.addEventListener("input", () => baricenterSlider.value = baricenterNum.value);
    baricenterSlider.addEventListener("input", () => baricenterNum.value = baricenterSlider.value);

    const timeDiffNum = document.getElementById("timeDifferenceMin");
    const timeDiffSlider = document.getElementById("timeDifferenceMinSlider");
    timeDiffNum.addEventListener("input", () => timeDiffSlider.value = timeDiffNum.value);
    timeDiffSlider.addEventListener("input", () => timeDiffNum.value = timeDiffSlider.value);

    // Load data when file is uploaded
    const fileInput = document.getElementById("fileInput");
    const loadFromFiles = async () => {
        const data = [];
        let alreadyProcessedData = [];
        for (const file of fileInput.files) {
            const text = await file.text();
            // We might have multiple dots in the name
            const splitName = file.name.split(".");
            const suffix = splitName.pop();
            const filename = splitName.join("");
            if (suffix === "csv") {
                // CSV means we have data from matlab
                const frame = parseProcessedData(text, filename);
                alreadyProcessedData.push(frame);
            } else {
                // Otherwise we should have the txt evaluation logs
                const scans = await parseScans(text);
                data.push(scans);
            }
        }
        // Hide file upload container
        document.getElementById("fileUploadContainer").style.display = "none";

        // Create api and make it a global variable in the web console
        window.api = new Api(camera, scene, renderer, controls, data, params);
        window.THREE = THREE;

        // Handle the loaded data
        onDataLoaded(data, alreadyProcessedData);
    };

    fileInput.onchange = loadFromFiles;

    document.getElementById("sabancayaExample").onclick = () => {
        loadDataFromUrl([
            "matlab/sabancaya/EvaluationLog_D2J2819_2024.01.28.txt",
            "matlab/sabancaya/EvaluationLog_D2J2833_2024.01.28.txt",
            "matlab/sabancaya/tomography_D2J2819_20240128_1213_D2J2833_20240128_1200.csv",
            "matlab/sabancaya/tomography_D2J2819_20240128_1213_D2J2833_20240128_1215.csv",
            "matlab/sabancaya/tomography_D2J2819_20240128_1230_D2J2833_20240128_1215.csv"
        ]);
    };

    document.getElementById("turrialbaExample").onclick = () => {
        loadDataFromUrl([
            "matlab/turrialba/EvaluationLog_Turrialba_1.txt",
            "matlab/turrialba/EvaluationLog_Turrialba_2.txt",
            "matlab/turrialba/tomography_2108111M1_20231013_1413_D2J3042_20231013_1422.csv",
            "matlab/turrialba/tomography_2108111M1_20231013_1433_D2J3042_20231013_1422.csv",
            "matlab/turrialba/tomography_2108111M1_20231015_1433_D2J3042_20231015_1423.csv",
            "matlab/turrialba/tomography_2108111M1_20231013_1427_D2J3042_20231013_1422.csv",
            "matlab/turrialba/tomography_2108111M1_20231015_1423_D2J3042_20231015_1423.csv",
            "matlab/turrialba/tomography_2108111M1_20231026_1436_D2J3042_20231026_1441.csv"
        ]);
    };

    document.getElementById("clevelandExample").onclick = () => {
        loadDataFromUrl([
            "matlab/cleveland/EvaluationLog_MAYP115019_2024.07.03.txt",
            "matlab/cleveland/EvaluationLog_MAYP115415_2024.07.03.txt",
            "matlab/cleveland/tomography_cleveland_20240703_0224_cleveland_20240703_0205.csv",
            "matlab/cleveland/tomography_cleveland_20240703_0224_cleveland_20240703_0213.csv",
            "matlab/cleveland/tomography_cleveland_20240703_0224_cleveland_20240703_0221.csv",
            "matlab/cleveland/tomography_cleveland_20240703_0224_cleveland_20240703_0229.csv",
            "matlab/cleveland/tomography_cleveland_20240703_0224_cleveland_20240703_0237.csv",
            "matlab/cleveland/tomography_cleveland_20240703_0224_cleveland_20240703_0254.csv",
            "matlab/cleveland/tomography_cleveland_20240703_0340_cleveland_20240703_0323.csv"
        ]);
    };

    document.getElementById("merapiExample").onclick = () => {
        loadDataFromUrl([
            "matlab/merapi/EvaluationLog_2108113M1_2023.06.09.txt",
            "matlab/merapi/EvaluationLog_2108117M1_2023.06.09.txt",
            "matlab/merapi/tomography_merapi_20230609_0013_merapi_20230609_0137.csv",
            "matlab/merapi/tomography_merapi_20230609_0022_merapi_20230609_0137.csv",
            "matlab/merapi/tomography_merapi_20230609_0032_merapi_20230609_0137.csv"
        ]);
    };

    document.getElementById("nevadodelruizExample").onclick = () => {
        loadDataFromUrl([
            "matlab/nevado_del_ruiz/EvaluationLog_2011045M1_2024.08.31.txt",
            "matlab/nevado_del_ruiz/EvaluationLog_2011046M1_2024.08.31.txt",
            "matlab/nevado_del_ruiz/tomography_nevado_del_ruiz_20240831_1452_nevado_del_ruiz_20240831_1455.csv",
            "matlab/nevado_del_ruiz/tomography_nevado_del_ruiz_20240831_1607_nevado_del_ruiz_20240831_1557.csv",
            "matlab/nevado_del_ruiz/tomography_nevado_del_ruiz_20240831_1607_nevado_del_ruiz_20240831_1607.csv",
            "matlab/nevado_del_ruiz/tomography_nevado_del_ruiz_20240831_1607_nevado_del_ruiz_20240831_1617.csv",
            "matlab/nevado_del_ruiz/tomography_nevado_del_ruiz_20240831_1632_nevado_del_ruiz_20240831_1617.csv",
            "matlab/nevado_del_ruiz/tomography_nevado_del_ruiz_20240831_1632_nevado_del_ruiz_20240831_1624.csv",
            "matlab/nevado_del_ruiz/tomography_nevado_del_ruiz_20240831_1632_nevado_del_ruiz_20240831_1638.csv",
            "matlab/nevado_del_ruiz/tomography_nevado_del_ruiz_20240831_1632_nevado_del_ruiz_20240831_1645.csv",
            "matlab/nevado_del_ruiz/tomography_nevado_del_ruiz_20240831_1807_nevado_del_ruiz_20240831_1755.csv",
            "matlab/nevado_del_ruiz/tomography_nevado_del_ruiz_20240831_1807_nevado_del_ruiz_20240831_1805.csv",
            "matlab/nevado_del_ruiz/tomography_nevado_del_ruiz_20240831_1807_nevado_del_ruiz_20240831_1815.csv",
            "matlab/nevado_del_ruiz/tomography_nevado_del_ruiz_20240831_1927_nevado_del_ruiz_20240831_1918.csv",
            "matlab/nevado_del_ruiz/tomography_nevado_del_ruiz_20240831_1927_nevado_del_ruiz_20240831_1928.csv"
        ]);
    };


    // ?example=<name> (or ?volcano=<name>, used by viewer.html's links from
    // the map) auto-loads the matching example button's dataset.
    const exampleButtonIds = {
        cleveland: "clevelandExample",
        nevado_del_ruiz: "nevadodelruizExample",
        merapi: "merapiExample",
        turrialba: "turrialbaExample",
        sabancaya: "sabancayaExample",
    };
    if (exampleParam && exampleButtonIds[exampleParam]) {
        // #volcanoTitle/#volcanoInfo are set from the actually-loaded data
        // in onDataLoaded (covers every volcano, not just these 5) --
        // nothing to do here for those.

        // Hide the example-picker/upload panel immediately, rather than
        // waiting for onDataLoaded() to hide it once the fetch+parse of the
        // clicked example's files finishes — otherwise it's visible (with
        // all 5 example buttons) for however long that load takes.
        document.getElementById("fileUploadContainer").style.display = "none";
        document.getElementById(exampleButtonIds[exampleParam])?.click();
    }

    // Firefox might cashe the last files selected,
    // so this is a shorthand to press Enter to
    // load the directly.
    window.addEventListener("keydown", (event) => {
        switch (event.code) {
        case "Enter":
            if (fileInput.files.length > 0) {
                loadFromFiles();
            }
            break;
        }
    });

    // Update camera aspect ratio on window resize
    window.addEventListener("resize", onWindowResize);

    render();
}
//------------------------------------------------------------------------------------------


async function loadDataFromUrl(filePaths) {
        const data = [];
        let alreadyProcessedData = [];
        for (const path of filePaths) {
            // Load text from path
            const res = await fetch(path);
            const text = await res.text();

            const filename = path.split("/").splice(-1)[0];

            // We might have multiple dots in the name
            const splitName = filename.split(".");
            const suffix = splitName.pop();
            if (suffix === "csv") {
                // CSV means we have data from matlab
                const frame = parseProcessedData(text, filename);
                alreadyProcessedData.push(frame);
            } else {
                // Otherwise we should have the txt evaluation logs
                const scans = await parseScans(text);
                data.push(scans);
            }
        }
        // Hide file upload container
        document.getElementById("fileUploadContainer").style.display = "none";

        // Create api and make it a global variable in the web console
        window.api = new Api(camera, scene, renderer, controls, data, params);
        window.THREE = THREE;

        // Handle the loaded data
        onDataLoaded(data, alreadyProcessedData);
}

function setBackgroundVisibility(visible) {
    if (visible) {
        renderer.setClearColor(BACKGROUND_COLOR, BACKGROUND_ALPHA);
    } else {
        renderer.setClearColor(0x000000, 0);
    }
    render();
}

/**
 * Parse data processed by Matlab script
 * @param {string} text CSV data string
 * @param {string} filename File name
 * @returns {{points: any[]}}
 */
function parseProcessedData(text, filename) {
    const frame = {points: [], filename: filename};

    // Parse date from filename — two formats:
    // Old: tomography_INST1_YYYYMMDD_HHMM_INST2_YYYYMMDD_HHMM
    // New: tomography_VOLCANO_YYYY-MM-DDTHH_MM_SS.000Z_YYYY-MM-DDTHH_MM_SS.000Z
    const isoMatch = filename.match(/(\d{4}-\d{2}-\d{2}T\d{2}_\d{2}).*?(\d{4}-\d{2}-\d{2}T\d{2}_\d{2})/);
    if (isoMatch) {
        frame.date1 = new Date(isoMatch[1].replace("_", ":"));
        frame.date2 = new Date(isoMatch[2].replace("_", ":"));
    } else {
        const parseDate = (d, t) => new Date(
            `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${t.slice(0,2)}:${t.slice(2,4)}`
        );
        const oldMatch = filename.match(/(\d{8})_(\d{4}).*?(\d{8})_(\d{4})/);
        if (oldMatch) {
            frame.date1 = parseDate(oldMatch[1], oldMatch[2]);
            frame.date2 = parseDate(oldMatch[3], oldMatch[4]);
        }
    }

    // Calc average time
    frame.time = new Date((
        frame.date1.getTime() +
        frame.date2.getTime()
    ) / 2);

    // Parse points
    for (let line of text.split("\n")) {
        line = line.trim("\r");
        if (line === "") {
            continue;
        }
        const values = line.split(",").map(v=>parseFloat(v));
        if (isNaN(values[0])) continue; // skip text header lines
        if (values.length == 2) {
            [frame.size1, frame.size2] = values;
        } else {
            const [lonPutm, latPutm, altP, Concentration] = values;
            frame.points.push({lonPutm, latPutm, altP, Concentration});
        }
    }
    return frame;
}

// Hands control back to the browser (paint/input) between chunks of heavy
// synchronous parsing, so large evaluation logs (10s of MB) don't block the
// main thread long enough to trigger the browser's "Page Unresponsive" state.
const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 0));
const YIELD_EVERY = 200; // scans per pause

/**
 * Parse evaluation logs
 * @param {string} text Evaluation logs
 * @returns {{points: any[]}}
 */
async function parseScans(text) {
    // Match spectral header and data
    const rInfo = /<scaninformation>(?<info>([\s\S])*?)<\/scaninformation>/gm;
    const scans = [];
    let infoCount = 0;
    for (const match of text.matchAll(rInfo)) {
        const scanInfo = {};
        const info = match.groups.info.split("\n");
        info.forEach(d=>{
            d = d.trim("\r");
            if (d !== "") {
                const [k, v] = d.split("=");
                scanInfo[k] = isNaN(v) ? v : Number(v);
            }
        });
        scans.push({
            scanInfo: scanInfo
        });
        if (++infoCount % YIELD_EVERY === 0) await yieldToMain();
    }

    // Match spectral header and data
    const rData = /#(?<header>[\s\S]+?)<spectraldata>(?<data>([\s\S])*?)<\/spectraldata>/gm;
    //const scans = [];
    let i = 0;
    for (const match of text.matchAll(rData)) {
        const spectralData = [];
        // Header names are not consistent across different stations
        // So let's assume that the order is at least the same
        //const header = match.groups.header.split("\t");
        const header = [
            "scanangle", "starttime", "stoptime", "name", "specsaturation",
            "fitsaturation", "counts_ms", "delta", "chisquare", "exposuretime",
            "numspec", "column_SO2", "columnerror_SO2", "shift_SO2",
            "shifterror_SO2", "squeeze_SO2", "squeezeerror_SO2", "column_O3",
            "columnerror_O3", "shift_O3", "shifterror_O3", "squeeze_O3",
            "squeezeerror_O3", "column_RING", "columnerror_RING", "shift_RING",
            "shifterror_RING", "squeeze_RING", "squeezeerror_RING",
            "isgoodpoint", "offset", "flag"
        ];
        const data = match.groups.data.split("\n");
        data.forEach(d=>{
            d = d.trim("\r");
            if (d !== "") {
                const linedata = {};
                d.split("\t").forEach((v, i) => {
                    linedata[header[i].trim()] = isNaN(v) ? v : Number(v);
                });
                spectralData.push(linedata);
            }
        });
        scans[i].spectralData = spectralData;
        i++;
        if (i % YIELD_EVERY === 0) await yieldToMain();
    }

    // Deduplicate: NOVAC files store one block per fit window, so the same
    // physical scan can appear multiple times with identical data. Keep only
    // the first occurrence of each (date, starttime) pair.
    const seen = new Set();
    return scans.filter(s => {
        const key = `${s.scanInfo.date}_${s.scanInfo.starttime}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Called when data has been loaded from the input files
 * @param {any[]} data Evaluation log data
 * @param {any[]} processedData (optional) Already processed concentration data
 */
async function onDataLoaded(data, processedData) {
    console.log(`onDataLoaded: ${data.length} TXT file(s), ${processedData.length} CSV file(s)`, data);

    if (data.length < 2) {
        alert(`Need at least 2 EvaluationLog .txt files (one per instrument). Got ${data.length}.\nCSV files go into pre-processed data — make sure you also upload the .txt files.`);
        return;
    }

    // There's an actual volcano scene to look at now -- matches the
    // pre-set examples' default (see init()), but applies here too so
    // manually uploaded data also gets the sky background on by default.
    params.backgroundVisible = true;
    setBackgroundVisibility(true);

    let tgeo = new ThreeGeo();

    const [nameVol, latVol, lonVol, altVol] = locateVolcano(data);
    const summitLatLng = new THREE.Vector2(latVol, lonVol);
    window.api.volcanoName = nameVol;

    // Name/lat/lon/altitude/institution box (upper left) -- works for any
    // volcano in the map's own database, not just the 5 originally
    // pre-set examples; falls back to locateVolcano()'s own lat/lon/alt
    // (from src/volcanoList.js) and a title-cased name with no
    // institution line for the few volcanoes not in that database.
    const geoData = await loadVolcanoGeoData();
    const geoInfo = geoData[nameVol];
    document.getElementById("volcanoTitle").textContent = geoInfo?.display_name || displayVolcanoName(nameVol);
    let volcanoInfoEl = document.getElementById("volcanoInfo");
    if (!volcanoInfoEl) {
        volcanoInfoEl = document.createElement("div");
        volcanoInfoEl.id = "volcanoInfo";
        document.body.appendChild(volcanoInfoEl);
    }
    const infoLat = geoInfo?.lat_deg ?? latVol;
    const infoLon = geoInfo?.lon_deg ?? lonVol;
    const infoAlt = geoInfo?.alt_masl ?? altVol;
    volcanoInfoEl.innerHTML = `
        <div>Lat: ${infoLat.toFixed(4)}°, Lon: ${infoLon.toFixed(4)}°</div>
        <div>Altitude: ${infoAlt} m</div>
        ${geoInfo?.observatory ? `<div>Institution: ${geoInfo.observatory}</div>` : ''}
    `;

    // Each instrument's group + scanning-cone line, plus the (x,z) and
    // originally-computed y (from the EvaluationLog's own recorded
    // altitude, which doesn't always agree with the terrain mesh's actual
    // elevation there) -- populated in the instrument loop below, and
    // used once the terrain model loads (see loader.load below) to snap
    // each station onto the real ground surface instead of floating
    // above (or sinking into) it.
    const instrumentGroundSnaps = [];

    // Snaps each instrument onto the given terrain model's actual surface
    // height at its (x,z) -- the EvaluationLog's recorded altitude and
    // the terrain mesh's real elevation there don't always agree, which
    // otherwise left some stations visibly floating above the ground (or,
    // less noticeably, sunk slightly into it). Called once the terrain
    // loads, whichever of the two ways below that happens.
    function snapInstrumentsToGround(model) {
        const down = new THREE.Vector3(0, -1, 0);
        for (const snap of instrumentGroundSnaps) {
            raycaster.set(
                new THREE.Vector3(snap.x, snap.originalY + 5000 * unitsPerMeter, snap.z),
                down
            );
            const hits = raycaster.intersectObject(model, true);
            if (hits.length) {
                const delta = hits[0].point.y - snap.originalY;
                snap.instrumentGroup.position.y += delta;
                snap.line.position.y += delta;
            }
        }
    }

    // Must match the radius the currently-cached .glb files were
    // actually generated with (a flat 6km, from the original Tomography
    // project) -- using the map's own per-volcano meshRadiusKm here
    // instead (e.g. 13km for Nevado del Ruiz) desynced the projection's
    // scale from what the loaded terrain actually covers, since that
    // radius feeds into the scene's units-per-meter scale. The visible
    // symptom was the initial camera view landing too close/zoomed in.
    // Sinabung's stations reaching past this radius (see the reverted
    // terrain-replacement commit) is still an open, unrelated issue --
    // fixing it needs a same-vintage regenerated .glb, not a mismatched
    // radius here.
    const radius = 6.0;
    const loader = new GLTFLoader().setPath("resources/terrainMeshes/");
    const filename = `${nameVol}.glb`;
    loader.load(filename, gltf => {
        const model = gltf.scene;
        scene.add(model);
        snapInstrumentsToGround(model);
        render();
    }, undefined, ()=>{
        // On error (file not found)
        const tokenMapbox = prompt(`The terrain for the volcano ${nameVol} is not saved. Input a mapbox token to download. To avoid this in the future, save the downloaded file to ./resources/terrainMeshes/`);
        tgeo = new ThreeGeo({
            tokenMapbox: tokenMapbox,
        });
        tgeo.getTerrainRgb(
            summitLatLng.toArray(),  // [lat, lng]
            radius,            // radius of bounding circle (km)
            13                 // zoom resolution
        ).then(terrain => {
            terrain.rotation.x = - Math.PI/2;
            scene.add(terrain);
            snapInstrumentsToGround(terrain);
            render();

            const gltfExporter = new GLTFExporter();
            gltfExporter.parse(
                terrain,
                function (result) {
                    saveArrayBuffer(result, filename);
                },
                error => console.log("An error happened during parsing", error),
                {binary: true}
            );
        });
    } );

    // Get projection from latitude, longitude to scene coordinates
    const {proj, unitsPerMeter} = tgeo.getProjection(summitLatLng.toArray(), radius);
    const toSceneCoords = (latLng, altitude) => {
        const pos2D = new THREE.Vector2(...proj(latLng));
        return new THREE.Vector3(pos2D.x, altitude * unitsPerMeter, -pos2D.y);
    };

    const summitPos = toSceneCoords(summitLatLng, altVol, proj);

    // Setup camera controls
    controls.minDistance = unitsPerMeter;
    controls.target.copy(summitPos);
    controls.update();

    // Set initial camera position
    camera.position.copy(summitPos).add(new THREE.Vector3(0, 5000 * unitsPerMeter, 8000 * unitsPerMeter));
    controls.update();


    // Visualise the instruments
    const instPos = [];
    for (const instrumentData of data) {
        const scanInfo = instrumentData[0].scanInfo; // Use first datapoint
        const instrumentLatLng = new THREE.Vector2(
            scanInfo.lat,
            scanInfo.long
        );
        const instrumentPos = toSceneCoords(instrumentLatLng, scanInfo.alt, proj);
        instPos.push(instrumentPos);

        // Add an instrument marker: mast + telescope + box + antenna, matching
        // the Remote sensing 3D view's station design. lookAt() below points
        // local -Z at the summit, so (unlike that view's +Z-forward
        // convention) the volcano-facing parts sit on -Z and the parts meant
        // to face away sit on +Z.
        const instrumentMaterial = new THREE.MeshStandardMaterial({color: 0x4d4d4d}); // mast/antenna: dark gray
        const boxMaterial = new THREE.MeshBasicMaterial({color: 0x3d7ea6}); // box: lighter blue, for visibility
        const telescopeMaterial = new THREE.MeshStandardMaterial({color: 0x1a1a1a}); // telescope: black
        const instrumentGroup = new THREE.Group();
        const bs = 1;
        const mastH = bs * 3;
        const mastR = bs * 0.12;

        const mast = new THREE.Mesh(new THREE.CylinderGeometry(mastR, mastR, mastH, 8), instrumentMaterial);
        mast.position.y = mastH / 2;
        instrumentGroup.add(mast);

        const telescopeLen = bs * 1.4;
        const telescope = new THREE.Mesh(
            new THREE.CylinderGeometry(bs * 0.18, bs * 0.18, telescopeLen, 12),
            telescopeMaterial
        );
        telescope.rotation.x = Math.PI / 2; // axis along local Z
        telescope.position.set(0, mastH, telescopeLen * 0.3); // bulk on +Z, away from the volcano
        instrumentGroup.add(telescope);

        const boxDepth = bs * 0.35;
        const mastBox = new THREE.Mesh(
            new THREE.BoxGeometry(bs * 0.6, bs * 0.5, boxDepth),
            boxMaterial
        );
        mastBox.position.set(0, mastH / 3, -(mastR + boxDepth / 2)); // facing the volcano, on -Z
        instrumentGroup.add(mastBox);

        const antennaLen = bs * 0.9;
        const antenna = new THREE.Mesh(
            new THREE.CylinderGeometry(bs * 0.03, bs * 0.03, antennaLen, 6),
            telescopeMaterial
        );
        antenna.rotation.z = Math.PI / 2; // axis along local X, horizontal, sideways
        antenna.position.set(mastR + antennaLen / 2, mastH * 0.65, 0);
        instrumentGroup.add(antenna);

        const elementH = bs * 0.3;
        [0.1, 0.25, 0.4, 0.55, 0.7, 0.85].forEach(f => {
            const el = new THREE.Mesh(
                new THREE.CylinderGeometry(bs * 0.015, bs * 0.015, elementH, 6),
                telescopeMaterial
            );
            el.position.set(mastR + antennaLen * f, mastH * 0.65, 0);
            instrumentGroup.add(el);
        });

        instrumentGroup.scale.multiplyScalar(50 * unitsPerMeter);
        instrumentGroup.position.copy(instrumentPos);
        // Yaw (horizontal-facing) only, not a full lookAt(summitPos) --
        // the summit sits well above each station, and lookAt() tips the
        // object's whole local "up" axis toward/away from a target that
        // isn't at the same height to keep it exactly centered in view,
        // which visibly tilted the (otherwise perfectly vertical) mast by
        // an amount that varied per station depending on how much higher
        // the summit is relative to that particular one.
        //
        // Points local -Z at the summit, matching what lookAt(summitPos)
        // did (see the comment above on volcano-facing vs. away-facing
        // parts) -- note the operands are instrument-minus-summit, not
        // summit-minus-instrument: local -Z after a rotation.y of θ
        // points along world (-sinθ, -cosθ), so reaching a given target
        // direction needs the *negated* delta, not the delta itself.
        instrumentGroup.rotation.y = Math.atan2(
            instrumentPos.x - summitPos.x,
            instrumentPos.z - summitPos.z
        );
        scene.add(instrumentGroup);

        // Add a cone to mark the instrument scanning volume
        const height = 1;
        const radius = height * Math.tan(2 * scanInfo.coneangle / 180 * Math.PI);
        const nScanValues = instrumentData[0].spectralData.length;
        const coneGeometry = new THREE.ConeGeometry(radius, height, nScanValues-1, 1, true, 1.5*Math.PI, -Math.PI);
        coneGeometry.translate(0, -height/2, 0);
        coneGeometry.rotateX(-Math.PI/2);
        const coneEdges = new THREE.EdgesGeometry(coneGeometry);
        const beamMat = new THREE.LineBasicMaterial({
            color: params.beamColor,
            opacity: 0.3,
            transparent: true
        });
        beamWireMats.push(beamMat);
        const line = new THREE.LineSegments(coneEdges, beamMat);
        line.scale.multiplyScalar(instrumentPos.distanceTo(summitPos));
        line.position.copy(instrumentPos);
        // Tip sits at the telescope's height, matching the Remote sensing
        // 3D view, instead of the ground. mastH is in the instrument
        // group's own (pre-scale) units, so convert it the same way that
        // group's scale does (50 * unitsPerMeter) before adding it here.
        line.position.y += mastH * 50 * unitsPerMeter;
        line.lookAt(new THREE.Vector3(0, line.position.y, 0));
        scene.add(line);

        instrumentGroundSnaps.push({
            instrumentGroup, line,
            x: instrumentPos.x, z: instrumentPos.z, originalY: instrumentPos.y
        });
    }


    // Find line between instruments
    const line = instPos[0].clone().sub(instPos[1]);
    // Find direction away from volcano (the volcano is at the origin).
    // dir is perpendicular to the instrument baseline, in one of two
    // possible directions -- resolved via the sign of its dot product
    // with the outward radial direction at the midpoint between the two
    // instruments (positive = already pointing outward), rather than
    // comparing distances-from-origin before/after adding the full dir
    // vector: that comparison can flip the wrong way whenever dir's own
    // magnitude is large enough to overshoot past the origin, which
    // doesn't depend on dir's direction actually being wrong.
    let dir = line.clone().cross(new THREE.Object3D().up);
    const midpoint = instPos[0].clone().add(instPos[1]).multiplyScalar(0.5);
    const outward = new THREE.Vector3(midpoint.x, 0, midpoint.z);
    if (dir.dot(outward) < 0) {
        dir.negate();
    }

    // Re-runs the tomographic inversion from the raw EvaluationLog data
    // using the Controls panel's current Min. plume completeness / Max
    // plume centre / Max time difference values -- shared by the initial
    // load below and recomputeFrames() (added once the GUI exists), so
    // adjusting those sliders can redo this with new thresholds instead
    // of only ever using whatever was set (or defaulted) before upload.
    async function computeProcessedData() {
        const deg2utm = (lat, long) => {
            const [x,y] = proj([lat, long]); // TODO this seems wrong. The deg2utm function is much bigger than just dividing by unitsPerMeter!
            return [x/unitsPerMeter, y/unitsPerMeter];
        };
        processedData = await tomoInverse(data, deg2utm);
        for (const frame of processedData) {
            // deg2utm returns [proj()[0], proj()[1]] / unitsPerMeter
            // proj()[0] → Three.js X,  proj()[1] → Three.js -Z  (same sign flip as toSceneCoords)
            frame.coordinates = frame.points.map(d=>new THREE.Vector3(
                d.latPutm * unitsPerMeter,
                d.altP * unitsPerMeter,
                -d.lonPutm * unitsPerMeter
            ));
        }
        // Sort frames chronologically
        processedData.sort((a,b)=>a.time - b.time);
    }

    // Logs the concentration value under the cursor -- a single listener
    // reading the current `frames` array each time it fires, rather than
    // one added per frame inside buildFrameVisuals() below (which piled
    // up more and more of these, never removed, on every recompute).
    window.addEventListener("mousemove", event => {
        const mouse = new THREE.Vector2();
        mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1;
        mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        for (const frameGroup of frames) {
            const pointMesh = frameGroup.children[0];
            if (!pointMesh.visible) continue;
            const intersects = raycaster.intersectObject(pointMesh, false);
            if (intersects.length) {
                const index = intersects[0].index;
                const concentration = pointMesh.geometry.attributes.concentration.array[index];
                console.log(concentration);
                break;
            }
        }
    });

    // Draw concentration visualisations for each frame in processedData --
    // shared by the initial load below and recomputeFrames().
    function buildFrameVisuals() {
        let t = 0;
        for (const frame of processedData) {
            const concentrations = frame.points.map(d=>d.Concentration);
            const lut = new Lut("ylOrRd", 512);
            lut.minV = Math.min(...concentrations);
            lut.maxV = Math.max(...concentrations);

            // If min and max is the same, lut returns undefined
            if (lut.minV === lut.maxV) {
                lut.minV--;
                lut.maxV++;
            }

            // Particles: only show cells above 1 % of peak so ghost edge-cells are hidden
            const threshold = lut.maxV * 0.01;
            const mask = concentrations.map(c => c > threshold);
            const visibleConc   = concentrations.filter((_, i) => mask[i]);
            const visibleCoords = frame.coordinates.filter((_, i) => mask[i]);
            const colors = visibleConc.map(c => lut.getColor(c));

            if (t === 0) {
                console.log(`Frame 0: ${concentrations.length} cells, conc [${Math.min(...concentrations).toExponential(2)}, ${Math.max(...concentrations).toExponential(2)}], threshold ${threshold.toExponential(2)}, visible cells: ${visibleCoords.length}`);
                if (frame.coordinates[0]) console.log('Frame 0 first coord:', frame.coordinates[0]);
            }

            const pointMesh = drawParticles(visibleCoords, colors, [{
                name: "concentration",
                itemSize: 1,
                flattenedItems: visibleConc
            }], 0.005);

            // Tomographic plane
            const texture = new THREE.CanvasTexture(
                generateTexture(concentrations, frame.size1, frame.size2)
            );
            texture.wrapS = THREE.ClampToEdgeWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;
            texture.colorSpace = THREE.SRGBColorSpace;

            const material = new THREE.MeshBasicMaterial({
                side: THREE.DoubleSide,
                map: texture,
                transparent: true
            });

            // Plane needs ALL coordinates in grid order — do not use the filtered set
            const planeGeometry = new TomographicPlaneGeometry(frame.coordinates, dir, frame.size1-1, frame.size2-1);
            const planeMesh = new THREE.Mesh(planeGeometry, material);

            const frameGroup = new THREE.Group();
            frameGroup.add(pointMesh);
            frameGroup.add(planeMesh);
            frames.push(frameGroup);
            scene.add(frameGroup);
            t++;
        }
    }

    // If we already have preloaded processed data (the 5 pre-set
    // examples' CSVs), use it for the initial view -- otherwise (a manual
    // upload with no CSV) compute it live via tomoInverse. Either way,
    // recomputeFrames() (added once the GUI exists) can later redo this
    // from the raw data with new threshold values, for any volcano.
    if (processedData.length === 0) {
        // The MLEM reconstruction is genuinely CPU-heavy for volcanoes
        // with a lot of scan data -- shown while it runs so the page
        // doesn't just look stuck.
        setStatus('Computing plume reconstruction…');
        await nextPaint();
        await computeProcessedData();
    } else {
        for (const frame of processedData) {
            frame.coordinates = frame.points.map(d=>toSceneCoords(
                new THREE.Vector2(
                    d.latPutm, d.lonPutm
                ), d.altP, proj
            ));
        }
        processedData.sort((a,b)=>a.time - b.time);
    }
    buildFrameVisuals();

    // Clears the current plume/frame visuals and redoes the tomographic
    // inversion from the raw EvaluationLog data using the Controls
    // panel's current parameter values -- called from the "Tomographic
    // inversion" GUI folder below. Works for any volcano, not just ones
    // uploaded without a CSV: touching a slider switches that session
    // over to a fresh live computation even for the pre-set examples.
    async function recomputeFrames() {
        setStatus('Recomputing…');
        await nextPaint();
        frames.forEach(f => scene.remove(f));
        frames = [];
        scene.remove(plumeMesh);
        await computeProcessedData();
        buildFrameVisuals();
        api.currentFrame = 0;
        if (processedData.length === 0) {
            // api.updateFrame() (which normally updates this text) bails
            // out immediately when there's nothing to show, which would
            // otherwise leave "Recomputing…" on screen indefinitely.
            setStatus('No valid frames — try loosening the parameters above');
            render();
            return;
        }
        api.updateFrame();
    }

    api.currentFrame = 0;

    // Velocity in units per millisecond
    api.updateFrame = (steps=20, automatic=true) => {
        if (processedData.length === 0) return;
        const velocity = (params.assumedVelocity * unitsPerMeter) / 1000;
        frames.forEach((f,i) => {
            // Time difference in milliseconds
            const dt = processedData[api.currentFrame].time - processedData[i].time;
            const newPos = dir.clone().multiplyScalar(dt * velocity);
            f.position.lerp(newPos, Math.sqrt(1/steps));
            f.visible = api.currentFrame >= i;
        });
        if (automatic && steps > 1) {
            requestAnimationFrame(()=>{
                scene.remove(plumeMesh);
                render();
                api.updateFrame(steps-1);
            });
        } else {
            setStatus(processedData[api.currentFrame].time.toLocaleString() + " UTC");
            scene.remove(plumeMesh);
            if (params.plumeVisible) {
                plumeMesh = makePlumeMesh(
                    processedData, summitPos, velocity, dir, api.currentFrame
                );
                scene.add(plumeMesh);
            }
            frames.forEach(f => {
                const [pointMesh, planeMesh] = f.children;
                pointMesh.visible = params.pointsVisible;
                planeMesh.visible = params.planeVisible;
            });
        }
        render();
    };
    api.updateFrame();

    // Setup visualisation parameters
    const gui = new GUI();
    gui.add(params, 'pointsVisible').name('Show concentration points').onChange(()=>api.updateFrame());
    gui.add(params, 'planeVisible').name('Show concentration field').onChange(()=>api.updateFrame());
    gui.add(params, 'backgroundVisible').name('Show background sky').onChange(e=>setBackgroundVisibility(e));
    const beamColorController = gui.addColor(params, 'beamColor').name('Beam color').onChange(hex => {
        localStorage.setItem(CONE_COLOR_KEY, hex);
        beamWireMats.forEach(m => m.color.set(hex));
        applyBeamIconColor(hex);
        render();
    });
    // lil-gui's own swatch is just a flat color rectangle -- swap in the
    // same scan-cone fan icon used for this control on the Remote sensing
    // and map pages (measurement/main.js's createConeColorPicker /
    // map/src/placeview.js), so "Beam color" looks the same everywhere.
    const beamDisplayEl = beamColorController.domElement.querySelector('.display');
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const beamIcon = document.createElementNS(SVG_NS, 'svg');
    beamIcon.setAttribute('viewBox', '0 0 32 24');
    beamIcon.setAttribute('width', '22');
    beamIcon.setAttribute('height', '16');
    // Absolutely positioned and centered over the (fixed-height) .display
    // box, rather than appended as a normal block sibling after the native
    // color <input> -- as a block element it dropped to a new line below
    // the input and overflowed the box's fixed height, spilling down into
    // whatever content followed in the DOM (the Plume folder heading).
    beamIcon.style.cssText = 'position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); pointer-events:none;';
    const beamFan = document.createElementNS(SVG_NS, 'path');
    beamFan.setAttribute('d', 'M2,22 A14,14 0 0 1 30,22 Z');
    beamFan.setAttribute('fill-opacity', '0.55');
    beamIcon.appendChild(beamFan);
    const beamLines = [135, 90, 45].map(deg => {
        const rad = deg * Math.PI / 180;
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', '16');
        line.setAttribute('y1', '22');
        line.setAttribute('x2', (16 + 14 * Math.cos(rad)).toFixed(2));
        line.setAttribute('y2', (22 - 14 * Math.sin(rad)).toFixed(2));
        line.setAttribute('stroke-width', '1');
        beamIcon.appendChild(line);
        return line;
    });
    const beamDot = document.createElementNS(SVG_NS, 'circle');
    beamDot.setAttribute('cx', '16');
    beamDot.setAttribute('cy', '22');
    beamDot.setAttribute('r', '3');
    beamDot.setAttribute('fill', '#e0a500');
    beamIcon.appendChild(beamDot);
    beamDisplayEl.appendChild(beamIcon);
    function applyBeamIconColor(hex) {
        beamFan.setAttribute('fill', hex);
        beamFan.setAttribute('stroke', hex);
        beamLines.forEach(l => l.setAttribute('stroke', hex));
    }
    applyBeamIconColor(params.beamColor);
    const plumeFolder = gui.addFolder('Plume');
    plumeFolder.add(params, 'plumeVisible').name('Show plume').onChange(()=>api.updateFrame());
    plumeFolder.add(params, 'assumedVelocity').name('Plume speed (m/s)').onChange(()=>api.updateFrame());

    // Start from whatever the number inputs above the upload field
    // (index.html) currently hold -- lets a value set before upload carry
    // over here instead of silently resetting to params' own defaults.
    params.completenessLimit = document.getElementById('completenessLimit')?.valueAsNumber ?? params.completenessLimit;
    params.baricenterLimit = document.getElementById('baricenterLimit')?.valueAsNumber ?? params.baricenterLimit;
    params.timeDifferenceMin = document.getElementById('timeDifferenceMin')?.valueAsNumber ?? params.timeDifferenceMin;
    const inversionFolder = gui.addFolder('Tomographic inversion');
    // Scopes the circular-slider-knob CSS below to just this folder's
    // sliders, leaving the default thin-line knob on "Plume speed (m/s)".
    inversionFolder.domElement.classList.add('inversion-folder');
    // .onFinishChange (fires once, on release/blur) rather than .onChange
    // (fires continuously while dragging) -- recomputeFrames() reruns the
    // whole inversion and rebuilds the scene, so triggering it on every
    // intermediate drag value would fire many overlapping recomputations.
    inversionFolder.add(params, 'completenessLimit', 0.5, 1, 0.05).name('Min. plume completeness').onFinishChange(v => {
        document.getElementById('completenessLimit').value = v;
        recomputeFrames();
    });
    inversionFolder.add(params, 'baricenterLimit', 50, 70, 1).name('Max plume centre (deg)').onFinishChange(v => {
        document.getElementById('baricenterLimit').value = v;
        recomputeFrames();
    });
    inversionFolder.add(params, 'timeDifferenceMin', 5, 30, 1).name('Max time difference (min)').onFinishChange(v => {
        document.getElementById('timeDifferenceMin').value = v;
        recomputeFrames();
    });

    const exportFolder = gui.addFolder("Export");
    exportFolder.add(params, "exportImage").name("Export image");

    // Push the "Upload own data" button below the GUI panel (its height
    // varies with the controls above), instead of a guessed fixed offset.
    // Deferred by a couple of frames since lil-gui opens folders via a
    // requestAnimationFrame-driven CSS transition, so measuring right away
    // can catch it before that settles to its final height.
    const uploadBtn = document.getElementById('uploadOwnDataBtn');
    const uploadHint = document.getElementById('uploadOwnDataHint');
    if (uploadBtn) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const rect = gui.domElement.getBoundingClientRect();
            uploadBtn.style.top = `${rect.bottom + 10}px`;
            if (uploadHint) {
                uploadHint.style.top = `${rect.bottom + 10 + uploadBtn.getBoundingClientRect().height + 10}px`;
            }
        }));
    }

    // Setup keybindings
    window.addEventListener("keydown", (event) => {
        switch (event.code) {
        case "ArrowRight":
            api.currentFrame = Math.min(api.currentFrame+1, frames.length-1);
            api.updateFrame();
            break;
        case "ArrowLeft":
            api.currentFrame = Math.max(api.currentFrame-1, 0);
            api.updateFrame();
            break;
        }
    });

    // Setup buttons
    document.getElementById("prevFrame").onclick = () => {
        api.currentFrame = Math.max(api.currentFrame-1, 0);
        api.updateFrame();
    };
    document.getElementById("nextFrame").onclick = () => {
        api.currentFrame = Math.min(api.currentFrame+1, frames.length-1);
        api.updateFrame();
    };

    // Dome export
    api.exportDomeVideo = (
        resolution=800, duration=5, revolutionTime = 30, framerate=60, eyeSep=0.064, tilt=27, span=165,
    ) => {
        exportDomeVideo(
            resolution, duration, revolutionTime, framerate, eyeSep, tilt, span, renderer, scene,
            summitPos, unitsPerMeter, processedData.length, api
        )
    };

}

/**
 * Update status container content (used to display the date)
 * @param {string} s Text to display
 */
function setStatus(s) {
    const container = document.getElementById("statusContainer");
    const text = document.getElementById("statusText");
    container.style.display = "block";
    text.textContent = s;
}

// Resolves after the browser has actually painted -- tomoInverse() (the
// MLEM reconstruction) is a long, fully synchronous computation with no
// internal await, so a setStatus() call right before starting it would
// otherwise sit queued in memory instead of appearing on screen until
// after the freeze it's meant to explain.
function nextPaint() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

/**
 * Generate texture from concentration data
 * @param {number[]} data Flattened (height x width) matrix of concentrations
 * @param {*} height Texture height
 * @param {*} width  Texture width
 * @returns {HTMLCanvasElement}
 */
function generateTexture(data, height, width) {
    console.assert(
        data.length === height * width,
        `Length of data ${data.length} not agreeing with height ${height} and width ${width}`
    );

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);

    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const imageData = image.data;

    // Load colour scheme and set min and max values
    const lut = new Lut("ylOrRd", 512);
    lut.minV = Math.min(...data);
    lut.maxV = Math.max(...data);
    if (lut.maxV <= lut.minV) lut.maxV = lut.minV + 1; // avoid 0/0 and out-of-bounds index

    for (let i = 0, j = 0, l = imageData.length; i < l; i += 4, j++) {
        const color = lut.getColor(data[j]);
        imageData[i] = color.r * 255;       // R
        imageData[i + 1] = color.g * 255;   // G
        imageData[i + 2] = color.b * 255;   // B
        // 4th-power alpha: only the brightest 30% of cells are clearly visible
        const rel = data[j] / lut.maxV;
        imageData[i + 3] = rel * rel * rel * rel * 255;   // A
    }

    context.putImageData(image, 0, 0);

    return canvas;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    render();
}

function render() {
    renderer.render(scene, camera);
}