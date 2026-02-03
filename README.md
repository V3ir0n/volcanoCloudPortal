# Volcano cloud portal
Developed by Infravis

## Content
The application consists of two parts; "model" and "map":

### Model
A visualisation of the reason to measure gases emitted by volcanoes.

All main constants are found in `./model/src/constants.js`.
  
  - `eruptiveRegimes` defines the parameter values for different eruptive regimes (weak, transitional, and plinian)
  - `eruptionFeatures` defines what features should be present for each regime. Edit this to change the info box text, sounds, etc.
  - `annotations` defines points of interests that can be placed to annotate the 3D scene.

### Map
A map of the location of the volcanoes and real data

The main data file here is `./map/resources/volcanoes.geojson`.

## Develop
To run locally, start a static webserver in this directory. If you have python 3, you can type:
```bash
python3 -m http.server 8000
```

A full list of static server oneliners is available here:
https://github.com/imgarylai/awesome-webservers
