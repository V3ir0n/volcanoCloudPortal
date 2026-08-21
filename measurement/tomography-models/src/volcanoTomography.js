import { locateVolcano } from "./locateVolcano.js";
import { volcanoList } from "./volcanoList.js";

class VolcanoTomography {
  constructor(parameters = {}) {
    this.completenessLimit = parameters.completenessLimit || 0.9;
    this.baricenterLimit = parameters.baricenterLimit || 60;
    this.timeDifferenceMin = parameters.timeDifferenceMin || 300;
    this.timeDifference = this.timeDifferenceMin / (24 * 60);
    this.numberOffset = parameters.numberOffset || 5;
    this.volcanoList = parameters.volcanoList || {};
    this.plots = parameters.plots || 0;
    // MLEM iteration count. More iterations → tighter data fit (ratios closer to 1)
    // but may amplify noise in sparse regions. 50 is a good starting point.
    this.mlemIterations = parameters.mlemIterations ?? 50;
  }
  // ==========================================================================
  // DATA HANDLING

  /**
   * Parse EvaluationLog format from text file
   */
  parseEvaluationLog(fileContent) {
    const scans = [];
    
    // Extract scan information blocks
    const scanPattern = /<scaninformation>[\s\S]*?<\/spectraldata>/g; //regex to match each scan block with spectral data
    const scanMatches = fileContent.match(scanPattern) || [];

    scanMatches.forEach(scanBlock => {
      try {
        const scan = this.extractScanData(scanBlock);
        if (scan) scans.push(scan);
      } catch (e) {
        console.warn('Error parsing scan block:', e);
      }
    });

    return scans;
  }

  /**
   * Extract individual scan parameters from XML-like block
   */
  extractScanData(block) {
    const extract = (pattern) => {
      const match = block.match(new RegExp(pattern + '="([^"]*)"'));
      return match ? match[1] : null;
    };

    const extractNum = (pattern) => {
      const val = extract(pattern);
      return val ? parseFloat(val) : NaN;
    };

    return {
      date: extract('date'),
      startTime: extract('starttime'),
      compass: extractNum('compass'),
      tilt: extractNum('tilt'),
      latitude: extractNum('latitude'),
      longitude: extractNum('longitude'),
      altitude: extractNum('altitude'),
      volcano: extract('volcano'),
      site: extract('site'),
      observatory: extract('observatory'),
      serial: extract('serial'),
      spectrometer: extract('spectrometer'),
      channel: extractNum('channel'),
      coneAngle: extractNum('coneangle'),
      interlaceSteps: extractNum('interlace'),
      startChannel: extractNum('startchannel'),
      spectrumLength: extractNum('spectrumlength'),
      flux: extractNum('flux'),
      windSpeed: extractNum('windspeed'),
      windDir: extractNum('winddir'),
      plumeHeight: extract('plumeheight'),
      plumeCompleteness: extractNum('plumecompleteness'),
      plumeCentre: extractNum('plumecentre'),
      plumeEdge1: extractNum('plumeedge1'),
      plumeEdge2: extractNum('plumeedge2'),
      spectralData: this.extractSpectralData(block)
    };
  }

  /**
   * Extract spectral scan data (angles and SO2 columns)
   */
  extractSpectralData(block) {
    const dataStart = block.indexOf('<spectraldata>');
    const dataEnd = block.indexOf('</spectraldata>');
    
    if (dataStart === -1 || dataEnd === -1) return null;

    const dataStr = block.substring(dataStart + 14, dataEnd);
    const lines = dataStr.trim().split('\n');
    
    const data = {
      angles: [],
      so2Columns: [],
      so2Errors: [],
      flags: []
    };

    lines.forEach(line => {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 12) {
        data.angles.push(parseFloat(parts[0])); //add angle value to the angles array
        data.so2Columns.push(parseFloat(parts[11])); // Column SO2
        data.so2Errors.push(parseFloat(parts[12]));  // Error
        data.flags.push(parseInt(parts[29]) || 0);   // Flag
      }
    });

