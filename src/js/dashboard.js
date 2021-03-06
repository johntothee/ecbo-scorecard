'use strict'
import soda from 'soda-js'
import * as dataManipulation from './dataManipulation.js'
import * as apiCalls from './apiCalls.js'
import * as helpers from './helpers.js'

let Dashboard = {}

// TODO: CHANGE limit on returned properties in function propertyTypeQuery()

Dashboard.colorSwatches = {
  energy_star_score: ['#EF839E', '#ECD68C', '#80D9AF', '#4FAD8E'],
  total_ghg_emissions_intensity_kgco2e_ft2: ['#4FAD8E', '#80D9AF', '#ECD68C', '#EF839E'],
  site_eui_kbtu_ft2: ['#4FAD8E', '#80D9AF', '#ECD68C', '#EF839E', '#ed5b5b'], // has to be 5 colors for the gradient to look right
  highlight: '#3e6ee9',
  shaded: '#dadada'
}

Dashboard.color = {
  energy_star_score: d3.scale.threshold().range(Dashboard.colorSwatches.energy_star_score),
  total_ghg_emissions_intensity_kgco2e_ft2: d3.scale.threshold().range(Dashboard.colorSwatches.total_ghg_emissions_intensity_kgco2e_ft2),
  site_eui_kbtu_ft2: d3.scale.linear().range(Dashboard.colorSwatches.site_eui_kbtu_ft2),
  ranking: d3.scale.threshold().range(Dashboard.colorSwatches.total_ghg_emissions_intensity_kgco2e_ft2)
}

/* use soda-js to query */
// ref: https://github.com/socrata/soda-js
Dashboard.consumer = new soda.Consumer('data.sfgov.org')

Dashboard.groups = {
  Office: {
    plural: 'Offices',
    names: [
      '<25k',
      '25-50k',
      '50-100k',
      '100-300k',
      '>300k'
    ],
    floorArea: [
      25000,
      50000,
      100000,
      300000
    ]
  },
  Hotel: {
    plural: 'Hotels',
    names: [
      '<25k',
      '25-50k',
      '50-100k',
      '100-250k',
      '>250k'
    ],
    floorArea: [
      25000,
      50000,
      100000,
      250000
    ]
  },
  'Retail Store': {
    plural: 'Retail Stores',
    names: [
      '<20k',
      '>20k'
    ],
    floorArea: [
      20000
    ]
  }
}

Dashboard.nonGroup = {
  'Other': {
    plural: 'Others',
    names: [
      '<25k',
      '25-50k',
      '>50k',
    ],
    floorArea: [
      25000,
      50000,
    ],
  },
}

for (let category in Dashboard.groups) {
  /* d3.scale to get "similar" sized buildings */
  Dashboard.groups[category].scale = d3.scale.threshold()
        .domain(Dashboard.groups[category].floorArea)
        .range(Dashboard.groups[category].names)
}

/* d3.scale to get "similar" sized buildings */
Dashboard.nonGroup['Other'].scale = d3.scale.threshold()
    .domain(Dashboard.nonGroup['Other'].floorArea)
    .range(Dashboard.nonGroup['Other'].names)


/* example queries */
// console.log( apiCalls.formQueryString(testquery) )
// apiCalls.propertyQuery( Dashboard.consumer, 1, specificParcel, null, handleSingleBuildingResponse )
// apiCalls.propertyQuery( Dashboard.consumer, null, null, apiCalls.formQueryString(testquery), handlePropertyTypeResponse )
// apiCalls.propertyQuery( Dashboard.consumer, null, {property_type_self_selected:'Office'}, null, handlePropertyTypeResponse )

Dashboard.singleBuildingData = []
Dashboard.categoryData = []
Dashboard.floorAreaRange = []

Dashboard.startQuery = function () {
  var urlVars = helpers.getUrlVars()
  if (urlVars.apn === undefined) {
    console.error('APN not defined')
      // APN numbers look like "3721/014"
  } else {
    console.log('Trying APN: ' + urlVars['apn'])
    $('#view-welcome').addClass('hidden')
    $('#view-load').removeClass('hidden')
    apiCalls.propertyQuery(Dashboard.consumer, 1, {parcel_s: urlVars['apn']}, null, handleSingleBuildingResponse)
  }
}

/** @function handleSingleBuildingResponse
 * do something with the returned data, expects only one row
 * @param {array} rows - returned from consumer.query.getRows, expects rows.length === 0
 */
