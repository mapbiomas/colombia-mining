/**
 * ==============================================================================
 * MAPBIOMAS COLOMBIA - COLLECTION 3 - CROSS-CUTTING: MINING
 * STEP 04: FREQUENCY FILTER (CLASS 30)
 * ==============================================================================
 * @version       1.0
 * @update        March 2026
 * @attribution   MapBiomas Colombia (Fundacion Gaia Amazonas)
 * @description   Applies a frequency filter to stabilize the mining class (30)
 *                across the time series. Pixels classified as mining in more than
 *                the majority percentage threshold of included years are stabilized.
 *                Supports year exclusions, spatial area restrictions, and
 *                polygon-based class remapping.
 * @inputs        - Temporally filtered classification image (clasificacion-ft/)
 *                - Mosaic ImageCollections (mosaics-3-ct, mosaics-6, mosaics-3, col-amazonia-pathrow)
 *                - Region vector (Regiones_Mineria_2024_2)
 * @outputs       - Earth Engine Asset: frequency-filtered classification image
 *                  saved to 'MINING/clasificacion-ft/'
 * @geom_struct   REMAP GEOMETRIES (remap_to_30, remap_to_30_20_21):
 *                Each item must be a FeatureCollection imported in the Code Editor.
 *                Each feature must contain:
 *                - 'years': Comma-separated list of years to apply (e.g., '2020,2021')
 *                - 'from':  Comma-separated source class IDs (e.g., '27,30')
 *                - 'to':    Comma-separated target class IDs (e.g., '30,27')
 *                APPLY AREA (apply_area):
 *                A FeatureCollection imported in the Code Editor. No required properties.
 * ==============================================================================
 */

// ==============================================================================
// 1. USER PARAMETERS
// ==============================================================================

var param = {
  regionCode:      30413,
  country:         'COLOMBIA',
  previewYear:     2001,
  inputCollection: 'clasificacion-ft',
  versionInput:    '4',
  versionOutput:   '5',
  majorityPercent: 65,
  excludeYears: [
    1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992,
    1993, 1995, 1996, 1997, 1998, 1999, 2000, 2001,
    2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009,
    2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017,
    2018, 2019, 2020, 2021, 2022, 2023, 2024
  ],
  remaps: [
    typeof remap_to_30       !== 'undefined' ? remap_to_30       : null,
    typeof remap_to_30_20_21 !== 'undefined' ? remap_to_30_20_21 : null
  ],
  applyArea: typeof apply_area !== 'undefined' ? apply_area : null
};

// Years with no mosaic will show a layer error in the map panel
// but will not stop the script from running.
var years = [
  1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992,
  1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000,
  2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008,
  2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016,
  2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024,
  2025
];

// ==============================================================================
// 2. IMPORTS & ASSETS
// ==============================================================================

var palettes = require('users/mapbiomas_caribe/public_repo_mbcolombia:mbcolombia-col3/modules/Palettes.js');
var mapbiomasPalette = palettes.get('ColombiaCol3');

var basePath = 'projects/ee-mapbiomasdeveloper/assets/';
var assets = {
  regions:          basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/MINING/Regiones_Mineria_2024_2',
  regionesMosaicos: basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/regiones-mosaicos-2024-buffer-250',
  inputPath:        basePath + 'LULC/COLLECTION3/CROSS_CUTTING/MINING/' + param.inputCollection + '/',
  outputAsset:      basePath + 'LULC/COLLECTION3/CROSS_CUTTING/MINING/clasificacion-ft/'
};

// ==============================================================================
// 3. INITIALIZATION & DATA LOADING
// ==============================================================================

var region = getRegion(assets.regions, param.regionCode);
var mosaics = getMosaic(region.vector);

var imageName = 'MINING-' + param.country + '-' + param.regionCode + '-' + param.versionInput;
var inputImage = ee.Image(assets.inputPath + imageName);
print('Input Image:', inputImage);

// ==============================================================================
// 4. PROCESSING
// ==============================================================================