    return data;
  }

  /**
   * Convert degrees to UTM coordinates
   */
  deg2utm(lat, lon) {
    const k0 = 0.9996;
    const a = 6378137.0;
    const e2 = 0.00669438;
    const e_prime2 = e2 / (1 - e2);

    const zone = Math.floor((lon + 180) / 6) + 1;
    const lon0 = (zone - 1) * 6 - 180 + 3;
    const lon0Rad = this.toRad(lon0);

    const latRad = this.toRad(lat);
    const lonRad = this.toRad(lon);
    
    const n = a / Math.sqrt(1 - e2 * Math.sin(latRad) ** 2);
    const t = Math.tan(latRad) ** 2;
    const c = e_prime2 * Math.cos(latRad) ** 2;
    const a_val = Math.cos(latRad) * (lonRad - lon0Rad);

    const m = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64) * latRad -
              (3 * e2 / 8 + 3 * e2 ** 2 / 32) * Math.sin(2 * latRad) +
              (15 * e2 ** 2 / 256) * Math.sin(4 * latRad));

    const easting = k0 * n * (a_val + (a_val ** 3 / 6) * (1 - t + c) +
                  (a_val ** 5 / 120) * (1 - 5 * t + 9 * c + 4 * c ** 2)) + 500000;
    
    const northing = k0 * (m + n * Math.tan(latRad) *
                   ((a_val ** 2 / 2) + (a_val ** 4 / 24) * (5 - t + 9 * c + 4 * c ** 2) +
                   (a_val ** 6 / 720) * (61 - 58 * t + t ** 2 + 600 * c - 330 * e_prime2))) + 10000000;

    return { easting, northing, zone };
  }

  /**
   * Convert UTM to degrees
   */
  utm2deg(northing, easting, zone) {
    const k0 = 0.9996;
    const a = 6378137.0;
    const e2 = 0.00669438;
    const e_prime2 = e2 / (1 - e2);

    const x = easting - 500000;
    const y = northing - 10000000;

    const m = y / k0;
    const mu = m / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 + 5 * e2 ** 3 / 256));
    
    const footpointLat = mu + (3 * e2 / 8) * Math.sin(2 * mu) +
                         (3 * e2 ** 2 / 32) * Math.sin(4 * mu);

    const c1 = e_prime2 * Math.cos(footpointLat) ** 2;
    const t1 = Math.tan(footpointLat) ** 2;
    const n1 = a / Math.sqrt(1 - e2 * Math.sin(footpointLat) ** 2);
    const r1 = a * (1 - e2) / Math.sqrt((1 - e2 * Math.sin(footpointLat) ** 2) ** 3);
    const d = x / (n1 * k0);

    const lat = footpointLat - (n1 * Math.tan(footpointLat) / r1) *
                (d ** 2 / 2 - (d ** 4 / 24) * (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * e_prime2) +
                (d ** 6 / 720) * (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * e_prime2 - 3 * c1 ** 2));

    const lon0Rad = this.toRad((zone - 1) * 6 - 180 + 3);
    const lon = lon0Rad + (d - (d ** 3 / 6) * (1 + 2 * t1 + c1) +
                (d ** 5 / 120) * (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * e_prime2 + 24 * t1 ** 2)) /
                Math.cos(footpointLat);

    return { lat: this.toDeg(lat), lon: this.toDeg(lon) };
  }

  //======================================================================================
  // PREPARE VARIABLES & CALL TOMOGRAPHY (Algorithm further down)
  /**
   * Process two station files and return tomography results
   */
  processTwoStations(txt1, txt2) {
    // Parse both files
    const station1Data = this.parseEvaluationLog(txt1);
    const station2Data = this.parseEvaluationLog(txt2);

    if (station1Data.length === 0 || station2Data.length === 0) {
      throw new Error('No valid scan data found in input files');
    }

    // Extract common parameters from first scan
    const s1 = station1Data[0];
    const s2 = station2Data[0];

    // Station parameters
    const latS1 = s1.latitude;
    const lonS1 = s1.longitude;
    const altS1 = s1.altitude;
    
    const latS2 = s2.latitude;
    const lonS2 = s2.longitude;
    const altS2 = s2.altitude;

    // Convert to UTM
    const utm1 = this.deg2utm(latS1, lonS1);
    const utm2 = this.deg2utm(latS2, lonS2);
    const volName = s1.volcano ? s1.volcano.toLowerCase() : null; // volcano name from station 1 (if available)
    let volEntry = volName ? volcanoList.find(v => v.volcano === volName) : null;
    if (!volEntry) {
      // Proximity fallback: closest by lat from s1, lon from s2 (mirrors locateVolcano.js)
      const iLat = volcanoList.reduce((best, v, i) => Math.abs(latS1 - v.lat) < Math.abs(latS1 - volcanoList[best].lat) ? i : best, 0);
      const iLon = volcanoList.reduce((best, v, i) => Math.abs(lonS2 - v.lon) < Math.abs(lonS2 - volcanoList[best].lon) ? i : best, 0);
      volEntry = volcanoList[iLat === iLon ? iLat : iLat];
    }
    const latVol = volEntry.lat;
    const lonVol = volEntry.lon;
    const utmVol = this.deg2utm(latVol, lonVol);

    const DX1 = utm1.easting - utmVol.easting;
    const DY1 = utm1.northing - utmVol.northing;
    const DX2 = utm2.easting - utmVol.easting;
    const DY2 = utm2.northing - utmVol.northing;

    const beta1 = s1.coneAngle;   // scan cone  for station 1
    const beta2 = s2.coneAngle;   // scan cone for station 2
    const deltaH21 = altS2 - altS1; // altitude difference between stations


    const S12 = Math.sqrt((DX1-DX2)**2 + (DY1-DY2)**2); // distance between the two stations

    // Filter valid scans
    const validScans1 = this.filterValidScans(station1Data);
    const validScans2 = this.filterValidScans(station2Data);

    // Pair scans by time and perform tomography
    const results = [];
    const csvLines = [];

    for (const scan1 of validScans1) {
      for (const scan2 of validScans2) {
        const timeDiff = Math.abs(this.parseTime(scan1.date + ' ' + scan1.startTime) - 
                                   this.parseTime(scan2.date + ' ' + scan2.startTime));
        
        if (timeDiff <= this.timeDifference) {
          try {
            const tomo = this.performTomography(
              scan1, scan2, 
              DX1, DY1, DX2, DY2, deltaH21, S12, 
              beta1, beta2, altS1, latVol, lonVol, utmVol, utm1, utm2
            );
            
            if (tomo && tomo.concentration) {
              results.push(tomo);
              
              // Add to CSV
              csvLines.push(`${tomo.gridDims[0]},${tomo.gridDims[1]}`);
              for (let i = 0; i < tomo.lon.length; i++) {
                csvLines.push(`${tomo.lon[i].toFixed(6)},${tomo.lat[i].toFixed(6)},${tomo.alt[i].toFixed(1)},${tomo.concentration[i].toFixed(6)}`);
              }
            }
          } catch (e) {
            console.warn('Error in tomography:', e);
          }
        }
      }
    }

    return csvLines.join('\n');
  }

  /**
   * Filter scans by quality criteria
   */
  filterValidScans(scans) {
    return scans.filter(scan => {
      if (!scan.spectralData) return false;
      
      const completeness = scan.plumeCompleteness || 0;
      const baricenter = scan.plumeCentre || 0;
      const maxColumn = Math.max(...(scan.spectralData.so2Columns || []));
      
      return completeness > this.completenessLimit &&
             Math.abs(baricenter) < this.baricenterLimit &&
             maxColumn > 0;
    });
  }
