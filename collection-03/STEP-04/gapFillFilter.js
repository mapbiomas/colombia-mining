/**
 * ==============================================================================
 * MAPBIOMAS COLOMBIA - COLLECTION 3 - CROSS-CUTTING: MINING
 * STEP 04: GAP-FILL FILTER
 * ==============================================================================
 * @version       1.0
 * @update        December 2024
 * @attribution   MapBiomas Colombia (Fundacion Gaia Amazonas)
 * @description   Applies a bidirectional gap-fill to the classification time series.
 *                Masked pixels are filled forward from t0 to tn, then backward
 *                from tn to t0. Years listed in yearsExclusion are removed from
 *                processing before the fill is applied.
 * @inputs        - Classification ImageCollection (clasificacion/ or clasificacion-ft/)
 *                - Region vector (Regiones_Mineria_2024_2)
 *                - Mosaic ImageCollections (mosaics-3-ct, mosaics-6, mosaics-3, col-amazonia-pathrow)
 * @outputs       - Earth Engine Asset: gap-filled classification image
 *                  saved to 'MINING/clasificacion-ft/'
 * ==============================================================================
 */

// ==============================================================================
// 1. USER PARAMETERS
// ==============================================================================

var param = {
  regionCode:      30502,
  country:         'COLOMBIA',
  previewYears:    [2023, 2024],
  yearsExclusion:  [1992],
  inputCollection: 'clasificacion-ft',
  versionInput:    '11',   // Input version
  versionOutput:   '2'     // Output version
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

var imageName = param.inputCollection === 'clasificacion'
  ? 'MINING-' + param.regionCode + '-' + param.country + '-RF-' + param.versionInput
  : 'MINING-' + param.country + '-' + param.regionCode + '-' + param.versionInput;

var inputImage = ee.Image(assets.inputPath + imageName);

print('Input Image:', inputImage);

// ==============================================================================
// 4. PROCESSING
// ==============================================================================

var bandNames = ee.List(
  years.map(function(year) { return 'classification_' + year.toString(); })
);

var bandNamesExclude = ee.List(
  param.yearsExclusion.map(function(year) { return 'classification_' + String(year); })
).getInfo();

var existingBands = inputImage.bandNames().getInfo();
var filteredBands = existingBands.filter(function(band) {
  return bandNamesExclude.indexOf(band) === -1;
});

// Rebuild image band by band, masking no-data pixels using the mosaic extent
var classification = ee.Image();

filteredBands.forEach(function(bandName) {
  var year     = parseInt(bandName.split('_')[1], 10);
  var nodata   = ee.Image(27);
  var mosaicBand = mosaics.filter(ee.Filter.eq('year', year))
    .select('swir1_median')
    .mosaic()
    .updateMask(region.rasterMask);

  nodata = nodata.updateMask(mosaicBand);

  var selected = inputImage.select(bandName);
  var newImage = ee.Image(0)
    .updateMask(region.rasterMask)
    .where(nodata.eq(27), 27)
    .where(selected.eq(30).or(selected.eq(1)), 30);

  var band0 = newImage.updateMask(newImage.unmask().neq(0));
  classification = classification.addBands(band0.rename(bandName));
});

classification = classification.select(filteredBands);

// Build complete band stack, inserting masked bands for any missing years
var bandsOccurrence = ee.Dictionary(
  bandNames.cat(classification.bandNames()).reduce(ee.Reducer.frequencyHistogram())
);

var bandsDictionary = bandsOccurrence.map(function(key, value) {
  return ee.Image(
    ee.Algorithms.If(
      ee.Number(value).eq(2),
      classification.select([key]).byte(),
      ee.Image().rename([key]).byte().updateMask(classification.select(0))
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

var imagePixelYear = ee.Image.constant(years)
  .updateMask(imageAllBands)
  .rename(bandNames);

var imageFilledtnt0 = applyGapFill(imageAllBands);
var imageFilledYear = applyGapFill(imagePixelYear);

// ==============================================================================
// 5. EXPORT
// ==============================================================================

var outputName = 'MINING-' + param.country + '-' + param.regionCode + '-' + param.versionOutput;

imageFilledtnt0 = imageFilledtnt0.select(bandNames)
  .set({
    code_region: param.regionCode,
    country:     param.country,
    version:     param.versionOutput,
    process:     'gapfill',
    step:        'S04-2'
  });

print('Output Image:', imageFilledtnt0);

Export.image.toAsset({
  image:            imageFilledtnt0,
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

param.previewYears.forEach(function(year) {
  var selector  = 'classification_' + year;
  var vis       = { bands: [selector], min: 0, max: mapbiomasPalette.length-1, palette: mapbiomasPalette, format: 'png' };
  var mosaicVis = mosaics.filter(ee.Filter.eq('year', year)).mosaic().updateMask(region.rasterMask);

  Map.addLayer(mosaicVis, { bands: ['swir1_median', 'nir_median', 'red_median'], gain: [0.08, 0.06, 0.2] }, 'Mosaic ' + year, false);
  Map.addLayer(classification,   vis, 'Classification Original ' + year, false);
  Map.addLayer(imageFilledtnt0,  vis, 'Classification Gap-Fill ' + year, true);
});

Map.addLayer(region.vector, {}, 'Region', true);

// ==============================================================================
// HELPER FUNCTIONS
// ==============================================================================

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

/**
 * Applies bidirectional gap-fill: forward t0→tn then backward tn→t0.
 */
function applyGapFill(image) {
  var imageFilledt0tn = bandNames.slice(1).iterate(
    function(bandName, previousImage) {
      var currentImage = image.select(ee.String(bandName));
      previousImage    = ee.Image(previousImage);
      currentImage     = currentImage.unmask(previousImage.select([0]));
      return currentImage.addBands(previousImage);
    },
    ee.Image(image.select([bandNames.get(0)]))
  );
  imageFilledt0tn = ee.Image(imageFilledt0tn);

  var bandNamesReversed = bandNames.reverse();
  var imageFilledtnt0  = bandNamesReversed.slice(1).iterate(
    function(bandName, previousImage) {
      var currentImage = imageFilledt0tn.select(ee.String(bandName));
      previousImage    = ee.Image(previousImage);
      currentImage     = currentImage.unmask(
        previousImage.select(previousImage.bandNames().length().subtract(1))
      );
      return previousImage.addBands(currentImage);
    },
    ee.Image(imageFilledt0tn.select([bandNamesReversed.get(0)]))
  );

  return ee.Image(imageFilledtnt0).select(bandNames);
}
