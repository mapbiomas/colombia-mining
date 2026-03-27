/**
 * ==============================================================================
 * MAPBIOMAS COLOMBIA - COLLECTION 3 - CROSS-CUTTING: MINING
 * STEP 04: TEMPORAL FILTER
 * ==============================================================================
 * @version       1.0
 * @update        March 2026
 * @attribution   MapBiomas Colombia (Fundacion Gaia Amazonas)
 * @description   Applies sliding-window temporal filters (3-, 4-, and 5-year)
 *                to smooth isolated class changes in the time series. Also
 *                enforces first-year and last-year boundary continuity.
 * @inputs        - Classification ImageCollection (clasificacion-ft/)
 *                - Region vector (Regiones_Mineria_2024_2)
 *                - Mosaic ImageCollections (mosaics-3-ct, mosaics-6, mosaics-3, col-amazonia-pathrow)
 * @outputs       - Earth Engine Asset: temporally filtered classification image
 *                  saved to 'MINING/clasificacion-ft/'
 * ==============================================================================
 */

// ==============================================================================
// 1. USER PARAMETERS
// ==============================================================================

var param = {
  regionCode:      30202,
  country:         'COLOMBIA',
  previewYears:    [1985, 2014, 2022],
  inputCollection: 'clasificacion-ft',
  versionInput:    '3',    // Input version
  versionOutput:   '4',    // Output version
  optionalFilters: {
    fourYears: true,
    fiveYears: true
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

// Class IDs passed to each filter stage
var orderExecFirst  = [1];     // Applied to first-year boundary filter
var orderExecLast   = [1];     // Applied to last-year boundary filter
var orderExecMiddle = [30];    // Applied to sliding-window filters

// ==============================================================================
// 2. IMPORTS & ASSETS
// ==============================================================================

var palettes = require('users/mapbiomas_caribe/public_repo_mbcolombia:mbcolombia-col3/modules/Palettes.js');
var mapbiomasPalette = palettes.get('ColombiaCol3');

var basePath = 'projects/ee-mapbiomasdeveloper/assets/';
var assets = {
  regions:          basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/MINING/Regiones_Mineria_2024_2',
  regionesMosaicos: basePath + 'PUBLIC_ASSETS/AUXILIARY_DATA/VECTORS/regiones-mosaicos-2024-buffer-250',
  inputPath:        basePath + 'LULC/COLLECTION3/CROSS_CUTTING/MINING/clasificacion-ft/',
  outputAsset:      basePath + 'LULC/COLLECTION3/CROSS_CUTTING/MINING/clasificacion-ft/'
};

// ==============================================================================
// 3. INITIALIZATION & DATA LOADING
// ==============================================================================

var region = getRegion(assets.regions, param.regionCode);
var mosaics = getMosaic(region.vector);

var imageName  = 'MINING-' + param.country + '-' + param.regionCode + '-' + param.versionInput;
var inputImage = ee.Image(assets.inputPath + imageName);

print('Input Image:', inputImage);

// ==============================================================================
// 4. PROCESSING
// ==============================================================================

var bandNames = ee.List(
  years.map(function(year) { return 'classification_' + String(year); })
);

// Rebuild image bands, removing no-data pixels
var classification = ee.Image();
var existingBands  = inputImage.bandNames().getInfo();
if (existingBands[0] === 'constant') {
  existingBands = existingBands.slice(1);
}

existingBands.forEach(function(bandName) {
  var band = inputImage.select(bandName);
  var band0 = band.updateMask(band.unmask().neq(0));
  classification = classification.addBands(band0.rename(bandName));
});

classification = classification.select(existingBands).unmask().updateMask(region.rasterMask);

// Fill missing year bands with class 27 (non-mining)
var bandsOccurrence = ee.Dictionary(
  bandNames.cat(classification.bandNames()).reduce(ee.Reducer.frequencyHistogram())
);

var bandsDictionary = bandsOccurrence.map(function(key, value) {
  return ee.Image(
    ee.Algorithms.If(
      ee.Number(value).eq(2),
      classification.select([key]),
      ee.Image(27).rename([key])
    )
  ).byte();
});

var allBandsImage = ee.Image(
  bandNames.iterate(
    function(band, image) {
      var newImage = ee.Image(bandsDictionary.get(ee.String(band)));
      newImage = newImage
        .where(newImage.eq(0), 27)
        .where(newImage.eq(1), 30)
        .rename(ee.String(band));
      return ee.Image(image).addBands(newImage).updateMask(region.rasterMask);
    },
    ee.Image().select()
  )
);

// years3: middle years for 3-year window (last 2 years appended unchanged)
// years4: middle years for 4-year window (last 3 years appended unchanged)
// years5: middle years for 5-year window (last 4 years appended unchanged)
var years3 = years.slice(1, -1).map(String);   // 1986–2024
var years4 = years3.slice(0, -1);              // 1986–2023
var years5 = years4.slice(0, -1);              // 1986–2022

var filtered = allBandsImage;

orderExecFirst.forEach(function(id_class) {
  filtered = mask3first(id_class, filtered);
});

orderExecLast.forEach(function(id_class) {
  filtered = mask3last(id_class, filtered);
});

orderExecMiddle.forEach(function(id_class) {
  filtered = window4years(filtered, id_class);
  filtered = window5years(filtered, id_class);
});

orderExecMiddle.forEach(function(id_class) {
  filtered = window3years(filtered, id_class);
});

orderExecMiddle.forEach(function(id_class) {
  filtered = window3years(filtered, id_class);
});

if (param.optionalFilters.fourYears && param.optionalFilters.fiveYears) {
  orderExecMiddle.forEach(function(id_class) {
    filtered = window4years(filtered, id_class);
    filtered = window5years(filtered, id_class);
  });
}

if (param.optionalFilters.fourYears) {
  orderExecMiddle.forEach(function(id_class) {
    filtered = window4years(filtered, id_class);
  });
}

if (param.optionalFilters.fiveYears) {
  orderExecMiddle.forEach(function(id_class) {
    filtered = window5years(filtered, id_class);
  });
}

// ==============================================================================
// 5. EXPORT
// ==============================================================================

var outputName = 'MINING-' + param.country + '-' + param.regionCode + '-' + param.versionOutput;

filtered = filtered.select(bandNames)
  .set({
    code_region: param.regionCode,
    country:     param.country,
    version:     param.versionOutput,
    process:     'temporal filter',
    step:        'S04-3'
  });

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

var nicfi   = ee.ImageCollection('projects/planet-nicfi/assets/basemaps/americas');
var basemap = nicfi.filter(ee.Filter.date('2022-12')).first();
Map.addLayer(basemap, { bands: ['R', 'G', 'B'], min: 64, max: 1050, gamma: 0.74 }, 'NICFI 2022-12', false);

param.previewYears.forEach(function(year) {
  var selector  = 'classification_' + year;
  var vis       = { bands: [selector], min: 0, max: mapbiomasPalette.length - 1, palette: mapbiomasPalette, format: 'png' };
  var mosaicVis = mosaics.filter(ee.Filter.eq('year', year)).mosaic().updateMask(region.rasterMask);

  Map.addLayer(mosaicVis, { bands: ['swir1_median', 'nir_median', 'red_median'], gain: [0.08, 0.06, 0.2] }, 'Mosaic ' + year, false);
  Map.addLayer(allBandsImage, vis, 'Classification Original ' + year, false);
  Map.addLayer(filtered,      vis, 'Classification Filtered ' + year, true);
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
 * 3-year sliding window: replaces curr with valor if prev==valor and next==valor.
 */
function mask3(valor, ano, imagem) {
  var prev = 'classification_' + (parseInt(ano, 10) - 1);
  var curr = 'classification_' + (parseInt(ano, 10));
  var next = 'classification_' + (parseInt(ano, 10) + 1);
  var mask     = imagem.select(prev).eq(valor).and(imagem.select(curr).neq(valor)).and(imagem.select(next).eq(valor));
  var muda_img = imagem.select(curr).mask(mask.eq(1)).where(mask.eq(1), valor);
  return imagem.select(curr).blend(muda_img);
}

/**
 * 4-year sliding window: replaces curr and next with valor if surrounded.
 */
function mask4(valor, ano, imagem) {
  var prev = 'classification_' + (parseInt(ano, 10) - 1);
  var curr = 'classification_' + (parseInt(ano, 10));
  var next = 'classification_' + (parseInt(ano, 10) + 1);
  var nex2 = 'classification_' + (parseInt(ano, 10) + 2);
  var mask      = imagem.select(prev).eq(valor).and(imagem.select(curr).neq(valor)).and(imagem.select(next).neq(valor)).and(imagem.select(nex2).eq(valor));
  var muda_img  = imagem.select(curr).mask(mask.eq(1)).where(mask.eq(1), valor);
  var muda_img1 = imagem.select(next).mask(mask.eq(1)).where(mask.eq(1), valor);
  return imagem.select(curr).blend(muda_img).blend(muda_img1);
}

/**
 * 5-year sliding window: replaces curr, next, nex2 with valor if surrounded.
 */
function mask5(valor, ano, imagem) {
  var prev = 'classification_' + (parseInt(ano, 10) - 1);
  var curr = 'classification_' + (parseInt(ano, 10));
  var next = 'classification_' + (parseInt(ano, 10) + 1);
  var nex2 = 'classification_' + (parseInt(ano, 10) + 2);
  var nex3 = 'classification_' + (parseInt(ano, 10) + 3);
  var mask      = imagem.select(prev).eq(valor).and(imagem.select(curr).neq(valor)).and(imagem.select(next).neq(valor)).and(imagem.select(nex2).neq(valor)).and(imagem.select(nex3).eq(valor));
  var muda_img  = imagem.select(curr).mask(mask.eq(1)).where(mask.eq(1), valor);
  var muda_img1 = imagem.select(next).mask(mask.eq(1)).where(mask.eq(1), valor);
  var muda_img2 = imagem.select(nex2).mask(mask.eq(1)).where(mask.eq(1), valor);
  return imagem.select('classification_' + ano).blend(muda_img).blend(muda_img1).blend(muda_img2);
}

/**
 * Enforces first-year continuity: sets 1985 to valor if 1986 and 1987 are valor.
 */
function mask3first(valor, imagem) {
  var mask     = imagem.select('classification_1985').neq(valor).and(imagem.select('classification_1986').eq(valor)).and(imagem.select('classification_1987').eq(valor));
  var muda_img = imagem.select('classification_1985').mask(mask.eq(1)).where(mask.eq(1), valor);
  var img_out  = imagem.select('classification_1985').blend(muda_img);
  return img_out.addBands([
    imagem.select('classification_1986'), imagem.select('classification_1987'),
    imagem.select('classification_1988'), imagem.select('classification_1989'),
    imagem.select('classification_1990'), imagem.select('classification_1991'),
    imagem.select('classification_1992'), imagem.select('classification_1993'),
    imagem.select('classification_1994'), imagem.select('classification_1995'),
    imagem.select('classification_1996'), imagem.select('classification_1997'),
    imagem.select('classification_1998'), imagem.select('classification_1999'),
    imagem.select('classification_2000'), imagem.select('classification_2001'),
    imagem.select('classification_2002'), imagem.select('classification_2003'),
    imagem.select('classification_2004'), imagem.select('classification_2005'),
    imagem.select('classification_2006'), imagem.select('classification_2007'),
    imagem.select('classification_2008'), imagem.select('classification_2009'),
    imagem.select('classification_2010'), imagem.select('classification_2011'),
    imagem.select('classification_2012'), imagem.select('classification_2013'),
    imagem.select('classification_2014'), imagem.select('classification_2015'),
    imagem.select('classification_2016'), imagem.select('classification_2017'),
    imagem.select('classification_2018'), imagem.select('classification_2019'),
    imagem.select('classification_2020'), imagem.select('classification_2021'),
    imagem.select('classification_2022'), imagem.select('classification_2023'),
    imagem.select('classification_2024'), imagem.select('classification_2025')
  ]);
}

/**
 * Enforces last-year continuity: sets 2025 to valor if 2023 and 2024 are valor.
 */
function mask3last(valor, imagem) {
  var mask     = imagem.select('classification_2023').eq(valor).and(imagem.select('classification_2024').eq(valor)).and(imagem.select('classification_2025').neq(valor));
  var muda_img = imagem.select('classification_2025').mask(mask.eq(1)).where(mask.eq(1), valor);
  var img_out  = imagem.select('classification_1985');
  img_out = img_out.addBands([
    imagem.select('classification_1986'), imagem.select('classification_1987'),
    imagem.select('classification_1988'), imagem.select('classification_1989'),
    imagem.select('classification_1990'), imagem.select('classification_1991'),
    imagem.select('classification_1992'), imagem.select('classification_1993'),
    imagem.select('classification_1994'), imagem.select('classification_1995'),
    imagem.select('classification_1996'), imagem.select('classification_1997'),
    imagem.select('classification_1998'), imagem.select('classification_1999'),
    imagem.select('classification_2000'), imagem.select('classification_2001'),
    imagem.select('classification_2002'), imagem.select('classification_2003'),
    imagem.select('classification_2004'), imagem.select('classification_2005'),
    imagem.select('classification_2006'), imagem.select('classification_2007'),
    imagem.select('classification_2008'), imagem.select('classification_2009'),
    imagem.select('classification_2010'), imagem.select('classification_2011'),
    imagem.select('classification_2012'), imagem.select('classification_2013'),
    imagem.select('classification_2014'), imagem.select('classification_2015'),
    imagem.select('classification_2016'), imagem.select('classification_2017'),
    imagem.select('classification_2018'), imagem.select('classification_2019'),
    imagem.select('classification_2020'), imagem.select('classification_2021'),
    imagem.select('classification_2022'), imagem.select('classification_2023'),
    imagem.select('classification_2024')
  ]);
  return img_out.addBands(imagem.select('classification_2025').blend(muda_img));
}

/**
 * Applies the 3-year window to years3; appends 2025 unchanged.
 */
function window3years(imagem, valor) {
  var img_out = imagem.select('classification_1985');
  years3.forEach(function(ano) {
    img_out = img_out.addBands(mask3(valor, ano, imagem));
  });
  return img_out.addBands(imagem.select('classification_2025'));
}

/**
 * Applies the 4-year window to years4; appends 2024 and 2025 unchanged.
 */
function window4years(imagem, valor) {
  var img_out = imagem.select('classification_1985');
  years4.forEach(function(ano) {
    img_out = img_out.addBands(mask4(valor, ano, imagem));
  });
  return img_out
    .addBands(imagem.select('classification_2024'))
    .addBands(imagem.select('classification_2025'));
}

/**
 * Applies the 5-year window to years5; appends 2023, 2024, and 2025 unchanged.
 */
function window5years(imagem, valor) {
  var img_out = imagem.select('classification_1985');
  years5.forEach(function(ano) {
    img_out = img_out.addBands(mask5(valor, ano, imagem));
  });
  return img_out
    .addBands(imagem.select('classification_2023'))
    .addBands(imagem.select('classification_2024'))
    .addBands(imagem.select('classification_2025'));
}