//======================================================================================
  /**
   * Main tomography reconstruction algorithm
   */
  performTomography(scan1, scan2, DX1, DY1, DX2, DY2, deltaH21, S12, 
                    beta1, beta2, altS1, latVol, lonVol, utmVol, utm1, utm2) {
    
    const spec1 = scan1.spectralData;
    const spec2 = scan2.spectralData;
    
    if (!spec1 || !spec2) return null;

    // Get scan angles and so2 columns (excluding edges and offset)
    const alpha1Full = spec1.angles;
    const alpha2Full = spec2.angles;
    const S1Full = spec1.so2Columns;
    const S2Full = spec2.so2Columns;

    // Find 180° reference point and filter data
    const ref1Idx = alpha1Full.findIndex(
    a => Math.abs(a - 180) < 0.1 );
    const ref2Idx = alpha2Full.findIndex(
    a => Math.abs(a - 180) < 0.1 );

    if (ref1Idx < 0 || ref2Idx < 0) return null;

    const alpha1 = alpha1Full.slice(ref1Idx + 1, -1);
    const alpha2 = alpha2Full.slice(ref2Idx + 1, -1);
    const S1Raw = S1Full.slice(ref1Idx + 1, -1);
    const S2Raw = S2Full.slice(ref2Idx + 1, -1);

    // Calculate per-station background offset (mean of 5 smallest values)
    const sorted1 = [...S1Raw].sort((a, b) => a - b);
    const offset1 = sorted1.slice(0, this.numberOffset).reduce((a, b) => a + b, 0) / this.numberOffset;
    const sorted2 = [...S2Raw].sort((a, b) => a - b);
    const offset2 = sorted2.slice(0, this.numberOffset).reduce((a, b) => a + b, 0) / this.numberOffset;

    // Project SCD onto a flat vertical plane
    const S1 = S1Raw.map(s => (s - offset1) * Math.sin(this.toRad(beta1)));
    const S2 = S2Raw.map(s => (s - offset2) * Math.sin(this.toRad(beta2)));

    // Trig helpers (degrees in/out)
    const tand = x => Math.tan(this.toRad(x));
    const sind = x => Math.sin(this.toRad(x));
    const cosd = x => Math.cos(this.toRad(x));
    const atand = x => this.toDeg(Math.atan(x));

    // Triangle geometry between stations
    const VS1 = Math.sqrt(DX1 ** 2 + DY1 ** 2);
    const VS2 = Math.sqrt(DX2 ** 2 + DY2 ** 2);
    const angleV  = this.toDeg(Math.acos(Math.min(1, Math.max(-1, (VS1**2 + VS2**2 - S12**2) / (2*VS1*VS2)))));
    const angleS1 = this.toDeg(Math.acos(Math.min(1, Math.max(-1, (VS1**2 + S12**2 - VS2**2) / (2*VS1*S12)))));

    // Estimate plume centre position (where so2 peaks) from barycenter angles
    const pc1 = scan1.plumeCentre ?? 0;
    const pc2 = scan2.plumeCentre ?? 0;

    // Solve for S1P: horizontal perpendicular distance from the V→S1 axis to the plume centre.
    // Both stations must triangulate to the same 3D plume altitude:
    //   h = S1P / tan(pc1)            (from S1)
    //   h = deltaH21 + S2P / tan(pc2) (from S2, corrected for altitude difference)
    // Substituting S2P = VS2·tan(angleV − angleV1) with tan(angleV1) = S1P/VS1
    // and applying the tan-subtraction formula gives the quadratic ax·S1P² + bx·S1P + cx = 0.
    const ax = (tand(Math.abs(pc2)) / tand(Math.abs(pc1))) * tand(Math.abs(angleV));
    const bx = (tand(Math.abs(pc2)) / tand(Math.abs(pc1))) * VS1
             + deltaH21 * tand(Math.abs(pc2)) * tand(Math.abs(angleV)) + VS2;
    const cx = deltaH21 * tand(Math.abs(pc2)) * VS1 - VS2 * VS1 * tand(Math.abs(angleV));

    const disc = bx ** 2 - 4 * ax * cx;
    if (disc < 0) return null;
    const S1P = (-bx + Math.sqrt(disc)) / (2 * ax);

    const angleV1 = atand(Math.abs(S1P / VS1));
    const S2P     = VS2 * tand(Math.abs(angleV - angleV1));
    const L1 = S12 - VS2 * sind(Math.abs(angleV - angleV1)) / sind(Math.abs(180 - angleS1 - angleV1));
    const L2 = S12 - L1;

    // Adjust the angular grid so the two stations share a common coordinate frame along the S1→S2 baseline.
    const alphaB1 = alpha1.map(v => atand((L1 / S1P) * tand(v)));
    const alphaB2 = alpha2.map(v => atand((L2 / S2P) * tand(v)));

    // Rescale SO2 columns conserving total flux
    const SB10 = S1.map((s, i) => s * (cosd(alpha1[i]) / cosd(alphaB1[i])));
    const SB20 = S2.map((s, i) => s * (cosd(alpha2[i]) / cosd(alphaB2[i])));
    const sumS1  = S1.reduce((a, b) => a + b, 0);
    const sumS2  = S2.reduce((a, b) => a + b, 0);
    const sumSB10 = SB10.reduce((a, b) => a + b, 0);
    const sumSB20 = SB20.reduce((a, b) => a + b, 0);
    const SB1 = SB10.map(s => s * (sumS1 / sumSB10));
    const SB2 = SB20.map(s => s * (sumS2 / sumSB20));

    // Threshold indices from corrected columns
    const maxSB1 = Math.max(...SB1); //peak SCD in station 1's scan
    const maxSB2 = Math.max(...SB2);
    const threshold = 1 / Math.E; // cut off for low signal

    const ind1 = SB1
      .map((s, i) => ({ val: s, idx: i }))       // attach each SCD value to its angle index
      .filter(x => x.val > maxSB1 * threshold)   // keep only angles above 1/e of the peak
      .map(x => x.idx);  

    const ind2 = SB2
      .map((s, i) => ({ val: s, idx: i }))
      .filter(x => x.val > maxSB2 * threshold)
      .map(x => x.idx);

    if (ind1.length < 2 || ind2.length < 2) return null;

    const nRows1 = ind1.length - 1; // 4 selected angles → 3 bands
    const nRows2 = ind2.length - 1;

    // Measured SCD per band in the baseline-projected frame (ppm·m).
    // Must use SB1/SB2 — same coordinate frame as the path lengths in computeExactPathLengths.
    const b1 = new Array(nRows1);
    for (let m = 0; m < nRows1; m++) b1[m] = 0.5 * (SB1[ind1[m]] + SB1[ind1[m + 1]]);
    const b2 = new Array(nRows2);
    for (let n = 0; n < nRows2; n++) b2[n] = 0.5 * (SB2[ind2[n]] + SB2[ind2[n + 1]]);

    // Exact path lengths — named pL1/pL2 to avoid collision with the
    // baseline-projection scalars L1/L2 defined above (lines 367-368).
    const { L1: pL1, L2: pL2 } = this.computeExactPathLengths(
      nRows1, nRows2, ind1, ind2, alphaB1, alphaB2, S12, deltaH21
    );

    // Solve A·x = b_meas with Tikhonov regularization.
    // Row m (0…nRows1-1): station 1 ray m — Σ_n c[m,n]·L1[m,n] = b1[m]
    // Row nRows1+n:        station 2 ray n — Σ_m c[m,n]·L2[m,n] = b2[n]
    const nCells = nRows1 * nRows2;
    const A = Array.from({ length: nRows1 + nRows2 }, () => new Array(nCells).fill(0));
    const bVec = new Array(nRows1 + nRows2);

    for (let m = 0; m < nRows1; m++) {
      bVec[m] = b1[m];
      for (let n = 0; n < nRows2; n++) A[m][m * nRows2 + n] = pL1[m * nRows2 + n];
    }
    for (let n = 0; n < nRows2; n++) {
      bVec[nRows1 + n] = b2[n];
      for (let m = 0; m < nRows1; m++) A[nRows1 + n][m * nRows2 + n] = pL2[m * nRows2 + n];
    }

    debugger; // inspect A, bVec, pL1, pL2, b1, b2, nRows1, nRows2 here
    const concentration = this.solveMlem(A, bVec);

    // Calculate positions using corrected angles
    const positions = this.calculatePositions(
      concentration, nRows1, nRows2, ind1, ind2, alphaB1, alphaB2,
      S12, deltaH21, latVol, lonVol, altS1, utm1, utm2, utmVol
    );

    const validation = this.validateReconstruction(concentration, nRows1, nRows2, b1, b2, pL1, pL2);

    return {
      concentration,
      lon:      positions.lon,
      lat:      positions.lat,
      alt:      positions.alt,
      gridDims: [nRows1, nRows2],
      validation
    };
  }

  /**
   * Exact path lengths (m) through each grid cell from each station's centre ray.
   *
   * Coordinate frame: station 1 at origin, station 2 at (S12, deltaH21).
   * X = along baseline, Y = altitude.  A ray from station 1 at angle α₁
   * satisfies X = Y·tan(α₁); a ray from station 2 satisfies
   * (S12−X) = (Y−deltaH21)·tan(α₂).
   *
   * Cell (m,n) is bounded by station 1's rays [α1lo, α1hi] and station 2's
   * rays [α2lo, α2hi].  The intersection altitude of two rays (ta1, ta2) is
   *   Y = (S12 + deltaH21·ta2) / (ta1 + ta2)
   *
   * For the centre ray of station 1 at ta1, the entry/exit altitudes into
   * cell (m,n) are found at ta2lo and ta2hi:
   *   L1 = |Yexit − Yenter| · √(1 + ta1²)
   * and symmetrically for station 2.
   */
  computeExactPathLengths(nRows1, nRows2, ind1, ind2, alphaB1, alphaB2, S12, deltaH21) {
    const L1  = new Array(nRows1 * nRows2);
    const L2  = new Array(nRows1 * nRows2);
    const EPS = 1e-9;

    for (let m = 0; m < nRows1; m++) {
      const ta1 = Math.abs(Math.tan(this.toRad(
        (alphaB1[ind1[m]] + alphaB1[ind1[m + 1]]) / 2
      )));

      for (let n = 0; n < nRows2; n++) {
        const ta2lo = Math.abs(Math.tan(this.toRad(alphaB2[ind2[n]])));
        const ta2hi = Math.abs(Math.tan(this.toRad(alphaB2[ind2[n + 1]])));

        // Station 1 centre ray enters cell at ta2lo boundary, exits at ta2hi
        const Ylo1 = ta1 + ta2lo > EPS ? (S12 + deltaH21 * ta2lo) / (ta1 + ta2lo) : 0;
        const Yhi1 = ta1 + ta2hi > EPS ? (S12 + deltaH21 * ta2hi) / (ta1 + ta2hi) : 0;
        L1[m * nRows2 + n] = Math.abs(Yhi1 - Ylo1) * Math.sqrt(1 + ta1 * ta1);

        // Station 2 centre ray — bounded by station 1's rays [ta1lo, ta1hi]
        const ta2  = Math.abs(Math.tan(this.toRad(
          (alphaB2[ind2[n]] + alphaB2[ind2[n + 1]]) / 2
        )));
        const ta1lo = Math.abs(Math.tan(this.toRad(alphaB1[ind1[m]])));
        const ta1hi = Math.abs(Math.tan(this.toRad(alphaB1[ind1[m + 1]])));
        const K    = S12 + deltaH21 * ta2;
        const Ylo2 = ta1lo + ta2 > EPS ? K / (ta1lo + ta2) : 0;
        const Yhi2 = ta1hi + ta2 > EPS ? K / (ta1hi + ta2) : 0;
        L2[m * nRows2 + n] = Math.abs(Yhi2 - Ylo2) * Math.sqrt(1 + ta2 * ta2);
      }
    }

    return { L1, L2 };
  }
  //=============================================================================================
  //COMPARISON
  /**
   * Forward-project the reconstructed concentration back to SCDs and compare
   * with the original measurements.
   * forward1[m] = Σ_n concentration[m,n] * L1[m,n]  should equal b1[m]
   * forward2[n] = Σ_m concentration[m,n] * L2[m,n]  should equal b2[n]
   * ratio ≈ 1 means the reconstruction is self-consistent.
   */
  validateReconstruction(concentration, nRows1, nRows2, b1, b2, L1, L2) {
    const forward1 = new Array(nRows1).fill(0);
    const forward2 = new Array(nRows2).fill(0);
    const totL1    = new Array(nRows1).fill(0);
    const totL2    = new Array(nRows2).fill(0);

    for (let m = 0; m < nRows1; m++) {
      for (let n = 0; n < nRows2; n++) {
        forward1[m] += concentration[m * nRows2 + n] * L1[m * nRows2 + n];
        forward2[n] += concentration[m * nRows2 + n] * L2[m * nRows2 + n];
        totL1[m]    += L1[m * nRows2 + n];
        totL2[n]    += L2[m * nRows2 + n];
      }
    }

    const ratio1    = b1.map((s, m) => Math.abs(s) > 1e-10 ? forward1[m] / s : NaN);
    const ratio2    = b2.map((s, n) => Math.abs(s) > 1e-10 ? forward2[n] / s : NaN);
    const avgConc1  = forward1.map((f, m) => totL1[m] > 0 ? f / totL1[m] : 0);
    const avgConc2  = forward2.map((f, n) => totL2[n] > 0 ? f / totL2[n] : 0);

    return { forward1, forward2, ratio1, ratio2, b1: [...b1], b2: [...b2],
             totL1, totL2, avgConc1, avgConc2 };
  }
  //========================================================================================================