function handleSingleBuildingResponse (rows) {
  if (typeof rows[0] === 'undefined') {
    return $('#view-load').html('The record for the chosen building was not found')
  }
  Dashboard.singleBuildingData = dataManipulation.parseSingleRecord(rows[0]) // save data in global var
  let type = Dashboard.singleBuildingData.property_type_self_selected

  /* check to see if the returned building is one of our supported building types */
  if (Object.keys(Dashboard.groups).indexOf(type) === -1) {
    let minMax = Dashboard.nonGroup['Other'].scale.invertExtent(Dashboard.nonGroup['Other'].scale(+Dashboard.singleBuildingData.floor_area));
    Dashboard.floorAreaRange = minMax;
    // console.error('not a supported building type')
    // $('#view-load').html('SF Environment’s EBO postcards support buildings that are more than 80% office, hotel, or retail.
    // For information on how your building’s performance compares to national medians, check out
    // <a href="http://www.portfoliomanager.energystar.gov">www.portfoliomanager.energystar.gov</a>.')
  }
  else {
    let minMax = Dashboard.groups[type].scale.invertExtent(Dashboard.groups[type].scale(+Dashboard.singleBuildingData.floor_area));
    Dashboard.floorAreaRange = minMax;

  }
  apiCalls.propertyQuery(Dashboard.consumer, null, null, apiCalls.formQueryString({
    where: apiCalls.whereArray(type, Dashboard.floorAreaRange)}), Dashboard.handlePropertyTypeResponse)
}

/** @function cleanAndFilter
 * @param {array} rows - returned from consumer.query.getRows
 */
Dashboard.cleanAndFilter = function (rows) {
  // TODO: functionalize this, returning a manipulated `rows` and use it to explicitly set Dashboard.categoryData where cleanAndFilter() is called
  // TODO: dataManipulation.parseSingleRecord finds the "latest" value for each metric, so the comparisons between buildings are not necessarially within the same year.  perhaps dataManipulation.parseSingleRecord should accept a param for year, passing to "latest" which finds that particular year instead of the "latest" metric. OR the apiCalls.propertyQuery call inside handleSingleBuildingResponse should take a param for year that only requests records which are not null for the individual building's "latest" metric year
  Dashboard.categoryData = rows.map(dataManipulation.parseSingleRecord)    // save data in global var
  Dashboard.categoryData = dataManipulation.cleanData(Dashboard.categoryData)        // clean data according to SFENV's criteria
  Dashboard.categoryData = dataManipulation.apiDataToArray(Dashboard.categoryData) // filter out unwanted data
}

/** @function populateInfoBoxes
 * brute force put returned data into infoboxes on the page
 * @param {object} singleBuildingData - data for a single building
 * @param {object} categoryData - data for the single building's category
 * @param {object} floorAreaRange - floor area range for this category
 * @return null
 */
