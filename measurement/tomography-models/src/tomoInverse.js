import {locateVolcano} from "./locateVolcano.js";
import {loadPyodide} from "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.mjs";

/**
 * Tomographic inversion. Retrieve concentration profiles of plumes from measured scans
 * @param {*[][]} data
 * @param {(latlong:[number, number]) => [number, number]} deg2utm Function to convert from longitude and latitude to X Y coordinates
 * @param {number} completenessLimit Cleteness value between 0.5 and 1, the larger the better
 * @param {number} baricenterLimit Angle of centre of mass, between 0 and 75
 * @param {number} timeDifferenceMin Difference in time between scans in minutes
 */
async function tomoInverse(
    data,
    deg2utm,
    completenessLimit,
    baricenterLimit,
    timeDifferenceMin,
) {

        // Hide progress bar
    document.getElementById("progress").style.display = "block";

    // Setup pyodide
    const pyodide = await loadPyodide();

    // Use pyodide's compiled binary packages (faster than micropip pure-Python wheels)
    await pyodide.loadPackage(["numpy", "scipy"]);

    // Hide progress bar
    document.getElementById("progress").style.display = "none";

    // Pre-import once — all per-pair calls reuse these
    pyodide.runPython(`
import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.linalg import lsqr
from scipy.optimize import nnls
`);

    if (completenessLimit === undefined) {
        completenessLimit = document.getElementById("completenessLimit").valueAsNumber;
    }
    if (baricenterLimit === undefined) {
        baricenterLimit = document.getElementById("baricenterLimit").valueAsNumber;
    }
    if (timeDifferenceMin === undefined) {
        timeDifferenceMin = document.getElementById("timeDifferenceMin").valueAsNumber;
    }

    const timeDifference = timeDifferenceMin * 60 * 1000 // To milliseconds
    const numberOffset = 5;

    // Determine parameters
    for (const instrumentData of data) {
        for (const s of instrumentData) {
            const d = s.spectralData;

            const dateStr = s.scanInfo.date.split('.').reverse().join('-');
            const scansTime = d.map(a=>new Date(dateStr+"T"+a.starttime));

            // Convert to VCDs
            s.pointsAll = d.findIndex(a=>a.scanangle===180);
            s.indScansAng = d.map(a=>a.scanangle).slice(s.pointsAll + 1);
            s.indScansTime = scansTime.slice(s.pointsAll + 1);
            s.indScansSO2All = d.map(a=>a.column_SO2).slice(s.pointsAll + 1);
            s.indScansSO2eAll = d.map(a=>a.columnerror_SO2).slice(s.pointsAll + 1);
            s.indScansFlagAll = d.map(a=>a.isgoodpoint).slice(s.pointsAll + 1);

            // Calculate offset and transform to SCD in flat geometry
            s.offsetAll0 = s.indScansSO2All.slice().sort((a, b) => a - b);
            s.offsetAll = mean(s.offsetAll0.slice(0, numberOffset));
            s.indScansSO2o = s.indScansSO2All.map(x => x - s.offsetAll);
            s.indScansSO2AllFinal = s.indScansSO2o.map(x => x * sind(s.scanInfo.coneangle));

            // Calculate most important scan properties
            s.scansTimeFinal = s.indScansTime[0]; // TODO: Should't it be the last, rather than the first, timestamp?
            s.scansBaricenter = sum(s.indScansAng.map((x, idx) => x * s.indScansSO2AllFinal[idx])) / sum(s.indScansSO2AllFinal);
            s.scansCompleteness = 1 - 0.5 * (Math.max(
                0.2 * sum(s.indScansSO2AllFinal.slice(0, 5)),
                0.2 * sum(s.indScansSO2AllFinal.slice(-5))
            ) / Math.max(...s.indScansSO2AllFinal));
            s.scansMeanColumn = mean(s.indScansSO2AllFinal);
        }
    }

    // Filtering
    const indexValid = [];
    for (let m=0; m<data.length; m++) {
        const instrumentData = data[m];
        let k = 0;
        indexValid[m] = [];
        for (let n=0, len=instrumentData.length; n<len; n++) {
            const scan = instrumentData[n];
            if (Math.abs(scan.scansBaricenter) < baricenterLimit && scan.scansCompleteness > completenessLimit && Math.max(...scan.indScansSO2AllFinal) > 0) {
                scan.indScansTimeValid = scan.indScansTime;
                scan.indScansSO2Valid = scan.indScansSO2AllFinal;
                indexValid[m][k] = n;
                k++
            } else {
                scan.indScansTimeValid = scan.indScansTime;
                scan.indScansSO2Valid = new Array(scan.indScansSO2AllFinal.length).fill(0);
            }
        }
    }

    // Station parameters
    let stepS1 = mean(diff(data[0][0].spectralData.map(v=>v.scanangle).slice(2))); // scanning step, deg
    let fovS1 = stepS1 / 8; // field of view of the instrument
    let latS1 = data[0][0].scanInfo.lat;  // latitude station 1
    let lonS1 = data[0][0].scanInfo.long; // longitude
    let altS1 = data[0][0].scanInfo.alt; // altitude

    let stepS2 = mean(diff(data[1][0].spectralData.map(v=>v.scanangle).slice(2))); // scanning step, deg
    let fovS2 = stepS2 / 8; // field of view of the instrument
    let latS2 = data[1][0].scanInfo.lat; // latitude station 2
    let lonS2 = data[1][0].scanInfo.long;
    let altS2 = data[1][0].scanInfo.alt;

    const [nameVol, latVol, lonVol, altVol] = locateVolcano(data);

    // Solve the location triangle
    let [latVolutm, lonVolutm] = deg2utm(latVol, lonVol);
    let [latS1utm, lonS1utm] = deg2utm(latS1, lonS1);
    let [latS2utm, lonS2utm] = deg2utm(latS2, lonS2);

    let DX1 = lonS1utm - lonVolutm; // Relative position in X of station 1 w.r.t. volcano
    let DY1 = latS1utm - latVolutm; // Relative position in Y of station 1
    let beta1 = data[0][0].scanInfo.coneangle; // coneangle station 1

    let DX2 = lonS2utm - lonVolutm; // Relative position in X of station 1 w.r.t. volcano
    let DY2 = latS2utm - latVolutm; // Relative position in Y of station 1
    let beta2 = data[1][0].scanInfo.coneangle; // coneangle station 1

    let deltaH21 = altS2 - altS1; // Difference in altitude st. 2 - st. 1

    // Geometry of stations and plume direction
    let compass1 = atan2d(DX1, DY1); // azimuth of station 1
    let compass2 = atan2d(DX2, DY2);

    // Geometry from above and using plume centre
    let VS1 = Math.sqrt(DX1 ** 2 + DY1 ** 2);
    let VS2 = Math.sqrt(DX2 ** 2 + DY2 ** 2);
    let S12 = Math.sqrt((DX1 - DX2) ** 2 + (DY1 - DY2) ** 2);
    let angleV = acosd((1 / (2 * VS1 * VS2)) * (VS1 ** 2 + VS2 ** 2 - S12 ** 2));
    let angleS1 = acosd((1 / (2 * VS1 * S12)) * (VS1 ** 2 + S12 ** 2 - VS2 ** 2));
    let angleS2 = acosd((1 / (2 * VS2 * S12)) * (VS2 ** 2 + S12 ** 2 - VS1 ** 2));

    // Pairing scans close in time and making the tomography
    let k = 0;
    let valid1 = [...indexValid[0].keys()];
    let valid2 = [...indexValid[1].keys()];
    console.log(`Valid scans: instrument 1 = ${valid1.length}, instrument 2 = ${valid2.length}`);
    let plumeDist = [];
    let plumeH = [];

    const frames = [];
    for (const iValid1 of valid1) {
        for (const iValid2 of valid2) {
            let valDiff = Math.abs(
                data[0][indexValid[0][iValid1]].indScansTimeValid[0] -
                data[1][indexValid[1][iValid2]].indScansTimeValid[0]
            );
            console.log(`Pair (${iValid1}, ${iValid2}): time diff = ${valDiff/1000}s, limit = ${timeDifference/1000}s`);
            if (valDiff <= timeDifference) {
                k++;
                try {
                let alpha1 = data[0][indexValid[0][iValid1]].indScansAng.slice(1, -1); // scan angles St. 1
                let alpha2 = data[1][indexValid[1][iValid2]].indScansAng.slice(1, -1);
                let S1 = data[0][indexValid[0][iValid1]].indScansSO2Valid.slice(1, -1); // columns St. 1
                let S2 = data[1][indexValid[1][iValid2]].indScansSO2Valid.slice(1, -1);
                let plumeCentre1 = data[0][indexValid[0][iValid1]].scansBaricenter; // centre of mass St. 1
                let plumeCentre2 = data[1][indexValid[1][iValid2]].scansBaricenter;

                let ax = (tand(Math.abs(plumeCentre2))/tand(Math.abs(plumeCentre1)))*tand(Math.abs(angleV));
                let bx = (tand(Math.abs(plumeCentre2))/tand(Math.abs(plumeCentre1)))*VS1 + deltaH21*tand(Math.abs(plumeCentre2))*tand(Math.abs(angleV)) + VS2;
                let cx = deltaH21*tand(Math.abs(plumeCentre2))*VS1 - VS2*VS1*tand(Math.abs(angleV));

                let S1P = (-bx + Math.sqrt(bx**2-4*ax*cx))/(2*ax);

                let S2P = VS2*tand(Math.abs(angleV-atand(S1P/VS1)));
                let angleV1 = atand(Math.abs(S1P/VS1));
                let angleV2 = atand(Math.abs(S2P/VS2));
                let L1 = S12 - VS2*sind(Math.abs(angleV-angleV1))/sind(Math.abs(180-angleS1-angleV1)); // horizontal distance to plume over inter-station line
                let L2 = S12 - L1;
                plumeDist[k] = VS1/cosd(angleV1); // plume length från source until intersection
                plumeDist[k] = VS2/cosd(angleV2);

                let alphaB1 = alpha1.map(v=>atand((L1/S1P) * tand(v)));
                let alphaB2 = alpha2.map(v=>atand((L2/S2P) * tand(v)));

                let SB10 = S1.map((s, i) => s * (
                    cosd(alpha1[i]) / cosd(alphaB1[i])
                ));
                let SB20 = S2.map((s, i) => s * (
                    cosd(alpha2[i]) / cosd(alphaB2[i])
                ));
                let SB1 = SB10.map(s => s*(sum(S1)/sum(SB10)));
                let SB2 = SB20.map(s => s*(sum(S2)/sum(SB20)));

                /*
                let plumeC1 = nansum(SB1.map((s, i) => s*alphaB1[i]))/nansum(SB1);
                let plumeC2 = nansum(SB2.map((s, i) => s*alphaB2[i]))/nansum(SB2);

                let plumeH = (
                    L1/tand(Math.abs(plumeC1)) +
                    L2/tand(Math.abs(plumeC2)) + deltaH21
                )/2;
                let plumeD = Math.abs(Math.abs(compass1)-Math.abs(angleV1));
                */

                let plumeC1 = sum(SB1.map((value, index) => value * alphaB1[index])) / sum(SB1);
                let plumeC2 = sum(SB2.map((value, index) => value * alphaB2[index])) / sum(SB2);

                plumeH[k] = mean([
                    L1 / tand(Math.abs(plumeC1)),
                    L2 / tand(Math.abs(plumeC2)) + deltaH21
                ]);

                // Find valueMax1, posMax1, posWidth1, wLeft1, valueLeft1, wRight1, valueRight1
                let [valueMax1, posMax1] = findMaxAndPosition(S1);
                let posWidth1 = find(S1.map(s=>s/valueMax1), v=>v<Math.exp(-1));
                let wLeft1 = Math.max(...find(posWidth1, v=>v<posMax1));
                let valueLeft1 = posWidth1[wLeft1];
                let wRight1 = Math.min(...find(posWidth1, v=>v>posMax1));
                let valueRight1 = posWidth1[wRight1];

                // Find valueMax2, posMax2, posWidth2, wLeft2, valueLeft2, wRight2, valueRight2
                let [valueMax2, posMax2] = findMaxAndPosition(S2);
                let posWidth2 = find(S2.map(s=>s/valueMax2), v=>v<Math.exp(-1));
                let wLeft2 = Math.max(...find(posWidth2, v=>v<posMax2));
                let valueLeft2 = posWidth2[wLeft2];
                let wRight2 = Math.min(...find(posWidth2, v=>v>posMax2));
                let valueRight2 = posWidth2[wRight2];

                const lim1 = Math.max(...SB1)/Math.exp(1);
                let ind1 = find(SB1, s=>s>lim1);
                const lim2 = Math.max(...SB2)/Math.exp(1);
                let ind2 = find(SB2, s=>s>lim2);

                // Tomographic inversion: C = L·D  (column tot concentrations = matrix × concentrations)
                // Grid: n1 rows (station-1 beams) × n2 cols (station-2 beams), cell(m,n) = index m*n2+n
                const n1 = ind1.length - 1;
                const n2 = ind2.length - 1;
                console.log(`Grid size: n1=${n1}, n2=${n2}`);
                if (n1 < 1 || n2 < 1) {
                    console.warn(`Skipping pair: grid too small (n1=${n1}, n2=${n2})`);
                    continue;
                }

                // Collect measurement vectors for each station
                const rhs = new Float64Array(n1 + n2);
                for (let m = 0; m < n1; m++) rhs[m]      = 0.5 * (S1[ind1[m]] + S1[ind1[m+1]]);
                for (let n = 0; n < n2; n++) rhs[n1+n]   = 0.5 * (S2[ind2[n]] + S2[ind2[n+1]]);

                // Outer-product reconstruction: concentration[m,n] = b1[m] × b2[n]
                // A cell is high only where BOTH crossing beams are strong — the true
                // intersection principle. Gives 7.4× dynamic range vs 2.7× for the
                // MATLAB additive backprojection, producing a Gaussian plume shape.
                const b1 = rhs.slice(0, n1);
                const b2 = rhs.slice(n1, n1 + n2);
                const Concentration = new Array(n1 * n2);
                for (let m = 0; m < n1; m++) {
                    for (let n = 0; n < n2; n++) {
                        Concentration[m * n2 + n] = b1[m] * b2[n];
                    }
                }
                console.log(`Outer product done for pair (${iValid1}, ${iValid2}), grid ${n1}×${n2}`);


                console.log(`Pair (${iValid1}, ${iValid2}) done, ${Concentration.length} cells`);

                // Calculate the position of each concentration point in the X-Y grid
                let meanAlpha1 = new Array(ind1.length - 1).fill(0);
                let meanAlpha2 = new Array(ind2.length - 1).fill(0);
                let PosX = new Array(meanAlpha1.length * meanAlpha2.length).fill(0);
                let PosY = new Array(meanAlpha1.length * meanAlpha2.length).fill(0);

                for (let m = 0; m < ind1.length - 1; m++) {
                    for (let n = 0; n < ind2.length - 1; n++) {
                        meanAlpha1[m] = (alphaB1[ind1[m]] + alphaB1[ind1[m + 1]]) / 2;
                        meanAlpha2[n] = (alphaB2[ind2[n]] + alphaB2[ind2[n + 1]]) / 2;
                    }
                }

                let r = 0;
                const EPS = 1e-6;
                for (let m = 0; m < ind1.length - 1; m++) {
                    for (let n = 0; n < ind2.length - 1; n++) {
                        const ta1 = tand(Math.abs(meanAlpha1[m]));
                        const ta2 = tand(Math.abs(meanAlpha2[n]));
                        if (ta1 > EPS && ta2 > EPS) {
                            PosX[r] = (S12 + deltaH21 * ta2) / (1 + ta2 / ta1);
                            PosY[r] = PosX[r] / ta1;
                        } else if (ta1 <= EPS && ta2 > EPS) {
                            // St1 beam nearly vertical: cell is at St1's horizontal position
                            PosX[r] = 0;
                            PosY[r] = deltaH21 + S12 / ta2;
                        } else if (ta2 <= EPS && ta1 > EPS) {
                            // St2 beam nearly vertical: cell is at St2's horizontal position
                            PosX[r] = S12;
                            PosY[r] = S12 / ta1;
                        } else {
                            // Both beams nearly vertical — place at St1 at station altitude
                            PosX[r] = 0;
                            PosY[r] = 0;
                        }
                        r++;
                    }
                }

                const altPs = PosY.map(y => altS1 + y);
                console.log(`Pair altP range: ${Math.min(...altPs).toFixed(0)}m – ${Math.max(...altPs).toFixed(0)}m ASL  |  L1=${L1.toFixed(0)}m  S1P=${S1P.toFixed(0)}m  ratio=${(L1/S1P).toFixed(3)}`);

                // plume parameters
                let meanPosX = sum(PosX.map((x, i) => x * Concentration[i])) / sum(Concentration);
                let meanPosY = sum(PosY.map((y, i) => y * Concentration[i])) / sum(Concentration);
                let lonMeanPutm = lonS1utm + (meanPosX / S12) * (lonS2utm - lonS1utm);
                let latMeanPutm = latS1utm + (meanPosX / S12) * (latS2utm - latS1utm);
                let plumeDirection = atan2d(lonMeanPutm - lonVolutm, latMeanPutm - latVolutm);
                let plumeWidth1 = plumeH * Math.abs(tand(alpha1[valueRight1]) - tand(alpha1[valueLeft1])) * cosd(Math.abs(plumeDirection - compass1));
                let plumeWidth2 = (plumeH - deltaH21) * Math.abs(tand(alpha2[valueRight2]) - tand(alpha2[valueLeft2])) * cosd(plumeDirection - compass1);
                let lonPutm = PosX.map(x => lonS1utm + (x / S12) * (lonS2utm - lonS1utm));
                let latPutm = PosX.map(x => latS1utm + (x / S12) * (latS2utm - latS1utm));
                //let [lat, lon] = PosY.map((y, i) => utm2deg(latPutm[i], lonPutm[i], utmzone));
                // Cap PosY: near-vertical beams produce absurd altitudes.
                // Volcanic plumes are typically 1–5 km above the instrument altitude.
                const maxPosY = 5000;
                let altP = PosY.map(y => altS1 + Math.min(y, maxPosY));
                let date1 = data[0][indexValid[0][iValid1]].indScansTimeValid[0];
                let date2 = data[1][indexValid[1][iValid2]].indScansTimeValid[0];
                let plumeTime = new Date((date1.getTime() + date2.getTime())/2);

                const points = Concentration.map((c,i)=>({
                    lonPutm: lonPutm[i],
                    latPutm: latPutm[i],
                    altP: altP[i],
                    Concentration: c
                }));

                frames.push({
                    points: points,
                    size1: ind1.length-1,
                    size2: ind2.length-1,
                    date1: date1,
                    date2: date2,
                    time: plumeTime
                });
                } catch (e) {
                    console.error(`Failed to process pair (${iValid1}, ${iValid2}):`, e);
                }
            }
        }
    }

    return frames;
}


