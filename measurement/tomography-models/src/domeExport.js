import {FisheyeCamera, saveImageSequence} from "https://akodiat.github.io/domare/src/domare.js";

function exportDomeVideo(resolution, duration, revolutionTime, framerate, eyeSep, tilt, span, renderer, scene,
    summitPos, unitsPerMeter, dataSize, api
) {
    const canvas = renderer.domElement;
    const camera = new FisheyeCamera(resolution);
    camera.tilt.x = tilt * Math.PI / 180;
    camera.span = span;

    canvas.width = resolution;
    canvas.height = resolution;

    renderer.setSize(resolution, resolution);

    camera.setResolution(resolution);

    camera.update(renderer, scene);

    const radius = 1000 * unitsPerMeter;

    const target = summitPos.clone();
    target.y *= 0.5;

    saveImageSequence(
        renderer, camera, scene,
        (timestamp, delta) => {
            api.currentFrame = Math.floor(0.001 * timestamp / duration * dataSize);
            api.updateFrame(20, false);
            // [Move camera according to keyframes]
            const angle = 2 * Math.PI * 0.001 * timestamp / revolutionTime;
            camera.position.set(
                radius * Math.cos(angle),
                summitPos.y * 0.5,
                radius * Math.sin(angle)
            )
            camera.lookAt(target);
        },
        duration, framerate, eyeSep * unitsPerMeter,
    );
}

export {exportDomeVideo};