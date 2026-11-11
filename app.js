
const DATASETS = [
  "overall_kpis",
  "train_performance",
  "station_performance",
  "station_recovery",
  "monthly_performance",
  "yearly_performance"
];

const data = {};
let currentPage = "overview";
let selectedTrain = "all";
let selectedYear = "all";
let activeCharts = [];
let activeMap = null;

const $ = id => document.getElementById(id);

const number = value =>
  value === null || value === undefined || value === ""
    ? null
    : Number.isFinite(Number(value))
      ? Number(value)
      : null;

const format = value => {
  const n = number(value);
  return n === null
    ? "Not available"
    : n.toLocaleString("en-IN", { maximumFractionDigits: 1 });
};

const percent = value => {
  const n = number(value);
  return n === null ? "Not available" : `${format(n)}%`;
};

const escapeHTML = value =>
  String(value ?? "—").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);

const sum = (rows, key) =>
  rows.reduce((total, row) => total + (number(row[key]) ?? 0), 0);

const hasMetric = (rows, key) =>
  rows.some(row => number(row[key]) !== null);

function showNotice(message) {
  $("notice").hidden = false;
  $("notice").textContent = message;
}

function clearNotice() {
  $("notice").hidden = true;
}

async function loadData() {
  try {
    await Promise.all(DATASETS.map(async name => {
      const response = await fetch(`data/${name}.json`);

      if (!response.ok) {
        throw new Error(`Unable to load ${name}.json`);
      }

      data[name] = await response.json();
    }));

    for (const optional of [
      "network_geo",
      "validation_audit",
      "train_year_performance"
    ]) {
      try {
        const response = await fetch(`data/${optional}.json`);
        data[optional] = response.ok
          ? await response.json()
          : optional === "network_geo" ? null : [];
      } catch {
        data[optional] =
          optional === "network_geo" ? null : [];
      }
    }

    populateFilters();
    render();

  } catch (error) {
    console.error(error);
    showNotice(
      `${error.message}. Generate the Gold JSON files using prepare_data.py.`
    );
    $("dashboard").innerHTML =
      `<div class="empty">Dashboard data could not be loaded.</div>`;
  }
}

function populateFilters() {
  const trains = data.train_performance || [];
  const years = [...new Set(
    (data.yearly_performance || []).map(row => row.journey_year)
  )].sort();

  $("trainFilter").innerHTML =
    `<option value="all">All trains</option>` +
    trains.map(row => `
      <option value="${escapeHTML(row.train_no)}">
        ${escapeHTML(row.train_name || row.train_no)}
      </option>
    `).join("");

  $("yearFilter").innerHTML =
    `<option value="all">All years</option>` +
    years.map(year => `
      <option value="${escapeHTML(year)}">${escapeHTML(year)}</option>
    `).join("");
}

function rowsFor(dataset) {
  let rows = data[dataset] || [];

  if (selectedTrain !== "all") {
    if (dataset === "train_year_performance") {
      rows = rows.filter(
        row => String(row.train_no) === selectedTrain
      );
    } else if (dataset === "train_performance") {
      rows = rows.filter(
        row => String(row.train_no) === selectedTrain
      );
    }
  }

  if (selectedYear !== "all") {
    if (dataset === "monthly_performance" ||
        dataset === "yearly_performance" ||
        dataset === "train_year_performance") {
      rows = rows.filter(
        row => String(row.journey_year) === selectedYear
      );
    }
  }

  return rows;
}

function kpi(label, value, subtitle, featured = false) {
  return `
    <article class="kpi ${featured ? "featured" : ""}">
      <div class="kpi-label">${escapeHTML(label)}</div>
      <div class="kpi-value">${escapeHTML(value)}</div>
      <div class="kpi-subtitle">${escapeHTML(subtitle)}</div>
    </article>
  `;
}

