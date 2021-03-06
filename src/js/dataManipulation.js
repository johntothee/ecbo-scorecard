import {Dashboard} from "./dashboard";

const BLK = /(.+)\//
const LOT = /[\/\.](.+)/
const METRICS = ['benchmark', 'energy_star_score', 'site_eui_kbtu_ft2', 'source_eui_kbtu_ft2', 'percent_better_than_national_median_site_eui', 'percent_better_than_national_median_source_eui', 'total_ghg_emissions_metric_tons_co2e', 'total_ghg_emissions_intensity_kgco2e_ft2', 'weather_normalized_site_eui_kbtu_ft2', 'weather_normalized_source_eui_kbtu_ft2']
const LIMITEDMETRICS = ['latest_energy_star_score', 'latest_total_ghg_emissions_metric_tons_co2e', 'latest_site_eui_kbtu_ft2']
const RANKINGMETRIC = 'latest_energy_star_score'
const RANKINGMETRICTIEBREAK = 'latest_site_eui_kbtu_ft2'

/** @function parseSingleRecord
 * parse the returned property record object
 * @param {object} record - the record object returned from SODA
 * @returns {object} the record from @param with our "latest_" properties added
 */
function parseSingleRecord (record) {
  if (record.parcel_s === undefined) { return null }
  if (!record.hasOwnProperty('property_type_self_selected')) { record.property_type_self_selected = 'N/A' }
  record.parcel1 = BLK.exec(record.parcel_s)[1]
  record.parcel2 = LOT.exec(record.parcel_s)[1]
  record.blklot = '' + record.parcel1 + record.parcel2
  record.ID = '' + record.blklot
  METRICS.forEach(function (metric) {
    record = latest(metric, record)
  })
  record = trendData(record);
  return record
}

/** @function latest
 * loop through a single parcel to find the latest data
 * @param {string} metric - the parcel metric being recorded
 * @param {object} entry - the parcel record object
 * @returns {object} - the entry param with new "latest_" properties
 */
function latest (metric, entry) {
  var thisYear = new Date().getFullYear()
  var years = []
  for (let i = 2011; i < thisYear; i++) {
    years.push(i)
  }
  if (metric === 'benchmark') years.unshift(2010)
  var yearTest = years.map(function (d) {
    if (metric === 'benchmark') return 'benchmark_' + d + '_status'
    else return '_' + d + '_' + metric
  })
  yearTest.forEach(function (year, i) {
    if (entry[year] != null) {
      entry['latest_' + metric] = entry[year]
      entry['latest_' + metric + '_year'] = years[i]
    } else {
      entry['latest_' + metric] = entry['latest_' + metric] || 'N/A'
      entry['latest_' + metric + '_year'] = entry['latest_' + metric + '_year'] || 'N/A'
    }
    if (!isNaN(+entry['latest_' + metric])) {
      entry['latest_' + metric] = roundToTenth(+entry['latest_' + metric])
    }
  })
  if (metric !== 'benchmark') {
    entry['pct_change_one_year_' + metric] = calcPctChange(entry, metric, 1)
    entry['pct_change_two_year_' + metric] = calcPctChange(entry, metric, 2)
  }
  if (metric === 'benchmark') {
    var prevYear = 'benchmark_' + (entry.latest_benchmark_year - 1) + '_status'
    entry['prev_year_benchmark'] = entry[prevYear]
  }
  return entry
}

function calcPctChange (entry, metric, yearsBack) {
  let prev = getPrevYearMetric(entry, metric, yearsBack)
  let pctChange = (+entry['latest_' + metric] - prev) / prev
  return pctChange * 100
}
function getPrevYearMetric (entry, metric, yearsBack) {
  let targetYear = entry['latest_' + metric + '_year'] - yearsBack
  let key = (metric === 'benchmark') ? `benchmark_${targetYear}_status` : `_${targetYear}_${metric}`
  return +entry[key]
}
function roundToTenth (num) {
  return Math.round(10 * num) / 10
}

/** @function apiDataToArray
 * transform record array to get a simpler, standardized array of k-v pairs
 * @param {array} data - the input array of data records
 * @returns {array} an array of objects only LIMITEDMETRICS keys
 */
function apiDataToArray (data) {
  let arr = data.map((parcel) => {
    // if ( typeof parcel != 'object' || parcel === 'null' ) continue
    let res = {id: parcel.ID}
    LIMITEDMETRICS.forEach(metric => {
      res[metric] = (typeof parseInt(parcel[metric]) === 'number' && !isNaN(parcel[metric])) ? parseInt(parcel[metric]) : -1
    })
    return res
  })
  return arr
}

