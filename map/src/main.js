// ?v= busts a stale cached copy of placeview.js -- bump it whenever that
// file changes, same reasoning as index.html's ?v= on this file's own tag.
import { renderPlaceView, createConeColorPicker } from "./placeview.js?v=8";

let selectedPlace = null;
let selectedLayer = null; // the currently highlighted marker, see openVolcano()
let selectedFeature = null; // its feature, so openVolcano can revert its tooltip's name

// ---- infobutton pop-up text ----
let _activeTooltip = null;
function showInfoTooltip(anchorEl, text) {
  if (_activeTooltip) {
    _activeTooltip.remove();
    _activeTooltip = null;
    return;
  }
  const tip = document.createElement("div");
  tip.className = "info-tooltip";
  const escaped = text.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
  tip.innerHTML = escaped.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
  );
  document.body.appendChild(tip);
  const r = anchorEl.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(
    Math.max(r.left + r.width / 2 - tip.offsetWidth / 2, margin),
    window.innerWidth - tip.offsetWidth - margin
  );
  tip.style.left = `${left}px`;
  tip.style.top = `${r.top - 8}px`;
  tip.style.transform = "translateY(-100%)";
  _activeTooltip = tip;
  setTimeout(() => {
    const dismiss = (e) => {
      if (!tip.contains(e.target) && e.target !== anchorEl) {
        tip.remove();
        if (_activeTooltip === tip) _activeTooltip = null;
        document.removeEventListener("click", dismiss);
      }
    };
    document.addEventListener("click", dismiss);
  }, 0);
}

let year, minYear, maxYear;
let legendValues = [0]; // fixed set of emission values markers are bucketed into (size + color)
const tickMs = 2000; // ms for each tick when pushing play button
let intervalId = null;

let map;
let geoLayer;
let overlayEl = null;
let prevView = null;
// True when this map is scoped via ?volcanoes=... (opened from the
// Tomography button), in which case picking a volcano navigates straight
// to its Tomography tool example instead of opening the usual place overlay.
let isTomographyMap = false;

function formatEmission(v) {
  if (v === 0) return "0";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1).replace(/\.0$/, "") + "000";
  return String(Math.round(v));
}

const volcanoIndex = new Map();

// --- Helpers ---
function emissionRadius(props, year, options = {}) {
  const {
    minRadius = 4,   // minimum visible size
    scale = 3        // how strongly radius increases
  } = options;

  // yearly value
  const raw = props[String(year)];
  const value = Number(raw) || 0; 
  // defined even when value = 0
  const logValue = Math.log10(value + 1);

  return minRadius + scale * logValue;
}

// Fixed palette, one hand-picked color per legend level (white for zero emissions up
// to near-black for the highest bucket). Picked directly rather than interpolated so
// adjacent levels (e.g. 500 vs 1000) stay clearly distinguishable instead of blurring
// together in a narrow slice of a continuous gradient.
const HEAT_PALETTE = ["#ffffff", "#FEF001", "#fdba01", "#ff5e00", "#c81e1e", "#2b0000"];

// Maps an emission value to a heat-map color by its position in `breaks` (the same
// fixed level list used for bucketing), so each legend level gets a distinct,
// well-separated color regardless of how compressed the values are on a log scale.
function emissionColor(value, breaks) {
  const idx = breaks.indexOf(Number(value) || 0);
  if (breaks.length <= 1) return HEAT_PALETTE[0];
  const paletteIdx = idx === -1
    ? HEAT_PALETTE.length - 1
    : Math.round((idx / (breaks.length - 1)) * (HEAT_PALETTE.length - 1));
  return HEAT_PALETTE[paletteIdx];
}

// Snaps a raw emission value up to the nearest value in `breaks` (ascending, e.g. the
// legend's own value list), so every marker's size/color matches one of a small,
// fixed set of legend-shown combinations instead of a continuous scale.
function bucketEmissionValue(value, breaks) {
  const v = Number(value) || 0;
  for (const b of breaks) {
    if (v <= b) return b;
  }
  return breaks[breaks.length - 1];
}

