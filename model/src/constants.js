export const eruptiveRegimes = [
    {depth: 2.5, gas: 0, h0: 5.9, h10: 5.7, h20: 5.4, regime: "weak"},
    {depth: 2.5, gas: 1, h0: 6.1, h10: 5.9, h20: 5.6, regime: "weak"},
    {depth: 2.5, gas: 2, h0: 6.4, h10: 6.1, h20: 5.8, regime: "weak"},
    {depth: 2.5, gas: 3, h0: 6.7, h10: 6.3, h20: 6.0, regime: "transitional"},
    {depth: 2.5, gas: 4, h0: 7.0, h10: 6.6, h20: 6.3, regime: "transitional"},
    {depth: 2.5, gas: 5, h0: 7.3, h10: 6.9, h20: 6.6, regime: "plinian"},
    {depth: 2.5, gas: 6, h0: 7.6, h10: 7.2, h20: 6.8, regime: "plinian"},

    {depth: 5.0, gas: 0, h0: 6.2, h10: 5.9, h20: 5.6, regime: "weak"},
    {depth: 5.0, gas: 1, h0: 6.6, h10: 6.2, h20: 5.9, regime: "weak"},
    {depth: 5.0, gas: 2, h0: 6.9, h10: 6.5, h20: 6.2, regime: "transitional"},
    {depth: 5.0, gas: 3, h0: 7.3, h10: 6.9, h20: 6.6, regime: "transitional"},
    {depth: 5.0, gas: 4, h0: 7.7, h10: 7.3, h20: 7.0, regime: "plinian"},
    {depth: 5.0, gas: 5, h0: 8.0, h10: 7.6, h20: 7.3, regime: "plinian"},
    {depth: 5.0, gas: 6, h0: 8.4, h10: 8.0, h20: 7.6, regime: "plinian"},

    {depth: 7.5, gas: 0, h0: 6.5, h10: 6.1, h20: 5.8, regime: "weak"},
    {depth: 7.5, gas: 1, h0: 6.9, h10: 6.5, h20: 6.2, regime: "transitional"},
    {depth: 7.5, gas: 2, h0: 7.3, h10: 6.9, h20: 6.6, regime: "transitional"},
    {depth: 7.5, gas: 3, h0: 7.7, h10: 7.3, h20: 7.0, regime: "plinian"},
    {depth: 7.5, gas: 4, h0: 8.1, h10: 7.7, h20: 7.3, regime: "plinian"},
    {depth: 7.5, gas: 5, h0: 8.5, h10: 8.1, h20: 7.7, regime: "plinian"},
    {depth: 7.5, gas: 6, h0: 8.9, h10: 8.5, h20: 8.1, regime: "plinian"},

    {depth: 10, gas: 0, h0: 6.8, h10: 6.4, h20: 6.0, regime: "weak"},
    {depth: 10, gas: 1, h0: 7.2, h10: 6.8, h20: 6.5, regime: "transitional"},
    {depth: 10, gas: 2, h0: 7.7, h10: 7.3, h20: 7.0, regime: "transitional"},
    {depth: 10, gas: 3, h0: 8.1, h10: 7.7, h20: 7.3, regime: "plinian"},
    {depth: 10, gas: 4, h0: 8.6, h10: 8.2, h20: 7.8, regime: "plinian"},
    {depth: 10, gas: 5, h0: 9.0, h10: 8.6, h20: 8.2, regime: "plinian"},
    {depth: 10, gas: 6, h0: 9.5, h10: 9.1, h20: 8.7, regime: "plinian"},
];

export const eruptionFeatures = {
    idle: {
        sound: "silence",
        ashAmount: "none"
    },
    weak: {
        smoke: "light",
        ashAmount: "none",
        sound: "silence",
        infoBoxText: `
            <h2>Weak Eruption</h2>
            Lorem ipsum dolor sit amet consectetur adipiscing elit.
            Quisque faucibus ex sapien vitae pellentesque sem placerat.
        `
    },
    transitional: {
        smoke: "dark",
        ashAmount: "small",
        shakeIntensity: 0.5,
        sound: "mild_eruption_sfx",
        infoBoxText: `
            <h2>Transitional Eruption</h2>
            In id cursus mi pretium tellus duis convallis. Tempus leo eu aenean sed diam urna tempor.
            Pulvinar vivamus fringilla lacus nec metus bibendum egestas.
        `
    },
    plinian: {
        smoke: "dark",
        ashAmount: "large",
        shakeIntensity: 1,
        sound: "strong_eruption_sfx",
        infoBoxText: `
            <h2>Plinian Eruption</h2>
            <p>
                Iaculis massa nisl malesuada lacinia integer nunc posuere.
                Ut hendrerit semper vel class aptent taciti sociosqu.
            </p>
            <p>Ad litora torquent per conubia nostra inceptos himenaeos.</p>
        `
    }
};

export const annotations = [
    {
        name: "POI?",
        position: [-4, -3, 3],
        infoBoxText: `
            <h2>A point of interest!</h2>
            Let us pretend that this is a point of interest, but to be fair, there is nothing particularly interesting with this point...
        `
    }
];

export const skyTopColor = 0x0172ad;
export const skyBottomColor = 0xffffff;
