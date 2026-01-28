import { renderPlaceView } from "./placeview.js";

let selectedPlace = null;

let year = 2005;
const minYear = 2005;
const maxYear = 2023;
const tickMs = 900;
let intervalId = null;

let map;
let geoLayer;
let overlayEl = null;
let prevView = null;

const LEGEND_VALUES = [10, 100, 1000, 10000]; // fixed reference emission values

function formatEmission(v) {
  if (v === 0) return "0";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(Math.round(v));
}

const volcanoIndex = new Map();

// --- Helpers ---
function emissionRadius(props, year, options = {}) {
  const {
    minRadius = 4,   // minimum visible size
    scale = 3        // how strongly radius increases
  } = options;

  // yearly value, e.g. props["2018"]
  const raw = props[String(year)];
  const value = Number(raw) || 0; // treat null/NaN as 0

  // defined even when value = 0
  const logValue = Math.log10(value + 1);

  return minRadius + scale * logValue;
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
  const place = getPlaceFromFeature(feature);
  selectedPlace = place;

  rememberViewIfNeeded();

  // zoom in to selected volcano
  if (layer?.getLatLng) {
    map.setView(layer.getLatLng(), 10, { animate: true });
  }

  const [lng, lat] = feature.geometry.coordinates;
  renderPlaceOverlay(place, [lat, lng]);
}

