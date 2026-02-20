// ── Mapbox access token ──────────────────────────────────────────────────────
mapboxgl.accessToken =
    'pk.eyJ1IjoiYW1hcnR5YWNoYXViZSIsImEiOiJjbWx1OHkzcHMwNGdjM2RvZzF3bjNuMThxIn0.34Gjsl2xrl9kUmuF8l9t9Q';

// ── Map object ───────────────────────────────────────────────────────────────
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/dark-v10',
    zoom: 3.5,
    minZoom: 2,
    center: [-98, 39]
});

// ── Globals ──────────────────────────────────────────────────────────────────
// The latest date column present in the GeoJSON
const LATEST_DATE = '2022-06-06';

// A sample of date keys for the time-series chart (every ~30 days)
const DATE_SERIES = [
    '2020-03-01','2020-06-01','2020-09-01','2020-12-01',
    '2021-03-01','2021-06-01','2021-09-01','2021-12-01',
    '2022-03-01','2022-06-06'
];

let covidData = null;
let barChart  = null;
let lineChart = null;

// ── Choropleth color stops ───────────────────────────────────────────────────
// Based on case counts as of LATEST_DATE
const COLOR_STOPS = [
    [0,         '#feedde'],
    [500000,    '#fdbe85'],
    [1000000,   '#fd8d3c'],
    [2000000,   '#e6550d'],
    [4000000,   '#a63603']
];

// ── Legend ───────────────────────────────────────────────────────────────────
const legend = document.getElementById('legend');
legend.innerHTML = `<h4>Total Cases</h4>` +
    COLOR_STOPS.map(([val, color]) =>
        `<div class="legend-row">
            <span class="legend-color" style="background:${color};"></span>
            <span>${val === 0 ? '0' : (val/1000000).toFixed(1) + 'M+'}</span>
        </div>`
    ).join('');

// ── Fetch GeoJSON and initialise ─────────────────────────────────────────────
async function geojsonFetch() {
    const response  = await fetch('assets/us-state-Covid-19-cases.geojson');
    covidData       = await response.json();

    updateCount(covidData.features);
    addMapLayers(covidData);
    buildBarChart(covidData.features);
}

// ── Add choropleth fill layer ────────────────────────────────────────────────
function addMapLayers(geojson) {
    map.on('load', () => {
        map.addSource('covid', {
            type: 'geojson',
            data: geojson
        });

        // Choropleth fill
        map.addLayer({
            id: 'covid-fill',
            type: 'fill',
            source: 'covid',
            paint: {
                'fill-color': [
                    'interpolate', ['linear'],
                    ['get', LATEST_DATE],
                    COLOR_STOPS[0][0], COLOR_STOPS[0][1],
                    COLOR_STOPS[1][0], COLOR_STOPS[1][1],
                    COLOR_STOPS[2][0], COLOR_STOPS[2][1],
                    COLOR_STOPS[3][0], COLOR_STOPS[3][1],
                    COLOR_STOPS[4][0], COLOR_STOPS[4][1]
                ],
                'fill-opacity': 0.75
            }
        }, 'waterway-label');

        // State outline
        map.addLayer({
            id: 'covid-outline',
            type: 'line',
            source: 'covid',
            paint: {
                'line-color': '#ffffff',
                'line-width': 0.5,
                'line-opacity': 0.4
            }
        });

        // Click → popup + update line chart
        map.on('click', 'covid-fill', (e) => {
            const p     = e.features[0].properties;
            const name  = p.state || p.NAME_left || 'State';
            const cases = Number(p[LATEST_DATE] || 0).toLocaleString();

            new mapboxgl.Popup()
                .setLngLat(e.lngLat)
                .setHTML(`<strong>${name}</strong><br>Cases (${LATEST_DATE}): ${cases}`)
                .addTo(map);

            buildLineChart(p, name);
        });

        map.on('mouseenter', 'covid-fill', () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'covid-fill', () => {
            map.getCanvas().style.cursor = '';
        });

        // Update count when map moves
        map.on('moveend', () => {
            const visible = map.queryRenderedFeatures({ layers: ['covid-fill'] });
            // deduplicate by state name
            const seen = new Set();
            const unique = visible.filter(f => {
                const n = f.properties.state;
                if (seen.has(n)) return false;
                seen.add(n);
                return true;
            });
            updateCount(unique.map(f => f.properties));
        });
    });
}

// ── Update total-cases counter in the panel ──────────────────────────────────
function updateCount(features) {
    const total = features.reduce((sum, f) => {
        const val = f.properties ? f.properties[LATEST_DATE] : f[LATEST_DATE];
        return sum + Number(val || 0);
    }, 0);
    document.getElementById('covid-count').innerText = total.toLocaleString();
}

// ── Bar chart: states grouped by case level ──────────────────────────────────
function buildBarChart(features) {
    const bins = { '<500K': 0, '500K–1M': 0, '1M–2M': 0, '2M–4M': 0, '>4M': 0 };

    features.forEach(f => {
        const c = Number(f.properties[LATEST_DATE] || 0);
        if      (c < 500000)  bins['<500K']++;
        else if (c < 1000000) bins['500K–1M']++;
        else if (c < 2000000) bins['1M–2M']++;
        else if (c < 4000000) bins['2M–4M']++;
        else                  bins['>4M']++;
    });

    const categories = Object.keys(bins);
    const counts     = Object.values(bins);

    if (barChart) barChart.destroy();

    barChart = c3.generate({
        bindto: '#bar-chart',
        size: { height: 160 },
        data: {
            columns: [['States', ...counts]],
            type: 'bar',
            colors: { States: '#fd8d3c' }
        },
        axis: {
            x: {
                type: 'category',
                categories: categories,
                tick: { rotate: -15, multiline: false }
            },
            y: { label: { text: '# States', position: 'outer-middle' } }
        },
        legend: { show: false },
        bar: { width: { ratio: 0.6 } }
    });
}

// ── Line chart: time-series for a clicked state ──────────────────────────────
function buildLineChart(props, name) {
    const seriesValues = DATE_SERIES.map(d => Number(props[d] || 0));

    if (lineChart) lineChart.destroy();

    lineChart = c3.generate({
        bindto: '#covid-chart',
        size: { height: 160 },
        data: {
            x: 'dates',
            columns: [
                ['dates', ...DATE_SERIES],
                [name, ...seriesValues]
            ],
            type: 'line',
            colors: { [name]: '#fd8d3c' }
        },
        axis: {
            x: {
                type: 'timeseries',
                tick: {
                    format: '%Y-%m',
                    count: 5,
                    rotate: -20
                }
            },
            y: {
                label: { text: 'Cases', position: 'outer-middle' },
                tick: {
                    format: d => d >= 1000000
                        ? (d/1000000).toFixed(1)+'M'
                        : d >= 1000 ? (d/1000).toFixed(0)+'K' : d
                }
            }
        },
        legend: { show: true },
        point: { show: false }
    });

    document.getElementById('chart-title').innerText =
        `Cases Over Time: ${name}`;
}

// ── Reset button ─────────────────────────────────────────────────────────────
document.getElementById('reset').addEventListener('click', () => {
    map.flyTo({ center: [-98, 39], zoom: 3.5 });
    if (covidData) updateCount(covidData.features);
    if (lineChart) { lineChart.destroy(); lineChart = null; }
    document.getElementById('chart-title').innerText = 'Cases Over Time (click a state)';
    buildBarChart(covidData.features);
});

// ── Start ────────────────────────────────────────────────────────────────────
geojsonFetch();
