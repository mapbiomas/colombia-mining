/**
 * ==============================================================================
 * MAPBIOMAS COLOMBIA - COLLECTION 3 - CROSS-CUTTING: MINING
 * STEP 01: REFERENCE AREAS
 * ==============================================================================
 * @version       1.0
 * @update        December 2024
 * @attribution   MapBiomas Colombia (Fundacion Gaia Amazonas)
 * @description   Builds a reference mining mask by accumulating selected reference
 *                layers (mining titles, EVOA, CORINE, COMIMO, and stable Col2 pixels).
 *                Applies an optional spatial filter and proportional buffer to the
 *                accumulated mask before exporting to an EE asset.
 * @inputs        - Region vector (Regiones_Mineria_2024_2)
 *                - Collection 2 integration image
 *                - Mining reference FeatureCollections (Titulos_Mineros, EVOA_*, etc.)
 *                - Mosaic ImageCollections (mosaics-3-ct, mosaics-6, mosaics-3, col-amazonia-pathrow)
 * @outputs       - Earth Engine Asset: reference mask image
 *                  saved to 'MINING/STEP1_REGIONS/classification_mask/'
 * ==============================================================================
 */

// ==============================================================================
// 1. USER PARAMETERS
// ==============================================================================

var param = {
  country:      'COLOMBIA',
  regionCode:   30601,
  previewYears: [1985, 2023],
  buffer:       30,
  referenceAccum: [
    // Select references to accumulate:
    // 'Ref1_TitulosMineros',
    // 'Ref2_EVOA_2020',
    // 'Ref3_EVOA_2014_2016_2018_2019',
    // 'Ref4_Mineria_Corine_2018',
    // 'Ref5_Comimo_2021_2023_01_16',
    // 'Ref6_accumulated_Col2',
    'Ref7_stable_Col2'
  ],
  spatialFilter: {
    enabled:            false,
    minConnectedPixels: 20
  },
  proportionalBuffer: {
    enabled:     true,
    threshold:   800,  // minimum connected-pixel count for large buffer
    lowerBuffer: 100   // buffer distance (m) for small patches
  },
  version:       1,
  exportToDrive: false
};

var featureSpace = [
  'blue_median',
  'green_median',
  'red_median',
  'red_wet',
  'nir_median',
  'nir_wet',
  'swir1_median',
  'swir2_median',
  'ndvi_median',
  'ndvi_wet',
  'wefi_wet',
  'gcvi_wet',
  'sefi_median',
  'soil_median',
  'snow_median',
  'evi2_median',
  'ndwi_mcfeeters_median',
  'mndwi_median',
  'slope',
  'slppost',
  'elevation',
  'shade_mask2',
  'ferrous_median',
  'clay_median'
];

// ==============================================================================
// 2. IMPORTS & ASSETS
// ==============================================================================

var palettes = require('users/mapbiomas_caribe/public_repo_mbcolombia:mbcolombia-col3/modules/Palettes.js');
var mapbiomasPalette = palettes.get('ColombiaCol3');

var basePath = 'projects/ee-mapbiomasdeveloper/assets/';
var assets = {
  regions:           basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/MINING/Regiones_Mineria_2024_2',
  regionesMosaicos:  basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/regiones-mosaicos-2024-buffer-250',
  collection2:       'projects/mapbiomas-public/assets/colombia/collection2/mapbiomas_colombia_collection2_integration_v1',
  titulosMineros:    basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/MINING/Titulos_Mineros',
  evoa2020:          basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/MINING/EVOA_2020',
  evoa2014to2019:    basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/MINING/EVOA_2014_2016_2018_2019',
  mineriaCorine2018: basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/MINING/Mineria_Corine_2018',
  comimo2021:        basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/MINING/Comimo_2021_2023_01_16',
  miningMaskOutput:  basePath + 'LULC/COLLECTION3/CROSS_CUTTING/MINING/STEP1_REGIONS/classification_mask'
};

// ==============================================================================
// 3. INITIALIZATION & DATA LOADING
// ==============================================================================

var region  = getRegion(assets.regions, param.regionCode);
var mosaics = getMosaic(region.vector);

var integration = ee.Image(assets.collection2);
var mining      = integration.eq(30).updateMask(region.rasterMask);

var fcTitulosMineros    = ee.FeatureCollection(assets.titulosMineros);
var fcEvoa2020          = ee.FeatureCollection(assets.evoa2020);
var fcEvoa2014to2019    = ee.FeatureCollection(assets.evoa2014to2019);
var fcMineriaCorine2018 = ee.FeatureCollection(assets.mineriaCorine2018);
var fcComimo2021        = ee.FeatureCollection(assets.comimo2021);