// Finds max and min value of year from volcanoes.geojson for the emission slider.
function computeYearRange(data) {
  let min = Infinity, max = -Infinity; //all years will be larger than -inf and smaller than inf
  for (const f of data.features || []) { // loop through all volcanoes
    for (const key of Object.keys(f.properties || {})) { //loop through all properties of the volcano
      const y = Number(key); // store property key
      if (Number.isInteger(y) && y >= 1800 && y <= 2200) { //if key is a number
        if (y < min) min = y; //if y is smaller than previous y
        if (y > max) max = y;
      }
    }
  }
  return min === Infinity ? { min: 2005, max: 2023 } : { min, max }; //if min=inf no years was found and 2005,2023 are used as stand in values.
}

// Raw (unrounded) max emission across all volcanoes and years; used to normalize the heat-map color scale.
function computeGlobalMaxEmission(data) {
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => String(minYear + i));

  let maxVal = 0;
  for (const f of data.features || []) {
    const p = f.properties || {};
    for (const y of years) {
      const v = Number(p[y]) || 0;
      if (v > maxVal) maxVal = v;
    }
  }
  return maxVal;
}

//for legend
function computeLegendValuesFromData(data) {
  const maxVal = computeGlobalMaxEmission(data);
  // round up
  const niceMax = maxVal <= 0 ? 0 : Math.ceil(maxVal / 500) * 500;
  return [0, 10, 100, 500, 1000, niceMax].filter((v, i, arr) => v >= 0 && arr.indexOf(v) === i);
}

function rememberViewIfNeeded() {
  if (!map || prevView) return;
  prevView = { center: map.getCenter(), zoom: map.getZoom() };
}

function restorePrevView() {
  if (!map || !prevView) return;
  map.setView(prevView.center, prevView.zoom, { animate: true });
  prevView = null;
}

function openVolcano(feature, layer) {
  if (isTomographyMap) {
    const name = feature.properties?.name;
    // tomography-models/ is a self-contained copy of the Tomography submodule's
    // viewer (trimmed to these 5 volcanoes' data) — used instead of linking into
    // measurement/Tomography/ directly, since that submodule isn't guaranteed to
    // be checked out/deployed wherever this site is served from. viewer.html
    // (rather than index.html) is a lean, dedicated page for just these 5
    // examples — no upload button, no example-picker/parameter chrome.
    // &v= busts any stale cached copy of viewer.html itself from before a
    // page-content change (revisiting the same volcano would otherwise be
    // the exact same URL as a prior, now-outdated visit).
    if (name) window.location.href = `../measurement/tomography-models/viewer.html?volcano=${name}&v=42`;
    return;
  }

  const place = getPlaceFromFeature(feature);
  selectedPlace = place;

  rememberViewIfNeeded();

  // Zoom in to selected volcano, with the map's *center* shifted right (in
  // pixel space, at the target zoom) by half the info panel's width (see
  // .panel in styles.css: min(720px, 92vw), right:0) — so the volcano
  // itself renders shifted left on screen, landing in the visible area
  // instead of behind the panel that's about to cover the right side.
  // A single setView call (rather than setView then panBy) avoids the two
  // animations conflicting.
  if (layer?.getLatLng) {
    const targetZoom = 6;
    const panelWidth = Math.min(720, window.innerWidth * 0.92);
    const volcanoPoint = map.project(layer.getLatLng(), targetZoom);
    const shiftedCenter = map.unproject(
      volcanoPoint.add([panelWidth / 2, 0]),
      targetZoom
    );
    map.setView(shiftedCenter, targetZoom, { animate: true });
  }

  // Highlight the selected marker and switch its tooltip to permanent (so
  // it stays open without needing continued hover) — reverting the
  // previous selection's marker back to a normal hover-only tooltip first
  // (matches baseStyle's defaults from the geoJSON pointToLayer setup:
  // weight 1, color "#000"). selectedLayer is set synchronously here,
  // before the pan/zoom animation above finishes, so the mouseover/
  // mouseout handlers' "if (layer === selectedLayer) return" guard
  // correctly ignores any mouseout the animation triggers by moving the
  // marker out from under the cursor. The moveend safety re-open below
  // covers it too, in case anything closes the tooltip mid-animation.
  if (selectedLayer && selectedLayer !== layer && selectedLayer.setStyle) {
    selectedLayer.setStyle({ weight: 1, color: "#000" });
    selectedLayer.closeTooltip?.();
    selectedLayer.unbindTooltip?.();
    const prevName = getVolcanoName(selectedFeature);
    if (prevName && selectedLayer.bindTooltip) {
      selectedLayer.bindTooltip(prevName, {
        direction: "top",
        offset: [0, -8],
        className: "volcano-label"
      });
    }
  }
  if (layer?.setStyle) {
    layer.setStyle({ weight: 3, color: "#e0a500" });
    layer.unbindTooltip?.();
    const name = getVolcanoName(feature);
    if (name && layer.bindTooltip) {
      layer.bindTooltip(name, {
        permanent: true,
        direction: "top",
        offset: [0, -8],
        className: "volcano-label"
      }).openTooltip();
    }
    selectedLayer = layer;
    selectedFeature = feature;
    map.once("moveend", () => {
      if (selectedLayer === layer) layer.openTooltip?.();
    });
  }

  const [lng, lat] = feature.geometry.coordinates; //fetches lng lat from volcanoes.json
  renderPlaceOverlay(place, [lat, lng]);
}

