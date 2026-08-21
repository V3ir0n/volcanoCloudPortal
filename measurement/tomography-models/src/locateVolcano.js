import {volcanoList} from "./volcanoList.js";

function locateVolcano(data) {
    const latS1 = data[0][0].scanInfo.lat;  // latitude station 1
    const lonS2 = data[1][0].scanInfo.long;

    // Locate the volcano
    let diffLatVolFinder = volcanoList.map(v=>Math.abs(latS1 - v.lat));
    let indLatVolFinder = diffLatVolFinder.indexOf(Math.min(...diffLatVolFinder));
    let diffLonVolFinder = volcanoList.map(v=>Math.abs(lonS2 - v.lon));
    let indLonVolFinder = diffLonVolFinder.indexOf(Math.min(...diffLonVolFinder));
    let nameVol, latVol, lonVol, altVol;
    if (indLonVolFinder === indLatVolFinder) {
        nameVol = volcanoList[indLatVolFinder].volcano;
        latVol = volcanoList[indLatVolFinder].lat;
        lonVol = volcanoList[indLatVolFinder].lon;
        altVol = volcanoList[indLatVolFinder].alt;
    } else {
        let indVolcano = volcanoList.map(v=>v.volcano).indexOf(data[0][0].scanInfo.volcano);
        nameVol = volcanoList[indVolcano].volcano;
        latVol = volcanoList[indVolcano].lat;
        lonVol = volcanoList[indVolcano].lon;
        altVol = volcanoList[indVolcano].alt;
    }

    return [nameVol, latVol, lonVol, altVol];
}

export {locateVolcano};