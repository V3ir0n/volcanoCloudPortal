// app.js
import { renderPlaceView } from "./placeview.js";

// --- State & constants ---
let selectedPlace = null;

let year = 1970;
const minYear = 1970;
const maxYear = 2025;
const tickMs = 900;
let intervalId = null;

let map;
let geoLayer;
let overlayEl = null;

// --- Helpers ---
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
  // TODO: update layers based on year here
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
  const { volcano, country, observatory, alt_masl, description } = props;
  return {
    title: volcano +', ' + country ?? "Unknown place",
    observatory: observatory ?? "Unknown observatory",
    description:
      description ??
      (alt_masl != null
        ? `Altitude: ${alt_masl} m`
        : "No description available"),
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
          <button class="yc-btn" aria-label="Play/Pause" title="Play/Pause">⏸</button>
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
      const volcanoStyle = {
        radius: 6,
        fillColor: "#FFD700",
        color: "#000",
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8
      };

      geoLayer = L.geoJSON(data, {
        pointToLayer: (feature, latlng) => L.circleMarker(latlng, volcanoStyle),
        onEachFeature: (feature, layer) => {
          layer.on("click", () => {
            const place = getPlaceFromFeature(feature);
            selectedPlace = place;
            renderPlaceOverlay(place, feature.geometry.coordinates);
          });
        }
      }).addTo(map);
    })
    .catch((err) => {
      console.error("Failed to load GeoJSON", err);
    });

  setYear(year);
  startTick();
}

// --- Init on DOM ready ---
document.addEventListener("DOMContentLoaded", () => {
  initMap();
});