print('Region:', region.vector);

// ==============================================================================
// 4. PROCESSING
// ==============================================================================

// Build reference images
var refTitulosMineros    = ee.Image(0).clip(fcTitulosMineros).updateMask(region.rasterMask).rename('Ref1_TitulosMineros').add(1).multiply(30);
var refEvoa2020          = ee.Image(0).clip(fcEvoa2020).updateMask(region.rasterMask).rename('Ref2_EVOA_2020').add(1).multiply(30);
var refEvoa2014to2019    = ee.Image(0).clip(fcEvoa2014to2019).updateMask(region.rasterMask).rename('Ref3_EVOA_2014_2016_2018_2019').add(1).multiply(30);
var refMineriaCorine2018 = ee.Image(0).clip(fcMineriaCorine2018).updateMask(region.rasterMask).rename('Ref4_Mineria_Corine_2018').add(1).multiply(30);
var refComimo2021        = ee.Image(0).clip(fcComimo2021).updateMask(region.rasterMask).rename('Ref5_Comimo_2021_2023_01_16').add(1).multiply(30);
var refAccumulated       = mining.reduce('max').multiply(30).selfMask().rename('Ref6_accumulated_Col2');
var stableRef            = getStablePixels(mining, ee.List.sequence(1, 50).getInfo()).rename('Ref7_stable_Col2');

// Accumulate all reference bands
var accumulatedTotal = ee.Image(0)
  .addBands(refTitulosMineros)
  .addBands(refEvoa2020)
  .addBands(refEvoa2014to2019)
  .addBands(refMineriaCorine2018)
  .addBands(refComimo2021)
  .addBands(refAccumulated)
  .addBands(stableRef)
  .updateMask(region.rasterMask);

print('Reference band names:', accumulatedTotal.bandNames());

var accumulatedSel = accumulatedTotal.select(param.referenceAccum).reduce('sum').selfMask();

var accumulatedUnion = ee.Image(0)
  .where(refTitulosMineros.selfMask(), 30)
  .where(refEvoa2020.selfMask(), 30)
  .where(refEvoa2014to2019.selfMask(), 30)
  .where(refMineriaCorine2018.selfMask(), 30)
  .where(refComimo2021.selfMask(), 30)
  .where(refAccumulated.selfMask(), 30)
  .selfMask();

// Prepare export image
var imageExport = accumulatedSel.gte(1).updateMask(region.rasterMask).toUint8()
  .reproject('EPSG:4326', null, 30);

var connected = imageExport.connectedPixelCount(1000).rename('connected');

if (param.spatialFilter.enabled) {
  print('Connected pixel scale:', connected.projection().nominalScale());
  imageExport = imageExport.mask(connected.select('connected').gte(param.spatialFilter.minConnectedPixels));
}

// Buffer computation
var accumulatedBuffer;

if (!param.proportionalBuffer.enabled) {
  accumulatedBuffer = ee.Image(1)
    .cumulativeCost({ source: imageExport, maxDistance: param.buffer })
    .lt(param.buffer);
  accumulatedBuffer = ee.Image(0).where(accumulatedBuffer.eq(1), 1).selfMask().updateMask(region.rasterMask);
}

if (param.proportionalBuffer.enabled) {
  var imageExportLarge = imageExport.mask(connected.select('connected').gte(param.proportionalBuffer.threshold)).selfMask();
  var bufferLarge = ee.Image(1)
    .cumulativeCost({ source: imageExportLarge, maxDistance: param.buffer })
    .lt(param.buffer);
  bufferLarge = ee.Image(0).where(bufferLarge.eq(1), 1).selfMask();

  var imageExportSmall = imageExport.mask(connected.select('connected').lt(param.proportionalBuffer.threshold)).selfMask();
  var bufferSmall = ee.Image(1)
    .cumulativeCost({ source: imageExportSmall, maxDistance: param.proportionalBuffer.lowerBuffer })
    .lt(param.proportionalBuffer.lowerBuffer);
  bufferSmall = ee.Image(0).where(bufferSmall.eq(1), 1).selfMask();

  accumulatedBuffer = ee.Image(0)
    .where(bufferLarge, 1)
    .where(bufferSmall, 1)
    .updateMask(region.rasterMask)
    .selfMask();
}

// ==============================================================================
// 5. EXPORT
// ==============================================================================

var imageName = 'MINING-REF-ACCUM-' + param.country + '-' + param.regionCode + '-' + param.version;

if (param.exportToDrive) {
  Export.image.toDrive({
    image:       accumulatedBuffer,
    description: imageName + '-DRIVE',
    scale:       30,
    maxPixels:   1e13,
    folder:      'EXPORT-MINING',
    region:      region.vector.geometry().bounds(),
    shardSize:   1024
  });
}

