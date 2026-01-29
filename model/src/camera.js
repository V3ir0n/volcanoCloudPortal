function updateCameraControlsLimits() {
    if (window.controls) {
        if (window.volcano && window.volcano.visible) {
            // Viewing slice: lock vertical rotation (no x-axis rotation), allow full horizontal (y-axis), disable pan
            const currentPolar = window.controls.getPolarAngle();
            window.controls.minPolarAngle = currentPolar;
            window.controls.maxPolarAngle = currentPolar;
            window.controls.minAzimuthAngle = -Infinity;
            window.controls.maxAzimuthAngle = Infinity;
            window.controls.enablePan = false;
        } else {
            // Viewing full model: allow full vertical and horizontal rotation, enable pan
            window.controls.minPolarAngle = 0; // Allow full vertical rotation
            window.controls.maxPolarAngle = Math.PI; // Allow full vertical rotation
            window.controls.minAzimuthAngle = -Infinity;
            window.controls.maxAzimuthAngle = Infinity;
            window.controls.enablePan = true;
        }
    }
}