/** @function rankBuildings
 * ranking algorithim: sort desc by prop, then desc by prop2
 * @param {string} id - building "ID" number
 * @param {array} bldgArray - processed/simplified building data
 * @param {string} prop - the property to rank by
 * @param {string} prop2 - the property to rank by if a[prop] === b[prop]
 * @returns {array} [rank, count]
 */
function rankBuildings (id, bldgArray, prop = RANKINGMETRIC, prop2 = RANKINGMETRICTIEBREAK) {
  // TODO: allow specify sort ascending or descending

  // polyfill for ie11 support https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/findIndex
  if (!Array.prototype.findIndex) {
    Object.defineProperty(Array.prototype, 'findIndex', {
      value: function(predicate) {
        if (this == null) {
          throw new TypeError('"this" is null or not defined');
        }
        var o = Object(this);
        var len = o.length >>> 0;
        if (typeof predicate !== 'function') {
          throw new TypeError('predicate must be a function');
        }
        var thisArg = arguments[1];
        var k = 0;
        while (k < len) {
          var kValue = o[k];
          if (predicate.call(thisArg, kValue, k, o)) {
            return k;
          }
          k++;
        }
        return -1;
      }
    });
  }

  let sorted = bldgArray.sort(function (a, b) {
    if (+a[prop] === +b[prop]) {
      return +a[prop2] - +b[prop2]
    }
    return +b[prop] - +a[prop]
  })

  sorted = sorted.filter(el => { return el[prop] > 0 })

  let rank = sorted.findIndex(function (el) { return el.id === id })
  if (rank === -1) return false // indicates building not in ranking array
  rank += 1
  let count = sorted.length

  return [rank, count]
}

/** @function cleanData
 * remove property listings that don't meet criteria provided by SF Dept of Env
 * @param {array} inputData - data from socrata
 * @returns {array} - % change eui has not increased by more than 100 nor decreased by 80 over the previous 2 years
 */
function cleanData (inputData) {
  var filtered = inputData.filter(function (el) {
    var cond1 = true;
    var cond2 = true;
    var currentBenchMark = true;

    if (!isNaN(el.pct_change_one_year_site_eui_kbtu_ft2)) {
      // Only perform math on numbers
      cond1 = (el.pct_change_one_year_site_eui_kbtu_ft2 <= 100) && (el.pct_change_one_year_site_eui_kbtu_ft2 >= -80);
    }
    if (!isNaN(el.pct_change_two_year_site_eui_kbtu_ft2)) {
      cond2 = (el.pct_change_two_year_site_eui_kbtu_ft2 <= 100) && (el.pct_change_two_year_site_eui_kbtu_ft2 >= -80);
    }
    var cond3 = el[RANKINGMETRIC] !== undefined

    if (el.latest_benchmark !== 'Complied') {
      currentBenchMark = false;
    }
    return (cond1 && cond2 && cond3 && currentBenchMark)
  })
  return filtered
}

/** @function trendData
 * generate weather normalized year array and percentage changes
 * @param {object} entry - the parcel record object
 * @returns {object} - the entry param with trend data populated
 */
function trendData(entry) {
  var years = [];
  var index = '';
  var value = false;
  let latestYear = entry['latest_weather_normalized_site_eui_kbtu_ft2_year'];
  years.push({year: latestYear, value: entry['latest_weather_normalized_site_eui_kbtu_ft2'], pctChange: false});
  latestYear--;
  while (latestYear >= 2013) {
    index = '_' + latestYear + '_weather_normalized_site_eui_kbtu_ft2';
    value = entry[index];
    if (isNumeric(value)) {
      years.push({year: latestYear, value: parseFloat(value), pctChange: ''});
    }
    latestYear--;
  }
  for (var index in years) {
    if (isNumeric(years[index].value)) {
      var next = +index + 1;
      if ((typeof years[+index+1] !== 'undefined') && isNumeric(years[+index+1].value)) {
        years[index].pctChange = roundToTenth(calcPctChangeSimple(years[index].value, years[+index+1].value));
      }
    }
  }
  entry['weather_normalized_trends'] = years;
  let latest = +entry['latest_weather_normalized_site_eui_kbtu_ft2'];
  let last = years[years.length - 1];
  entry['last_weather_normalized_site_eui_kbtu_ft2_year'] = last.year;
  entry['weather_normalized_pct_change_total'] = roundToTenth(calcPctChangeSimple(latest, last.value));

  return entry
}

function calcPctChangeSimple (val1, val2) {
  let pctChange = (val1 - val2) / val2;
  return pctChange * 100
}

/*
isNumeric function in Javascript
*/
function isNumeric(n) {
  return !isNaN(parseFloat(n)) && isFinite(n) && (n !== 'undefined');
}

export {parseSingleRecord, apiDataToArray, rankBuildings, cleanData}
