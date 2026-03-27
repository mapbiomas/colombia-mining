/**
 * ==============================================================================
 * MAPBIOMAS COLOMBIA - COLLECTION 3 - CROSS-CUTTING: MINING
 * STEP 03: RANDOM FOREST CLASSIFICATION
 * ==============================================================================
 * @version       1.0
 * @update        March 2026
 * @attribution   MapBiomas Colombia (Fundacion Gaia Amazonas)
 * @description   Trains a Random Forest classifier using Step 2 samples,
 *                optionally appends manual stable/non-stable samples on the fly,
 *                and classifies the annual mosaics to extract mining areas (Class 30).
 *                Applies temporal exclusion masks and water masks.
 * @inputs        - Region vector (Regiones_Mineria_2024_2)
 *                - Step 2 training samples (MINING/SAMPLES/)
 *                - Step 1 classification mask (classification_mask/)
 *                - Collection 2 integration image
 *                - Mosaic ImageCollections (mosaics-3-ct, mosaics-6, mosaics-3, col-amazonia-pathrow)
 * @outputs       - Earth Engine Asset: classified multiband image
 *                  saved to 'MINING/clasificacion/'
 * @geom_struct   STABLE SAMPLE POLYGONS (geometry_30, geometry_27):
 *                No required properties — class is assigned from param.additionalSamples.classes
 *                NON-STABLE SAMPLE POLYGONS (Muestra30_2020_2023):
 *                Each feature must contain:
 *                - 't0':        First year of the range (e.g., 2020)
 *                - 't1':        Last year of the range (e.g., 2023)
 *                - 'reference': Class ID to assign (e.g., 30)
 *                YEAR-RANGE EXCLUSION POLYGONS (exclusion_2020_2023):
 *                Each feature must contain:
 *                - 't0': First year to exclude
 *                - 't1': Last year to exclude
 *                INCLUSION / EXCLUSION POLYGONS (inclusion, exclusion):
 *                Each feature must contain:
 *                - 'value': 1 to flag the area
 *                WATER MASK POLYGON (mask_water):
 *                Each feature must contain:
 *                - 'value': 33 to override the water mask in the area
 * ==============================================================================
 */

// ==============================================================================
// 1. USER PARAMETERS
// ==============================================================================

