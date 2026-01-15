// app.js
import { renderPlaceView } from "./placeview.js";

// --- State & constants ---
let selectedPlace = null;

let year = 2005;
const minYear = 2005;
const maxYear = 2023;
const tickMs = 900;
let intervalId = null;

let map;
let geoLayer;
let overlayEl = null;

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

function closeOverlay() {
  selectedPlace = null;
  if (overlayEl && overlayEl.parentNode) {
    overlayEl.parentNode.removeChild(overlayEl);
  }
  overlayEl = null;
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
  }

  // Title
  const titleEl = overlayEl.querySelector("#panel-title");
  const titleText = place.title.split("").map((c,i)=>i==0?c.toUpperCase():c).join("");
  if (titleEl) titleEl.textContent = titleText || "Unknown place";

  // Body via placeview.js
  const bodyEl = overlayEl.querySelector(".panel-body");
  renderPlaceView(bodyEl, place, latlng);

  // Focus overlay for accessibility
  overlayEl.focus();
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
        // index by volcano name
        const name = feature.properties?.volcano;
        if (name) {
          volcanoIndex.set(name, { layer, feature });
        }

        layer.on("click", () => {
          const place = getPlaceFromFeature(feature);
          selectedPlace = place;
          const [lng, lat] = feature.geometry.coordinates;
          renderPlaceOverlay(place, [lat, lng]);
        });
      }
}).addTo(map);
    setYear(year);
    //dropdown control
    const VolcanoControl = L.Control.extend({
  onAdd() {
    const container = L.DomUtil.create("div", "leaflet-bar volcano-control");

    // Build <select> with all volcano names
    const select = L.DomUtil.create("select", "volcano-select", container);
    select.innerHTML = `
      <option value="">Select volcano…</option>
      ${Array.from(volcanoIndex.keys())
        .sort()
        .map(name => `<option value="${name}">${name}</option>`)
        .join("")}
    `;

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    select.addEventListener("change", (e) => {
      const name = e.target.value;
      if (!name) return;

      const entry = volcanoIndex.get(name);
      if (!entry) return;

      const { feature, layer } = entry;
      const place = getPlaceFromFeature(feature);
      selectedPlace = place;

      // center map on this volcano
      if (layer.getLatLng) {
        map.setView(layer.getLatLng(), 10, { animate: true });
      }

      const [lng, lat] = feature.geometry.coordinates;
      renderPlaceOverlay(place, [lat, lng]);
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