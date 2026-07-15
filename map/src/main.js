import { renderPlaceView, createConeColorPicker } from "./placeview.js";

let selectedPlace = null;

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
    if (name) window.location.href = `../measurement/Tomography/index.html?example=${name}`;
    return;
  }

  const place = getPlaceFromFeature(feature);
  selectedPlace = place;

  rememberViewIfNeeded();

  // zoom in to selected volcano
  if (layer?.getLatLng) {
    map.setView(layer.getLatLng(), 4, { animate: true });
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
  polyline.setAttribute("stroke", "#FF6B35");
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
  }).fitBounds(worldBounds);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png", {
    attribution: "&copy; CARTO &copy; OSM",
    subdomains: "abcd",
    maxZoom: 19,
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

    map.addControl(new YearControl({ position: "bottomleft" }));

    const baseStyle = {
      color: "#000",
      weight: 1,
      opacity: 1,
      fillOpacity: 0.8
    };

    // Adds circle markers that are used in main to create the emission circlesfor each volcano
    geoLayer = L.geoJSON(data, {
      pointToLayer: (feature, latlng) => {
        const props = feature.properties || {};
        const raw = Number(props[String(year)]) || 0;
        const bucketV = bucketEmissionValue(raw, legendValues);
        return L.circleMarker(latlng, {
          ...baseStyle,
          radius: emissionRadius({ [String(year)]: bucketV }, year),
          fillColor: emissionColor(bucketV, legendValues)
        });
      },
      onEachFeature: (feature, layer) => {
        const name = getVolcanoName(feature);
        if (name) volcanoIndex.set(name, { layer, feature });

        layer.on("click", () => openVolcano(feature, layer));
      }
    }).addTo(map);

    // Add static legend showing the fixed set of size/color combinations
    createStaticLegend(legendValues);

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
          <option value="">Select volcano…</option>
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

        return container;
      }
    });

    // Add the volcano select control now that it's defined
    map.addControl(new VolcanoControl({ position: "topright" }));
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