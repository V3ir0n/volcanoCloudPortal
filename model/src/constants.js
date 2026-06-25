export const eruptiveRegimes = [
    {depth: 2.5, gas: 0, h0: 0.0, h10: 0.0, h20: 0.0, regime: "no eruption"},
    {depth: 2.5, gas: 1, h0: 3.0, h10: 2.5, h20: 1.8, regime: "weak"},
    {depth: 2.5, gas: 2, h0: 6.2, h10: 5.1, h20: 3.8, regime: "transitional"},
    {depth: 2.5, gas: 3, h0: 6.2, h10: 5.1, h20: 3.8, regime: "transitional"},
    {depth: 2.5, gas: 4, h0: 6.2, h10: 5.1, h20: 3.8, regime: "transitional"},
    {depth: 2.5, gas: 5, h0: 6.2, h10: 5.1, h20: 3.8, regime: "transitional"},
    {depth: 2.5, gas: 6, h0: 6.2, h10: 5.1, h20: 3.8, regime: "transitional"},

    {depth: 5.0, gas: 0, h0: 0.0, h10: 0.0, h20: 0.0, regime: "no eruption"},
    {depth: 5.0, gas: 1, h0: 3.3, h10: 2.8, h20: 2.1, regime: "weak"},
    {depth: 5.0, gas: 2, h0: 7.2, h10: 6.0, h20: 4.5, regime: "transitional"},
    {depth: 5.0, gas: 3, h0: 11.3, h10: 9.4, h20: 7.0, regime: "explosive"},
    {depth: 5.0, gas: 4, h0: 12.5, h10: 10.4, h20: 7.8, regime: "explosive"},
    {depth: 5.0, gas: 5, h0: 12.5, h10: 10.4, h20: 7.8, regime: "explosive"},
    {depth: 5.0, gas: 6, h0: 12.5, h10: 10.4, h20: 7.8, regime: "explosive"},

    {depth: 7.5, gas: 0, h0: 0.0, h10: 0.0, h20: 0.0, regime: "no eruption"},
    {depth: 7.5, gas: 1, h0: 3.7, h10: 3.0, h20: 2.3, regime: "weak"},
    {depth: 7.5, gas: 2, h0: 7.9, h10: 6.6, h20: 4.9, regime: "transitional"},
    {depth: 7.5, gas: 3, h0: 12.5, h10: 10.4, h20: 7.8, regime: "explosive"},
    {depth: 7.5, gas: 4, h0: 17.3, h10: 14.3, h20: 10.7, regime: "explosive"},
    {depth: 7.5, gas: 5, h0: 20.4, h10: 16.9, h20: 12.6, regime: "explosive"},
    {depth: 7.5, gas: 6, h0: 20.4, h10: 16.9, h20: 12.6, regime: "explosive"},

    {depth: 10, gas: 0, h0: 0.0, h10: 0.0, h20: 0.0, regime: "no eruption"},
    {depth: 10, gas: 1, h0: 4.0, h10: 3.3, h20: 2.5, regime: "weak"},
    {depth: 10, gas: 2, h0: 8.7, h10: 7.2, h20: 5.4, regime: "transitional"},
    {depth: 10, gas: 3, h0: 13.7, h10: 11.3, h20: 8.5, regime: "explosive"},
    {depth: 10, gas: 4, h0: 18.8, h10: 15.6, h20: 11.7, regime: "explosive"},
    {depth: 10, gas: 5, h0: 24.2, h10: 20.1, h20: 15.0, regime: "explosive"},
    {depth: 10, gas: 6, h0: 29.7, h10: 24.6, h20: 18.4, regime: "explosive"},
];

export const eruptionFeatures = {
    "no eruption": {
        smoke: "none",
        ashAmount: "none",
        sound: "silence",
        infoBoxText: `
            <h2>No Eruption</h2>
            If the gas content is too low or the depth of the reservoir too high, 
            no gas will reach the surface and the volcano will remain inactive.
        `
    },
    weak: {
        smoke: "light",
        ashAmount: "none",
        sound: "silence",
        infoBoxText: `
            <h2>Weak Eruption</h2>
            If gas can escape from the magma before reaching the surface, 
            only weak eruptive activity, possibly including lava flows,
            or passive degassing will occurr.
        `
    },
    transitional: {
        smoke: "light",
        ashAmount: "small",
        lava: true,
        shakeIntensity: 0.5,
        sound: "mild_eruption_sfx",
        infoBoxText: `
            <h2>Transitional Eruption</h2>
            When gas reaches the surface with a pressure above ambient,
            some explosive activity is expected, probably including magma fragmentation (ash).
        `
    },
    explosive: {
        smoke: "dark",
        ashAmount: "large",
        lava: true,
        shakeIntensity: 1,
        sound: "strong_eruption_sfx",
        infoBoxText: `
            <h2>Explosive Eruption</h2>
            Gas-rich magma ascending quickly through the conduit will most likely retain
            significant overpressure when reaching the surface. This leads to explosive
            volcanic eruption, with fragmented magma (ash).
            If the volcanic column collapses, a pyroclastic flow will be produced.
        `
    }
};
// Creating POIs
export const annotations = [
    {
        name: "Magma Chamber",
        position: [0.89, -24.95, 2.51], 
        infoBoxText: `
            <h2>Where magma is stored</h2>
            Magma, the mixture of molter rock, crytstals and volatiles (gases) is stored at depth.
            The depth, compositiona, and size of the magma reservoir influence the frequency and intensity of eruptions.
        `
    },
    {
        name: "Conduit",
        position: [0.80, -1.15, 2.1],
        infoBoxText: `
            <h2>Where the action happens</h2>
            The conduit is the pathway through which magma travels from the magma chamber to the surface during an eruption. 
            Narrow conduits can lead to more explosive eruptions, while wider conduits may result in effusive eruptions with lava flows.
        `
    }
    ,
    {
        name: "Crater",
        position: [0.21, 8.04, 0.50],
        infoBoxText: `
            <h2>Where magma reaches the surface</h2>
            At the crater, magma transitions from a pressurized state to the atmosphere, releasing gases, lava, or ash.
        `
    }
    ,
    {
        name: "Plume",
        position: [3.25, 10.63, 0.89],
        infoBoxText: `
            <h2>Where the cloud of gases and particles is transported</h2>
            The plume is the wind-driven cloud formed after the volcanic column has reached equilibrium with the surrounding atmosphere. 
            The plume transports volcanic gases and ash over long distances, potentially disturbing the environment, climate or air traffic.        `
    }
];

export const skyTopColor = 0x0172ad;
export const skyBottomColor = 0xffffff;