function closeOverlay() {
  hideVolcanoControl(false);
  document.querySelector(".emission-legend")?.style.removeProperty("display");
  selectedPlace = null;

  if (overlayEl && overlayEl.parentNode) {
    overlayEl.parentNode.removeChild(overlayEl);
  }
  overlayEl = null;

  // reset dropdown selection
  const select = document.querySelector(".volcano-select");
  if (select) select.value = "";

  // zoom back out to where the user was
  restorePrevView();
}

function setYear(newYear) {
  year = newYear;
  const el = document.querySelector(".year-control");
  if (el) {
    const display = el.querySelector(".yc-display");
    const slider = el.querySelector(".yc-slider");
    if (display) display.textContent = String(year);
    if (slider && Number(slider.value) !== year) {
      slider.value = String(year);
    }
  }

  // update circle radius and heat-map color based on the new year
  if (geoLayer) {
    geoLayer.eachLayer((layer) => {
      if (!layer.feature || typeof layer.setRadius !== "function") return;

      const props = layer.feature.properties || {};
      const raw = Number(props[String(year)]) || 0;
      const bucketV = bucketEmissionValue(raw, legendValues);
      layer.setRadius(emissionRadius({ [String(year)]: bucketV }, year));
      layer.setStyle({ fillColor: emissionColor(bucketV, legendValues) });
    });
  }
}

function startTick() {
  if (intervalId) return;
  intervalId = setInterval(() => {
    setYear(year + 1 > maxYear ? minYear : year + 1);
  }, tickMs);
}

function stopTick() {
  if (!intervalId) return;
  clearInterval(intervalId);
  intervalId = null;
}

function getPlaceFromFeature(feature) {
  const props = feature.properties || {};
  console.log(props);
  const { name, display_name, country, observatory, alt_masl, gvp_url, observatory_url } = props;
  return {
    title: `${display_name}, ${country}`,
    displayName: display_name || "Unknown place",
    country: country || "",
    gvpUrl: gvp_url || null,
    name: name,
    observatory: observatory ?? "Unknown observatory",
    observatoryUrl: observatory_url || null,
    altitude: alt_masl ? `${alt_masl} m` : "Unknown altitude",
    raw: props
  };
}

function getVolcanoName(feature) {
  const p = feature?.properties || {};
  return (p.display_name || "").toString().trim();
}