// TOMOGRAPHY ALGORITHM
  /**
   * MLEM (Maximum Likelihood Expectation Maximization) for emission tomography.
   *
   * Linear inversion (Tikhonov / least-squares) requires a non-negativity clamp
   * after solving.  That clamp breaks the data constraint (Ax = b), which is why
   * ratios blow up.  MLEM avoids this entirely: the multiplicative update keeps
   * all values strictly positive by construction, and at convergence Ax[i] = b[i]
   * exactly, so ratios → 1.
   *
   * Update rule:  x[j] ← x[j] / s[j]  ×  Σᵢ A[i][j] · b[i] / (Ax)[i]
   * where s[j] = Σᵢ A[i][j]  (sensitivity: total path through cell j).
   * At the fixed point every ratio b[i]/(Ax)[i] = 1, so the correction is 1.
   *
   * mlemIterations controls how tightly the measurements are fitted.
   * More iterations → ratios closer to 1 but may amplify noise in sparse cells.
   */
  solveMlem(A, b) {
    const nMeas  = A.length;
    const nCells = A[0].length;
    const nIter  = this.mlemIterations;

    // Sensitivity: s[j] = Σᵢ A[i][j]
    const s = new Array(nCells).fill(0);
    for (let i = 0; i < nMeas; i++)
      for (let k = 0; k < nCells; k++)
        s[k] += A[i][k];

    // Uniform initialisation: mean(b)/mean(s) so the first forward projection ≈ b
    const meanB = b.reduce((a, v) => a + v, 0) / nMeas;
    const meanS = s.reduce((a, v) => a + v, 0) / nCells;
    const x = new Array(nCells).fill(meanS > 0 ? meanB / meanS : 1e-9);

    for (let iter = 0; iter < nIter; iter++) {
      // Forward projection: (Ax)[i] = Σ_k A[i][k] · x[k]
      const Ax = new Array(nMeas).fill(0);
      for (let i = 0; i < nMeas; i++)
        for (let k = 0; k < nCells; k++)
          Ax[i] += A[i][k] * x[k];

      // Back-project the ratio b / Ax
      const bp = new Array(nCells).fill(0);
      for (let i = 0; i < nMeas; i++) {
        if (Ax[i] < 1e-30) continue;
        const r = b[i] / Ax[i];
        for (let k = 0; k < nCells; k++)
          bp[k] += A[i][k] * r;
      }

      // Multiplicative update
      for (let k = 0; k < nCells; k++)
        if (s[k] > 0) x[k] *= bp[k] / s[k];
    }

    return x;
  }

  /**
   * Calculate geographic positions of plume points
   */
  calculatePositions(concentration, nRows1, nRows2, ind1, ind2, alpha1, alpha2,
                     S12, deltaH21, latVol, lonVol, altS1, utm1, utm2, utmVol) {
    const positions = {
      lon: [],
      lat: [],
      alt: []
    };

    const EPS = 1e-6;

    // Mean angles for each grid cell
    for (let m = 0; m < nRows1; m++) {
      for (let n = 0; n < nRows2; n++) {
        const meanAlpha1 = (alpha1[ind1[m]] + alpha1[ind1[m + 1]]) / 2;
        const meanAlpha2 = (alpha2[ind2[n]] + alpha2[ind2[n + 1]]) / 2;

        // Use absolute tangents and EPS guards to avoid NaN/Infinity
        const ta1 = Math.abs(Math.tan(this.toRad(meanAlpha1)));
        const ta2 = Math.abs(Math.tan(this.toRad(meanAlpha2)));

        let PosX, PosY;
        if (ta1 > EPS && ta2 > EPS) {
            PosX = (S12 + deltaH21 * ta2) / (1 + ta2 / ta1);
            PosY = PosX / ta1;
        } else if (ta1 <= EPS && ta2 > EPS) {
            PosX = 0;
            PosY = deltaH21 + S12 / ta2;
        } else if (ta2 <= EPS && ta1 > EPS) {
            PosX = S12;
            PosY = S12 / ta1;
        } else {
            PosX = 0;
            PosY = 0;
        }

        // Convert back to geographic coordinates
        const lonUtm = utm1.easting  + (PosX / S12) * (utm2.easting  - utm1.easting);
        const latUtm = utm1.northing + (PosX / S12) * (utm2.northing - utm1.northing);

        const deg = this.utm2deg(latUtm, lonUtm, utm1.zone);
        positions.lon.push(deg.lon);
        positions.lat.push(deg.lat);
        positions.alt.push(altS1 + PosY);
      }
    }

    return positions;
  }

  /**
   * Time parsing (simple format)
   */
  parseTime(dateStr) {
    return new Date(dateStr).getTime();
  }

  /**
   * Angle conversion
   */
  toRad(deg) {
    return deg * Math.PI / 180;
  }

  toDeg(rad) {
    return rad * 180 / Math.PI;
  }
}

