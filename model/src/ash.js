import * as THREE from 'three';

const ashGeometry = new THREE.PlaneGeometry(10, 10);

class Ash extends THREE.Object3D {
    constructor(camera, parameters, eruptionHandler) {
        super();
        this.ashParticles = [];
        this.loadedAshTextures = [];
        this.camera = camera;
        this.parameters = parameters
        this.eruptionHandler = eruptionHandler;
    }
    createAshParticles() {
        console.log('createAsh called');

        const textureLoader = new THREE.TextureLoader();
        textureLoader.setPath("resources/");
        const ashTexturePaths = ['ash1.png', 'ash2.png', 'ash3.png'];

        const loadPromises = ashTexturePaths.map(path => {
            return new Promise((resolve, reject) => {
                textureLoader.load(
                    path,
                    (texture) => {
                        console.log(`Ash texture loaded successfully: ${path}`);
                        resolve(texture);
                    },
                    undefined,
                    (error) => {
                        console.error('Error loading ash texture:', error);
                        reject(error);
                    }
                );
            });
        });

        Promise.all(loadPromises).then(textures => {
            this.loadedAshTextures.push(...textures);
            console.log('All ash textures loaded successfully');

            const numParticles = 100; // A pool for ash particles
            for (let i = 0; i < numParticles; i++) {
                const randomTexture = this.loadedAshTextures[Math.floor(Math.random() * this.loadedAshTextures.length)];

                const ashMaterial = new THREE.MeshBasicMaterial({
                    map: randomTexture,
                    transparent: true,
                    depthWrite: false,
                    visible: false
                });

                const particle = new THREE.Mesh(ashGeometry, ashMaterial);
                particle.position.set(0.29, 7.26, 0.78);
                particle.rotation.x = -Math.PI / 2;
                particle.scale.set(0.2, 0.2, 0.2);
                particle.userData = {
                    velocity: new THREE.Vector3(),
                    birthTime: 0,
                    lifetime: 0.15 + Math.random() * 0.1,
                    isActive: false
                };
                this.ashParticles.push(particle);
                this.add(particle);
            }
            console.log('Ash particles created:', this.ashParticles.length);
        }).catch(error => {
            console.error('Failed to load ash textures:', error);
        });
    }

    update() {
        // No ash particles in type 1 eruption
        if (this.eruptionHandler.isType1Eruption) return;

        const now = Date.now();
        const stretch = this.parameters.volcanoStretch || 1.0;
        const gasDensity = this.parameters.gasDensity || 25;

        // Condition for ash in type 2 eruption (small amount of ash)
        if (this.eruptionHandler.isType2Eruption && Math.random() < 0.05) {
            // Find an inactive ash particle to launch
            const inactiveAsh = this.ashParticles.find(p => !p.userData.isActive);
            if (inactiveAsh) {
                inactiveAsh.visible = true;
                inactiveAsh.material.visible = true;
                inactiveAsh.userData.isActive = true;
                inactiveAsh.userData.birthTime = now;
                inactiveAsh.userData.lifetime = 0.4 + Math.random() * 0.3; // Longer lifetime
                inactiveAsh.position.set(
                    (Math.random() - 0.5) * 1.5,
                    0,
                    (Math.random() - 0.5) * 1.5
                );
                inactiveAsh.position.add(new THREE.Vector3(0.29, 7.26, 0.78));
                inactiveAsh.scale.set(0.2, 0.2, 0.2);

                // Strong initial velocity for "burst"
                const burstSpeed = 0.01 + Math.random() * 0.01;
                // Random launch angle between 30° and 90° (in radians)
                const launchAngle = (Math.PI / 6) + Math.random() * (Math.PI / 2 - Math.PI / 6);
                // Random horizontal direction
                const horizontalAngle = Math.random() * Math.PI * 2;
                // Compute velocity components for parabolic trajectory
                const vx = burstSpeed * Math.sin(launchAngle) * Math.cos(horizontalAngle);
                const vz = burstSpeed * Math.sin(launchAngle) * Math.sin(horizontalAngle);
                const vy = burstSpeed * Math.cos(launchAngle);
                inactiveAsh.userData.velocity.set(vx, vy, vz);

                // Randomly select a texture for the new particle
                const randomTexture = this.loadedAshTextures[Math.floor(Math.random() * this.loadedAshTextures.length)];
                inactiveAsh.material.map = randomTexture;
                inactiveAsh.material.opacity = 1.0;
                inactiveAsh.material.color.set(0x141414); // dark grey for type 2 eruption
            }
        }

        // Removed parameter-based ash conditions to rely only on eruption types

        // Condition for ash in type 3 eruption: abundant long-living ash particles (a lot of ash)
        if (this.eruptionHandler.isType3Eruption && Math.random() < 0.2) {
            // Find an inactive ash particle to launch
            const inactiveAsh = this.ashParticles.find(p => !p.userData.isActive);
            if (inactiveAsh) {
                inactiveAsh.visible = true;
                inactiveAsh.material.visible = true;
                inactiveAsh.userData.isActive = true;
                inactiveAsh.userData.birthTime = now;
                inactiveAsh.userData.lifetime = 2.0 + Math.random() * 0.5; // Longer lifetime (2.0-2.5 seconds)
                inactiveAsh.position.set(
                    (Math.random() - 0.5) * 1.5,
                    0,
                    (Math.random() - 0.5) * 1.5
                );
                inactiveAsh.position.add(new THREE.Vector3(0.29, 7.26, 0.78));
                inactiveAsh.scale.set(0.2, 0.2, 0.2);

                // Moderate initial velocity for sustained ash fall
                const burstSpeed = 0.05 + Math.random() * 0.05;
                // Random launch angle between 30° and 90° (in radians)
                const launchAngle = (Math.PI / 6) + Math.random() * (Math.PI / 2 - Math.PI / 6);
                // Random horizontal direction
                const horizontalAngle = Math.random() * Math.PI * 2;
                // Compute velocity components for parabolic trajectory
                const vx = burstSpeed * Math.sin(launchAngle) * Math.cos(horizontalAngle);
                const vz = burstSpeed * Math.sin(launchAngle) * Math.sin(horizontalAngle);
                const vy = burstSpeed * Math.cos(launchAngle);
                inactiveAsh.userData.velocity.set(vx, vy, vz);

                // Randomly select a texture for the new particle
                const randomTexture = this.loadedAshTextures[Math.floor(Math.random() * this.loadedAshTextures.length)];
                inactiveAsh.material.map = randomTexture;
                inactiveAsh.material.opacity = 1.0;
                inactiveAsh.material.color.set(0x333333); // Dark grey for type 3 eruption ash
            }
        }

        // Update active ash particles
        this.ashParticles.forEach(particle => {
            if (particle.userData.isActive) {
                const age = (now - particle.userData.birthTime) / 1000;
                if (age > particle.userData.lifetime) {
                    // Deactivate particle
                    particle.userData.isActive = false;
                    particle.userData.isDeepVolcano = false; // Reset flag
                    particle.visible = false;
                    particle.material.visible = false;
                } else {
                    // Apply gravity (slower for deep volcano ash)
                    const gravity = particle.userData.isDeepVolcano ? 0.00005 : 0.0001;
                    particle.userData.velocity.y -= gravity;

                    // Update position
                    particle.position.add(particle.userData.velocity);

                    particle.scale.multiplyScalar(1.01);

                    // Fade out
                    const life = Math.min(age / particle.userData.lifetime, 1.0);
                    particle.material.opacity = 1.0 - life;

                    particle.lookAt(this.camera.position);
                }
            }
        });
    }
}


export {Ash}