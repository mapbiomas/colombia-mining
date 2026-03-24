/**
 * ==============================================================================
 * MAPBIOMAS COLOMBIA - COLLECTION 3 - CROSS-CUTTING: MINING
 * STEP 04: INTEGRATION (JOIN COL2 + COL3) & MANUAL INCLUSIONS
 * ==============================================================================
 * @version       1.0
 * @update        December 2024
 * @attribution   MapBiomas Colombia (Fundacion Gaia Amazonas)
 * @description   Integrates the base Collection 2 integration with the newly
 *                classified Collection 3 years. Applies manual spatio-temporal
 *                inclusions based on user-defined polygons and year ranges.
 * @inputs        - Collection 2 Integration Asset
 *                - Collection 3 Classification Asset (from Step 3)
 *                - Region vector (Regiones_Mineria_2024_2)
 * @outputs       - Earth Engine Asset: joined classification image
 *                  saved to 'MINING/clasificacion-ft/'
 * @geom_struct   REMAP GEOMETRY (incluir_30_2018_2019):
 *                Each feature must contain:
 *                - 't0': First year of the inclusion range (e.g., 2018)
 *                - 't1': Last year of the inclusion range (e.g., 2019)
 * ==============================================================================
 */

// ==============================================================================
// 1. USER PARAMETERS
// ==============================================================================

var param = {
  regionCode:      30601,
  country:         'COLOMBIA',
  previewYears:    [1985, 2019, 2020, 2021, 2022, 2023],
  inputCollection: 'clasificacion',
  versionInput:    '1',                  // Input version (from Col 3 classification)
  versionOutput:   '11',                 // Output joined version
  yearsToAdd:      [2020, 2021, 2022, 2023, 2024],  // Years to append from Col 3
  remapGeometry: [
    typeof incluir_30_2018_2019 !== 'undefined' ? incluir_30_2018_2019 : null
  ]
};

// ==============================================================================
// 2. IMPORTS & ASSETS
// ==============================================================================

var palettes = require('users/mapbiomas_caribe/public_repo_mbcolombia:mbcolombia-col3/modules/Palettes.js');
var mapbiomasPalette = palettes.get('ColombiaCol3');

var basePath = 'projects/ee-mapbiomasdeveloper/assets/';
var assets = {
  regions:          basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/MINING/Regiones_Mineria_2024_2',
  regionesMosaicos: basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/regiones-mosaicos-2024-buffer-250',
  collection2:      'projects/mapbiomas-public/assets/colombia/collection2/mapbiomas_colombia_collection2_integration_v1',
  inputClass:       basePath + 'LULC/COLLECTION3/CROSS_CUTTING/MINING/' + param.inputCollection,
  outputAsset:      basePath + 'LULC/COLLECTION3/CROSS_CUTTING/MINING/clasificacion-ft/'
};

// ==============================================================================
// 3. INITIALIZATION & DATA LOADING
// ==============================================================================

var region  = getRegion(assets.regions, param.regionCode);
var mosaics = getMosaic(region.vector).select(['swir1_median', 'nir_median', 'red_median']);

var col2Base = ee.Image(assets.collection2)
  .where(ee.Image(assets.collection2).eq(30), 30)
  .where(ee.Image(assets.collection2).neq(30), 27)
  .updateMask(region.rasterMask);

var col3NewClass = ee.ImageCollection(assets.inputClass)
  .filter(ee.Filter.eq('code_region', param.regionCode))
  .filter(ee.Filter.eq('version', param.versionInput))
  .mosaic();

print('Collection 3 Input:', col3NewClass);

// ==============================================================================
// 4. PROCESSING
// ==============================================================================

var bandsToJoin       = param.yearsToAdd.map(function(year) { return 'classification_' + year; });
var col3BandsToInject = col3NewClass.select(bandsToJoin);

print('Bands to Inject from Col 3:', col3BandsToInject);

var joinedClassification = col2Base.addBands(col3BandsToInject, null, true).updateMask(region.rasterMask);

print('Joined Classification (Base):', joinedClassification);

var allYearsList = ee.List.sequence(1985, 2025);
var validGeoms   = param.remapGeometry.filter(function(poly) { return poly !== null; });

validGeoms.forEach(function(fea) {
  var featureProps = fea.getInfo().features[0].properties;
  var t0 = featureProps.t0;
  var t1 = featureProps.t1;

  var filteredYears = allYearsList.filter(ee.Filter.and(
    ee.Filter.gte('item', t0),
    ee.Filter.lte('item', t1)
  )).getInfo().map(function(y) { return 'classification_' + y; });

  var classificationClipped = col3NewClass.clip(fea);

  filteredYears.forEach(function(band) {
    var tempCol3       = joinedClassification.select(band);
    var tempExtraYears = classificationClipped.select(band);
    tempCol3 = tempCol3.where(tempExtraYears.eq(30), tempExtraYears);
    joinedClassification = joinedClassification.addBands(tempCol3, null, true);
  });
});

// ==============================================================================
// 5. EXPORT
// ==============================================================================

var imageName = 'MINING-' + param.country + '-' + param.regionCode + '-' + param.versionOutput;

var finalExportImage = ee.Image(
  joinedClassification
    .set({
      code_region: param.regionCode,
      country:     param.country,
      version:     param.versionOutput,
      process:     'join',
      step:        'S04-1'
    })
);

print('Final Joined Classification to Export:', finalExportImage);

Export.image.toAsset({
  image:            finalExportImage,
  description:      imageName,
  assetId:          assets.outputAsset + imageName,
  pyramidingPolicy: { '.default': 'mode' },
  region:           region.vector.geometry().bounds(),
  scale:            30,
  maxPixels:        1e13
});

// ==============================================================================
// 6. VISUALIZATION
// ==============================================================================

param.previewYears.forEach(function(year) {
  var vis = {
    bands:   ['classification_' + year],
    min:     0,
    max:     mapbiomasPalette.length - 1,
    palette: mapbiomasPalette,
    format:  'png'
  };

  var mosaicYear = mosaics.filter(ee.Filter.eq('year', year)).mosaic().clip(region.vector);

  Map.addLayer(mosaicYear, { bands: ['swir1_median', 'nir_median', 'red_median'], gain: [0.08, 0.06, 0.2] }, 'Mosaic ' + year, false);

  if (year < 2025) {
    Map.addLayer(col2Base, vis, 'Classification Col2 - ' + year, false);
  }

  Map.addLayer(joinedClassification, vis, 'Classification Joined Col3 - ' + year, false);
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
