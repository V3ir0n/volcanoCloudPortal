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

function toggleCameraControls() {
    if (window.controls) {
        window.controls.enabled = !window.controls.enabled;
        const button = document.getElementById('toggle-camera-btn');
        if (window.controls.enabled) {
            // Enable limited movement: view-specific horizontal and vertical, limited zoom to y=9 to 18
            updateCameraControlsLimits(); // Apply view-specific limits
            const cosTheta = Math.cos(window.initialPolarAngle);
            window.controls.minDistance = 9 / cosTheta; // Zoom in until y=9
            window.controls.maxDistance = 18 / cosTheta; // Zoom out until y=18
            button.textContent = 'Camera Control On';
        } else {
            // Disable controls and reset limits
            window.controls.minAzimuthAngle = -Infinity;
            window.controls.maxAzimuthAngle = Infinity;
            window.controls.minPolarAngle = 0;
            window.controls.maxPolarAngle = Math.PI;
            window.controls.minDistance = 0;
            window.controls.maxDistance = Infinity;
            button.textContent = 'Camera Control Off';
        }
        console.log('Camera controls ' + (window.controls.enabled ? 'enabled' : 'disabled'));
    }
}
