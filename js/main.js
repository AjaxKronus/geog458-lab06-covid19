// Token 
mapboxgl.accessToken =
    'pk.eyJ1IjoiYW1hcnR5YWNoYXViZSIsImEiOiJjbWx1OHkzcHMwNGdjM2RvZzF3bjNuMThxIn0.34Gjsl2xrl9kUmuF8l9t9Q';

// Map 
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/dark-v10',
    zoom: 3.5,
    minZoom: 2,
    center: [-98, 39]
});

map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

// Constants 
// Load directly from GitHub raw — no local file needed
const GEOJSON_URL =
    'https://raw.githubusercontent.com/spatial-data-lab/data/ba06af5e48b8fc656bacc3658e4f033c93e81e3b/us-state-Covid-19-cases.geojson';
const LATEST_DATE = '2022-06-06';

// Sample of dates for the time-series line chart
const DATE_SERIES = [
    '2020-03-01','2020-06-01','2020-09-01','2020-12-01',
    '2021-03-01','2021-06-01','2021-09-01','2021-12-01',
    '2022-03-01','2022-06-06'
];

const COLOR_STOPS = [
    [0,         '#feedde'],
    [500000,    '#fdbe85'],
    [1000000,   '#fd8d3c'],
    [2000000,   '#e6550d'],
    [4000000,   '#a63603']
];

let covidData = null;
let barChart  = null;
let lineChart = null;

// Legend 
const LEGEND_LABELS = ['0', '500K+', '1M+', '2M+', '4M+'];
const legend = document.getElementById('legend');
legend.innerHTML = '<h4>Total Cases</h4>' +
    COLOR_STOPS.map(([, color], i) =>
        `<div class="legend-row">
            <span class="legend-color" style="background:${color};"></span>
            <span>${LEGEND_LABELS[i]}</span>
        </div>`
    ).join('');

// Fetch and boot 
async function geojsonFetch() {
    document.getElementById('covid-count').innerText = 'Loading...';
    try {
        const response = await fetch(GEOJSON_URL);
        covidData = await response.json();
        updateCount(covidData.features);
        buildBarChart(covidData.features);
        addMapLayers(covidData);
    } catch (err) {
        document.getElementById('covid-count').innerText = 'Error loading data';
        console.error('Failed to load GeoJSON:', err);
    }
}

// Choropleth + outline layers 
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
                    ['to-number', ['get', LATEST_DATE]],
                    COLOR_STOPS[0][0], COLOR_STOPS[0][1],
                    COLOR_STOPS[1][0], COLOR_STOPS[1][1],
                    COLOR_STOPS[2][0], COLOR_STOPS[2][1],
                    COLOR_STOPS[3][0], COLOR_STOPS[3][1],
                    COLOR_STOPS[4][0], COLOR_STOPS[4][1]
                ],
                'fill-opacity': 0.75
            }
        }, 'waterway-label');

        // State borders
        map.addLayer({
            id: 'covid-outline',
            type: 'line',
            source: 'covid',
            paint: {
                'line-color': '#ffffff',
                'line-width': 0.6,
                'line-opacity': 0.4
            }
        });

        // Popup + line chart on state click
        map.on('click', 'covid-fill', (e) => {
            const p     = e.features[0].properties;
            const name  = p.state || p.NAME_left || 'State';
            const cases = Number(p[LATEST_DATE] || 0).toLocaleString();

            new mapboxgl.Popup()
                .setLngLat(e.lngLat)
                .setHTML(
                    `<strong style="font-size:14px">${name}</strong><br/>
                     Cases as of ${LATEST_DATE}:<br/>
                     <span style="color:#e6550d;font-size:16px;font-weight:bold">${cases}</span>`
                )
                .addTo(map);

            buildLineChart(p, name);
        });

        map.on('mouseenter', 'covid-fill', () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'covid-fill', () => {
            map.getCanvas().style.cursor = '';
        });

        // Recount when map moves
        map.on('moveend', () => {
            const rendered = map.queryRenderedFeatures({ layers: ['covid-fill'] });
            const seen = new Set();
            const unique = rendered.filter(f => {
                const n = f.properties.state;
                if (seen.has(n)) return false;
                seen.add(n);
                return true;
            });
            updateCount(unique.map(f => f.properties));
        });
    });
}

// Dynamic case counter 
function updateCount(features) {
    const total = features.reduce((sum, f) => {
        const val = f.properties ? f.properties[LATEST_DATE] : f[LATEST_DATE];
        return sum + Number(val || 0);
    }, 0);
    document.getElementById('covid-count').innerText = total.toLocaleString();
}

// Bar chart: states by case bracket 
function buildBarChart(features) {
    const bins       = ['<500K', '500K–1M', '1M–2M', '2M–4M', '>4M'];
    const counts     = [0, 0, 0, 0, 0];

    features.forEach(f => {
        const c = Number(f.properties[LATEST_DATE] || 0);
        if      (c < 500000)  counts[0]++;
        else if (c < 1000000) counts[1]++;
        else if (c < 2000000) counts[2]++;
        else if (c < 4000000) counts[3]++;
        else                  counts[4]++;
    });

    if (barChart) barChart.destroy();

    barChart = c3.generate({
        bindto: '#bar-chart',
        size: { height: 155 },
        data: {
            columns: [['States', ...counts]],
            type: 'bar',
            colors: { States: '#fd8d3c' }
        },
        axis: {
            x: {
                type: 'category',
                categories: bins,
                tick: { rotate: -15, multiline: false }
            },
            y: {
                label: { text: '# of States', position: 'outer-middle' }
            }
        },
        legend: { show: false },
        bar: { width: { ratio: 0.55 } }
    });
}

// Line chart: time-series for clicked state 
function buildLineChart(props, name) {
    const values = DATE_SERIES.map(d => Number(props[d] || 0));

    if (lineChart) lineChart.destroy();

    lineChart = c3.generate({
        bindto: '#covid-chart',
        size: { height: 155 },
        data: {
            x: 'x',
            columns: [
                ['x', ...DATE_SERIES],
                [name, ...values]
            ],
            type: 'line',
            colors: { [name]: '#ff6b6b' }
        },
        axis: {
            x: {
                type: 'timeseries',
                tick: { format: '%Y-%m', count: 5, rotate: -20 }
            },
            y: {
                tick: {
                    format: d =>
                        d >= 1000000 ? (d / 1000000).toFixed(1) + 'M' :
                        d >= 1000    ? (d / 1000).toFixed(0) + 'K' : d
                }
            }
        },
        point: { show: false },
        legend: { show: false }
    });

    document.querySelector('.chart-label:last-of-type').innerText =
        `📈 Cases Over Time: ${name}`;
}

// Reset
document.getElementById('reset').addEventListener('click', () => {
    map.flyTo({ center: [-98, 39], zoom: 3.5 });
    if (covidData) {
        updateCount(covidData.features);
        buildBarChart(covidData.features);
    }
    if (lineChart) { lineChart.destroy(); lineChart = null; }
    document.querySelectorAll('.chart-label')[1].innerText =
        '📈 Cases Over Time (click a state)';
});

//  Init 
geojsonFetch();