function renderPlaceOverlay(place, latlng) {
  const mapWrap = document.querySelector(".map-wrap");
  if (!mapWrap) return;

  document.querySelector(".emission-legend")?.style.setProperty("display", "none");

  // Create overlay if it doesn't exist
  if (!overlayEl) {
    overlayEl = document.createElement("div");
    overlayEl.className = "overlay";
    overlayEl.tabIndex = 0;

    overlayEl.innerHTML = `
      <div class="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title">
        <header class="panel-header">
          <h3 id="panel-title"></h3>
          <button class="btn btn--icon btn--ghost info-close" aria-label="Close">&times;</button>
        </header>
        <div class="panel-body"></div>
      </div>
      <div class="diagram-container"></div>
      <div class="backdrop"></div>
    `;

    // Escape key
    overlayEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape" || e.key === "Esc") {
        closeOverlay();
      }
    });
    // Close button
    overlayEl.querySelector(".info-close").addEventListener("click", () => {
      closeOverlay();
    });
    // Backdrop click
    overlayEl.querySelector(".backdrop").addEventListener("click", () => {
      closeOverlay();
    });
    mapWrap.appendChild(overlayEl);
  } else {
    overlayEl.style.display = "";
  }


//------------Emission graph----------------
  const renderEmissionDiagram = (container, data, view) => {
  container.innerHTML = "";

  //Info button
  const header = document.createElement("div");
  header.className = "diagram-header";
  header.innerHTML = `
    <div class="diagram-title-group">
      <span class="diagram-title">SO₂ Emissions</span>
      <button class="btn btn--icon btn--icon-sm btn--outline info-btn diagram-info-btn" type="button" aria-label="About this chart">ℹ</button>
    </div>
  `;
  container.appendChild(header);
  if (view) {
    header.appendChild(createConeColorPicker(hex => view.setConeColor(hex)));
  }
  header.querySelector(".diagram-info-btn").addEventListener("click", (e) => {
    showInfoTooltip(e.currentTarget, "Annual SO₂ emissions. Data is preliminary and zero emission may correspond to data that is not evaluated. For completeness we use data from [NASA SO₂ Climatology](https://so2.gsfc.nasa.gov/measures.html) together with public [NOVAC](https://novac.chalmers.se/) data.");
  });

  const svgNS = "http://www.w3.org/2000/svg";

  const width = 480;
  const height = 220;

  const margin = { top: 20, right: 30, bottom: 40, left: 55 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "auto");
  svg.style.maxWidth = `${width}px`;
  svg.style.display = "block";
  svg.style.margin = "0 auto";

  const LEGEND_VALUES = [10, 100, 1000, 10000];

  const years = [];
  const emissions = [];

  for (let y = minYear; y <= maxYear; y++) {
    years.push(y);
    emissions.push(Number(data[String(y)]) || 0);
  }

  const maxEmission = Math.max(...emissions, 1);

  // ---- scales ----
  const xScale = i => margin.left + (i / (years.length - 1)) * innerWidth;
  const yScale = v =>
    margin.top + innerHeight - (v / maxEmission) * innerHeight;

  // ---- axes ----
  const axisGroup = document.createElementNS(svgNS, "g");

  // X axis
  const xAxis = document.createElementNS(svgNS, "line");
  xAxis.setAttribute("x1", margin.left);
  xAxis.setAttribute("y1", margin.top + innerHeight);
  xAxis.setAttribute("x2", margin.left + innerWidth);
  xAxis.setAttribute("y2", margin.top + innerHeight);
  xAxis.setAttribute("stroke", "#888888");
  axisGroup.appendChild(xAxis);

  // Y axis
  const yAxis = document.createElementNS(svgNS, "line");
  yAxis.setAttribute("x1", margin.left);
  yAxis.setAttribute("y1", margin.top);
  yAxis.setAttribute("x2", margin.left);
  yAxis.setAttribute("y2", margin.top + innerHeight);
  yAxis.setAttribute("stroke", "#888888");
  axisGroup.appendChild(yAxis);

  // Y
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const value = (maxEmission / yTicks) * i;
    const y = yScale(value);

    const tick = document.createElementNS(svgNS, "line");
    tick.setAttribute("x1", margin.left - 4);
    tick.setAttribute("x2", margin.left);
    tick.setAttribute("y1", y);
    tick.setAttribute("y2", y);
    tick.setAttribute("stroke", "#888888");
    axisGroup.appendChild(tick);

    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", margin.left - 8);
    label.setAttribute("y", y + 4);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("font-size", "10");
    label.setAttribute("fill", "#555555");
    label.textContent = Math.round(value);
    axisGroup.appendChild(label);
  }

  // ---- X ticks + labels (every ~4 years) ----
  const step = Math.ceil(years.length / 6);
  years.forEach((year, i) => {
    if (i % step !== 0) return;

    const x = xScale(i);

    const tick = document.createElementNS(svgNS, "line");
    tick.setAttribute("x1", x);
    tick.setAttribute("x2", x);
    tick.setAttribute("y1", margin.top + innerHeight);
    tick.setAttribute("y2", margin.top + innerHeight + 4);
    tick.setAttribute("stroke", "#888888");
    axisGroup.appendChild(tick);

    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", x);
    label.setAttribute("y", margin.top + innerHeight + 16);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", "10");
    label.setAttribute("fill", "#555555");
    label.textContent = year;
    axisGroup.appendChild(label);
  });