Dashboard.populateInfoBoxes = function (singleBuildingData, categoryData, floorAreaRange) {
  if (Object.keys(Dashboard.groups).indexOf(singleBuildingData.property_type_self_selected) === -1) {
    singleBuildingData.display = singleBuildingData.property_type_self_selected;
  }
  else {
    singleBuildingData.display = Dashboard.groups[singleBuildingData.property_type_self_selected].plural;
  }

  singleBuildingData.compliance_year = singleBuildingData.latest_benchmark_year;

  // Check eui change
  if (!isNaN(singleBuildingData.pct_change_one_year_site_eui_kbtu_ft2)) {
    // Only perform math on numbers
    if (!((singleBuildingData.pct_change_one_year_site_eui_kbtu_ft2 <= 100)
        && (singleBuildingData.pct_change_one_year_site_eui_kbtu_ft2 >= -80))) {
      singleBuildingData.latest_benchmark = 'Data Not Verified';
    }
  }

  if (!isNaN(singleBuildingData.pct_change_two_year_site_eui_kbtu_ft2)) {
    // Only perform math on numbers
    if (!((singleBuildingData.pct_change_two_year_site_eui_kbtu_ft2 <= 100)
        && (singleBuildingData.pct_change_two_year_site_eui_kbtu_ft2 >= -80))) {
      singleBuildingData.latest_benchmark = 'Data Not Verified';

    }
  }

  var complianceMessage = {
    'Violation - Did Not Report': `${singleBuildingData.building_name} cannot receive a ranking comparing it to
      similar-sized ${singleBuildingData.display} in San Francisco, because an annual energy benchmark for
      ${singleBuildingData.latest_benchmark_year} has not been submitted.`,
    'Exempt': `${singleBuildingData.building_name} cannot receive a ranking comparing it to similar-sized
      ${singleBuildingData.display} in San Francisco, because an annual energy benchmark for
      ${singleBuildingData.latest_benchmark_year} was exempted.`,
    'Violation - Insufficient Data': `${singleBuildingData.building_name} cannot receive a ranking comparing it to
      similar-sized ${singleBuildingData.display} in San Francisco, because an annual energy benchmark for
      ${singleBuildingData.latest_benchmark_year} was rejected due to data quality issues. Please contact the ECB
      Helpdesk for more information.`,
    'Data Not Verified': `${singleBuildingData.building_name} cannot receive a ranking comparing it to
      similar-sized ${singleBuildingData.display} in San Francisco, because the energy use reported in the
      ${singleBuildingData.latest_benchmark_year} benchmark is not within range of previous years.`
  };

  d3.select('#building-apn').text(singleBuildingData.parcel_s)
  if (Dashboard.displayPage === 'estar') {
    d3.select('#building-energy-star-score').text(singleBuildingData.latest_energy_star_score)
    d3.selectAll('.building-energy-star-score-year').text(singleBuildingData.latest_energy_star_score_year)
    if (!singleBuildingData.latest_energy_star_score) {
      d3.select('#estar-text').html(`The national median energy star score for <span class="building-type-lower">BUILDING TYPE</span> is 50.`)
    }
    let re = /violation|exempt|verified/i
    var message = false;
    if (re.test(Dashboard.singleBuildingData.latest_benchmark)) {
      message = complianceMessage[singleBuildingData.latest_benchmark];
    }
    if (!message) {
      d3.selectAll('.building-ranking-text').text(singleBuildingData.localRank[0])
      d3.selectAll('.total-building-type').text(singleBuildingData.localRank[1])
    } else {
      // the building is not rankable: did not report an estar score OR the % change in eui either increased by more than 100 or decreased by more than 80 over the previous 2 years
      d3.select('.local-ranking-container').classed('hidden', true)
      d3.selectAll('.estar-ranking-text').html(message);
    }
  } else if (Dashboard.displayPage === 'ghg') {
    d3.selectAll('.building-ghg-emissions').text(singleBuildingData.latest_total_ghg_emissions_metric_tons_co2e)
    d3.selectAll('.building-ghg-emissions-year').text(singleBuildingData.latest_total_ghg_emissions_metric_tons_co2e_year)
  } else if (Dashboard.displayPage === 'eui') {
    d3.select('#building-eui').text(singleBuildingData.latest_site_eui_kbtu_ft2)
  }
  else if (Dashboard.displayPage === 'trend') {
    d3.select('.pct-label').remove();
    let pct = singleBuildingData.weather_normalized_pct_change_total;
    if (pct <= 0) {
      d3.selectAll('.trend-value').text(pct * -1);
      d3.selectAll('#trend-change').text('decreased').style("color", "green");
    }
    else {
      d3.selectAll('.trend-value').text(pct);
      d3.selectAll('#trend-change').style("color", "red");
    }

    d3.selectAll('#trend-latest-year').text(singleBuildingData.latest_weather_normalized_site_eui_kbtu_ft2_year);
    d3.selectAll('#trend-first-year').text(singleBuildingData.last_weather_normalized_site_eui_kbtu_ft2_year);
  }

  d3.selectAll('.building-type-lower').text(singleBuildingData.display)
  d3.selectAll('.building-type-upper').text(singleBuildingData.display.toUpperCase())
  d3.select('#building-floor-area').text(helpers.numberWithCommas(singleBuildingData.floor_area))
  d3.selectAll('.building-name').text(singleBuildingData.building_name)
  d3.selectAll('.eui-year').text(singleBuildingData.latest_source_eui_kbtu_ft2_year);
  d3.select('#building-street-address').text(singleBuildingData.building_address)
  d3.select('#building-city-address').text(
    singleBuildingData.full_address_city + ' ' +
    singleBuildingData.full_address_state + ', ' +
    singleBuildingData.full_address_zip + ' '
  )
  d3.selectAll('.building-type-sq-ft').text(helpers.numberWithCommas(floorAreaRange[0]) + '-' + helpers.numberWithCommas(floorAreaRange[1]))

  d3.select('#compliance-current-year').text(`${singleBuildingData.latest_benchmark_year}:`)
  d3.select('#compliance-previous-year').text(`${singleBuildingData.latest_benchmark_year - 1}:`)

  d3.select('#compliance-status-current').html(complianceStatusString(singleBuildingData.latest_benchmark))
  d3.select('#compliance-status-previous').html(complianceStatusString(singleBuildingData.prev_year_benchmark))

  var auditDueDate = new Date(singleBuildingData.energy_audit_due_date)
  d3.select('#audit-date').html(`${auditDueDate.getFullYear()}:`)
  d3.select('#audit-status').html(auditStatusIndicator(singleBuildingData.energy_audit_status))

  if (singleBuildingData.next_audit_due_date) {
    var nextAuditDueDate = new Date(singleBuildingData.next_audit_due_date)
    d3.select('#next-audit-date').html(`${nextAuditDueDate.getFullYear()}:`)
    d3.select('#next-audit-status').html(auditStatusIndicator(singleBuildingData.next_energy_audit_status))
    d3.select('#next-audit').classed('hidden', false)
  }

  function complianceStatusString (status) {
    var indicator
    if (status === 'Complied') {
      indicator = ' <i class="fa fa-check ok" aria-hidden="true"></i>'
    } else if (status === 'Exempt') {
      indicator = ' <i class="fa fa-check alrt" aria-hidden="true"></i>'
    } else {
      indicator = ' <i class="fa fa-times attn" aria-hidden="true"></i>'
    }
    return `${indicator} ${status}`
  }

  function auditStatusIndicator (status) {
    var indicator
    if (status === 'Complied') {
      indicator = ' <i class="fa fa-check ok" aria-hidden="true"></i>'
    } else if (typeof status === 'string' && status.includes('Exempt')) {
      indicator = ' <i class="fa fa-check alrt" aria-hidden="true"></i>'
    } else if (status === 'Municipal' || status === 'Pending') {
      indicator = ' <i class="fa fa-check alrt" aria-hidden="true"></i>'
    } else if (status === 'Upcoming') {
      indicator = ' <i class="fa fa-arrow-right upcoming" aria-hidden="true"></i>'
    } else if (status === 'Did Not Comply') {
      indicator = ' <i class="fa fa-times attn" aria-hidden="true"></i>'
    } else {
      indicator = ' <i class="fa fa-question alrt" aria-hidden="true"></i>'
    }
    return `${indicator} ${status}`
  }
  return null
}

