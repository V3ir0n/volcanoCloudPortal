import * as THREE from 'three';
import {annotations} from './constants.js';

const textureLoader = new THREE.TextureLoader();
const spriteTexture = textureLoader.load(
    "resources/label.png",
    texture => texture.colorSpace = THREE.SRGBColorSpace
);

const annotationSizeDefault = 0.05;
const annotationSizeHighlight = 0.055;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const annotationLabel = document.getElementById("annotationLabel");

class AnnotationHandler {
    constructor(canvas, camera, scene, onAnnotationSelected, onAnnotationClosed) {
        this.canvas = canvas;
        this.camera = camera;
        this.annotationOpen = false;
        this.onAnnotationSelected = (a) => {
            this.annotationOpen = true;
            onAnnotationSelected(a);
        };
        this.onAnnotationClosed = (a) => {
            this.annotationOpen = false;
            onAnnotationClosed(a);
        };

        this.openSprite = undefined;
        this.annotationSprites = new THREE.Group();

        for (const annotation of annotations) {
            const sprite = new THREE.Sprite(
                new THREE.SpriteMaterial({
                    map: spriteTexture,
                    color: 0xFFFFFF,
                    transparent: true,
                    sizeAttenuation: false,
                    alphaTest: 0.5
                }
            ));
            sprite.annotation = annotation;
            sprite.position.fromArray(annotation.position);
            sprite.scale.setScalar(annotationSizeDefault);
            this.annotationSprites.add(sprite);
        }
        scene.add(this.annotationSprites);

        canvas.addEventListener("pointermove", event => this.onPointerMove(event));

        canvas.addEventListener("click", event => this.onClick(event));

        // Sometimes, the user might click the label itself, rather
        // than the sprite, so this makes sure the label is clickable
        // too. (useful on mobile in particular)
        annotationLabel.addEventListener("click", ()=>{
            this.openSprite = this.highlightedAnnotation;
            this.onAnnotationSelected(this.highlightedAnnotation.annotation);
            annotationLabel.style.display = "none";
        });
    }

    onClick(event) {
        const resetHighlight = () => {
            if (this.highlightedAnnotation) {
                this.highlightedAnnotation.material.color.set('#ffffff');
                this.highlightedAnnotation.scale.setScalar(annotationSizeDefault);
                this.canvas.style.cursor = "";
                annotationLabel.style.display = "none";
                this.highlightedAnnotation = undefined;
            }
        };

        if (this.annotationOpen) {
            const previousSprite = this.openSprite;
            this.onAnnotationClosed();
            this.openSprite = undefined;

            // On touch devices pointer is never moved, so resolve hover first
            if (!this.highlightedAnnotation) {
                this.onPointerMove(event);
            }

            if (this.highlightedAnnotation && this.highlightedAnnotation !== previousSprite) {
                // Clicked a different annotation — open it directly
                this.openSprite = this.highlightedAnnotation;
                this.onAnnotationSelected(this.highlightedAnnotation.annotation);
            }
            resetHighlight();
        } else if (this.highlightedAnnotation) {
            this.openSprite = this.highlightedAnnotation;
            this.onAnnotationSelected(this.highlightedAnnotation.annotation);
            resetHighlight();
        } else {
            // On touch devices pointer is never moved
            this.onPointerMove(event);
        }
    }

    onPointerMove(event) {
        if (this.highlightedAnnotation) {
            this.highlightedAnnotation.material.color.set("#ffffff");
            this.highlightedAnnotation.scale.setScalar(annotationSizeDefault);
            this.canvas.style.cursor = "";
            annotationLabel.style.display = "none";
            this.highlightedAnnotation = undefined;
        }

        pointer.x = (event.clientX / this.canvas.offsetWidth) * 2 - 1;
        pointer.y = - (event.clientY / this.canvas.offsetHeight) * 2 + 1;

        raycaster.setFromCamera(pointer, this.camera);

        const intersects = raycaster.intersectObject(this.annotationSprites, true);

        if (intersects.length > 0) {
            const res = intersects.filter(res => res && res.object)[0];

            if (res && res.object) {
                this.canvas.style.cursor = "pointer"
                this.highlightedAnnotation = res.object;
                this.highlightedAnnotation.scale.setScalar(annotationSizeHighlight);
                this.highlightedAnnotation.material.color.set('#f00');

                annotationLabel.innerHTML = this.highlightedAnnotation.annotation.name;
                annotationLabel.style.display = "block";

                const p = this.highlightedAnnotation.position.clone().project(this.camera);

                const w = this.canvas.width / window.devicePixelRatio;
                const h = this.canvas.height / window.devicePixelRatio;
                p.x = Math.round((0.5 + p.x / 2) * w);
                p.y = Math.round((0.5 - p.y / 2) * h);

                // Do not draw the label outside the canvas
                if (p.x + annotationLabel.offsetWidth > w) {
                    p.x -= annotationLabel.offsetWidth
                }
                if (p.y + annotationLabel.offsetHeight > h) {
                    p.y -= annotationLabel.offsetHeight
                }

                annotationLabel.style.top = `${p.y}px`;
                annotationLabel.style.left = `${p.x}px`;
            }
        }
    }
}

export {AnnotationHandler}