// Y label 
  const yLabel = document.createElementNS(svgNS, "text");
  yLabel.setAttribute("x", -(margin.top + innerHeight / 2));
  yLabel.setAttribute("y", 12);
  yLabel.setAttribute("text-anchor", "middle");
  yLabel.setAttribute("font-size", "15");
  yLabel.setAttribute("fill", "#555555");
  yLabel.setAttribute("transform", "rotate(-90)");
  yLabel.textContent = "SO₂ (kt/y)";
  axisGroup.appendChild(yLabel);

// X label 
  const xLabel = document.createElementNS(svgNS, "text");
  xLabel.setAttribute("x", margin.left + innerWidth / 2);
  xLabel.setAttribute("y", height - 4);
  xLabel.setAttribute("text-anchor", "middle");
  xLabel.setAttribute("font-size", "15");
  xLabel.setAttribute("fill", "#555555");
  xLabel.textContent = "Year";
  axisGroup.appendChild(xLabel);

  svg.appendChild(axisGroup);

  // ---- polyline ----
  const points = emissions
    .map((v, i) => `${xScale(i)},${yScale(v)}`)
    .join(" ");

  const polyline = document.createElementNS(svgNS, "polyline");
  polyline.setAttribute("points", points);
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke", "#e0a500");
  polyline.setAttribute("stroke-width", "2");

  svg.appendChild(polyline);
  container.appendChild(svg);
};
//------------End emission graph----------------

  // Hide volcano select while overlay is open
  hideVolcanoControl(true);

  // Title (volcano name links to its Global Volcanism Program page, when known)
  const titleEl = overlayEl.querySelector("#panel-title");
  if (titleEl) {
    titleEl.textContent = "";
    const nameText = place.displayName.charAt(0).toUpperCase() + place.displayName.slice(1);
    if (place.gvpUrl) {
      const nameLink = document.createElement("a");
      nameLink.href = place.gvpUrl;
      nameLink.target = "_blank";
      nameLink.rel = "noopener noreferrer";
      nameLink.textContent = nameText;
      titleEl.appendChild(nameLink);
    } else {
      titleEl.appendChild(document.createTextNode(nameText));
    }
    if (place.country) titleEl.appendChild(document.createTextNode(`, ${place.country}`));
  }

  // Body via placeview.js
  const bodyEl = overlayEl.querySelector(".panel-body");
  const view = renderPlaceView(bodyEl, place, latlng);
  //diagram div
  const diagramContainer = overlayEl.querySelector(".diagram-container");
    if (bodyEl && diagramContainer) bodyEl.appendChild(diagramContainer);

    // render diagram
    const data = place.raw;
    if (diagramContainer) {
      diagramContainer.innerHTML = "";
      renderEmissionDiagram(diagramContainer, data, view);
    }

  overlayEl.focus();
}

function hideVolcanoControl(hide = true) {
  const select = document.querySelector(".volcano-select");
  const container = select ? select.closest(".volcano-control") : null;
  if (container) {
    container.style.display = hide ? "none" : "";
  }
}

