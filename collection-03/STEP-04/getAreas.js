/**
 * ==============================================================================
 * MAPBIOMAS COLOMBIA - COLLECTION 3 - CROSS-CUTTING: MINING
 * STEP 08: FILTER AREA STATISTICS EXPORT
 * ==============================================================================
 * @version       1.0
 * @update        March 2026
 * @attribution   MapBiomas Colombia (Fundacion Gaia Amazonas)
 * @description   Calculates and exports the total area (in hectares) for Class 30 
 * (Mining) across the baseline classification (Step 3) and all 
 * subsequent filter versions. Compiles the results into a single CSV.
 * @inputs        - Classification ImageCollections (clasificacion-ft/)
 * - Region vector (Regiones_Mineria_2024_2)
 * @outputs       - CSV Export to Google Drive
 * ==============================================================================
 */

// ==============================================================================
// 1. USER PARAMETERS
// ==============================================================================

var param = { 
  regionCode: 30601,  
  country: 'COLOMBIA', 
  versionStep3: '11',              // Baseline classification version
  exportFilters: true,             // Include filtered versions in the CSV?
  versionFilters: ['2','3','4','5','6'], // Filter versions to compare
  previewYear: 2015                // Year to display on the map
}; 

// Generate List of Years
var yearsList = ee.List.sequence(1985, 2025);
var bandNames = yearsList.map(function(year){
  return ee.String('classification_').cat(ee.Number(year).format('%04d'));
});

// ==============================================================================
// 2. IMPORTS & ASSETS
// ==============================================================================

var palettes = require('users/mapbiomas_caribe/public_repo_mbcolombia:mbcolombia-col3/modules/Palettes.js');
var mapbiomasPalette = palettes.get('ColombiaCol3');

var basePath = 'projects/ee-mapbiomasdeveloper/assets/';
var assets = {
  regions:      basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/MINING/Regiones_Mineria_2024_2',
  miningClassFt: basePath + 'LULC/COLLECTION3/CROSS_CUTTING/MINING/clasificacion-ft'
};

// ==============================================================================
// 3. INITIALIZATION & DATA LOADING
// ==============================================================================

// Load Region
var regionData = ee.FeatureCollection(assets.regions)
  .filter(ee.Filter.eq('id_regionC', param.regionCode))
  .map(function(fea){ return fea.set('version', 1); });

var regionGeom = regionData.geometry();

// Load Baseline Classification (Step 3)
var classStep3Img = ee.ImageCollection(assets.miningClassFt)
  .filter(ee.Filter.eq('code_region', param.regionCode))
  .filter(ee.Filter.eq('version', param.versionStep3))
  .select(bandNames)
  .mosaic();

print('Baseline Classification (Step 3):', classStep3Img);

// Load Filtered Classifications
var classFiltersCol = ee.ImageCollection(assets.miningClassFt)                 
  .filter(ee.Filter.eq('code_region', param.regionCode))
  .filter(ee.Filter.inList('version', param.versionFilters))
  .filter(ee.Filter.neq('process', 'gapfill metadata'))
  .select(bandNames);

print('Filtered Classifications Collection:', classFiltersCol);

// ==============================================================================
// 4. PARALLEL AREA CALCULATION (SERVER-SIDE)
// ==============================================================================

var statsExport;

// Extract dynamic names for columns (e.g., "ID30_filtro_frecuencia_4")
var filterDescriptions = classFiltersCol.aggregate_array('process');
var filterVersions     = classFiltersCol.aggregate_array('version');

var filterColumnNames = filterDescriptions.zip(filterVersions).map(function(pair) {
  var p = ee.List(pair);
  return ee.String('ID30_').cat(p.get(0)).cat('_').cat(p.get(1));
});

var filterImgList = classFiltersCol.toList(classFiltersCol.size());

// Map over each year to calculate areas efficiently
var yearlyStatsFC = ee.FeatureCollection(yearsList.map(function(year) {
  var yearStr  = ee.Number(year).format('%04d');
  var bandName = ee.String('classification_').cat(yearStr);
  
  // Base Dictionary
  var statsDict = ee.Dictionary({'year': yearStr});
  
  var pixelAreaHectares = ee.Image.pixelArea().divide(1e4); // 1e4 = Hectares
  
  // 1. Calculate Baseline Area (with Null fallback to 0)
  var step3AreaDict = classStep3Img.select([bandName]).eq(30)
    .multiply(pixelAreaHectares)
    .reduceRegion({
      reducer: ee.Reducer.sum(), 
      geometry: regionGeom, 
      scale: 30, 
      maxPixels: 1e13
    });
    
  var step3Area = ee.Algorithms.If(ee.Algorithms.IsEqual(step3AreaDict.get(bandName), null), 0, step3AreaDict.get(bandName));
  statsDict = statsDict.set(ee.String('ID30_paso3_').cat(param.versionStep3), step3Area);

  // 2. Calculate Filtered Areas (if enabled)
  var finalDict = ee.Algorithms.If(
    param.exportFilters,
    ee.Dictionary(function() {
      // Map over the list of filter images
      var filterAreas = filterImgList.map(function(img) {
        var fDict = ee.Image(img).select([bandName]).eq(30)
          .multiply(pixelAreaHectares)
          .reduceRegion({
            reducer: ee.Reducer.sum(), 
            geometry: regionGeom, 
            scale: 30, 
            maxPixels: 1e13
          });
          
        var fArea = fDict.get(bandName);
        // FIX: Return 0 if null to keep the list length perfectly matched!
        return ee.Algorithms.If(ee.Algorithms.IsEqual(fArea, null), 0, fArea);
      });
      
      // Combine column names with their calculated areas
      var dynamicFilterDict = ee.Dictionary.fromLists(filterColumnNames, filterAreas);
      return statsDict.combine(dynamicFilterDict);
    }()),
    statsDict
  );

  return ee.Feature(null, ee.Dictionary(finalDict));
}));

statsExport = yearlyStatsFC;
print('Computed Statistics FeatureCollection:', statsExport);

// ==============================================================================
// 5. EXPORT
// ==============================================================================

var exportDescription = 'ESTADISTICAS-MINING-' + param.country.toUpperCase() + '-' + param.regionCode;

Export.table.toDrive({
  collection: statsExport,
  description: exportDescription,
  fileFormat: 'CSV',
  folder: 'STATS-MINING'
});

// ==============================================================================
// 6. VISUALIZATION
// ==============================================================================

var visParams = {
  bands:   ['classification_' + param.previewYear],
  min:     0,
  max:     mapbiomasPalette.length - 1,
  palette: mapbiomasPalette
};

Map.addLayer(regionData.style({ fillColor: '00000000', color: 'red' }), {}, 'Region Border', true);
Map.addLayer(classStep3Img, visParams, 'Baseline Step 3 - ' + param.previewYear, false);