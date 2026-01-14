class VolcanoParameters {
    constructor(view) {

        this.gasDensity = 30; // Default gas density (50% of 10-50)
        this.volcanoStretch = 2.0; // Default volcano stretch (50% of 1.0-3.0)
        this.temperature = 10; // Default temperature (50% of 0-20)
        this.smokeSpeed = 0.01; // Default smoke speed
        this.smokeHeight = 1.0; // Default smoke height
        this.smokeLifetime = 2.5; // Default smoke lifetime

        const parametersButton = document.getElementById('parameters-btn');
        const popup = document.getElementById('parameters-popup');

        console.log('Parameters button:', parametersButton);
        console.log('Popup:', popup);

        if (parametersButton && popup) {
            console.log('Adding event listener');
            parametersButton.addEventListener('click', () => {
                console.log('Button clicked, popup display:', popup.style.display);
                if (popup.style.display === 'none') {
                    popup.style.display = 'block';
                    parametersButton.textContent = 'Close Parameters';
                    console.log('Opened popup, text set to Close Parameters');
                } else {
                    popup.style.display = 'none';
                    parametersButton.textContent = 'Parameters';
                    console.log('Closed popup, text set to Parameters');
                }
            });
        } else {
            console.log('Button or popup not found');
        }

        const smokeSpeedSlider = document.getElementById('smoke-speed-slider');
        if (smokeSpeedSlider) {
            smokeSpeedSlider.addEventListener('input', (event) => {
                this.smokeSpeed = parseFloat(event.target.value);
            });
        }

        const smokeHeightSlider = document.getElementById('smoke-height-slider');
        if (smokeHeightSlider) {
            smokeHeightSlider.addEventListener('input', (event) => {
                this.smokeHeight = parseFloat(event.target.value);
            });
        }

        const smokeLifetimeSlider = document.getElementById('smoke-lifetime-slider');
        if (smokeLifetimeSlider) {
            smokeLifetimeSlider.addEventListener('input', (event) => {
                this.smokeLifetime = parseFloat(event.target.value);
            });
        }

        const gasDensitySlider = document.getElementById('gas-density-slider');
        if (gasDensitySlider) {
            gasDensitySlider.addEventListener('input', (event) => {
                this.gasDensity = parseInt(event.target.value);
                this.updateTriggerButtonText();
            });
        }

        const volcanoStretchSlider = document.getElementById('volcano-stretch-slider');
        if (volcanoStretchSlider) {
            volcanoStretchSlider.addEventListener('input', (event) => {
                this.volcanoStretch = parseFloat(event.target.value);
                view.stretchVolcano();
                this.updateTriggerButtonText();
            });
        }

        const temperatureSlider = document.getElementById('temperature-slider');
        if (temperatureSlider) {
            temperatureSlider.addEventListener('input', (event) => {
                this.temperature = parseFloat(event.target.value);
                this.updateTriggerButtonText();
            });
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
            return 'Type 1';
        } else if (temp >= tempMedium && gas >= gasMedium && gas <= gasMedHigh && depth >= depthMedium && depth <= depthMedHigh) {
            return 'Type 2';
        } else if (temp <= tempMedium && gas >= gasHigh && depth >= depthHigh) {
            return 'Type 3';
        } else {
            return 'No Eruption';
        }
    }

    // Function to update the trigger button text based on current parameters
    updateTriggerButtonText() {
        const type = this.getEruptionType();
        const btn = document.getElementById('trigger-eruption-btn');
        if (btn) {
            btn.textContent = `Trigger Eruption ${type}`;
            if (type === 'No Eruption') {
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
            } else {
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
            }
        }
    };
}

export {VolcanoParameters}
