/**
 * ==============================================================================
 * MAPBIOMAS COLOMBIA - COLLECTION 3 - CROSS-CUTTING: MINING
 * STEP 02: EXTRACT TRAINING SAMPLES
 * ==============================================================================
 * @version       1.0
 * @update        March 2026
 * @attribution   MapBiomas Colombia (Fundacion Gaia Amazonas)
 * @description   Generates stratified random samples for training the Random
 *                Forest classifier. Extracts feature-space values from annual
 *                mosaics (including mining-specific indices like Iron Oxide)
 *                using the reference masks generated in Step 1.
 * @inputs        - Region vector (Regiones_Mineria_2024_2)
 *                - Collection 2 integration image
 *                - Step 1 classification mask (classification_mask/)
 *                - Mosaic ImageCollections (mosaics-3-ct, mosaics-6, mosaics-3, col-amazonia-pathrow)
 * @outputs       - Earth Engine Asset: FeatureCollection of training samples
 *                  saved to 'MINING/SAMPLES/'
 * @geom_struct   REMAP POLYGONS (to_mining, to_no_mining):
 *                Each feature must contain:
 *                - 'original': Comma-separated source class IDs (e.g., '27')
 *                - 'new':      Comma-separated target class IDs (e.g., '30')
 *                INCLUSION / EXCLUSION POLYGONS (inclusion, exclusion):
 *                Each feature must contain:
 *                - 'value': 1 to flag the area
 * ==============================================================================
 */

// ==============================================================================
// 1. USER PARAMETERS
// ==============================================================================