export async function tomoInverse(data, deg2utm) {
    const completenessLimit = document.getElementById("completenessLimit")?.valueAsNumber ?? 0.9;
    const baricenterLimit   = document.getElementById("baricenterLimit")?.valueAsNumber ?? 60;
    const timeDifferenceMin = document.getElementById("timeDifferenceMin")?.valueAsNumber ?? 15;
    const timeDifference    = timeDifferenceMin * 60 * 1000;

    const mlemIterations = document.getElementById("mlemIterations")?.valueAsNumber ?? 50;
    const tomo = new VolcanoTomography({ completenessLimit, baricenterLimit, timeDifferenceMin, mlemIterations });

    // Convert raw scan data to the format VolcanoTomography expects, computing
    // plumeCentre and plumeCompleteness needed by filterValidScans.
    function toScan(s) {
        const allAngles = s.spectralData.map(v => v.scanangle);
        const allCols   = s.spectralData.map(v => v.column_SO2);
        const ref = allAngles.indexOf(180);
        const angles  = ref >= 0 ? allAngles.slice(ref + 1) : allAngles;
        const rawCols = ref >= 0 ? allCols.slice(ref + 1)   : allCols;

        const sorted = [...rawCols].sort((a, b) => a - b);
        const offset = sorted.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
        const so2    = rawCols.map(x => (x - offset) * Math.sin(s.scanInfo.coneangle * Math.PI / 180));

        const sumSO2 = so2.reduce((a, b) => a + b, 0);
        const plumeCentre = sumSO2 > 0
            ? angles.reduce((acc, a, i) => acc + a * so2[i], 0) / sumSO2
            : 0;
        const maxSO2 = Math.max(...so2);
        const plumeCompleteness = maxSO2 > 0
            ? 1 - 0.5 * Math.max(
                0.2 * so2.slice(0,  5).reduce((a, b) => a + b, 0),
                0.2 * so2.slice(-5).reduce((a, b) => a + b, 0)
              ) / maxSO2
            : 0;

        const starttime = s.spectralData[Math.max(0, ref + 1)]?.starttime ?? '00:00:00';
        const dateStr   = s.scanInfo.date.split('.').reverse().join('-');

        return {
            date: dateStr,
            startTime: starttime,
            latitude:  s.scanInfo.lat,
            longitude: s.scanInfo.long,
            altitude:  s.scanInfo.alt,
            coneAngle: s.scanInfo.coneangle,
            plumeCentre,
            plumeCompleteness,
            spectralData: {
                angles:    allAngles,
                so2Columns: allCols,
                so2Errors:  s.spectralData.map(v => v.columnerror_SO2 ?? 0),
                flags:      s.spectralData.map(v => v.isgoodpoint ?? 1),
            },
            _time: new Date(dateStr + 'T' + starttime),
        };
    }

    const scans1 = data[0].map(toScan);
    const scans2 = data[1].map(toScan);
    const valid1 = tomo.filterValidScans(scans1);
    const valid2 = tomo.filterValidScans(scans2);
    console.log(`Valid scans: instrument 1 = ${valid1.length}, instrument 2 = ${valid2.length}`);

    // Station and volcano geometry
    const [, latVol, lonVol] = locateVolcano(data);
    const altS1 = data[0][0].scanInfo.alt;
    const latS1 = data[0][0].scanInfo.lat,  lonS1 = data[0][0].scanInfo.long;
    const latS2 = data[1][0].scanInfo.lat,  lonS2 = data[1][0].scanInfo.long;

    const utmVol = tomo.deg2utm(latVol, lonVol);
    const utm1   = tomo.deg2utm(latS1,  lonS1);
    const utm2   = tomo.deg2utm(latS2,  lonS2);

    const DX1 = utm1.easting  - utmVol.easting;
    const DY1 = utm1.northing - utmVol.northing;
    const DX2 = utm2.easting  - utmVol.easting;
    const DY2 = utm2.northing - utmVol.northing;
    const deltaH21 = data[1][0].scanInfo.alt - altS1;
    const S12 = Math.sqrt((DX1 - DX2)**2 + (DY1 - DY2)**2);
    const beta1 = data[0][0].scanInfo.coneangle;
    const beta2 = data[1][0].scanInfo.coneangle;

    // Sort by time so we can use a two-pointer sweep instead of O(n×m)
    valid1.sort((a, b) => (a._time?.getTime() ?? 0) - (b._time?.getTime() ?? 0));
    valid2.sort((a, b) => (a._time?.getTime() ?? 0) - (b._time?.getTime() ?? 0));

    const frames = [];
    let j0 = 0;
    for (const s1 of valid1) {
        const t1 = s1._time?.getTime() ?? 0;
        // Advance the left boundary of the window
        while (j0 < valid2.length && (valid2[j0]._time?.getTime() ?? 0) < t1 - timeDifference) j0++;
        for (let j = j0; j < valid2.length; j++) {
            const s2 = valid2[j];
            const t2 = s2._time?.getTime() ?? 0;
            if (t2 > t1 + timeDifference) break;
            try {
                const result = tomo.performTomography(
                    s1, s2,
                    DX1, DY1, DX2, DY2, deltaH21, S12,
                    beta1, beta2, altS1, latVol, lonVol, utmVol, utm1, utm2
                );
                if (!result) continue;

                // Log validation for the very first frame: SCD = concentration × path
                if (frames.length === 0 && result.validation) {
                    const { forward1, b1: vb1, ratio1, forward2, b2: vb2, ratio2,
                            totL1, totL2, avgConc1, avgConc2 } = result.validation;
                    const fmt = x => isNaN(x) ? NaN : parseFloat(x.toFixed(4));
                    const toRows = (b, conc, path, fwd, ratio) => b.map((_, i) => ({
                        'SCD measured (ppm·m)':   fmt(b[i]),
                        'avg conc (ppm)':          fmt(conc[i]),
                        'total path (m)':          fmt(path[i]),
                        'SCD reproduced (ppm·m)': fmt(fwd[i]),
                        'ratio (expect ~1)':       fmt(ratio[i]),
                    }));
                    console.group('[Tomography validation] SCD = concentration × path');
                    console.log('Station 1');
                    console.table(toRows(vb1, avgConc1, totL1, forward1, ratio1));
                    console.log('Station 2');
                    console.table(toRows(vb2, avgConc2, totL2, forward2, ratio2));
                    console.groupEnd();
                }

                const { concentration, lon, lat, alt, gridDims } = result;
                const points = concentration.map((c, i) => {
                    const [latPutm, lonPutm] = deg2utm(lat[i], lon[i]);
                    return { latPutm, lonPutm, lat: lat[i], lon: lon[i], altP: alt[i], Concentration: c };
                });
                frames.push({
                    points,
                    size1: gridDims[0],
                    size2: gridDims[1],
                    time:  new Date((t1 + t2) / 2),
                    date1: s1._time,
                    date2: s2._time,
                });
            } catch (e) {
                console.warn('Failed to process scan pair:', e);
            }
        }
    }
    console.log(`tomoInverse: ${frames.length} frame(s) produced`);
    return frames;
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VolcanoTomography;
}
