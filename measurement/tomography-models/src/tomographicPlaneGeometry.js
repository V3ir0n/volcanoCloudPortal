import * as THREE from "three";

class TomographicPlaneGeometry extends THREE.BufferGeometry {


    constructor(positions, dir, gridX, gridY) {

        super();
        this.type = "TomographicPlaneGeometry";

        const gridX1 = gridX + 1;
        const gridY1 = gridY + 1;

        const indices = [];
        const vertices = [];
        const normals = [];
        const uvs = [];

        //The retrieved concentration values fill a n*m grid in space,
        // formed by the intersection of (n+1) beams with gas detections
        // by instrument 1, and (m+1) beams with gas detections by
        // instrument 2. The elements of the vector of concentrations
        // follows the order (1,1), (1,2), …, (1,m), (2,1), (2,2), …,
        // (2,m), …, (n,1), (n,2), …, (n,m).

        const p = new THREE.Vector3();
        for (let iy = 0; iy < gridY1; iy++) {
            for (let ix = 0; ix < gridX1; ix++) {
                const i = iy + gridY1 * ix;
                p.copy(positions[i]);
                vertices.push(p.x, p.y, p.z);

                normals.push(dir.x, dir.y, dir.z);

                uvs.push(iy / gridY);
                uvs.push(1 - (ix / gridX));
            }
        }

        for (let iy = 0; iy < gridY; iy++) {
            for (let ix = 0; ix < gridX; ix++) {
                const a = ix + gridX1 * iy;
                const b = ix + gridX1 * (iy + 1);
                const c = (ix + 1) + gridX1 * (iy + 1);
                const d = (ix + 1) + gridX1 * iy;

                indices.push(a, b, d);
                indices.push(b, c, d);
            }
        }

        this.setIndex(indices);
        this.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
        this.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
        this.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    }
}

export {TomographicPlaneGeometry};