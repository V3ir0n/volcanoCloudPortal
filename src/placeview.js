// placeview.js

/**
 * Render a place view into the given container.
 * @param {HTMLElement} container - The .panel-body element.
 * @param {{ title: string, description: string, raw: object }} place
 */
export function renderPlaceView(container, place) {
  if (!container) return;

  container.innerHTML = "";

  // Description
  const descP = document.createElement("p");
  descP.className = "place-description";
  descP.textContent = place.description || "";
  container.appendChild(descP);

}