var param = {
  regionCode:         30601,
  country:            'COLOMBIA',
  trees:              75,
  previewYears:       [2025, 2023, 2022, 2021, 2020, 2019],
  tileScale:          8,
  versionInputSample: '1',
  versionOutputClass: '1',
  gswThreshold:       1,   // Global Surface Water threshold for 2023+ (earlier years use Col2)

  additionalSamples: {
    polygons: [
      typeof geometry_30 !== 'undefined' ? geometry_30 : null,
      typeof geometry_27 !== 'undefined' ? geometry_27 : null
    ],
    classes: [30, 27],
    points:  [1000, 1000]
  },

  additionalSamplesNoStable: {
    polygons: [typeof Muestra30_2020_2023 !== 'undefined' ? Muestra30_2020_2023 : null]
  },

  classificationArea: {
    versionClassArea:          '1',
    inclusion: typeof inclusion          !== 'undefined' ? inclusion          : null,
    exclusion: typeof exclusion          !== 'undefined' ? exclusion          : null,
    exclusionYearRangePolygons: [typeof exclusion_2020_2023 !== 'undefined' ? exclusion_2020_2023 : null],
    useShapefile: true,
    shpVersion:   '1'
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

var maskWaterFea = typeof mask_water !== 'undefined' ? mask_water : ee.FeatureCollection([]);

// ==============================================================================
// 2. IMPORTS & ASSETS
// ==============================================================================

var mapbiomasPalette = require('users/mapbiomas_caribe/public_repo_mbcolombia:mbcolombia-col3/modules/Palettes.js').get('ColombiaCol3');

var basePath = 'projects/ee-mapbiomasdeveloper/assets/';
var assets = {
  regions:          basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/MINING/Regiones_Mineria_2024_2',
  miningMaskPath:   basePath + 'LULC/COLLECTION3/CROSS_CUTTING/MINING/STEP1_REGIONS/classification_mask/',
  samplesOutput:    basePath + 'LULC/COLLECTION3/CROSS_CUTTING/MINING/SAMPLES/',
  classifOutput:    basePath + 'LULC/COLLECTION3/CROSS_CUTTING/MINING/clasificacion/',
  collection2:      'projects/mapbiomas-public/assets/colombia/collection2/mapbiomas_colombia_collection2_integration_v1',
  regionesMosaicos: basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/regiones-mosaicos-2024-buffer-250'
};

// ==============================================================================
// 3. CLASSIFICATION WORKFLOW
// ==============================================================================

var MiningClassification = function(param) {

  this.init = function() {
    Map.setOptions({ mapTypeId: 'SATELLITE' });
    var _this = this;

    var region     = _this.getRegion(assets.regions, param.regionCode);
    var regionMask = region.rasterMask;
    var mosaic     = _this.getMosaic(region.vector);

    var classAreaPath = assets.miningMaskPath + 'MINING-REF-ACCUM-' + param.country + '-' + param.regionCode + '-' + param.classificationArea.versionClassArea;
    var classArea = ee.Image(classAreaPath).updateMask(regionMask);
    classArea = _this.applyInclusionExclusion(classArea, param.classificationArea.inclusion, param.classificationArea.exclusion);

    var validExclusionPolys = param.classificationArea.exclusionYearRangePolygons.filter(function(p) { return p !== null; });
    var exclusionStartingMask, exclusionFinishMask;

    if (validExclusionPolys.length > 0) {
      var fixedOverlaps     = validExclusionPolys.map(function(fea) { return fea.union(fea); });
      var allExclusionAreas = ee.FeatureCollection(fixedOverlaps);
      exclusionStartingMask = allExclusionAreas.reduceToImage(['t0'], ee.Reducer.min())
        .clipToBoundsAndScale({ geometry: allExclusionAreas.geometry(), scale: 30 });
      exclusionFinishMask = allExclusionAreas.reduceToImage(['t1'], ee.Reducer.max())
        .clipToBoundsAndScale({ geometry: allExclusionAreas.geometry(), scale: 30 });
    }

    var safeWaterMask = null;
    if (maskWaterFea.size().getInfo() >= 1) {
      safeWaterMask = maskWaterFea.reduceToImage(['value'], ee.Reducer.first())
        .clipToBoundsAndScale({ geometry: maskWaterFea.geometry(), scale: 30 });
    }

    var samplesFileName = 'mining-' + param.regionCode + '-' + param.country + '-' + param.versionInputSample;
    var trainingSamples = ee.FeatureCollection(assets.samplesOutput + samplesFileName);
    print('Loaded Step 2 Samples:', trainingSamples.limit(5));

    var classifier = ee.Classifier.smileRandomForest({
      numberOfTrees:     param.trees,
      variablesPerSplit: 1
    });

    var dem        = ee.Image('JAXA/ALOS/AW3D30_V1_1').select('AVE');
    var slope      = ee.Terrain.slope(dem).rename('slope');
    var slppost    = ee.Image('projects/mapbiomas-raisg/MOSAICOS/slppost2_30_v2').rename('slppost');
    var shadeMask2 = ee.Image('projects/mapbiomas-raisg/MOSAICOS/shademask2_v2').rename('shade_mask2');
    var globalWater = ee.Image('JRC/GSW1_2/GlobalSurfaceWater').select('occurrence').gte(param.gswThreshold).updateMask(regionMask);

    var miningRefCol2 = ee.Image(assets.collection2).eq(30);
    var waterRefCol2  = ee.Image(assets.collection2).eq(33)
      .addBands(globalWater.rename('classification_2024'))
      .addBands(globalWater.rename('classification_2025'))
      .updateMask(regionMask);

    var accumulatedMiningRef = miningRefCol2.reduce('max').multiply(30).selfMask();

    var geomBounds = ee.FeatureCollection(region.vector.geometry().bounds())
      .map(function(item) { return item.set('version', 1); })
      .reduceToImage(['version'], ee.Reducer.first());

    var validNoStablePolys    = param.additionalSamplesNoStable.polygons.filter(function(p) { return p !== null; });
    var regionsNoStableSample = ee.FeatureCollection(validNoStablePolys).flatten();
    var yearst0 = validNoStablePolys.length > 0 ? regionsNoStableSample.aggregate_min('t0').getInfo() : null;
    var yearst1 = validNoStablePolys.length > 0 ? regionsNoStableSample.aggregate_max('t1').getInfo() : null;

    var finalClassifiedImage = ee.Image().byte();

    years.forEach(function(year) {
      var yearMosaic = mosaic.filter(ee.Filter.eq('year', year))
        .median()
        .addBands(dem.rename('elevation'))
        .addBands(slope)
        .addBands(slppost)
        .addBands(shadeMask2)
        .updateMask(regionMask);

      yearMosaic = _this.addMiningIndices(yearMosaic);

      var yearMosaicSel = yearMosaic.select(featureSpace)
        .updateMask(yearMosaic.select('blue_median').gte(0))
        .updateMask(classArea);

      var yearSamples = trainingSamples.filter(ee.Filter.eq('year', year))
        .map(function(fea) { return _this.removeProperty(fea, 'year'); });

      var validStablePolys = param.additionalSamples.polygons.filter(function(p) { return p !== null; });
      if (validStablePolys.length > 0) {
        var insidePolygons  = ee.FeatureCollection(validStablePolys).flatten().reduceToImage(['id'], ee.Reducer.first());
        var outsidePolygons = geomBounds.updateMask(insidePolygons.mask().eq(0).selfMask());
        var outsideVector   = outsidePolygons.reduceToVectors({
          reducer:   ee.Reducer.countEvery(),
          geometry:  region.vector.geometry().bounds(),
          scale:     30,
          maxPixels: 1e13
        });
        var newStableSamples = _this.resampleCover(yearMosaicSel, param.additionalSamples);
        yearSamples = yearSamples.filterBounds(outsideVector).merge(newStableSamples);
      }

      if (validNoStablePolys.length > 0 && year >= yearst0 && year <= yearst1) {
        var polysThisYear      = regionsNoStableSample.filterBounds(region.vector)
          .filter(ee.Filter.and(ee.Filter.lte('t0', year), ee.Filter.gte('t1', year)));
        var newNoStableSamples = yearMosaicSel.sampleRegions(polysThisYear, ['reference'], 30, null, 4);
        yearSamples = yearSamples.merge(newNoStableSamples);
      }

      var featureSpaceSafe = featureSpace.filter(function(band) { return band !== 'iron_oxide_median'; });
      var classified = _this.classifyRandomForests(yearMosaicSel.select(featureSpaceSafe), classifier, yearSamples);

      var bandName  = 'classification_' + year.toString();
      var waterYear = waterRefCol2.select(bandName);
      if (safeWaterMask !== null) {
        waterYear = waterYear.where(safeWaterMask.eq(33), 0);
      }
      classified = classified.where(waterYear.eq(1), 27);

      if (validExclusionPolys.length > 0) {
        classified = classified.where(exclusionStartingMask.lte(year).and(exclusionFinishMask.gte(year)), 27);
      }

      finalClassifiedImage = finalClassifiedImage.addBands(classified.rename(bandName));

      if (param.previewYears.indexOf(year) > -1) {
        Map.addLayer(yearMosaic, { bands: ['swir1_median', 'nir_median', 'red_median'], gain: [0.08, 0.06, 0.2] }, 'Mosaic S,N,R ' + year, false);
        Map.addLayer(yearMosaic.select('ferrous_median').updateMask(regionMask), { min: 0, max: 1, palette: ['blue', 'red', 'green'] }, 'Ferrous ' + year, false);
        Map.addLayer(classified.eq(30).selfMask().multiply(30).rename(bandName).updateMask(classArea), { min: 0, max: 69, palette: mapbiomasPalette }, 'Classification ' + year, false);
      }
    });

    var exportName = 'MINING-' + param.regionCode + '-' + param.country + '-RF-' + param.versionOutputClass;

    finalClassifiedImage = finalClassifiedImage.slice(1).updateMask(classArea).byte()
      .set({
        code_region: param.regionCode,
        country:     param.country,
        method:      'Random forest',
        version:     param.versionOutputClass
      });

    print('Final Classified Image to Export:', finalClassifiedImage);

    Export.image.toAsset({
      image:       finalClassifiedImage,
      description: exportName,
      assetId:     assets.classifOutput + exportName,
      region:      region.vector.geometry().bounds(),
      scale:       30,
      maxPixels:   1e13
    });

    Map.addLayer(region.vector.style({ fillColor: '00000000' }), {}, 'Region', true);
    Map.addLayer(classArea.mask(classArea), { opacity: 0.2, palette: ['00FFFF'] }, 'Classification Area', false);
    Map.addLayer(accumulatedMiningRef.clip(region.vector), { palette: ['purple'] }, 'Accumulated Ref', false);
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
    var ferrous   = image.expression('SWIR1 / NIR',   { SWIR1: image.select('swir1_median'), NIR:   image.select('nir_median')   }).rename('ferrous_median');
    var clay      = image.expression('SWIR1 / SWIR2', { SWIR1: image.select('swir1_median'), SWIR2: image.select('swir2_median') }).rename('clay_median');
    var ironOxide = image.expression('RED / BLUE',    { RED:   image.select('red_median'),   BLUE:  image.select('blue_median')  }).rename('iron_oxide_median');
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
   * Draws stratified random samples from each polygon using the given mosaic.
   */
  this.resampleCover = function(mosaic, additionalSamples) {
    var polygons  = additionalSamples.polygons.filter(function(p) { return p !== null; });
    var classIds  = additionalSamples.classes;
    var points    = additionalSamples.points;
    var newSamples = [];
    polygons.forEach(function(polygon, i) {
      var newSample = mosaic.sample({
        numPixels:  points[i],
        region:     polygon,
        scale:      30,
        projection: 'EPSG:4326',
        seed:       1,
        geometries: true,
        tileScale:  param.tileScale
      }).map(function(item) { return item.set('reference', classIds[i]); });
      newSamples.push(newSample);
    });
    return ee.FeatureCollection(newSamples).flatten();
  };

  /**
   * Trains the classifier and returns a classified image, with safe fallbacks for empty inputs.
   */
  this.classifyRandomForests = function(mosaic, classifier, samples) {
    var bands  = mosaic.bandNames();
    var nBands = bands.size();
    var points = samples.size();

    var nClassSamples = ee.List(samples.reduceColumns(ee.Reducer.toList(), ['reference']).get('list')).reduce(ee.Reducer.countDistinct());

    var _classifier = ee.Classifier(
      ee.Algorithms.If(ee.Algorithms.IsEqual(nBands, 0), null,
        ee.Algorithms.If(ee.Algorithms.IsEqual(nClassSamples, 1), null, classifier.train(samples, 'reference', bands))
      )
    );

    var classified = ee.Image(
      ee.Algorithms.If(ee.Algorithms.IsEqual(points, 0),        ee.Image().rename('classification'),
        ee.Algorithms.If(ee.Algorithms.IsEqual(nBands, 0),      ee.Image().rename('classification'),
          ee.Algorithms.If(ee.Algorithms.IsEqual(nClassSamples, 1), ee.Image().rename('classification'),
            mosaic.classify(_classifier)
          )
        )
      )
    ).unmask(27).toByte();

    return classified.where(classified.neq(30), 27).where(classified.eq(30), 30);
  };

  /**
   * Returns a feature with the specified property removed.
   */
  this.removeProperty = function(feature, property) {
    var properties       = feature.propertyNames();
    var selectProperties = properties.filter(ee.Filter.neq('item', property));
    return feature.select(selectProperties);
  };

  this.init();
};

// RUN
var runMiningClassification = new MiningClassification(param);
