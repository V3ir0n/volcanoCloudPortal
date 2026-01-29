import * as THREE from 'three';
import {skyBottomColor, skyTopColor} from './constants.js';

// Add custom skybox with gradient and subtle fog
const skyGeometry = new THREE.SphereGeometry(500, 32, 32);
const skyMaterial = new THREE.ShaderMaterial({
    uniforms: {
        topColor: {value: new THREE.Color(skyTopColor)},
        bottomColor: {value: new THREE.Color(skyBottomColor)}
    },
    vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        varying vec3 vWorldPosition;

        void main() {
            // Create vertical gradient based on height
            float h = normalize(vWorldPosition).y * 0.5 + 0.5;
            vec3 color = mix(bottomColor, topColor, smoothstep(0.0, 1.0, h));

            gl_FragColor = vec4(color, 1.0);
        }
    `,
    side: THREE.BackSide
});

export const skyMesh = new THREE.Mesh(skyGeometry, skyMaterial);