function closeOverlay() {
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

  // update circle radius based on the new year
  if (geoLayer) {
    geoLayer.eachLayer((layer) => {
      if (!layer.feature || typeof layer.setRadius !== "function") return;

      const props = layer.feature.properties || {};
      const r = emissionRadius(props, year);
      layer.setRadius(r);
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
  const { name, display_name, country, observatory, alt_masl,} = props;
  return {
    title: display_name +', ' + country ?? "Unknown place",
    name: name,
    observatory: observatory ?? "Unknown observatory",
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

  // Create overlay if it doesn't exist
  if (!overlayEl) {
    overlayEl = document.createElement("div");
    overlayEl.className = "overlay";
    overlayEl.tabIndex = 0;

    overlayEl.innerHTML = `
      <div class="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title">
        <header class="panel-header">
          <h3 id="panel-title"></h3>
          <button class="close-btn" aria-label="Close">&times;</button>
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
    overlayEl.querySelector(".close-btn").addEventListener("click", () => {
      closeOverlay();
    });

    // Backdrop click
    overlayEl.querySelector(".backdrop").addEventListener("click", () => {
      closeOverlay();
    });

    mapWrap.appendChild(overlayEl);
  } else {
    // overlay exists — ensure it's visible (in case you removed it rather than recreating)
    overlayEl.style.display = "";
  }

  const renderEmissionDiagram = (container, data) => {
  container.innerHTML = "";

  const svgNS = "http://www.w3.org/2000/svg";

  const width = 320;
  const height = 220;

  const margin = { top: 20, right: 20, bottom: 40, left: 50 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);

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
  xAxis.setAttribute("stroke", "#888");
  axisGroup.appendChild(xAxis);

  // Y axis
  const yAxis = document.createElementNS(svgNS, "line");
  yAxis.setAttribute("x1", margin.left);
  yAxis.setAttribute("y1", margin.top);
  yAxis.setAttribute("x2", margin.left);
  yAxis.setAttribute("y2", margin.top + innerHeight);
  yAxis.setAttribute("stroke", "#888");
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
    tick.setAttribute("stroke", "#888");
    axisGroup.appendChild(tick);

    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", margin.left - 8);
    label.setAttribute("y", y + 4);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("font-size", "10");
    label.setAttribute("fill", "#ccc");
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
    tick.setAttribute("stroke", "#888");
    axisGroup.appendChild(tick);

    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", x);
    label.setAttribute("y", margin.top + innerHeight + 16);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", "10");
    label.setAttribute("fill", "#ccc");
    label.textContent = year;
    axisGroup.appendChild(label);
  });

  svg.appendChild(axisGroup);

  // ---- polyline ----
  const points = emissions
    .map((v, i) => `${xScale(i)},${yScale(v)}`)
    .join(" ");

  const polyline = document.createElementNS(svgNS, "polyline");
  polyline.setAttribute("points", points);
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke", "orange");
  polyline.setAttribute("stroke-width", "2");

  svg.appendChild(polyline);
  container.appendChild(svg);
};

  // Hide volcano select while overlay is open
  hideVolcanoControl(true);

  // Title
  const titleEl = overlayEl.querySelector("#panel-title");
  const titleText = (place.title || "").split("").map((c,i)=>i==0?c.toUpperCase():c).join("");
  if (titleEl) titleEl.textContent = titleText || "Unknown place";

  // Body via placeview.js
  const bodyEl = overlayEl.querySelector(".panel-body");
  renderPlaceView(bodyEl, place, latlng);
  //diagram div
  const diagramContainer = overlayEl.querySelector(".diagram-container");
    if (bodyEl && diagramContainer) bodyEl.appendChild(diagramContainer);

    // render diagram
    const data = place.raw;
    if (diagramContainer) {
      diagramContainer.innerHTML = "";
      renderEmissionDiagram(diagramContainer, data);
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

function initMap() {
  const worldBounds = L.latLngBounds(
    [
      [-60, -180],
      [75, 180]
    ]
  );

  map = L.map("map", {
    zoomControl: true,
    worldCopyJump: false,
    maxBounds: worldBounds,
    maxBoundsViscosity: 1.0
  }).setView([15, 60], 2);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png", {
    attribution: "&copy; CARTO &copy; OSM",
    subdomains: "abcd",
    maxZoom: 19,
    minZoom: 2,
    noWrap: true,
    bounds: worldBounds
  }).addTo(map);

  // Year control
  const YearControl = L.Control.extend({
    onAdd() {
      const container = L.DomUtil.create("div", "leaflet-bar year-control");
      container.innerHTML = `
        <div class="yc-row">
          <button class="yc-btn" aria-label="Play/Pause" title="Play/Pause">▶</button>
          <div class="yc-display">${year}</div>
        </div>
        <input class="yc-slider" type="range" min="${minYear}" max="${maxYear}" step="1" value="${year}" />
      `;

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      const btn = container.querySelector(".yc-btn");
      const slider = container.querySelector(".yc-slider");

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

  //add legend
  function createStaticLegend() {
  if (!map) return;

  const Legend = L.Control.extend({
    onAdd() {
      const div = L.DomUtil.create("div", "leaflet-bar emission-legend");

      div.innerHTML = `
        <div class="legend-title">Emission</div>
        <div class="legend-items">
          ${LEGEND_VALUES.map(v => {
            const r = emissionRadius({ [String(minYear)]: v }, minYear);
            const size = Math.ceil(r * 2) + 6;
            const c = Math.ceil(size / 2);

            return `
              <div class="legend-row">
                <svg width="${size}" height="${size}" aria-hidden="true">
                  <circle cx="${c}" cy="${c}" r="${r}"
                    fill="#FFD700" fill-opacity="0.8" stroke="#000" stroke-width="1"></circle>
                </svg>
                <span class="legend-label">${formatEmission(v)}</span>
              </div>
            `;
          }).join("")}
        </div>
      `;

      // avoid map panning when interacting with legend
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);

      return div;
    }
  });

  map.addControl(new Legend({ position: "bottomright" }));
}

  // Load GeoJSON
  fetch("resources/volcanoes.geojson")
  .then((r) => r.json())
  .then((data) => {
    const baseStyle = {
      fillColor: "#FFD700",
      color: "#000",
      weight: 1,
      opacity: 1,
      fillOpacity: 0.8
    };

    geoLayer = L.geoJSON(data, {
      pointToLayer: (feature, latlng) => {
        const radius = emissionRadius(feature.properties || {}, year);
        return L.circleMarker(latlng, {
          ...baseStyle,
          radius
        });
      },
      onEachFeature: (feature, layer) => {
        const name = getVolcanoName(feature);
        if (name) {
          volcanoIndex.set(name, { layer, feature });
        }

        layer.on("click", () => {
          openVolcano(feature, layer);
        });
      }
}).addTo(map);

createStaticLegend();

    setYear(year);
    //dropdown control
    const VolcanoControl = L.Control.extend({
    onAdd() {
    const container = L.DomUtil.create("div", "leaflet-bar volcano-control");

    // Build <select> with all volcano names
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

map.addControl(new VolcanoControl({ position: "topright" }));
  })
  .catch((err) => {
    console.error("Failed to load GeoJSON", err);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initMap();
});

