/**
 * ==============================================================================
 * MAPBIOMAS COLOMBIA - COLLECTION 3 - CROSS-CUTTING: MINING
 * STEP 04: SPATIAL FILTER
 * ==============================================================================
 * @version       1.0
 * @update        December 2024
 * @attribution   MapBiomas Colombia (Fundacion Gaia Amazonas)
 * @description   Applies a spatial filter to remove isolated pixels (salt & pepper).
 *                Pixels with fewer connected neighbors than the minimum threshold
 *                are replaced by the focal mode (most common neighboring class).
 *                Missing year bands are filled with class 27 (non-mining) before
 *                filtering.
 * @inputs        - Frequency-filtered classification image (clasificacion-ft/)
 *                - Mosaic ImageCollections (mosaics-3-ct, mosaics-6, mosaics-3, col-amazonia-pathrow)
 *                - Region vector (Regiones_Mineria_2024_2)
 * @outputs       - Earth Engine Asset: spatially filtered classification image
 *                  saved to 'MINING/clasificacion-ft/'
 * ==============================================================================
 */

// ==============================================================================
// 1. USER PARAMETERS
// ==============================================================================

var param = {
  regionCode:         30203,
  country:            'COLOMBIA',
  previewYears:       [1986, 2023],
  inputCollection:    'clasificacion-ft',
  versionInput:       '2',
  versionOutput:      '3',
  minConnectedPixels: 3,    // patches smaller than this are replaced by focal mode
  eightConnected:     true  // true: 8-connected; false: 4-connected
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

// Mask out no-data pixels and rebuild the image band by band
var classif       = ee.Image();
var existingBands = inputImage.bandNames().getInfo();
if (existingBands[0] === 'constant') existingBands = existingBands.slice(1);

existingBands.forEach(function(bandName) {
  var imgBand   = inputImage.select(bandName);
  var validBand = imgBand.updateMask(imgBand.unmask().neq(0));
  classif = classif.addBands(validBand.rename(bandName));
});

inputImage = classif.select(existingBands).unmask().updateMask(region.rasterMask);

// Fill missing years with class 27 (non-mining)
var bandsOccurrence = ee.Dictionary(
  bandNames.cat(inputImage.bandNames()).reduce(ee.Reducer.frequencyHistogram())
);

var bandsDictionary = bandsOccurrence.map(function(key, value) {
  return ee.Image(
    ee.Algorithms.If(
      ee.Number(value).eq(2),
      inputImage.select([key]),
      ee.Image(27).rename([key])
    )
  ).byte();
});

var alignedImage = ee.Image(
  bandNames.iterate(
    function(band, img) {
      var newImage = ee.Image(bandsDictionary.get(ee.String(band)))
        .where(ee.Image(bandsDictionary.get(ee.String(band))).eq(0), 27)
        .where(ee.Image(bandsDictionary.get(ee.String(band))).eq(1), 30)
        .rename(ee.String(band));
      return ee.Image(img).addBands(newImage).updateMask(region.rasterMask);
    },
    ee.Image().select()
  )
);

// Add connected pixel count bands for each year
var imageFilledConnected = alignedImage.addBands(
  alignedImage
    .connectedPixelCount(100, param.eightConnected)
    .rename(bandNames.map(function(band) { return ee.String(band).cat('_connected'); }))
);

// Apply focal mode to patches smaller than minConnectedPixels
var filteredTotalImage = ee.Image(0).updateMask(region.rasterMask);

years.forEach(function(year) {
  var baseImg      = imageFilledConnected.select('classification_' + year);
  var connectedImg = imageFilledConnected.select('classification_' + year + '_connected');
  var focalModeImg = baseImg
    .focal_mode(1, 'square', 'pixels')
    .mask(connectedImg.lte(param.minConnectedPixels));
  var classOut = baseImg.blend(focalModeImg);
  filteredTotalImage = filteredTotalImage.addBands(classOut);
});

// Remove the initial placeholder band — keep only classification bands
filteredTotalImage = filteredTotalImage.select(bandNames).updateMask(region.rasterMask);

// ==============================================================================
// 5. EXPORT
// ==============================================================================

var outputName = 'MINING-' + param.country + '-' + param.regionCode + '-' + param.versionOutput;

var finalExportImage = ee.Image(
  filteredTotalImage
    .set({
      code_region: param.regionCode,
      country:     param.country,
      version:     param.versionOutput,
      process:     'spatial filter',
      step:        'S04-5'
    })
);

print('Output Image:', finalExportImage);

Export.image.toAsset({
  image:            finalExportImage,
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

var reprojectedFiltered = finalExportImage.reproject({ crs: 'EPSG:4326', scale: 30 });

param.previewYears.forEach(function(year) {
  var selector = 'classification_' + year;
  var vis = {
    bands:   [selector],
    min:     0,
    max:     mapbiomasPalette.length - 1,
    palette: mapbiomasPalette
  };
  var mosaicYear = mosaics.filter(ee.Filter.eq('year', year)).mosaic().mask(region.rasterMask);

  Map.addLayer(mosaicYear,          { bands: ['swir1_median', 'nir_median', 'red_median'], gain: [0.08, 0.06, 0.2] }, 'Mosaic ' + year, false);
  Map.addLayer(alignedImage,        vis, 'Classification Original ' + year, false);
  Map.addLayer(reprojectedFiltered, vis, 'Classification Filtered ' + year, true);
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
