# 🇨🇴 MapBiomas Colombia – Mining

Developed by ***MapBiomas Colombia***.

## 📖 About

This repository contains the scripts to classify and filter mining areas (Class 30) across the Colombian territory as part of the **MapBiomas Colombia Collection 3** cross-cutting themes.

We highly recommend reading the [Colombia Collection 3 Appendix of the Algorithm Theoretical Basis Document (ATBD)](https://colombia.mapbiomas.org/descripcion-general-de-la-metodologia/). The fundamental information about the classification methodology is there.

## 📂 Collections and Codes

### Collection 3

```
collection-03/
├── STEP-01/
│   └── referenceAreas.js              # Reference area definition
├── STEP-02/
│   └── getSamples.js                  # Training sample generation
├── STEP-03/
│   ├── rf-classification.js           # Random Forest classification
│   └── vis-results.js                 # Results visualization
└── STEP-04/
    ├── joinFilter.js                  # Join filter
    ├── gapFillFilter.js               # Gap fill filter
    ├── temporalFilter.js              # Temporal filter
    ├── frequencyFilter1.js            # Frequency filter
    ├── spatialFilter.js               # Spatial filter
    ├── getAreas.js                    # Area statistics export
    └── vis-filterResults.js           # Filter results visualization
```

## 📬 Contact

**MapBiomas Colombia** | [mapbiomas.org](https://mapbiomas.org) | [colombia.mapbiomas.org](https://colombia.mapbiomas.org)

---

*Last update: March 2026*