//---------------------------------INITIALIZE CARTO AS BACKGROUND-------------------------------------
//Change how the map is centered
function initMap() {
  const worldBounds = L.latLngBounds( 
    [
      [-85, -180],
      [85, 180]
    ]
  );

  map = L.map("map", {
    zoomControl: true,
    worldCopyJump: false,
    maxBounds: worldBounds,
    maxBoundsViscosity: 1.0,
    minZoom: 2,
    // By default fitBounds() rounds its computed zoom *down* to the nearest
    // whole level (so it never crops the bounds), which is exactly what
    // left an empty gutter -- a flat, textureless strip of #map's own
    // background -- on whichever side the window's aspect ratio doesn't
    // match the world's 360:170 ratio. zoomSnap:0 lets it land on the
    // exact fractional zoom that fits the world with no gutter and no
    // cropping, instead of rounding to a whole level either way.
    zoomSnap: 0,
  }).fitBounds(worldBounds);

  // CARTO's basemap CDN (used here previously) now requires an API key on
  // every tile -- switched to Esri's free, no-key "Light Gray" basemap,
  // which is the closest free equivalent to CARTO's light/no-labels style.
  // Esri only renders tiles up to zoom 16 natively; maxNativeZoom keeps
  // Leaflet upscaling those past that instead of requesting (and failing to
  // get) tiles beyond what the service actually has.
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
    attribution: "&copy; Esri &mdash; Esri, DeLorme, NAVTEQ",
    maxZoom: 19,
    maxNativeZoom: 16,
    minZoom: 1,
    noWrap: true,
    bounds: worldBounds,
  }).addTo(map);

  // Fetches volcanoes as a GeoJSON Point