var bandNames = ee.List(
  years.map(function(year) { return 'classification_' + String(year); })
);

// Rebuild image band by band, masking no-data pixels using the mosaic extent
var classif       = ee.Image();
var existingBands = inputImage.bandNames().getInfo();
if (existingBands[0] === 'constant') existingBands = existingBands.slice(1);

existingBands.forEach(function(bandName) {
  var year     = parseInt(bandName.split('_')[1], 10);
  var nodata   = ee.Image(27);
  var mosaicBand = mosaics.filter(ee.Filter.eq('year', year))
    .select('swir1_median')
    .mosaic()
    .updateMask(region.rasterMask);

  nodata = nodata.updateMask(mosaicBand);

  var newImage = ee.Image(0)
    .updateMask(region.rasterMask)
    .where(nodata.eq(27), 27)
    .where(inputImage.select(bandName).eq(30), 30);

  var band0 = newImage.updateMask(newImage.unmask().neq(0));
  classif = classif.addBands(band0.rename(bandName));
});

classif = classif.select(existingBands);

// Build complete band stack, inserting masked bands for any missing years
var bandsOccurrence = ee.Dictionary(
  bandNames.cat(classif.bandNames()).reduce(ee.Reducer.frequencyHistogram())
);

var bandsDictionary = bandsOccurrence.map(function(key, value) {
  return ee.Image(
    ee.Algorithms.If(
      ee.Number(value).eq(2),
      classif.select([key]).byte(),
      ee.Image().rename([key]).byte().updateMask(classif.select(0))
    )
  );
});

var imageAllBands = ee.Image(
  bandNames.iterate(
    function(band, image) {
      return ee.Image(image).addBands(bandsDictionary.get(ee.String(band)));
    },
    ee.Image().select()
  )
);

// Apply frequency filter
var filtered = applyFrequencyFilter(imageAllBands);

// Restrict filter to a defined area if applyArea is provided
if (param.applyArea && param.applyArea.size().getInfo() > 0) {
  var geomMask   = ee.Image().paint(param.applyArea, 1);
  var filterGeom = filtered.mask(geomMask).selfMask();
  filtered = inputImage.where(filterGeom.and(filtered.eq(30)), 27);
  filtered = filtered.where(filterGeom, filterGeom);
}

// Apply polygon-based class remapping
var validRemaps = param.remaps.filter(function(r) { return r !== null; });
if (validRemaps.length > 0) {
  var remapBands = filtered.bandNames();
  var remapped = remapBands.map(function(band) {
    var yearBand = ee.Number(ee.String(band).slice(-4));
    return remapWithPolygons(filtered.select([band]), validRemaps, yearBand).rename([band]);
  });
  filtered = ee.ImageCollection(remapped).toBands().rename(remapBands);
}

// ==============================================================================
// 5. EXPORT
// ==============================================================================

var outputName = 'MINING-' + param.country + '-' + param.regionCode + '-' + param.versionOutput;

filtered = ee.Image(
  filtered.select(bandNames)
    .set({
      code_region: param.regionCode,
      country:     param.country,
      version:     param.versionOutput,
      process:     'frequency filter',
      step:        'S04-4'
    })
);

print('Output Image:', filtered);

Export.image.toAsset({
  image:            filtered,
  description:      outputName,
  assetId:          assets.outputAsset + outputName,
  pyramidingPolicy: { '.default': 'mode' },
  region:           region.vector.geometry().bounds(),
  scale:            30,
  maxPixels:        1e13
});

// ==============================================================================
// 6. VISUALIZATION
// ==============================================================================

Map.setOptions('SATELLITE');

var vis = {
  bands:   ['classification_' + param.previewYear],
  min:     0,
  max:     mapbiomasPalette.length - 1,
  palette: mapbiomasPalette,
  format:  'png'
};

