import * as THREE from "three";
import {ConvexGeometry} from "../libs/threeAddons/ConvexGeometry.js";
import { LoopSubdivision } from '../libs/threeAddons/LoopSubdivision.js';

/**
 * 
 * @param {[]} processedData
 * @param {THREE.Vector3} summitPos Position of summit
 * @param {number} velocity Assumed velocity in units per millisecond
 * @param {THREE.Vector3} dir Assumed plume direction
 * @param {number} currentFrame 
 * @param {number} concentrationThreshold 
 * @param {number} maxTimeDiff Max time since current frame to include in geometry
 */
function makePlumeMesh(processedData, summitPos, velocity, dir, currentFrame, concentrationThreshold=0, maxTimeDiff=30) {
    const filteredPoints = [summitPos];
    const margin = 1.001; // Avoid plane clipping
    const maxDt = maxTimeDiff * 1000 * 60 // Minutes to milliseconds
    processedData.forEach((d, di)=>{
        if (currentFrame >= di) {
            // Time difference in milliseconds
            const dt = processedData[currentFrame].time - d.time;
            if (dt <= maxDt) {
                const drift = dir.clone().multiplyScalar(dt * velocity);
                d.points.forEach((p,i)=> {
                    if (p.Concentration >= concentrationThreshold) {
                        const pos = d.coordinates[i].clone().add(drift);
                        pos.multiplyScalar(margin);
                        filteredPoints.push(pos);
                    } 
                });
            }
        }
    });

    const geometry = new ConvexGeometry(filteredPoints);

    const dividedGeometry = LoopSubdivision.modify(geometry, 1);

    const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        opacity: 0.3,
        transparent: true,
        depthWrite: false
    }); 
    const mesh = new THREE.Mesh(dividedGeometry, material, {split: false}); 
    return mesh;
}

export {makePlumeMesh};