fetch("resources/volcanoes.geojson")
  .then((r) => r.json())
  .then((data) => {
    // Optional ?volcanoes=name1,name2,... query param restricts the map to a
    // subset of volcanoes (matched against the geojson "name" property),
    // e.g. for the Tomography button's map.
    const volcanoFilter = new URLSearchParams(window.location.search).get("volcanoes");
    if (volcanoFilter) {
      const allowed = new Set(volcanoFilter.split(",").map(s => s.trim()).filter(Boolean));
      data = { ...data, features: (data.features || []).filter(f => allowed.has(f.properties?.name)) };
      isTomographyMap = true;
      const titleEl = document.querySelector(".topbar-title");
      if (titleEl) {
        titleEl.textContent = "Tomography examples";
        titleEl.classList.add("topbar-title--true-center");
      }
    }

    const { min, max } = computeYearRange(data);
    minYear = min;
    maxYear = max;
    year = minYear;
    legendValues = computeLegendValuesFromData(data);

    const YearControl = L.Control.extend({
      onAdd() {
        const container = L.DomUtil.create("div", "leaflet-bar year-control");
        container.innerHTML = `
          <div class="yc-row">
            <button class="btn btn--icon btn--icon-sm btn--outline yc-btn" aria-label="Play/Pause" title="Play/Pause">▶</button>
            <div class="yc-display">${year}</div>
            <button class="btn btn--icon btn--icon-sm btn--outline info-btn yc-info-btn" type="button" aria-label="About this data">ℹ</button>
          </div>
          <input class="yc-slider" type="range" min="${minYear}" max="${maxYear}" step="1" value="${year}" />
        `;

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        const btn = container.querySelector(".yc-btn");
        const slider = container.querySelector(".yc-slider");
        const infoBtn = container.querySelector(".yc-info-btn");
        // Info button pop-up text
        infoBtn.addEventListener("click", (e) => {
          L.DomEvent.stopPropagation(e);
          showInfoTooltip(infoBtn, "Circle size and color represent annual SO₂ emissions for the selected year. Larger, redder circles = higher emissions. Drag the slider or press play to explore different years.");
        });

        btn.addEventListener("click", () => {
          if (intervalId) {
            stopTick();
            btn.textContent = "▶";
          } else {
            startTick();
            btn.textContent = "⏸";
          }
        });

        slider.addEventListener("input", (e) => {
          stopTick();
          btn.textContent = "▶";
          setYear(Number(e.target.value));
        });

        return container;
      }
    });

    // The year slider (emission-over-time) doesn't apply to the Tomography
    // button's filtered map — it's just picking a volcano, not exploring
    // emission history.
    if (!isTomographyMap) {
      map.addControl(new YearControl({ position: "bottomleft" }));
    }

    const baseStyle = {
      color: "#000",
      weight: 1,
      opacity: 1,
      fillOpacity: 0.8
    };

    // Adds circle markers that are used in main to create the emission circlesfor each volcano
    // Hand-tuned per volcano (by its geojson "name") for the Tomography
    // map's 5 always-visible name labels, since it's a small fixed list —
    // Nevado del Ruiz and Sabancaya specifically were confirmed to overlap
    // with the earlier generic index-cycled offsets, so they're pushed
    // further apart (opposite sides) here explicitly.
    const tomographyLabelByName = {
      // Purely horizontal offset (no vertical component) so the default
      // arrow — vertically centered on the box — points straight at the
      // circle with no diagonal skew.
      nevado_del_ruiz: { direction: "right", offset: [10, 0] },
      sabancaya: { direction: "right", offset: [12, 0] },
      cleveland: { direction: "top", offset: [0, -12] },
      merapi: { direction: "bottom", offset: [0, 12] },
      turrialba: { direction: "top", offset: [0, -10] }
    };
    // Purely single-axis, same as the hand-tuned entries above, so any
    // volcano not explicitly listed still gets an untilted arrow.
    const tomographyLabelVariants = [
      { direction: "top", offset: [0, -12] },
      { direction: "bottom", offset: [0, 12] },
      { direction: "right", offset: [18, 0] },
      { direction: "left", offset: [-18, 0] },
      { direction: "left", offset: [-18, 0] }
    ];
    let tomographyLabelIndex = 0;

    geoLayer = L.geoJSON(data, {
      pointToLayer: (feature, latlng) => {
        const props = feature.properties || {};
        const raw = Number(props[String(year)]) || 0;
        const bucketV = bucketEmissionValue(raw, legendValues);
        // Tomography's filtered map is just picking a volcano to open, not
        // comparing emission magnitude, so keep every circle the same
        // size/color (dark red, matching the site's other dark-red accents).
        return L.circleMarker(latlng, {
          ...baseStyle,
          radius: isTomographyMap ? 8 : emissionRadius({ [String(year)]: bucketV }, year),
          fillColor: isTomographyMap ? "#8b0000" : emissionColor(bucketV, legendValues)
        });
      },
      onEachFeature: (feature, layer) => {
        const name = getVolcanoName(feature);
        if (name) volcanoIndex.set(name, { layer, feature });

        // Tooltip is bound non-permanent by default — Leaflet only shows a
        // non-permanent tooltip while actually hovering its layer, and
        // (unlike permanent:true) it does NOT auto-show just from being on
        // the map. openVolcano() switches the *selected* marker's tooltip
        // to permanent so its label survives after the hover ends. On the
        // Tomography map there are only 5 volcanoes to choose from, so show
        // all their names right away instead of requiring hover/selection.
        if (name) {
          const variant = isTomographyMap
            ? (tomographyLabelByName[feature.properties?.name]
              || tomographyLabelVariants[tomographyLabelIndex++ % tomographyLabelVariants.length])
            : { direction: "top", offset: [0, -8] };
          layer.bindTooltip(name, {
            permanent: isTomographyMap,
            direction: variant.direction,
            offset: variant.offset,
            className: "volcano-label"
          });
          if (isTomographyMap) layer.openTooltip();
        }

        layer.on("click", () => openVolcano(feature, layer));

        // Hover preview: same highlight as a click-selection, but reverts
        // on mouseout — unless this marker is the actual selection, in
        // which case its highlight should stay put (its tooltip is already
        // permanent by then, so Leaflet keeps showing it without our help).
        layer.on("mouseover", () => {
          if (layer === selectedLayer) return;
          layer.setStyle({ weight: 3, color: "#e0a500" });
        });
        layer.on("mouseout", () => {
          if (layer === selectedLayer) return;
          layer.setStyle({ weight: 1, color: "#000" });
        });
      }
    }).addTo(map);

    // Add static legend showing the fixed set of size/color combinations —
    // not relevant on the Tomography button's filtered map, since its
    // circles are all the same size (see pointToLayer above).
    if (!isTomographyMap) {
      createStaticLegend(legendValues);
    }

    // Define the VolcanoControl here (in the same scope)
    const VolcanoControl = L.Control.extend({
      onAdd() {
        const container = L.DomUtil.create("div", "leaflet-bar volcano-control");

        const select = L.DomUtil.create("select", "volcano-select", container);
        const names = (data.features || [])
          .map(getVolcanoName)
          .filter(Boolean)
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .sort((a, b) => a.localeCompare(b));

        select.innerHTML = `
          <option value="">Select a volcano</option>
          ${names.map(n => `<option value="${n}">${n}</option>`).join("")}
        `;

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        select.addEventListener("change", (e) => {
          const name = e.target.value;
          if (!name) return;
          const entry = volcanoIndex.get(name);
          if (!entry) return;
          openVolcano(entry.feature, entry.layer);
        });

        if (isTomographyMap) {
          const hint = L.DomUtil.create("p", "volcano-control-hint", container);
          hint.textContent = "Select a volcano on the map or in this list to see an example of plume tomography from real measurements";
        }

        return container;
      }
    });

    // Add the volcano select control now that it's defined
    const volcanoControl = new VolcanoControl({ position: "topright" });
    map.addControl(volcanoControl);

    if (isTomographyMap) {
      // A plain fixed-position element on the page instead of another
      // Leaflet control stacked below it -- #map (.leaflet-container) has
      // overflow:hidden, which was silently clipping this button's bottom
      // edge whenever the dropdown+hint above it left it running past the
      // visible map area. Being outside that container entirely (a sibling
      // of #map, not inside it) sidesteps that regardless of window size.
      const uploadBtn = document.createElement("a");
      uploadBtn.className = "volcano-upload-btn";
      // ?v= busts any stale cached copy of this page from before the
      // examples-picker section was hidden (see index.html).
      uploadBtn.href = "../measurement/tomography-models/index.html?v=50";
      uploadBtn.innerHTML = `
        <span class="volcano-upload-btn-title">Upload own data</span>
        <span class="volcano-upload-btn-subtitle">Upload two NOVAC EvaluationLog files from the same volcano and date</span>
      `;
      // Fixed to the bottom-left corner (see .volcano-upload-btn in
      // styles.css) rather than tracked to sit under the volcano-select
      // control -- simpler and doesn't need a resize listener.
      document.body.appendChild(uploadBtn);
    }
  })
  .catch((err) => {
    console.error("Failed to load GeoJSON", err);
  });