Map.addLayer(
  mosaics.filter(ee.Filter.eq('year', param.previewYear)).mosaic().updateMask(region.rasterMask),
  { bands: ['swir1_median', 'nir_median', 'red_median'], gain: [0.08, 0.06, 0.08], gamma: 0.65 },
  'Mosaic ' + param.previewYear, false
);
Map.addLayer(inputImage.updateMask(region.rasterMask), vis, 'Classification Original ' + param.previewYear, false);
Map.addLayer(filtered,                                 vis, 'Classification Filtered ' + param.previewYear, true);
Map.addLayer(region.vector, {}, 'Region', true);

// ==============================================================================
// HELPER FUNCTIONS
// ==============================================================================

/**
 * Applies frequency-based stabilization to class 30 across the time series.
 */
function applyFrequencyFilter(image) {
  var bands = image.bandNames();

  if (param.excludeYears && param.excludeYears.length > 0) {
    var excludedBands = param.excludeYears.map(function(yr) { return 'classification_' + yr; });
    bands = bands.removeAll(excludedBands);
  }

  var frequency = image.select(bands).eq(30)
    .reduce(ee.Reducer.sum())
    .divide(bands.size())
    .multiply(100);

  var miningMap = ee.Image(0).where(frequency.gt(param.majorityPercent), 30);
  miningMap = miningMap.updateMask(miningMap.neq(0));

  return image.where(miningMap, miningMap);
}

/**
 * Remaps classes spatially within defined polygons for specified years.
 */
function remapWithPolygons(image, polygonsList, year) {
  year = ee.Number.parse(year);

  polygonsList.forEach(function(polygon) {
    var excluded = polygon.map(function(layer) {
      var area       = image.clip(layer);
      var layerYears = ee.String(layer.get('years')).split(',').map(function(item) { return ee.Number.parse(item); });
      var fromList   = ee.String(layer.get('from')).split(',').map(function(item) { return ee.Number.parse(item); });
      var toList     = ee.String(layer.get('to')).split(',').map(function(item) { return ee.Number.parse(item); });

      area = ee.Algorithms.If(
        layerYears.contains(year),
        area.remap(fromList, toList).clipToBoundsAndScale({ geometry: layer.geometry(), scale: 30 }),
        area
      );
      return ee.Image(area);
    });

    excluded = ee.ImageCollection(excluded).mosaic();
    image = excluded.unmask(image).rename([image.bandNames().get(0)]);
    image = image.mask(image.neq(0));
  });

  return image;
}

/**
 * Generates the region of interest vector and raster mask.
 */
function getRegion(regionPath, regionCode) {
  var regionData = ee.FeatureCollection(regionPath)
    .filter(ee.Filter.eq('id_regionc', regionCode));
  var regionMask = regionData
    .map(function(item) { return item.set('version', 1); })
    .reduceToImage(['version'], ee.Reducer.first());
  return { vector: regionData, rasterMask: regionMask };
}

/**
 * Retrieves and clips image mosaics to the region of interest.
 */
function getMosaic(regionObj) {
  var mosaicsColPaths = [
    'projects/mapbiomas-colombia/assets/MOSAICOS/mosaics-3-ct',
    'projects/mapbiomas-raisg/MOSAICOS/mosaics-6',
    'projects/mapbiomas-colombia/assets/MOSAICOS/mosaics-3',
    'projects/mapbiomas-raisg/MOSAICOS/col-amazonia-pathrow'
  ];

  var mergedMosaics = ee.ImageCollection(mosaicsColPaths[0])
    .merge(ee.ImageCollection(mosaicsColPaths[1]))
    .merge(ee.ImageCollection(mosaicsColPaths[2]))
    .merge(ee.ImageCollection(mosaicsColPaths[3]))
    .filter(ee.Filter.eq('country', 'COLOMBIA'));

  var regionMosaics = ee.FeatureCollection(assets.regionesMosaicos);

  return mergedMosaics.filterBounds(regionObj).map(function(img) {
    return img
      .clip(regionMosaics.filter(ee.Filter.eq('id_region', img.get('region_code'))))
      .clip(regionObj);
  });
}
