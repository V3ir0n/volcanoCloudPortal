import * as THREE from 'three';
import {eruptiveRegimes, eruptionFeatures} from './constants.js';
import {SoundHandler} from './soundHandler.js';

const regimePoints = eruptiveRegimes.map(v=>{
    const p = new THREE.Vector2(v.depth, v.gas);
    p.regime = v.regime;
    return p;
});

class EruptionHandler {
    constructor(view, parameters) {
        this.view = view;
        this.parameters = parameters;
        this.shakeAnimationId = null;

        // Figure out what sounds are defined. Ugly, but better than hardcoding
        // in both locations.
        const sounds = [];
        for (var prop in eruptionFeatures) {
            if (Object.prototype.hasOwnProperty.call(eruptionFeatures, prop)) {
                if (eruptionFeatures[prop].sound) {
                    sounds.push(eruptionFeatures[prop].sound)
                }
            }
        }

        this.soundHandler = new SoundHandler(sounds);
    }

    getRegime() {
        // This happens to be the the distance between depth steps
        const maxDist = 2.5;

        const p = new THREE.Vector2(
            this.parameters["depth"],
            this.parameters["gasDensity"]
        );

        let minDistSq = maxDist * maxDist;
        let closest;

        for (const r of regimePoints) {
            const distSq = p.distanceToSquared(r);
            if (distSq < minDistSq) {
                minDistSq = distSq
                closest = r;
            }
        }

        console.log(`Depth ${p.x}, gas: ${p.y}, min dist: ${Math.sqrt(minDistSq)}`)

        if (closest === undefined) {
            return undefined
        }

        return closest.regime;
    }

    // Function to shake the camera with looping, varying speed and intensity, and uneven intervals
    shakeCamera(intensity) {
        let isShaking = false;
        let shakeStartTime = 0;
        let shakeDuration = 0;
        let shakeIntensity = 0;
        let nextShakeTime = Date.now();
        let hasMovedToTarget = false;
        let hasTextureFadedIn = false;
        let hasColorChanged = false;

        const maxIntensity = 0.5;
        const minIntensity = 0.1;

        const animateShake = () => {
            const currentTime = Date.now();

            if (!isShaking && currentTime >= nextShakeTime) {
                // Start a new shake
                isShaking = true;
                shakeStartTime = currentTime;
                shakeDuration = Math.random() * 2000 + 1000; // 1-3 seconds
                shakeIntensity = intensity * Math.random() * (maxIntensity-minIntensity) + minIntensity;
            }

            if (isShaking) {
                const elapsed = currentTime - shakeStartTime;
                const progress = elapsed / shakeDuration;

                if (progress < 1) {
                    // Calculate fade factor for fade-in and fade-out effect
                    const fadeFactor = Math.sin(progress * Math.PI);


                    // Generate random offsets for shake, multiplied by fade factor (reduced intensity for slower shake)
                    const offsetX = (Math.random() - 0.5) * shakeIntensity * fadeFactor * 0.5;
                    const offsetY = (Math.random() - 0.5) * shakeIntensity * fadeFactor * 0.5;
                    const offsetZ = (Math.random() - 0.5) * shakeIntensity * fadeFactor * 0.5;

                    this.view.camera.position.add(new THREE.Vector3(
                        offsetX, offsetY, offsetZ
                    ));

                    this.shakeAnimationId = requestAnimationFrame(animateShake);
                } else {
                    // End of shake
                    isShaking = false;

                    if (!hasMovedToTarget) {
                        hasMovedToTarget = true;
                        hasTextureFadedIn = true;
                        hasColorChanged = true;
                    }
                    // Set next shake time with random delay (5-10 seconds)
                    nextShakeTime = currentTime + Math.random() * 5000 + 5000;
                    this.shakeAnimationId = requestAnimationFrame(animateShake);
                }
            } else {
                // Not shaking, continue looping
                this.shakeAnimationId = requestAnimationFrame(animateShake);
            }
        }

        animateShake();
    };

    updateEruption(regime = this.getRegime()) {
        if (regime === undefined) {
            console.warn("Unknown regime");
            return;
        }

        const features = eruptionFeatures[regime];

        // Update sound
        this.soundHandler.setSound(features.sound);

        // Update infobox
        const infoboxDiv = document.getElementById('infobox');
        if (infoboxDiv) {
            infoboxDiv.style.opacity = '0';
            setTimeout(() => {
                infoboxDiv.innerHTML = features.infoBoxText,
                infoboxDiv.style.opacity = '1';
            }, 250);
        }

        // Stop any ongoing shake
        this.stopShake();

        if (features.shakeIntensity) {
            this.shakeCamera(features.shakeIntensity);
        }

        // Update lava
        if (features.lava) {
            this.view.addLava();
        } else {
            this.view.removeLava();
        }

        // Update smoke textures
        this.view.smoke.smokeType = features.smoke;

        this.view.ash.ashAmount = features.ashAmount;
    }

    // Function to stop the camera shake animation
   stopShake() {
        if (this.shakeAnimationId) {
            cancelAnimationFrame(this.shakeAnimationId);
            this.shakeAnimationId = null;
        }
    };
}

export {EruptionHandler, eruptiveRegimes};