function panel(title, subtitle, content, tag = "GOLD") {
  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>${escapeHTML(title)}</h3>
          <p>${escapeHTML(subtitle)}</p>
        </div>
        <span class="panel-tag">${escapeHTML(tag)}</span>
      </div>
      ${content}
    </section>
  `;
}

function chart(id, tall = false) {
  return `<div id="${id}" class="chart ${tall ? "tall" : ""}"></div>`;
}

function table(rows, columns) {
  if (!rows.length) {
    return `<div class="empty">No records available.</div>`;
  }

  return `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            ${columns.map(col => `<th>${escapeHTML(col[0])}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              ${columns.map(([label, key, formatter]) => `
                <td>${escapeHTML(
                  formatter ? formatter(row[key]) : row[key]
                )}</td>
              `).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

const COLORS = {
  green: "#21765C",
  forest: "#163D31",
  mint: "#82B5A0",
  orange: "#C98B56"
};

function drawChart(id, options) {
  const element = $(id);
  if (!element || !window.echarts) return;

  const instance = echarts.init(element);
  instance.setOption(options);
  activeCharts.push(instance);
}

function lineChart(id, rows, metrics) {
  const valid = rows.filter(row =>
    metrics.some(([key]) => number(row[key]) !== null)
  );

  if (!valid.length) {
    $(id).innerHTML =
      `<div class="empty">No verified delay metrics available.</div>`;
    return;
  }

  drawChart(id, {
    tooltip: { trigger: "axis" },
    legend: { top: 0 },
    grid: { left: 55, right: 25, top: 55, bottom: 65 },
    xAxis: {
      type: "category",
      data: valid.map(row => row.year_month || row.journey_year),
      axisLabel: { rotate: 35, color: "#718379" }
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#718379" },
      splitLine: { lineStyle: { color: "#E5ECE5" } }
    },
    series: metrics.map(([key, label, color]) => ({
      name: label,
      type: "line",
      smooth: true,
      symbol: "circle",
      symbolSize: 5,
      connectNulls: false,
      itemStyle: { color },
      data: valid.map(row => number(row[key]))
    }))
  });
}

function barChart(id, rows, labelKey, metricKey) {
  const valid = rows
    .filter(row => number(row[metricKey]) !== null)
    .sort((a, b) => number(b[metricKey]) - number(a[metricKey]))
    .slice(0, 12)
    .reverse();

  if (!valid.length) {
    $(id).innerHTML =
      `<div class="empty">No verified values available for this metric.</div>`;
    return;
  }

  drawChart(id, {
    tooltip: { trigger: "axis" },
    grid: { left: 110, right: 35, top: 15, bottom: 35 },
    xAxis: {
      type: "value",
      splitLine: { lineStyle: { color: "#E5ECE5" } }
    },
    yAxis: {
      type: "category",
      data: valid.map(row => row[labelKey]),
      axisLabel: {
        color: "#718379",
        width: 100,
        overflow: "truncate"
      }
    },
    series: [{
      type: "bar",
      barMaxWidth: 22,
      itemStyle: {
        color: COLORS.green,
        borderRadius: [0, 5, 5, 0]
      },
      data: valid.map(row => number(row[metricKey]))
    }]
  });
}

function renderOverview() {
  const overall = data.overall_kpis?.[0] || {};
  const trains = rowsFor("train_performance");
  const monthly = rowsFor("monthly_performance")
    .sort((a, b) => String(a.year_month).localeCompare(String(b.year_month)));

  const yearly = rowsFor("yearly_performance")
    .sort((a, b) => a.journey_year - b.journey_year);

  $("dashboard").innerHTML = `
    <div class="kpi-grid">
      ${kpi(
        "Total Observations",
        format(overall.total_observations),
        "Historical movement records",
        true
      )}
      ${kpi(
        "Train Services",
        format(overall.total_trains),
        "Distinct trains analyzed"
      )}
      ${kpi(
        "Stations Covered",
        format(overall.total_stations),
        "Distinct railway stations"
      )}
      ${kpi(
        "Average Arrival Delay",
        number(overall.avg_arrival_delay_min) === null
          ? "—"
          : `${format(overall.avg_arrival_delay_min)} min`,
        "Verified arrival observations"
      )}
    </div>

    <div class="grid-two">
      ${panel(
        "Monthly Delay Trend",
        "Historical arrival and departure delay",
        chart("monthlyChart"),
        "MONTHLY"
      )}
      ${panel(
        "Yearly Observation Volume",
        "Number of records processed each year",
        chart("yearlyChart"),
        "COVERAGE"
      )}
    </div>

    <div class="grid-two">
      ${panel(
        "Train Delay Ranking",
        "Average arrival delay by train",
        chart("trainChart", true),
        "TRAINS"
      )}
      ${panel(
        "Station Delay Ranking",
        "Average arrival delay by station",
        chart("stationChart", true),
        "STATIONS"
      )}
    </div>

    ${panel(
      "Indian Railway Network",
      "Historical station markers and schematic train routes",
      `<div id="railMap" class="map"></div>
       <p style="color:#718379;font-size:11px">
         Map connections represent station sequences, not exact railway tracks.
         No live train positions are shown.
       </p>`,
      "NETWORK"
    )}
  `;

  lineChart("monthlyChart", monthly, [
    ["avg_arrival_delay_min", "Arrival Delay", COLORS.green],
    ["avg_departure_delay_min", "Departure Delay", COLORS.orange]
  ]);

  barChart(
    "yearlyChart",
    yearly,
    "journey_year",
    "total_observations"
  );

  barChart(
    "trainChart",
    trains,
    "train_name",
    "avg_arrival_delay_min"
  );

  barChart(
    "stationChart",
    data.station_performance || [],
    "station_code",
    "avg_arrival_delay_min"
  );

  renderMap();
}

function renderMap() {
  if (!window.L) {
    $("railMap").innerHTML =
      `<div class="empty">Map library unavailable.</div>`;
    return;
  }

  const map = L.map("railMap", {
    scrollWheelZoom: false
  }).setView([22.6, 79.5], 5);

  activeMap = map;

  L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19
    }
  ).addTo(map);

  const railwayLayer = L.tileLayer(
    "https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png",
    {
      attribution: "&copy; OpenRailwayMap",
      opacity: 0.7
    }
  ).addTo(map);

  const geo = data.network_geo;

  const stationsLayer = L.layerGroup().addTo(map);
  const routesLayer = L.layerGroup().addTo(map);

  L.control.layers(
    { "Railway Infrastructure": railwayLayer },
    {
      "Station Markers": stationsLayer,
      "Historical Routes": routesLayer
    }
  ).addTo(map);

  if (!geo || !Array.isArray(geo.stations)) {
    return;
  }

  const stationLookup = new Map();
  const performanceLookup = new Map(
    (data.station_performance || []).map(row => [
      String(row.station_code).toUpperCase(),
      row
    ])
  );

  geo.stations.forEach(station => {
    const lat = number(station.lat);
    const lng = number(station.lng);

    if (lat === null || lng === null ||
        lat < 6 || lat > 38 || lng < 68 || lng > 98) {
      return;
    }

    const code = String(station.station_code).toUpperCase();
    stationLookup.set(code, station);

    const performance = performanceLookup.get(code) || {};

    const marker = L.circleMarker([lat, lng], {
      radius: 5,
      color: COLORS.forest,
      fillColor: COLORS.green,
      fillOpacity: 0.9
    }).addTo(stationsLayer);

    marker.bindPopup(`
      <strong>${escapeHTML(station.station_name || code)}</strong>
      <p>Station: ${escapeHTML(code)}</p>
      <p>Arrival delay:
        ${escapeHTML(format(performance.avg_arrival_delay_min))}
      </p>
      <p>Punctuality:
        ${escapeHTML(percent(performance.arrival_punctuality_pct))}
      </p>
    `);
  });

  (geo.routes || []).forEach(route => {
    if (
      selectedTrain !== "all" &&
      String(route.train_no) !== selectedTrain
    ) return;

    const points = (route.stops || [])
      .map(code => stationLookup.get(String(code).toUpperCase()))
      .filter(Boolean)
      .map(station => [number(station.lat), number(station.lng)]);

    if (points.length < 2) return;

    L.polyline(points, {
      color: COLORS.green,
      weight: 3,
      opacity: 0.65,
      dashArray: "7 6"
    }).addTo(routesLayer);
  });

  setTimeout(() => map.invalidateSize(), 100);
}

function renderTrains() {
  const rows = rowsFor("train_performance");

  $("dashboard").innerHTML = `
    <div class="kpi-grid">
      ${kpi("Train Services", format(rows.length), "Selected train groups", true)}
      ${kpi("Observations", format(sum(rows, "total_observations")), "Movement records")}
      ${kpi("Verified Arrivals", format(sum(rows, "verified_arrival_count")), "Available actual arrivals")}
      ${kpi("Severe Delays", format(sum(rows, "severe_arrival_count")), "Verified severe arrivals")}
    </div>

    <div class="grid-two">
      ${panel("Arrival Delay by Train", "Average minutes", chart("trainArrival", true))}
      ${panel("Departure Delay by Train", "Average minutes", chart("trainDeparture", true))}
    </div>

    ${panel(
      "Train Performance Details",
      "Historical Gold aggregates",
      table(rows, [
        ["TRAIN", "train_name"],
        ["NUMBER", "train_no"],
        ["TYPE", "train_type"],
        ["OBSERVATIONS", "total_observations", format],
        ["ARRIVAL DELAY", "avg_arrival_delay_min", format],
        ["DEPARTURE DELAY", "avg_departure_delay_min", format],
        ["ARRIVAL ON-TIME", "arrival_punctuality_pct", percent]
      ])
    )}
  `;

  barChart("trainArrival", rows, "train_name", "avg_arrival_delay_min");
  barChart("trainDeparture", rows, "train_name", "avg_departure_delay_min");
}

function renderStations() {
  const rows = data.station_performance || [];

  $("dashboard").innerHTML = `
    <div class="kpi-grid">
      ${kpi("Stations", format(rows.length), "Historical station groups", true)}
      ${kpi("Observations", format(sum(rows, "total_observations")), "Station movements")}
      ${kpi(
        "Delay Coverage",
        format(rows.filter(row =>
          number(row.avg_arrival_delay_min) !== null
        ).length),
        "Stations with verified delays"
      )}
      ${kpi("Data Source", "GOLD", "Databricks Delta analytics")}
    </div>

    ${panel(
      "Highest Average Station Delays",
      "Stations with available delay observations",
      chart("stationDelays", true)
    )}

    ${panel(
      "Station Performance",
      "First 100 station records",
      table(rows.slice(0, 100), [
        ["STATION", "station_code"],
        ["OBSERVATIONS", "total_observations", format],
        ["TRAINS", "total_trains", format],
        ["AVG DELAY", "avg_arrival_delay_min", format],
        ["PUNCTUALITY", "arrival_punctuality_pct", percent]
      ])
    )}
  `;

  barChart("stationDelays", rows, "station_code", "avg_arrival_delay_min");
}

function renderRecovery() {
  const rows = data.station_recovery || [];

  $("dashboard").innerHTML = `
    <div class="kpi-grid">
      ${kpi("Stations Analyzed", format(rows.length), "Recovery groups", true)}
      ${kpi("Verified Recovery", format(sum(rows, "verified_recovery_count")), "Comparable observations")}
      ${kpi("Recovered Events", format(sum(rows, "recovered_count")), "Verified recovery events")}
      ${kpi(
        "Recovery Coverage",
        format(rows.filter(row =>
          number(row.recovery_pct) !== null
        ).length),
        "Stations with recovery metrics"
      )}
    </div>

    ${panel(
      "Recovery Performance",
      "Station recovery percentage",
      chart("recoveryChart", true)
    )}

    ${panel(
      "Recovery Details",
      "First 100 station recovery records",
      table(rows.slice(0, 100), [
        ["STATION", "station_code"],
        ["OBSERVATIONS", "total_observations", format],
        ["VERIFIED", "verified_recovery_count", format],
        ["RECOVERED", "recovered_count", format],
        ["AVG RECOVERY", "avg_recovery_min", format],
        ["RECOVERY %", "recovery_pct", percent]
      ])
    )}
  `;

  barChart("recoveryChart", rows, "station_code", "recovery_pct");
}

function renderQuality() {
  const audit = data.validation_audit || [];
  const available = audit.length > 0;

  const columns = available
    ? Object.keys(audit[0]).slice(0, 12).map(key => [
        key.replaceAll("_", " ").toUpperCase(),
        key
      ])
    : [];

  $("dashboard").innerHTML = `
    <div class="kpi-grid">
      ${kpi("Gold Datasets", "6", "Curated analytical datasets", true)}
      ${kpi("Audit Records", format(audit.length), "Validation records loaded")}
      ${kpi("Audit Status", available ? "Available" : "Missing", "Evidence status")}
      ${kpi("Source", "Databricks", "Pipeline validation")}
    </div>

    ${available
      ? panel(
          "Pipeline Validation Audit",
          "Exported Databricks validation records",
          table(audit, columns),
          "QUALITY"
        )
      : panel(
          "Validation Audit Not Available",
          "Additional Databricks export required",
          `<div class="empty">
            The file data/validation_audit.json is missing or empty.
            Run the validation notebook and export its results.
            No pipeline success status is assumed.
          </div>`,
          "ACTION REQUIRED"
        )
    }
  `;
}

function render() {
  activeCharts.forEach(chart => chart.dispose());
  activeCharts = [];

  if (activeMap) {
    activeMap.remove();
    activeMap = null;
  }

  const pages = {
    overview: ["Operations Overview", "Historical railway performance and network intelligence."],
    trains: ["Train Analytics", "Explore train-level operational performance."],
    stations: ["Station Analytics", "Analyze station-level railway observations."],
    recovery: ["Delay Recovery", "Explore verified recovery patterns."],
    quality: ["Data Quality", "Pipeline validation and reliability reporting."]
  };

  $("pageTitle").textContent = pages[currentPage][0];
  $("pageSubtitle").textContent = pages[currentPage][1];

  document.querySelectorAll(".nav-link").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.page === currentPage
    );
  });

  const renderers = {
    overview: renderOverview,
    trains: renderTrains,
    stations: renderStations,
    recovery: renderRecovery,
    quality: renderQuality
  };

  renderers[currentPage]();

  const trainSpecific = ["trains"].includes(currentPage);
  const yearSpecific = ["overview"].includes(currentPage);

  // A single year cannot filter all-time train aggregates.
  $("yearFilter").disabled = !yearSpecific;
  $("trainFilter").disabled = !trainSpecific && currentPage !== "overview";

  if (currentPage === "overview" && selectedTrain !== "all") {
    showNotice(
      "Train selection affects the train ranking and map, but overall and monthly aggregates remain network-wide. Train-year Gold data is required for combined filtering."
    );
  } else if (currentPage === "overview" && selectedYear !== "all") {
    showNotice(
      "Year selection affects monthly and yearly charts. Overall and station KPIs remain all-time aggregates."
    );
  } else {
    clearNotice();
  }
}

function downloadCSV() {
  const datasetByPage = {
    overview: "overall_kpis",
    trains: "train_performance",
    stations: "station_performance",
    recovery: "station_recovery",
    quality: "validation_audit"
  };

  const dataset = datasetByPage[currentPage];
  const rows = rowsFor(dataset);

  if (!rows.length) {
    alert("No data is available to export.");
    return;
  }

  const columns = [...new Set(rows.flatMap(Object.keys))];

  const csvEscape = value => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text)
      ? `"${text.replace(/"/g, '""')}"`
      : text;
  };

  const csv = [
    columns.map(csvEscape).join(","),
    ...rows.map(row =>
      columns.map(column => csvEscape(row[column])).join(",")
    )
  ].join("\r\n");

  const blob = new Blob(["\ufeff", csv], {
    type: "text/csv;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `railvista_${dataset}.csv`;
  link.click();

  URL.revokeObjectURL(url);
}

document.querySelectorAll(".nav-link").forEach(button => {
  button.addEventListener("click", () => {
    currentPage = button.dataset.page;
    render();
    window.scrollTo(0, 0);
  });
});

$("trainFilter").addEventListener("change", event => {
  selectedTrain = event.target.value;
  render();
});

$("yearFilter").addEventListener("change", event => {
  selectedYear = event.target.value;
  render();
});

$("resetBtn").addEventListener("click", () => {
  selectedTrain = "all";
  selectedYear = "all";
  $("trainFilter").value = "all";
  $("yearFilter").value = "all";
  render();
});

$("exportBtn").addEventListener("click", downloadCSV);

window.addEventListener("resize", () => {
  activeCharts.forEach(chart => chart.resize());
  if (activeMap) activeMap.invalidateSize();
});

loadData();
