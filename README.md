# 🇨🇴 Colombia - Mining

Developed by ***MapBiomas Colombia***.

## About

This repository contains the scripts to classify and filter mining areas across the Colombian territory as part of the **MapBiomas Colombia Collection 3** cross-cutting themes.

We highly recommend reading the [Colombia Collection 3 Appendix of the Algorithm Theoretical Basis Document (ATBD)](https://colombia.mapbiomas.org/descripcion-general-de-la-metodologia/). The fundamental information about the classification methodology is there.

## Collections and Codes

* [Collection 3](./collection-03)
  * [Step 01 - Reference Areas](./collection-03/STEP-01/referenceAreas.js)
  * [Step 02 - Sample Generation](./collection-03/STEP-02/getSamples.js)
  * [Step 03 - Classification](./collection-03/STEP-03)
    * [Random Forest Classification](./collection-03/STEP-03/rf-classification.js)
    * [Visualization - Results](./collection-03/STEP-03/vis-results.js)
  * [Step 04 - Post-Processing Filters](./collection-03/STEP-04)
    * [Frequency Filter](./collection-03/STEP-04/frequencyFilter1.js)
    * [Gap Fill Filter](./collection-03/STEP-04/gapFillFilter.js)
    * [Temporal Filter](./collection-03/STEP-04/temporalFilter.js)
    * [Join Filter](./collection-03/STEP-04/joinFilter.js)
    * [Spatial Filter](./collection-03/STEP-04/spatialFilter.js)
    * [Get Areas](./collection-03/STEP-04/getAreas.js)
    * [Visualization - Filter Results](./collection-03/STEP-04/vis-filterResults.js)

**MapBiomas Colombia** | [mapbiomas.org](https://mapbiomas.org) | [colombia.mapbiomas.org](https://colombia.mapbiomas.org)
