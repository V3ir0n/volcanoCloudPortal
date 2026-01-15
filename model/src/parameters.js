class VolcanoParameters {
    constructor(view) {

        const setupParameter = (param, defaultValue, callback=()=>{}) => {
            const slider = document.getElementById(param+"Slider");
            if (slider) {
                this[param] = parseFloat(slider.value);
                slider.addEventListener('input', () => {
                    this[param] = parseFloat(slider.value);
                    callback();

                    if (view.eruptionHandler.eruptionOngoing()) {
                        view.eruptionHandler.resetToBeforeEruption();
                    }
                });
            } else {
                this[param] = defaultValue
            }
        };

        setupParameter("smokeSpeed", 0.01);
        setupParameter("smokeHeight", 1.0);
        setupParameter("smokeLifetime", 2.5);
        setupParameter("gasDensity", 30, ()=>this.updateTriggerButtonText());
        setupParameter("volcanoStretch", 2.0, ()=>{
            this.updateTriggerButtonText();
            view.stretchVolcano();
        });
        setupParameter("temperature", 10, ()=>this.updateTriggerButtonText());
        setupParameter("windSpeed", 0);
    }

    set(param, value) {
        this[param] = value;
        const slider = document.getElementById(param+"Slider");
        if (slider) {
            slider.value = value;
        }
    }
    // Function to get eruption type based on parameters
    getEruptionType() {
        const temp = this.temperature;
        const gas = this.gasDensity;
        const depth = this.volcanoStretch;

        // Define ranges based on slider min/max divided into fifths
        const tempLow = 2, tempMedLow = 5, tempMedium = 11, tempMedHigh = 15, tempHigh = 18;
        const gasLow = 15, gasMedLow = 20, gasMedium = 31, gasMedHigh = 40, gasHigh = 45;
        const depthLow = 1.3, depthMedLow = 1.5, depthMedium = 2.1, depthMedHigh = 2.5, depthHigh = 2.8;

        if (temp >= tempHigh && gas <= gasLow && depth <= depthLow) {
            return 'passive degassing';
        } else if (temp >= tempMedium && gas >= gasMedium && gas <= gasMedHigh && depth >= depthMedium && depth <= depthMedHigh) {
            return 'strombolian eruption';
        } else if (temp <= tempMedium && gas >= gasHigh && depth >= depthHigh) {
            return 'vulcanian eruption';
        } else {
            return 'No Eruption';
        }
    }

    // Function to update the trigger button text based on current parameters
    updateTriggerButtonText() {
        const type = this.getEruptionType();
        const btn = document.getElementById('trigger-eruption-btn');
        if (btn) {
            if (type === 'No Eruption') {
                btn.textContent = "No eruption possible for current parameters";
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
            } else {
                btn.textContent = `Trigger ${type}`;
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
            }
        }
    };
}

export {VolcanoParameters}
