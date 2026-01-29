class VolcanoParameters {
    constructor(view) {
        const setupSlider = (param, callback=()=>{}, defaultValue) => {
            const slider = document.getElementById(param+"Slider");
            const indicator = document.getElementById(param+"Indicator");
            if (defaultValue !== undefined) {
                slider.valueAsNumber = defaultValue;
            }
            indicator.innerText = slider.value;
            this[param] = slider.valueAsNumber;
            slider.addEventListener('input', () => {
                this[param] = slider.valueAsNumber;
                indicator.innerText = slider.value;
                callback();
            });
        };

        this.smokeSpeed = 0.01;
        this.smokeHeight = 1;
        this.smokeLifetime = 2.5;

        setupSlider("gasDensity",
            ()=>view.checkEruption()
        );
        setupSlider("depth", ()=>{
            view.checkEruption();
            view.stretchVolcano();
        });
        setupSlider("windSpeed",
            ()=>view.checkEruption()
        );

        const depthSlider = document.getElementById("depthSlider").parentElement;
        depthSlider.addEventListener("mouseenter", ()=>{
            view.setTerrainOpacity(0.2)
        });
        depthSlider.addEventListener("mouseleave", ()=>{
            view.setTerrainOpacity(0.8)
        });
    }

    getLim(param) {
        const slider = document.getElementById(param+"Slider");
        return {
            min: parseFloat(slider.min),
            max: parseFloat(slider.max)
        };
    }

    set(param, value) {
        this[param] = value;
        const slider = document.getElementById(param+"Slider");
        if (slider) {
            slider.value = value;
        }
    }
}

export {VolcanoParameters}