Export.image.toAsset({
  image:            accumulatedBuffer,
  description:      imageName,
  assetId:          assets.miningMaskOutput + '/' + imageName,
  scale:            30,
  pyramidingPolicy: { '.default': 'mode' },
  maxPixels:        1e13,
  region:           region.vector.geometry().bounds()
});

// ==============================================================================
// 6. VISUALIZATION
// ==============================================================================

Map.addLayer(region.vector.style({ fillColor: '00000000', width: 2 }), {}, 'Region', true);

var vis = { min: 0, max: mapbiomasPalette.length - 1, palette: mapbiomasPalette };

param.previewYears.forEach(function(year) {
  var mosaicYear = mosaics.filter(ee.Filter.eq('year', year)).mosaic().updateMask(region.rasterMask);
  Map.addLayer(mosaicYear, { bands: ['swir1_median', 'nir_median', 'red_median'], gain: [0.08, 0.06, 0.2] }, 'Mosaic S,N,R ' + year, false);
  Map.addLayer(mosaicYear, { bands: ['nir_median', 'swir1_median', 'red_median'], gain: [0.08, 0.06, 0.2] }, 'Mosaic N,S,R ' + year, false);
  Map.addLayer(mosaicYear, { bands: ['nir_median', 'red_median', 'green_median'], gain: [0.08, 0.06, 0.2] }, 'Mosaic N,R,G ' + year, false);
});

Map.addLayer(refTitulosMineros, vis, 'Ref1_TitulosMineros', false);
Map.addLayer(refEvoa2020, vis, 'Ref2_EVOA_2020', false);
Map.addLayer(refEvoa2014to2019, vis, 'Ref3_EVOA_2014_2016_2018_2019', false);
Map.addLayer(refMineriaCorine2018, vis, 'Ref4_Mineria_Corine_2018', false);
Map.addLayer(refComimo2021, vis, 'Ref5_Comimo_2021_2023_01_16', false);
Map.addLayer(refAccumulated, vis, 'Ref6_accumulated_Col2', false);
Map.addLayer(stableRef, { min: 1, max: 50, palette: ['FF0000', '00FF00'] }, 'Ref7_stable_Col2', false);
Map.addLayer(accumulatedUnion, { bands: ['constant'], min: 30, max: 30, opacity: 1, palette: ['b9bfce'] }, 'Accumulated Union', false);

if (param.spatialFilter.enabled) {
  Map.addLayer(connected, { bands: ['connected'], min: 1, max: 100, palette: ['b90000', 'ff0000', 'ffbf10', 'f2ff1b', '23ff47', '10c9ff'] }, 'Connected', false);
}

Map.addLayer(
  accumulatedSel.updateMask(region.rasterMask),
  { min: 0, max: param.referenceAccum.length, palette: ['fff829', 'ffce45', 'ff920a', 'ff6e19', 'ff0000', 'b30000'] },
  'Accumulated Selection', true
);
Map.addLayer(accumulatedBuffer, {}, 'Accumulated Buffer', true);

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
 * Returns a single-band image marking pixels stable across all years for each class.
 */
function getStablePixels(image, classes) {
  var bandNames = image.bandNames();
  var images    = [];

  classes.forEach(function(classId) {
    var previousBand = image.select([bandNames.get(0)]).eq(classId);
    var singleClass  = ee.Image(
      bandNames.slice(1).iterate(
        function(bandName, previousBand) {
          return image.select(ee.String(bandName)).eq(classId).multiply(previousBand);
        },
        previousBand
      )
    );
    singleClass = singleClass.updateMask(singleClass.eq(1)).multiply(classId);
    images.push(singleClass);
  });

  var allStable = ee.Image();
  images.forEach(function(img) {
    allStable = allStable.blend(img);
  });

  return allStable;
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

  var mosaicCollectionsList = mosaicsColPaths.map(function(path) {
    return ee.ImageCollection(path);
  });

  var mergedMosaics = mosaicCollectionsList[0]
    .merge(mosaicCollectionsList[1])
    .merge(mosaicCollectionsList[2])
    .merge(mosaicCollectionsList[3])
    .filter(ee.Filter.eq('country', 'COLOMBIA'));

  var regionMosaics = ee.FeatureCollection(assets.regionesMosaicos);

  return mergedMosaics
    .filterBounds(regionObj)
    .map(function(img) {
      return img
        .clip(regionMosaics.filter(ee.Filter.eq('id_region', img.get('region_code'))))
        .clip(regionObj);
    });
}