// Helper functions

function trigd(f, x) {
    return f(x * Math.PI/180);
}

function tand(x) {
    return trigd(Math.tan, x);
}

function sind(x) {
    return trigd(Math.sin, x);
}

function cosd(x) {
    return trigd(Math.cos, x);
}

function atrigd(f, x) {
    return f(x) * 180 / Math.PI
}

function acosd(x) {
    return atrigd(Math.acos, x);
}

function atand(x) {
    return atrigd(Math.atan, x);
}

function atan2d(x, y) {
    return Math.atan2(x, y) * 180 / Math.PI;
}

function sum(array) {
    return array.reduce((a, b) => a + b, 0);
}

function mean(array) {
    return sum(array)/array.length;
}

function diff(array) {
    let result = [];
    for (let i = 1; i < array.length; i++) {
      result.push(array[i] - array[i - 1]);
    }
    return result;
}

/**
 *
 * @param {*} array
 * @param {*} condition
 * @returns
 */
function find(array, condition) {
    const found = [];
    for (let i=0, l=array.length; i<l; i++) {
        if (condition(array[i])) {
            found.push(i);
        }
    }
    return found;
}

function findMaxAndPosition(arr) {
    let maxValue = Math.max(...arr);
    let maxIndex = arr.indexOf(maxValue);
    return [maxValue, maxIndex];
}

export {tomoInverse}