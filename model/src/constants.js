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
        lava: true,
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
        lava: true,
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
// Creating POIs
export const annotations = [
    {
        name: "POI?",
        position: [-11, -3, 6.6], //horizontal, vertical, depth
        infoBoxText: `
            <h2>A point of interest!</h2>
            Let us pretend that this is a point of interest, but to be fair, there is nothing particularly interesting with this point...
        `
    },
    {
        name: "Magma Chamber",
        position: [0.89, -24.95, 2.51], 
        infoBoxText: `
            <h2>Where the magic happens!</h2>
            In this meltpot of rock and gas, the magma is stored before it finds its way to the surface. The magma chamber is a key component of the volcanic system, and its properties can influence the style and intensity of eruptions.
        `
    },
    {
        name: "Conduit",
        position: [0.80, -1.15, 2.1],
        infoBoxText: `
            <h2>Where the action happens!</h2>
            The conduit is the pathway through which magma travels from the magma chamber to the surface during an eruption. It can be thought of as a volcanic "pipe" that allows the magma to escape and create an eruption. Narrow conduits can lead to more explosive eruptions, while wider conduits may result in effusive eruptions with lava flows.
        `
    }
    ,
    {
        name: "Plume",
        position: [3.25, 10.63, 0.89],
        infoBoxText: `
            <h2>Where the burst happens!</h2>
            The plume is the column of volcanic gases and ash that rises from the crater during an eruption. It can be thought of as the "chimney" of the volcano, carrying the erupted material high into the atmosphere. The size and shape of the plume can provide clues about the intensity and style of the eruption.
        `
    }
    ,
    {
        name: "Crater",
        position: [0.21, 8.04, 0.50],
        infoBoxText: `
            <h2>Where the burst happens!</h2>
            The plume is the column of volcanic gases and ash that rises from the crater during an eruption. It can be thought of as the "chimney" of the volcano, carrying the erupted material high into the atmosphere. The size and shape of the plume can provide clues about the intensity and style of the eruption.
        `
    }
];
export const parameterInfos = {
    depthInfo: `
        <h2>Depth</h2>
        <p>Depth changes the subsurface vent depth. Deeper vents alter eruption style, model stretching, and plume behavior.</p>
    `,
    gasDensityInfo: `
        <h2>Gas Density</h2>
        <p>Gas density controls how much eruptive gas is released into the plume. Higher values make the eruption plume denser and more visible.</p>
    `,
    windSpeedInfo: `
        <h2>Wind Speed</h2>
        <p>Wind speed affects plume shape and drift. Higher wind values stretch the plume more horizontally.</p>
    `
};


export const skyTopColor = 0x0172ad;
export const skyBottomColor = 0xffffff;