/** @function addHighlightLine
 * add a highlight bar to a histogram chart
 * @param {object} selection - d3 selection of the dom element for the histogram chart
 * @param {integer} data - the value to highlight
 * @param {object} chart - the histogram chart object
 * @param {string} label - the label for the highlighting bar
 */
Dashboard.addHighlightLine = function (selection, data, chart, label) {
  label = (label !== undefined) ? `${label.toUpperCase()}` : "Your Building";
  if (isNaN(data)) data = -100
  var x = chart.xScale(),
    y = chart.yScale(),
    margin = chart.margin(),
    width = chart.width(),
    height = chart.height()
  var svg = selection.select('svg')
  var hl = svg.select('g').selectAll('.highlight').data([data])

  var lineFunction = d3.svg.line()
        .x(function (d) { return d.x })
        .y(function (d) { return d.y })
        .interpolate('linear')

  var hlline = [
    {x: x(data), y: 2},
    {x: x(data), y: height - margin.bottom - margin.top}
  ]

  var moreThanHalf = !((x(data) < chart.width() / 2))
  var textPos = moreThanHalf ? x(data) - 5 : x(data) + 5
  var textAnchor = moreThanHalf ? 'end' : 'start'

  hl.enter().append('path')
      .attr('class', 'highlight')
      .attr('d', lineFunction(hlline))
      .attr('stroke', Dashboard.colorSwatches.highlight)
      .attr('stroke-width', 3)
      .attr('stroke-dasharray', '5,3')
      .attr('fill', 'none');
  let labelX = x - 100;
  hl.enter().append('text')
      .attr('x', x)
      .attr('y', 12  )
      .attr('font-family', 'Open Sans')
      .attr('text-anchor', textAnchor)
      .attr('fill', 'black')
      .text(label);
  hl.exit().remove()
}

Dashboard.setSidePanelHeight = function () {
  var contentHeight = $('#view-content').height()
  $('.panel-body.side.flex-grow').height(contentHeight - 10)
}

export { Dashboard }