var param = {
  regionCode:            30601,
  country:               'COLOMBIA',
  previewYears:          [1985, 2023],
  samples: [
    100,  // No-Mining (Class 27)
    500   // Mining (Class 30)
  ],
  versionOutput:         '1',
  frequencyRefThreshold: 5,     // minimum Col2 occurrence count for stable mining
  remapStablePixel: {
    polygons: [
      typeof to_mining    !== 'undefined' ? to_mining    : null,
      typeof to_no_mining !== 'undefined' ? to_no_mining : null
    ]
  },
  classificationArea: {
    versionClassArea: '1',      // Version from Step 1 mask
    inclusion: typeof inclusion !== 'undefined' ? inclusion : null,
    exclusion: typeof exclusion !== 'undefined' ? exclusion : null,
    useShapefile: false,
    shpVersion:   '1'
  },
  exportAssets: {
    geometries: false
  }
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

var featureSpace = [
  'blue_median', 'green_median', 'red_median', 'red_wet',
  'nir_median',  'nir_wet',      'swir1_median', 'swir2_median',
  'ndvi_median', 'ndvi_wet',     'wefi_wet',   'gcvi_wet',
  'sefi_median', 'soil_median',  'snow_median', 'evi2_median',
  'ndwi_mcfeeters_median', 'mndwi_median', 'slope', 'slppost',
  'elevation', 'shade_mask2', 'ferrous_median', 'clay_median',
  'iron_oxide_median'
];

// ==============================================================================
// 2. IMPORTS & ASSETS
// ==============================================================================

var pointsPalette = require('users/mapbiomas/modules:Palettes.js').get('classification9');

var basePath = 'projects/ee-mapbiomasdeveloper/assets/';
var assets = {
  regions:          basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/MINING/Regiones_Mineria_2024_2',
  samplesOutput:    basePath + 'LULC/COLLECTION3/CROSS_CUTTING/MINING/SAMPLES/',
  miningMaskPath:   basePath + 'LULC/COLLECTION3/CROSS_CUTTING/MINING/STEP1_REGIONS/classification_mask/',
  collection2:      'projects/mapbiomas-public/assets/colombia/collection2/mapbiomas_colombia_collection2_integration_v1',
  regionesMosaicos: basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/regiones-mosaicos-2024-buffer-250',
  shpGeometryBase:  'projects/mapbiomas-raisg/MUESTRAS/'
};

// ==============================================================================
// 3. SAMPLING WORKFLOW
// ==============================================================================

var SampleMining = function(param) {

  this.init = function(param) {
    var _this = this;

    var region     = _this.getRegion(assets.regions, param.regionCode);
    var regionMask = region.rasterMask;
    var mosaics    = _this.getMosaic(region.vector);

    var classAreaPath = assets.miningMaskPath + 'MINING-REF-ACCUM-' + param.country + '-' + param.regionCode + '-' + param.classificationArea.versionClassArea;
    var shpPath       = assets.shpGeometryBase + param.country + '/COLECCION6/TRANSVERSALES/MINERIA/STEP3_GEOMETRY/mining-' + param.regionCode + '-' + param.country + '-' + param.classificationArea.shpVersion;
    var fileName      = 'mining-' + param.regionCode + '-' + param.country + '-' + param.versionOutput;

    var miningCol2        = ee.Image(assets.collection2).eq(30);
    var accumulatedMining = miningCol2.reduce('sum').selfMask();

    var classArea = ee.Image(classAreaPath).updateMask(regionMask);
    classArea = _this.applyInclusionExclusion(classArea, param.classificationArea.inclusion, param.classificationArea.exclusion);

    var geometriesIE = ee.FeatureCollection([param.classificationArea.inclusion, param.classificationArea.exclusion]).flatten();

    if (param.classificationArea.useShapefile) {
      var inclusionSHP = ee.FeatureCollection(shpPath).filter(ee.Filter.eq('type', 'inclusion'));
      var exclusionSHP = ee.FeatureCollection(shpPath).filter(ee.Filter.eq('type', 'exclusion'));
      classArea = _this.applyInclusionExclusion(classArea, inclusionSHP, exclusionSHP);
      Map.addLayer(inclusionSHP, {}, 'Inclusion SHP', false);
      Map.addLayer(exclusionSHP, {}, 'Exclusion SHP', false);
    }

    var miningRef = accumulatedMining.gte(param.frequencyRefThreshold)
      .rename('reference')
      .updateMask(regionMask);

    var notMiningRef = ee.Image(0).where(classArea.eq(1), 27).selfMask();

    var stableReference = ee.Image(0)
      .where(notMiningRef, 27)
      .where(miningRef.eq(1), 30)
      .updateMask(regionMask)
      .updateMask(classArea)
      .rename('reference');

    var validPolygons = param.remapStablePixel.polygons.filter(function(poly) { return poly !== null; });
    stableReference = _this.remapWithPolygons(stableReference, validPolygons);
    stableReference = stableReference.updateMask(classArea);

    var points = stableReference
      .addBands(ee.Image.pixelLonLat())
      .stratifiedSample({
        numPoints:   0,
        classBand:   'reference',
        region:      region.vector.geometry().bounds(),
        scale:       30,
        seed:        1,
        geometries:  true,
        dropNulls:   true,
        classValues: [30, 27],
        classPoints: [param.samples[1], param.samples[0]]
      });

    Map.setOptions('SATELLITE');

    var dem        = ee.Image('JAXA/ALOS/AW3D30_V1_1').select('AVE');
    var slope      = ee.Terrain.slope(dem).rename('slope');
    var slppost    = ee.Image('projects/mapbiomas-raisg/MOSAICOS/slppost2_30_v2').rename('slppost');
    var shadeMask2 = ee.Image('projects/mapbiomas-raisg/MOSAICOS/shademask2_v2').rename('shade_mask2');

    var samplesList = ee.List([]);

    years.forEach(function(year) {
      var mosaic = mosaics
        .filter(ee.Filter.eq('year', Number(year)))
        .median()
        .addBands(dem.rename('elevation'))
        .addBands(slope)
        .addBands(slppost)
        .addBands(shadeMask2)
        .updateMask(regionMask);

      mosaic = _this.addMiningIndices(mosaic);

      var mosaicSel = mosaic.updateMask(mosaic.select('blue_median'))
        .select(featureSpace)
        .updateMask(classArea);

      var trainingSamples = _this.extractSamples(stableReference, mosaicSel, points);

      samplesList = samplesList.add(trainingSamples.map(function(feature) {
        return feature.set('year', year);
      }));

      if (param.previewYears.indexOf(year) > -1) {
        Map.addLayer(mosaic, { bands: ['swir1_median', 'nir_median', 'red_median'], gain: [0.08, 0.06, 0.2] }, 'Mosaic S,N,R ' + year, false);
        Map.addLayer(mosaic, { bands: ['nir_median', 'swir1_median', 'red_median'], gain: [0.08, 0.06, 0.2] }, 'Mosaic N,S,R ' + year, false);
        Map.addLayer(mosaic.select('ferrous_median').updateMask(regionMask),    { min: 0, max: 1, palette: ['blue', 'red',   'green'] }, 'Ferrous '    + year, false);
        Map.addLayer(mosaic.select('iron_oxide_median').updateMask(regionMask), { min: 0, max: 5, palette: ['blue', 'white', 'cyan']  }, 'Iron Oxide ' + year, false);
        Map.addLayer(mosaic.select('clay_median').updateMask(regionMask),       { min: 0, max: 5, palette: ['blue', 'white', 'brown'] }, 'Clay '       + year, false);
      }
    });

    samplesList = ee.FeatureCollection(samplesList).flatten();

    Export.table.toAsset(samplesList, fileName, assets.samplesOutput + fileName);

    if (param.exportAssets.geometries) {
      var assetIdG = assets.shpGeometryBase + param.country + '/COLECCION6/TRANSVERSALES/MINERIA/STEP2_GEOMETRY/' + fileName;
      Export.table.toAsset(geometriesIE, 'geom-' + fileName, assetIdG);
    }

    Map.addLayer(region.vector, {}, 'Region', true);
    Map.addLayer(classArea, { palette: ['fcff00'] }, 'Classification Area', false);
    Map.addLayer(stableReference, { min: 0, max: 50, palette: pointsPalette }, 'Stable Reference', false);

    var eeColors     = ee.List(pointsPalette);
    var styledPoints = ee.FeatureCollection(points).map(function(feature) {
      return feature.set('style', { color: eeColors.get(feature.get('reference')), pointSize: 4 });
    });
    Map.addLayer(styledPoints.style({ styleProperty: 'style' }), {}, 'Training Points', false);
  };

  // ==============================================================================
  // HELPER METHODS
  // ==============================================================================

  /**
   * Generates the region of interest vector and raster mask.
   */
  this.getRegion = function(regionPath, regionCode) {
    var regionData = ee.FeatureCollection(regionPath)
      .filter(ee.Filter.eq('id_regionc', regionCode));
    var regionMask = regionData
      .map(function(item) { return item.set('version', 1); })
      .reduceToImage(['version'], ee.Reducer.first());
    return { vector: regionData, rasterMask: regionMask };
  };

  /**
   * Retrieves and clips image mosaics to the region of interest.
   */
  this.getMosaic = function(regionObj) {
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
  };

  /**
   * Computes mining-specific spectral indices and adds them as bands.
   */
  this.addMiningIndices = function(image) {
    var ferrous   = image.expression('SWIR1 / NIR',   { SWIR1: image.select('swir1_median'), NIR:   image.select('nir_median')  }).rename('ferrous_median');
    var clay      = image.expression('SWIR1 / SWIR2', { SWIR1: image.select('swir1_median'), SWIR2: image.select('swir2_median') }).rename('clay_median');
    var ironOxide = image.expression('RED / BLUE',    { RED:   image.select('red_median'),   BLUE:  image.select('blue_median') }).rename('iron_oxide_median');
    return image.addBands(ferrous).addBands(clay).addBands(ironOxide);
  };

  /**
   * Applies inclusion and exclusion masks to the classification area.
   */
  this.applyInclusionExclusion = function(baseLayer, includeFea, excludeFea) {
    if (excludeFea !== null) {
      var exclusionRaster = ee.FeatureCollection(excludeFea).reduceToImage(['value'], ee.Reducer.first()).eq(1);
      baseLayer = baseLayer.where(exclusionRaster.eq(1), 0).selfMask();
    }
    if (includeFea !== null) {
      var inclusionRaster = ee.FeatureCollection(includeFea).reduceToImage(['value'], ee.Reducer.first()).eq(1);
      baseLayer = ee.Image(0).where(baseLayer.eq(1), 1).where(inclusionRaster.eq(1), 1).selfMask();
    }
    return baseLayer;
  };

  /**
   * Remaps stable pixel classes within defined polygons.
   */
  this.remapWithPolygons = function(stablePixels, polygonsList) {
    if (polygonsList.length > 0) {
      polygonsList.forEach(function(polygon) {
        var excluded = polygon.map(function(layer) {
          var area     = stablePixels.clip(layer);
          var fromList = ee.String(layer.get('original')).split(',').map(function(item) { return ee.Number.parse(item); });
          var toList   = ee.String(layer.get('new')).split(',').map(function(item) { return ee.Number.parse(item); });
          return area.remap(fromList, toList);
        });
        excluded     = ee.ImageCollection(excluded).mosaic();
        stablePixels = excluded.unmask(stablePixels).rename('reference');
        stablePixels = stablePixels.mask(stablePixels.neq(0));
      });
    }
    return stablePixels;
  };

  /**
   * Samples mosaic values at stratified random point locations.
   */
  this.extractSamples = function(reference, mosaic, points) {
    return reference.addBands(mosaic).sampleRegions({
      collection: points,
      properties: ['reference'],
      scale:      30,
      geometries: true,
      tileScale:  4
    });
  };

  return this.init(param);
};

// RUN
var runMiningSampling = new SampleMining(param);
