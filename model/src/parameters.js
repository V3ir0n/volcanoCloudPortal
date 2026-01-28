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

    // Define ranges based on slider min/max divided into three equidistant values
    getRanges(param) {
        const slider = document.getElementById(param+"Slider");
        const min = parseFloat(slider.min);
        const max = parseFloat(slider.max);
        const range = max - min;
        const delta = range / 6;
        return {
            low: min + delta,
            medium: min + delta*3,
            high: min + delta*5,
            delta: delta
        }
    }
    // Function to get eruption type based on parameters
    getEruptionType() {

        const check = (param, comparison, target) => {
            const val = this[param];
            const range = this.getRanges(param);
            switch (comparison) {
                case "<": return val <= range[target];
                case ">": return val >= range[target];
                case "=":
                    return Math.abs(val - range[target]) <= range.delta * 1.1;
                default:
                    console.error(`Unknown comparison: ${comparison}`);
                    break;
            }
        }

        if (
            check("temperature", "=", "high") &&
            check("gasDensity", "=", "low") &&
            check("volcanoStretch", "=", "low")
        ) {
            return 'passive degassing';
        } else if (
            check("temperature", ">", "medium") &&
            check("gasDensity", "=", "high") &&
            check("volcanoStretch", "=", "high")
        ) {
            return 'strombolian eruption';
        } else if (
            check("temperature", "=", "medium") &&
            check("gasDensity", "=", "high") &&
            check("volcanoStretch", "=", "medium")
        ) {
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