function createStaticLegend(legendValues) {
  if (!map) return;

  const Legend = L.Control.extend({
    onAdd() {
      const div = L.DomUtil.create("div", "leaflet-bar emission-legend");
      div.innerHTML = `
        <div class="legend-title">Emission of SO₂ kt/y</div>
        <div class="legend-items">
          ${legendValues.map(v => {
            const r = emissionRadius({ [String(minYear)]: v }, minYear);
            const size = Math.ceil(r * 2) + 6;
            const c = Math.ceil(size / 2);
            const fill = emissionColor(v, legendValues);

            return `
              <div class="legend-row">
                <svg width="${size}" height="${size}" aria-hidden="true">
                  <circle cx="${c}" cy="${c}" r="${r}"
                    fill="${fill}" fill-opacity="0.8" stroke="#000" stroke-width="1"></circle>
                </svg>
                <span class="legend-label">${formatEmission(v)}</span>
                ${v === 0 ? `<button class="btn btn--icon btn--icon-sm btn--outline info-btn diagram-info-btn" type="button" aria-label="About this legend" style="margin-left:auto">ℹ</button>` : ""}
              </div>
            `;
          }).join("")}
        </div>
      `;

      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);

      div.querySelector(".diagram-info-btn").addEventListener("click", (e) => {
        L.DomEvent.stopPropagation(e);
        showInfoTooltip(e.currentTarget, "Circle size and color each fall into one of a fixed set of levels based on annual SO₂ emissions — larger, darker-red circles mean higher emissions. Data is preliminary and zero emission may correspond to data that is not evaluated. For completeness we use data from [NASA SO₂ Climatology](https://so2.gsfc.nasa.gov/measures.html) together with public [NOVAC](https://novac.chalmers.se/) data.");
      });

      return div;
    }
  });

  map.addControl(new Legend({ position: "bottomright" }));
}

}
document.addEventListener("DOMContentLoaded", () => {
  initMap();
});