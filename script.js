
/* =====================================
   ATMOSIQ - SHARED JAVASCRIPT
===================================== */

document.addEventListener("DOMContentLoaded", () => {

    console.log("AtmosIQ initialized!");

    /*
       Reliable Plotly double-click reset.
       This runs in capture phase so it still works when a chart's own
       interaction handler does not reset the axes as expected.
    */
    document.addEventListener("dblclick", event => {
        const graph = event.target.closest?.(".js-plotly-plot");
        if (!graph || typeof Plotly === "undefined" || !graph._fullLayout) return;

        const resetAxes = {};
        Object.keys(graph._fullLayout).forEach(key => {
            if (/^[xy]axis[0-9]*$/.test(key)) {
                resetAxes[`${key}.autorange`] = true;
            }
        });

        if (!Object.keys(resetAxes).length) {
            resetAxes["xaxis.autorange"] = true;
            resetAxes["yaxis.autorange"] = true;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        Plotly.relayout(graph, resetAxes).catch(error => {
            console.warn("Could not reset graph zoom:", error);
        });
    }, true);

    function updateText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }

    /* =================================
       1. LANDING PAGE
    ================================= */

    const landingPage = document.querySelector(".hero");

    if (landingPage) {
        document.querySelectorAll('.nav-links a[href^="#"]')
            .forEach(link => {
                link.addEventListener("click", event => {
                    const target = document.querySelector(
                        link.getAttribute("href")
                    );

                    if (target) {
                        event.preventDefault();
                        target.scrollIntoView({
                            behavior: "smooth"
                        });
                    }
                });
            });
    }

    /* =================================
       2. RAINFALL DATA + CHART
    ================================= */

    const rainfallChart = document.getElementById("rainfall-chart");
    const rainfallSelector = document.getElementById("rainfall-state");
    const comparisonOptions = document.getElementById("comparison-options");
    const comparisonChart = document.getElementById("rainfall-comparison-chart");
    const comparisonCount = document.getElementById("comparison-count");
    const rankingChart = document.getElementById("rainfall-ranking-chart");
    let selectedComparisonCodes = ["IN-KL", "IN-GA", "IN-ML", "IN-AS"];
    let rainfallRows = [];
    let rainfallSummary = [];
    let selectedRainfallCode = "IN-KL";

    function parseCSVLine(line) {
        const values = [];
        const pattern = /("(?:[^"]|"")*"|[^,]*)(?:,|$)/g;
        let match;
        while ((match = pattern.exec(line)) !== null) {
            let value = match[1] ?? "";
            if (value.startsWith('"') && value.endsWith('"')) {
                value = value.slice(1, -1).replace(/""/g, '"');
            }
            values.push(value.trim());
            if (match[0] === "") break;
        }
        return values;
    }

    async function loadRainfallData() {
        if (!rainfallChart || !rainfallSelector) return;

        try {
            const [annualResponse, summaryResponse] = await Promise.all([
                fetch("./data/processed/state_annual_rainfall.csv"),
                fetch("./data/processed/state_rainfall_summary.csv")
            ]);

            if (!annualResponse.ok || !summaryResponse.ok) {
                throw new Error("Could not load the processed rainfall CSV files.");
            }

            const [annualText, summaryText] = await Promise.all([
                annualResponse.text(),
                summaryResponse.text()
            ]);

            const annualLines = annualText.trim().split(/\r?\n/);
            const annualHeaders = parseCSVLine(annualLines.shift());
            rainfallRows = annualLines.filter(Boolean).map(line => {
                const values = parseCSVLine(line);
                const row = Object.fromEntries(annualHeaders.map((key, i) => [key, values[i] ?? ""]));
                return {
                    year: Number(row.year),
                    state: row.state,
                    state_code: row.state_code,
                    rainfall: row.annual_rainfall_mm === "" ? null : Number(row.annual_rainfall_mm),
                    coverage: Number(row.valid_area_coverage)
                };
            });

            const summaryLines = summaryText.trim().split(/\r?\n/);
            const summaryHeaders = parseCSVLine(summaryLines.shift());
            rainfallSummary = summaryLines.filter(Boolean).map(line => {
                const values = parseCSVLine(line);
                return Object.fromEntries(summaryHeaders.map((key, i) => [key, values[i] ?? ""]));
            });

            populateRainfallSelector();
            populateComparisonOptions();
            renderRainfallChart(selectedRainfallCode);
            renderComparisonChart();
            renderRainfallRankings();
        } catch (error) {
            console.error("Rainfall data loading error:", error);
            rainfallChart.innerHTML = '<div class="chart-message">Rainfall data could not be loaded. Please run AtmosIQ through VS Code Live Server and check that the processed CSV files are in <code>data/processed/</code>.</div>';
        }
    }

    function populateRainfallSelector() {
        const available = rainfallSummary
            .filter(row => Number(row.valid_years) > 0)
            .sort((a, b) => a.state.localeCompare(b.state));
        const unavailable = rainfallSummary
            .filter(row => Number(row.valid_years) === 0)
            .sort((a, b) => a.state.localeCompare(b.state));

        rainfallSelector.innerHTML = "";
        available.forEach(row => {
            const option = document.createElement("option");
            option.value = row.state_code;
            option.textContent = row.state;
            rainfallSelector.appendChild(option);
        });

        if (unavailable.length) {
            const group = document.createElement("optgroup");
            group.label = "Data unavailable";
            unavailable.forEach(row => {
                const option = document.createElement("option");
                option.value = row.state_code;
                option.textContent = `${row.state} · unavailable`;
                option.disabled = true;
                group.appendChild(option);
            });
            rainfallSelector.appendChild(group);
        }

        if (!available.some(row => row.state_code === selectedRainfallCode)) {
            selectedRainfallCode = available[0]?.state_code || "";
        }
        rainfallSelector.value = selectedRainfallCode;
    }

    function populateComparisonOptions() {
        if (!comparisonOptions) return;

        const available = rainfallSummary
            .filter(row => Number(row.valid_years) > 0)
            .sort((a, b) => a.state.localeCompare(b.state));

        // Keep the default selection limited to regions that actually have data.
        selectedComparisonCodes = selectedComparisonCodes
            .filter(code => available.some(row => row.state_code === code))
            .slice(0, 4);
        if (selectedComparisonCodes.length < 2) {
            selectedComparisonCodes = available.slice(0, 4).map(row => row.state_code);
        }

        comparisonOptions.innerHTML = "";
        available.forEach(row => {
            const label = document.createElement("label");
            label.className = "comparison-option";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = row.state_code;
            checkbox.checked = selectedComparisonCodes.includes(row.state_code);
            checkbox.addEventListener("change", () => {
                if (checkbox.checked) {
                    if (selectedComparisonCodes.length >= 4) {
                        checkbox.checked = false;
                        updateText("comparison-note", "You can compare up to four regions at a time.");
                        return;
                    }
                    selectedComparisonCodes.push(row.state_code);
                } else {
                    selectedComparisonCodes = selectedComparisonCodes.filter(code => code !== row.state_code);
                }
                updateComparisonControls();
                renderComparisonChart();
            });

            const name = document.createElement("span");
            name.textContent = row.state;
            label.append(checkbox, name);
            comparisonOptions.appendChild(label);
        });

        updateComparisonControls();
    }

    function updateComparisonControls() {
        if (!comparisonOptions) return;
        if (comparisonCount) {
            comparisonCount.textContent = `${selectedComparisonCodes.length} of 4 selected`;
        }
        comparisonOptions.querySelectorAll("input[type=checkbox]").forEach(checkbox => {
            checkbox.disabled = !checkbox.checked && selectedComparisonCodes.length >= 4;
        });
    }

    function renderComparisonChart() {
        if (!comparisonChart || typeof Plotly === "undefined") return;

        if (selectedComparisonCodes.length < 2) {
            Plotly.purge(comparisonChart);
            comparisonChart.innerHTML = '<div class="chart-message">Select at least two regions to compare their annual rainfall trends.</div>';
            updateText("comparison-note", "Choose two to four regions using the checkboxes.");
            return;
        }

        const palette = ["#35c5df", "#f2b65d", "#9b8cff", "#62d6a5"];
        const traces = selectedComparisonCodes.map((code, index) => {
            const summary = rainfallSummary.find(row => row.state_code === code);
            const rows = rainfallRows
                .filter(row => row.state_code === code)
                .sort((a, b) => a.year - b.year);

            return {
                x: rows.map(row => row.year),
                y: rows.map(row => Number.isFinite(row.rainfall) ? row.rainfall : null),
                type: "scatter",
                mode: "lines+markers",
                name: summary?.state || code,
                connectgaps: false,
                line: { color: palette[index % palette.length], width: 2.5 },
                marker: { size: 5 },
                hovertemplate: `<b>${summary?.state || code}</b><br>%{x}: %{y:,.1f} mm<extra></extra>`
            };
        });

        const layout = {
            autosize: true,
            paper_bgcolor: "rgba(0,0,0,0)",
            plot_bgcolor: "rgba(0,0,0,0)",
            margin: { l: 65, r: 25, t: 20, b: 55 },
            font: { family: "Inter, sans-serif", color: "#a9bfd2", size: 12 },
            xaxis: { title: { text: "Year", standoff: 12 }, tickmode: "linear", dtick: 2, gridcolor: "rgba(143,166,189,0.10)", linecolor: "#29445d", zeroline: false },
            yaxis: { title: { text: "Annual rainfall (mm)", standoff: 12 }, rangemode: "tozero", gridcolor: "rgba(143,166,189,0.13)", linecolor: "#29445d", zeroline: false, tickformat: ",.0f" },
            legend: { orientation: "h", y: 1.14, x: 0, font: { size: 11 } },
            hovermode: "x unified"
        };

        Plotly.react(comparisonChart, traces, layout, { responsive: true, displayModeBar: false, doubleClick: "reset" });
        updateText("comparison-note", "Only observed annual values are plotted. Missing observations remain gaps, not zero rainfall.");
    }

    function renderRainfallRankings() {
        if (!rankingChart || typeof Plotly === "undefined") return;

        const ranked = rainfallSummary
            .filter(row => Number(row.valid_years) > 0 && Number.isFinite(Number(row.mean_annual_rainfall)))
            .sort((a, b) => Number(b.mean_annual_rainfall) - Number(a.mean_annual_rainfall));

        if (!ranked.length) {
            rankingChart.innerHTML = '<div class="chart-message">No rainfall summary data is available for ranking.</div>';
            return;
        }

        const names = ranked.map(row => row.state);
        const values = ranked.map(row => Number(row.mean_annual_rainfall));

        const trace = {
            x: values,
            y: names,
            type: "bar",
            orientation: "h",
            marker: {
                color: values,
                colorscale: [
                    [0, "#287c91"],
                    [0.5, "#35c5df"],
                    [1, "#9b8cff"]
                ],
                showscale: false
            },
            hovertemplate: "<b>%{y}</b><br>Average: %{x:,.1f} mm/year<extra></extra>"
        };

        const layout = {
            autosize: true,
            paper_bgcolor: "rgba(0,0,0,0)",
            plot_bgcolor: "rgba(0,0,0,0)",
            margin: { l: 190, r: 35, t: 15, b: 55 },
            font: { family: "Inter, sans-serif", color: "#a9bfd2", size: 12 },
            xaxis: {
                title: { text: "Mean annual rainfall (mm)", standoff: 12 },
                rangemode: "tozero",
                gridcolor: "rgba(143,166,189,0.13)",
                linecolor: "#29445d",
                zeroline: false,
                tickformat: ",.0f"
            },
            yaxis: {
                autorange: "reversed",
                automargin: true,
                gridcolor: "rgba(0,0,0,0)",
                linecolor: "#29445d"
            },
            bargap: 0.24
        };

        Plotly.react(rankingChart, [trace], layout, {
            responsive: true,
            displayModeBar: false,
            doubleClick: "reset"
        });

        updateText(
            "ranking-note",
            `${ranked.length} regions ranked by their available 1991–2024 annual rainfall observations. Andaman and Nicobar Islands and Lakshadweep are excluded because their downloaded grid cells contain no valid observations.`
        );
    }

    function formatRainfall(value) {
        return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 });
    }

    function renderRainfallChart(stateCode) {
        if (!rainfallChart || typeof Plotly === "undefined") return;

        const summary = rainfallSummary.find(row => row.state_code === stateCode);
        const rows = rainfallRows
            .filter(row => row.state_code === stateCode)
            .sort((a, b) => a.year - b.year);
        const validRows = rows.filter(row => Number.isFinite(row.rainfall));

        if (!summary || validRows.length === 0) {
            rainfallChart.innerHTML = '<div class="chart-message">Annual rainfall data is unavailable for this territory.</div>';
            return;
        }

        const average = Number(summary.mean_annual_rainfall);
        const maxValue = Number(summary.maximum_annual_rainfall);
        const minValue = Number(summary.minimum_annual_rainfall);
        const maxRow = validRows.reduce((a, b) => b.rainfall > a.rainfall ? b : a);
        const minRow = validRows.reduce((a, b) => b.rainfall < a.rainfall ? b : a);

        updateText("rainfall-average", formatRainfall(average));
        updateText("rainfall-maximum", formatRainfall(maxValue));
        updateText("rainfall-minimum", formatRainfall(minValue));
        updateText("rainfall-maximum-year", `Recorded in ${maxRow.year}`);
        updateText("rainfall-minimum-year", `Recorded in ${minRow.year}`);
        updateText("rainfall-years", `${validRows.length} / 34`);
        updateText("rainfall-chart-title", `${summary.state} annual rainfall`);
        updateText("rainfall-chart-note", `Based on ${validRows.length} valid annual observations. The dashed line represents the 1991–2024 average.`);

        const trace = {
            x: validRows.map(row => row.year),
            y: validRows.map(row => row.rainfall),
            type: "scatter",
            mode: "lines+markers",
            name: "Annual rainfall",
            line: { color: "#35c5df", width: 3, shape: "spline" },
            marker: { color: "#70e0ef", size: 6, line: { color: "#0e2033", width: 1 } },
            fill: "tozeroy",
            fillcolor: "rgba(53, 197, 223, 0.09)",
            customdata: validRows.map(row => [row.coverage * 100]),
            hovertemplate: "<b>%{x}</b><br>Rainfall: %{y:,.1f} mm<extra></extra>"
        };

        const layout = {
            autosize: true,
            paper_bgcolor: "rgba(0,0,0,0)",
            plot_bgcolor: "rgba(0,0,0,0)",
            margin: { l: 65, r: 25, t: 20, b: 50 },
            font: { family: "Inter, sans-serif", color: "#a9bfd2", size: 12 },
            xaxis: {
                title: { text: "Year", standoff: 12 },
                tickmode: "linear", dtick: 2,
                gridcolor: "rgba(143,166,189,0.10)",
                linecolor: "#29445d", zeroline: false
            },
            yaxis: {
                title: { text: "Rainfall (mm)", standoff: 12 },
                rangemode: "tozero",
                gridcolor: "rgba(143,166,189,0.13)",
                linecolor: "#29445d", zeroline: false,
                tickformat: ",.0f"
            },
            shapes: [{
                type: "line", xref: "paper", x0: 0, x1: 1,
                yref: "y", y0: average, y1: average,
                line: { color: "#f2b65d", width: 2, dash: "dash" }
            }],
            annotations: [{
                xref: "paper", x: 1, xanchor: "right",
                yref: "y", y: average, yshift: 12,
                text: `Average ${formatRainfall(average)} mm`,
                showarrow: false,
                font: { color: "#f2b65d", size: 11 },
                bgcolor: "rgba(6,17,31,0.75)",
                borderpad: 4
            }],
            hovermode: "x unified",
            showlegend: false
        };

        Plotly.react(rainfallChart, [trace], layout, {
            responsive: true,
            displayModeBar: false,
            doubleClick: "reset"
        });
    }

    if (rainfallSelector) {
        rainfallSelector.addEventListener("change", event => {
            selectedRainfallCode = event.target.value;
            renderRainfallChart(selectedRainfallCode);
            renderRegionalTemperatureChart(selectedRainfallCode);
            const stats = stateClimateStats.get(selectedRainfallCode);
            updateText("temperature-value", stats && Number.isFinite(stats.temperature) ? `${stats.temperature.toFixed(1)} °C` : "-- °C");
            updateText("rainfall-value", stats && Number.isFinite(stats.rainfall) ? `${Math.round(stats.rainfall).toLocaleString("en-IN")} mm` : "-- mm");
            const selected = rainfallSummary.find(row => row.state_code === selectedRainfallCode);
            if (selected) {
                updateText("location-name", selected.state);
                updateText("selected-place", "Selected Indian state");
                updateText("location-description", `${selected.state} selected. Annual rainfall and temperature trends are shown below.`);
                if (stateLayer && currentView === "india") {
                    stateLayer.eachLayer(layer => {
                        if (getStateCode(layer.feature) === selectedRainfallCode) selectState(layer.feature, layer);
                    });
                }
            }
        });
    }

    loadRainfallData();

    /* =================================
       2B. INDIA-WIDE PRECIPITATION DATA
    ================================= */

    const precipitationSection = document.getElementById("precipitation-analysis");
    const precipitationTrend = document.getElementById("india-precipitation-trend");
    const precipitationHeatmap = document.getElementById("india-precipitation-heatmap");

    function formatMillimetres(value) {
        return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 });
    }

    async function loadIndiaPrecipitation() {
        if (!precipitationSection || !precipitationTrend || typeof Plotly === "undefined") return;

        try {
            const [annualResponse, gridResponse] = await Promise.all([
                fetch("./data/processed/india_annual_rainfall.csv"),
                fetch("./data/processed/india_rainfall_climatology.csv")
            ]);
            if (!annualResponse.ok || !gridResponse.ok) {
                throw new Error("Could not load India-wide precipitation data files.");
            }

            const [annualText, gridText] = await Promise.all([
                annualResponse.text(),
                gridResponse.text()
            ]);

            const annualLines = annualText.trim().split(/\r?\n/);
            const annualHeaders = parseCSVLine(annualLines.shift());
            const annualRows = annualLines.filter(Boolean).map(line => {
                const values = parseCSVLine(line);
                const row = Object.fromEntries(annualHeaders.map((key, i) => [key, values[i] ?? ""]));
                return {
                    year: Number(row.year),
                    rainfall: Number(row.mean_annual_rainfall_mm),
                    cells: Number(row.valid_grid_cells)
                };
            }).filter(row => Number.isFinite(row.rainfall));

            if (!annualRows.length) throw new Error("The annual precipitation dataset contains no valid rows.");

            const mean = annualRows.reduce((sum, row) => sum + row.rainfall, 0) / annualRows.length;
            const wettest = annualRows.reduce((a, b) => b.rainfall > a.rainfall ? b : a);
            const driest = annualRows.reduce((a, b) => b.rainfall < a.rainfall ? b : a);
            const averageCells = annualRows.reduce((sum, row) => sum + row.cells, 0) / annualRows.length;

            updateText("india-rainfall-average", formatMillimetres(mean));
            updateText("insight-precipitation-average", `${formatMillimetres(mean)} mm`);
            updateText("india-rainfall-wettest", formatMillimetres(wettest.rainfall));
            updateText("india-rainfall-wettest-year", `Recorded in ${wettest.year}`);
            updateText("india-rainfall-driest", formatMillimetres(driest.rainfall));
            updateText("india-rainfall-driest-year", `Recorded in ${driest.year}`);
            updateText("india-rainfall-cells", formatMillimetres(averageCells));

            Plotly.react(precipitationTrend, [{
                x: annualRows.map(row => row.year),
                y: annualRows.map(row => row.rainfall),
                type: "scatter",
                mode: "lines+markers",
                name: "Annual grid average",
                line: { color: "#35d5e9", width: 3, shape: "spline" },
                marker: { color: "#f2b65d", size: 7 },
                hovertemplate: "%{x}: %{y:,.0f} mm<extra></extra>"
            }, {
                x: annualRows.map(row => row.year),
                y: annualRows.map(() => mean),
                type: "scatter",
                mode: "lines",
                name: "34-year average",
                line: { color: "#f2b65d", width: 1.5, dash: "dash" },
                hoverinfo: "skip"
            }], {
                autosize: true,
                paper_bgcolor: "rgba(0,0,0,0)",
                plot_bgcolor: "rgba(0,0,0,0)",
                font: { color: "#b8c8d8", family: "Inter, sans-serif" },
                margin: { l: 65, r: 24, t: 24, b: 55 },
                xaxis: {
                    title: { text: "Year", font: { color: "#e3edf7", size: 14 }, standoff: 14 },
                    dtick: 2,
                    tickfont: { color: "#b8c8d8", size: 11 },
                    gridcolor: "rgba(143,166,189,0.10)",
                    linecolor: "#29445d",
                    automargin: true
                },
                yaxis: {
                    title: { text: "Annual rainfall (mm)", font: { color: "#e3edf7", size: 14 }, standoff: 14 },
                    rangemode: "tozero",
                    tickfont: { color: "#b8c8d8", size: 11 },
                    gridcolor: "rgba(143,166,189,0.13)",
                    linecolor: "#29445d",
                    tickformat: ",.0f",
                    automargin: true
                },
                legend: { orientation: "h", y: 1.12, x: 0 },
                hovermode: "x unified"
            }, { responsive: true, displayModeBar: false, doubleClick: "reset" });

            const gridLines = gridText.trim().split(/\r?\n/);
            const gridHeaders = parseCSVLine(gridLines.shift());
            const gridRows = gridLines.filter(Boolean).map(line => {
                const values = parseCSVLine(line);
                const row = Object.fromEntries(gridHeaders.map((key, i) => [key, values[i] ?? ""]));
                return { lat: Number(row.latitude), lon: Number(row.longitude), rain: Number(row.mean_annual_rainfall_mm) };
            }).filter(row => Number.isFinite(row.lat) && Number.isFinite(row.lon) && Number.isFinite(row.rain));

            const latitudes = [...new Set(gridRows.map(row => row.lat))].sort((a, b) => a - b);
            const longitudes = [...new Set(gridRows.map(row => row.lon))].sort((a, b) => a - b);
            const valuesByCell = new Map(gridRows.map(row => [`${row.lat}|${row.lon}`, row.rain]));
            const z = latitudes.map(lat => longitudes.map(lon => valuesByCell.has(`${lat}|${lon}`) ? valuesByCell.get(`${lat}|${lon}`) : null));

            Plotly.react(precipitationHeatmap, [{
                type: "heatmap",
                x: longitudes,
                y: latitudes,
                z,
                colorscale: [[0, "#173d68"], [0.25, "#237fa3"], [0.5, "#35c4c8"], [0.75, "#b6d77b"], [1, "#f2b65d"]],
                colorbar: { title: { text: "mm/year", side: "right", font: { color: "#b8c8d8" } }, tickfont: { color: "#b8c8d8" } },
                hovertemplate: "Latitude: %{y:.2f}°<br>Longitude: %{x:.2f}°<br>Mean rainfall: %{z:,.0f} mm/year<extra></extra>"
            }], {
                autosize: true,
                paper_bgcolor: "rgba(0,0,0,0)",
                plot_bgcolor: "rgba(0,0,0,0)",
                font: { color: "#b8c8d8", family: "Inter, sans-serif" },
                margin: { l: 65, r: 45, t: 20, b: 55 },
                xaxis: {
                    title: { text: "Longitude (°E)", font: { color: "#e3edf7", size: 14 }, standoff: 14 },
                    tickfont: { color: "#b8c8d8", size: 11 },
                    ticksuffix: "°",
                    gridcolor: "rgba(143,166,189,0.10)",
                    linecolor: "#29445d",
                    automargin: true
                },
                yaxis: {
                    title: { text: "Latitude (°N)", font: { color: "#e3edf7", size: 14 }, standoff: 14 },
                    tickfont: { color: "#b8c8d8", size: 11 },
                    ticksuffix: "°",
                    gridcolor: "rgba(143,166,189,0.10)",
                    linecolor: "#29445d",
                    scaleanchor: "x",
                    scaleratio: 1,
                    automargin: true
                }
            }, { responsive: true, displayModeBar: false, doubleClick: "reset" });

        } catch (error) {
            console.error("India-wide precipitation loading error:", error);
            precipitationTrend.innerHTML = '<div class="chart-message">India-wide precipitation data could not be loaded. Check that both India precipitation CSV files are present in <code>data/processed/</code> and open AtmosIQ using VS Code Live Server.</div>';
        }
    }

    loadIndiaPrecipitation();

    /* =================================
       2C. TEMPERATURE DATA + CHARTS
    ================================= */
    const temperatureSection = document.getElementById("temperature-analysis");
    const temperatureNotice = document.getElementById("temperature-data-notice");
    const temperatureChartDefinitions = [
        { id: "india-temperature-average", field: "tas_c", label: "Average temperature", title: "Average temperature (°C)", color: "#35d5e9" },
        { id: "india-temperature-maximum", field: "tasmax_c", label: "Maximum temperature", title: "Maximum temperature (°C)", color: "#f2b65d" },
        { id: "india-temperature-minimum", field: "tasmin_c", label: "Minimum temperature", title: "Minimum temperature (°C)", color: "#7bc4ff" }
    ];

    async function loadIndiaTemperature() {
        if (!temperatureSection || typeof Plotly === "undefined") return;
        const chartElements = temperatureChartDefinitions.map(item => document.getElementById(item.id));
        if (chartElements.some(element => !element)) return;

        try {
            const response = await fetch("./data/processed/state_annual_temperature_area_weighted.csv");
            if (!response.ok) throw new Error("Area-weighted state temperature CSV is unavailable.");
            const csvText = await response.text();
            const lines = csvText.trim().split(/\r?\n/);
            const headers = parseCSVLine(lines.shift());
            const rawRows = lines.filter(Boolean).map(line => {
                const values = parseCSVLine(line);
                return Object.fromEntries(headers.map((key, index) => [key, values[index] ?? ""]));
            });
            const byYear = new Map();
            rawRows.forEach(row => {
                const year = Number(row.year);
                const area = Number(row.overlap_area_km2);
                if (!Number.isFinite(year) || !Number.isFinite(area) || area <= 0) return;
                if (!byYear.has(year)) byYear.set(year, { area:0, tas_c:0, tasmax_c:0, tasmin_c:0, weights:{tas_c:0,tasmax_c:0,tasmin_c:0} });
                const item = byYear.get(year); item.area += area;
                [["tmean_mean_c","tas_c"],["tmax_mean_c","tasmax_c"],["tmin_mean_c","tasmin_c"]].forEach(([source,target]) => {
                    const value = Number(row[source]);
                    if (row[source] !== "" && Number.isFinite(value)) { item[target] += value * area; item.weights[target] += area; }
                });
            });
            const rows = [...byYear.entries()].map(([year,item]) => ({ year, tas_c:item.weights.tas_c ? item.tas_c/item.weights.tas_c : null, tasmax_c:item.weights.tasmax_c ? item.tasmax_c/item.weights.tasmax_c : null, tasmin_c:item.weights.tasmin_c ? item.tasmin_c/item.weights.tasmin_c : null })).sort((a,b)=>a.year-b.year);
            if (!rows.length) throw new Error("No valid area-weighted annual temperature values were found.");
            const meanAnnualTemperature = rows.filter(row=>Number.isFinite(row.tas_c)).reduce((sum,row,_,arr)=>sum+row.tas_c/arr.length,0);
            const warmestYear = rows.filter(row=>Number.isFinite(row.tas_c)).reduce((best,row)=>!best || row.tas_c>best.tas_c ? row : best,null);
            if (Number.isFinite(meanAnnualTemperature)) updateText("insight-temperature-average", `${meanAnnualTemperature.toFixed(1)} °C`);
            if (warmestYear) { updateText("insight-warmest-year", String(warmestYear.year)); updateText("insight-warmest-value", `${warmestYear.tas_c.toFixed(1)} °C annual mean`); }

            temperatureChartDefinitions.forEach(item => {
                const element = document.getElementById(item.id);
                const validRows = rows.filter(row => Number.isFinite(row[item.field]));
                if (!validRows.length) {
                    element.innerHTML = '<div class="chart-message">No valid values are available for this temperature variable.</div>';
                    return;
                }

                Plotly.react(element, [{
                    x: validRows.map(row => row.year),
                    y: validRows.map(row => row[item.field]),
                    type: "scatter",
                    mode: "lines+markers",
                    name: item.label,
                    line: { color: item.color, width: 3, shape: "spline" },
                    marker: { color: item.color, size: 6 },
                    hovertemplate: "%{x}: %{y:.2f} °C<extra></extra>"
                }], {
                    autosize: true,
                    paper_bgcolor: "rgba(0,0,0,0)",
                    plot_bgcolor: "rgba(0,0,0,0)",
                    font: { color: "#b8c8d8", family: "Inter, sans-serif" },
                    margin: { l: 70, r: 24, t: 22, b: 55 },
                    xaxis: {
                        title: { text: "Year", font: { color: "#e3edf7", size: 14 }, standoff: 14 },
                        tickfont: { color: "#b8c8d8", size: 11 },
                        dtick: Math.max(1, Math.ceil(validRows.length / 12)),
                        gridcolor: "rgba(143,166,189,0.10)",
                        linecolor: "#29445d",
                        automargin: true
                    },
                    yaxis: {
                        title: { text: item.title, font: { color: "#e3edf7", size: 14 }, standoff: 14 },
                        tickfont: { color: "#b8c8d8", size: 11 },
                        gridcolor: "rgba(143,166,189,0.13)",
                        linecolor: "#29445d",
                        automargin: true
                    },
                    hovermode: "x unified",
                    showlegend: false,
                    uirevision: `temperature-${item.field}`
                }, { responsive: true, displayModeBar: false, doubleClick: "reset" });
            });

            if (temperatureNotice) temperatureNotice.hidden = true;
        } catch (error) {
            console.info("Temperature charts are waiting for a verified dataset:", error.message);
            temperatureChartDefinitions.forEach(item => {
                const element = document.getElementById(item.id);
                if (element) {
                    element.innerHTML = '<div class="chart-message">Temperature data will appear here once the verified annual dataset is added.</div>';
                }
            });
        }
    }

    // State-to-state temperature comparison uses the verified area-weighted state dataset.
    async function loadTemperatureStateComparison() {
        const optionsContainer = document.getElementById("temperature-comparison-options");
        const countLabel = document.getElementById("temperature-comparison-count");
        const variableSelect = document.getElementById("temperature-compare-variable");
        const chart = document.getElementById("temperature-state-comparison-chart");
        const status = document.getElementById("temperature-comparison-status");
        if (!optionsContainer || !variableSelect || !chart || typeof Plotly === "undefined") return;
        let selectedCodes = ["IN-TG", "IN-KL", "IN-RJ"];

        try {
            const response = await fetch("./data/processed/state_annual_temperature_area_weighted.csv");
            if (!response.ok) throw new Error("Could not load state_annual_temperature_area_weighted.csv");
            const lines = (await response.text()).trim().split(/\r?\n/);
            const headers = parseCSVLine(lines.shift());
            const rows = lines.filter(Boolean).map(line => {
                const values = parseCSVLine(line);
                return Object.fromEntries(headers.map((key, index) => [key, values[index] ?? ""]));
            }).map(row => ({
                code: row.shapeISO,
                name: row.shapeName,
                year: Number(row.year),
                tmean_mean_c: row.tmean_mean_c === "" ? null : Number(row.tmean_mean_c),
                tmax_mean_c: row.tmax_mean_c === "" ? null : Number(row.tmax_mean_c),
                tmin_mean_c: row.tmin_mean_c === "" ? null : Number(row.tmin_mean_c),
                coverage: row.tmean_coverage_pct === "" ? null : Number(row.tmean_coverage_pct)
            })).filter(row => Number.isFinite(row.year) && row.code && row.name);

            if (!rows.length) throw new Error("The state temperature dataset contains no usable records.");
            const states = [...new Map(rows.map(row => [row.code, row.name])).entries()]
                .sort((a, b) => a[1].localeCompare(b[1]));
            selectedCodes = selectedCodes.filter(code => states.some(item => item[0] === code));
            if (selectedCodes.length < 2) selectedCodes = states.slice(0, 3).map(item => item[0]);
            optionsContainer.innerHTML = "";
            states.forEach(([code, name]) => {
                const label = document.createElement("label");
                label.className = "comparison-option";
                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.value = code;
                checkbox.checked = selectedCodes.includes(code);
                checkbox.addEventListener("change", () => {
                    if (checkbox.checked) {
                        if (selectedCodes.length >= 4) { checkbox.checked = false; return; }
                        selectedCodes.push(code);
                    } else selectedCodes = selectedCodes.filter(item => item !== code);
                    updateControls();
                    renderComparison();
                });
                const text = document.createElement("span");
                text.textContent = name;
                label.append(checkbox, text);
                optionsContainer.appendChild(label);
            });

            function updateControls() {
                if (countLabel) countLabel.textContent = `${selectedCodes.length} of 4 selected`;
                optionsContainer.querySelectorAll("input[type=checkbox]").forEach(input => {
                    input.disabled = !input.checked && selectedCodes.length >= 4;
                });
            }

            function renderComparison() {
                const field = variableSelect.value;
                const label = variableSelect.selectedOptions[0]?.textContent || "Temperature";
                if (selectedCodes.length < 2) {
                    chart.innerHTML = '<div class="chart-message">Select at least two states to compare their temperature trends.</div>';
                    if (status) status.textContent = "Choose two or more states from the list.";
                    return;
                }

                const traces = selectedCodes.map(code => {
                    const stateRows = rows.filter(row => row.code === code && Number.isFinite(row[field]));
                    const name = states.find(item => item[0] === code)?.[1] || code;
                    return {
                        x: stateRows.map(row => row.year),
                        y: stateRows.map(row => row[field]),
                        customdata: stateRows.map(row => [row.coverage]),
                        type: "scatter", mode: "lines+markers", name,
                        line: { width: 2.5 }, marker: { size: 5 },
                        connectgaps: false,
                        hovertemplate: `${name}<br>Year: %{x}<br>${label}: %{y:.2f} °C<br>Coverage: %{customdata[0]:.1f}%<extra></extra>`
                    };
                }).filter(trace => trace.x.length);

                if (!traces.length) {
                    chart.innerHTML = '<div class="chart-message">No valid temperature observations are available for these states and this measure.</div>';
                    if (status) status.textContent = "No comparable records found.";
                    return;
                }

                Plotly.react(chart, traces, {
                    autosize: true, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
                    font: { color: "#b8c8d8", family: "Inter, sans-serif" },
                    margin: { l: 65, r: 25, t: 24, b: 58 },
                    xaxis: { title: { text: "Year", font: { color: "#e3edf7", size: 14 }, standoff: 12 },
                        dtick: 2, gridcolor: "rgba(143,166,189,0.10)", linecolor: "#29445d", automargin: true },
                    yaxis: { title: { text: `${label} (°C)`, font: { color: "#e3edf7", size: 14 }, standoff: 12 },
                        gridcolor: "rgba(143,166,189,0.13)", linecolor: "#29445d", automargin: true },
                    hovermode: "x unified", legend: { orientation: "h", y: -0.25 },
                    uirevision: `state-temperature-${field}`
                }, { responsive: true, displayModeBar: true, doubleClick: "reset" });
                if (status) status.textContent = `${traces.length} state(s) plotted. Missing observations remain gaps rather than being estimated.`;
            }

            variableSelect.addEventListener("change", renderComparison);
            updateControls();
            renderComparison();
        } catch (error) {
            console.error("State temperature comparison could not load:", error);
            chart.innerHTML = '<div class="chart-message">Could not load the state temperature comparison. Check that the area-weighted CSV is in data/processed/ and open the dashboard with VS Code Live Server.</div>';
            if (status) status.textContent = error.message;
        }
    }

    loadTemperatureStateComparison();
    loadIndiaTemperature();

    /* =================================
       3. DASHBOARD
    ================================= */

    const mapElement = document.getElementById("climate-map");

    if (!mapElement) return;

    const links = document.querySelectorAll(".side-link");
    const heading = document.getElementById("view-title");

    const titles = {
        states: "Regional Analysis",
        temperature: "Temperature Analysis",
        rainfall: "Precipitation Analysis",
        insights: "Climate Insights",
        methodology: "Data & Methodology"
    };

    /* =================================
       3. INITIALIZE MAP
    ================================= */

    if (typeof L === "undefined") {
        console.error("Leaflet library not loaded.");
        return;
    }

    const map = L.map("climate-map", { minZoom: 2, maxZoom: 18 }).setView([22.5, 79], 4);

    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            attribution: "&copy; OpenStreetMap contributors",
            maxZoom: 18
        }
    ).addTo(map);

    /* =================================
       4. MAP STYLES
    ================================= */

    function normalStyle() {
        return {
            color: "#54738e",
            weight: 0.8,
            fillColor: "#17466a",
            fillOpacity: 0.55
        };
    }

    function hoverStyle() {
        return {
            color: "#54d9ed",
            weight: 2,
            fillColor: "#2799d0",
            fillOpacity: 0.85
        };
    }

    function selectedStyle() {
        return {
            color: "#ffffff",
            weight: 2,
            fillColor: "#249dd5",
            fillOpacity: 0.9
        };
    }

    function stateStyle() {
        return {
            color: "#54bfe0",
            weight: 1.2,
            fillColor: "#176b91",
            fillOpacity: 0.65
        };
    }

    let overlayVariable = "temperature";
    const stateClimateStats = new Map();
    const overlayPalette = ["#2878b5", "#63b7b2", "#c8d982", "#f2b45f", "#d85b4a"];

    function colorForValue(value, values) {
        const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
        if (!Number.isFinite(value) || !valid.length) return "#526477";
        const rank = valid.filter(item => item <= value).length / valid.length;
        return overlayPalette[Math.min(4, Math.floor(rank * 5))];
    }

    function climateStateStyle(feature) {
        const code = getStateCode(feature);
        const values = [...stateClimateStats.values()].map(item => overlayVariable === "temperature" ? item.temperature : item.rainfall).filter(Number.isFinite);
        const item = stateClimateStats.get(code);
        const value = item ? (overlayVariable === "temperature" ? item.temperature : item.rainfall) : null;
        return { color: selectedStateLayer && selectedStateLayer.feature === feature ? "#ffffff" : "#7b9bb5", weight: selectedStateLayer && selectedStateLayer.feature === feature ? 2.2 : 1, fillColor: colorForValue(value, values), fillOpacity: Number.isFinite(value) ? 0.82 : 0.28 };
    }

    function refreshClimateOverlay() {
        if (stateLayer) stateLayer.setStyle(climateStateStyle);
        const title = document.getElementById("overlay-legend-title");
        if (title) title.textContent = overlayVariable === "temperature" ? "Mean annual temperature (°C)" : "Mean annual precipitation (mm)";
    }

    async function loadStateClimateOverlayData() {
        try {
            const [temperatureResponse, rainfallResponse] = await Promise.all([
                fetch("./data/processed/state_annual_temperature_area_weighted.csv"),
                fetch("./data/processed/state_rainfall_summary.csv")
            ]);
            if (!temperatureResponse.ok || !rainfallResponse.ok) throw new Error("State climate files unavailable");
            const tempText = await temperatureResponse.text();
            const tempLines = tempText.trim().split(/\r?\n/);
            const tempHeaders = parseCSVLine(tempLines.shift());
            const tempRows = tempLines.filter(Boolean).map(line => {
                const vals = parseCSVLine(line); return Object.fromEntries(tempHeaders.map((key, i) => [key, vals[i] ?? ""]));
            });
            const grouped = new Map();
            tempRows.forEach(row => {
                const code = row.shapeISO;
                const value = row.tmean_mean_c === "" ? null : Number(row.tmean_mean_c);
                if (!code || !Number.isFinite(value)) return;
                if (!grouped.has(code)) grouped.set(code, { name: row.shapeName, tempSum: 0, tempCount: 0, annual: [] });
                const item = grouped.get(code); item.tempSum += value; item.tempCount += 1;
                item.annual.push({ year: Number(row.year), value });
            });
            grouped.forEach(item => { item.temperature = item.tempSum / item.tempCount; item.rainfall = null; });
            const rainText = await rainfallResponse.text();
            const rainLines = rainText.trim().split(/\r?\n/); const rainHeaders = parseCSVLine(rainLines.shift());
            rainLines.filter(Boolean).forEach(line => {
                const vals = parseCSVLine(line); const row = Object.fromEntries(rainHeaders.map((key, i) => [key, vals[i] ?? ""]));
                if (grouped.has(row.state_code) && row.mean_annual_rainfall !== "") grouped.get(row.state_code).rainfall = Number(row.mean_annual_rainfall);
            });
            grouped.forEach((value, key) => stateClimateStats.set(key, value));
            refreshClimateOverlay();
            renderRegionalTemperatureChart(selectedRainfallCode);
            const initialStats = stateClimateStats.get(selectedRainfallCode);
            updateText("temperature-value", initialStats && Number.isFinite(initialStats.temperature) ? `${initialStats.temperature.toFixed(1)} °C` : "-- °C");
            updateText("rainfall-value", initialStats && Number.isFinite(initialStats.rainfall) ? `${Math.round(initialStats.rainfall).toLocaleString("en-IN")} mm` : "-- mm");
            renderClimateInsightsCharts(tempRows, rainLines, rainHeaders);
        } catch (error) { console.warn("State overlay data could not be loaded:", error); }
    }

    function renderRegionalTemperatureChart(stateCode) {
        const el = document.getElementById("regional-temperature-chart");
        if (!el || typeof Plotly === "undefined") return;
        const state = stateClimateStats.get(stateCode);
        if (!state || !state.annual.length) { el.innerHTML = '<div class="chart-message">Temperature observations are unavailable for this region.</div>'; return; }
        const rows = state.annual.slice().sort((a,b) => a.year-b.year);
        updateText("regional-temperature-title", `${state.name} annual temperature`);
        updateText("regional-temperature-note", `Based on ${rows.length} valid annual observations. Missing years are not interpolated.`);
        Plotly.react(el, [{ x: rows.map(r=>r.year), y: rows.map(r=>r.value), type:"scatter", mode:"lines+markers", line:{color:"#f2b65d",width:3}, marker:{size:6}, hovertemplate:"%{x}: %{y:.2f} °C<extra></extra>" }], climatePlotLayout("Year", "Mean temperature (°C)"), {responsive:true,displayModeBar:false});
    }

    function climatePlotLayout(xTitle, yTitle) {
        return { autosize:true, paper_bgcolor:"rgba(0,0,0,0)", plot_bgcolor:"rgba(0,0,0,0)", font:{family:"Inter,sans-serif",color:"#a9bfd2",size:12}, margin:{l:68,r:24,t:20,b:55}, xaxis:{title:xTitle,gridcolor:"rgba(143,166,189,.12)",linecolor:"#29445d",automargin:true}, yaxis:{title:yTitle,gridcolor:"rgba(143,166,189,.12)",linecolor:"#29445d",automargin:true}, hovermode:"closest" };
    }

    function renderClimateInsightsCharts(tempRows, rainLines, rainHeaders) {
        const scatter = document.getElementById("climate-scatter-chart");
        if (scatter && typeof Plotly !== "undefined") {
            const points = [...stateClimateStats.entries()].map(([code,item]) => ({code,...item})).filter(item => Number.isFinite(item.temperature) && Number.isFinite(item.rainfall));
            Plotly.react(scatter, [{ x:points.map(p=>p.temperature), y:points.map(p=>p.rainfall), text:points.map(p=>p.name), customdata:points.map(p=>p.code), type:"scatter", mode:"markers+text", textposition:"top center", textfont:{size:9,color:"#a9bfd2"}, marker:{size:10,color:points.map(p=>p.temperature),colorscale:"Turbo",showscale:true,colorbar:{title:"°C",thickness:10}}, hovertemplate:"<b>%{text}</b><br>Mean temperature: %{x:.2f} °C<br>Mean rainfall: %{y:,.0f} mm/year<extra></extra>" }], climatePlotLayout("Mean annual temperature (°C)","Mean annual rainfall (mm/year)"), {responsive:true,displayModeBar:false});
        }
        const heat = document.getElementById("temperature-state-heatmap");
        if (heat && typeof Plotly !== "undefined") {
            const rows = tempRows.map(row=>({name:row.shapeName,year:Number(row.year),value:row.tmean_mean_c===""?null:Number(row.tmean_mean_c)})).filter(row=>row.name && Number.isFinite(row.year));
            const names=[...new Set(rows.map(r=>r.name))].sort((a,b)=>a.localeCompare(b)); const years=[...new Set(rows.map(r=>r.year))].sort((a,b)=>a-b);
            const lookup=new Map(rows.map(r=>[`${r.name}|${r.year}`,r.value]));
            Plotly.react(heat,[{x:years,y:names,z:names.map(name=>years.map(year=>lookup.get(`${name}|${year}`) ?? null)),type:"heatmap",colorscale:"Reds",colorbar:{title:"°C"},hovertemplate:"%{y}<br>%{x}: %{z:.2f} °C<extra></extra>"}],{...climatePlotLayout("Year","State / UT"),margin:{l:175,r:35,t:20,b:55},yaxis:{automargin:true,gridcolor:"rgba(0,0,0,0)"}}, {responsive:true,displayModeBar:false});
        }
        const pie=document.getElementById("rainfall-distribution-pie");
        if (pie && typeof Plotly !== "undefined") {
            const rainfallValues = rainLines.map(line => {
                const vals = parseCSVLine(line);
                const row = Object.fromEntries(rainHeaders.map((key, index) => [key, vals[index] ?? ""]));
                return row.mean_annual_rainfall === "" ? null : Number(row.mean_annual_rainfall);
            }).filter(Number.isFinite).sort((a,b)=>a-b);
            if (rainfallValues.length) {
                const groups=[0,0,0,0];
                rainfallValues.forEach((value,index)=>{ groups[Math.min(3,Math.floor(index*4/rainfallValues.length))]++; });
                Plotly.react(pie,[{labels:["Lowest quartile","Lower-middle","Upper-middle","Highest quartile"],values:groups,type:"pie",hole:.48,marker:{colors:["#287c91","#35c5df","#6f82d6","#9b8cff"],line:{color:"#102337",width:2}},textinfo:"label+percent",hovertemplate:"%{label}: %{value} states (%{percent})<extra></extra>"}],{paper_bgcolor:"rgba(0,0,0,0)",plot_bgcolor:"rgba(0,0,0,0)",font:{color:"#b8c8d8"},margin:{l:20,r:20,t:10,b:10},showlegend:false},{responsive:true,displayModeBar:false});
            }
        }
    }

    /* =================================
       5. MAP LAYERS AND STATE
    ================================= */

    let worldLayer = null;
    let stateLayer = null;

    let selectedLayer = null;
    let selectedStateLayer = null;

    let currentView = "none";

    /* =================================
       7. GET STATE NAME
    ================================= */

    function getStateName(feature) {

        const p = feature.properties || {};

        const featureName =
            p.shapeName ||
            p.ST_NM ||
            p.NAME_1 ||
            p.name ||
            p.NAME ||
            p.state ||
            p.State ||
            p.STATE ||
            p.dtname ||
            p.st_nm;
        if (featureName && String(featureName).trim()) return String(featureName).trim();

        const code = p.shapeISO || p.shapeIso || p.iso_code || p.ISO_3166_2 || p.shapeISO_1 || "";
        const matchingOption = rainfallSelector && [...rainfallSelector.options].find(option => option.value === code);
        return matchingOption ? matchingOption.textContent.trim() : "Unknown state";
    }

    function getStateCode(feature) {
        const p = feature.properties || {};
        return p.shapeISO || p.shapeIso || p.iso_code || p.ISO_3166_2 || p.shapeISO_1 || "";
    }

    /* =================================
       8. SELECT INDIAN STATE
    ================================= */

    function selectState(feature, layer) {

        if (selectedStateLayer && stateLayer) {
            stateLayer.resetStyle(selectedStateLayer);
        }

        selectedStateLayer = layer;

        layer.setStyle(climateStateStyle(feature));

        const stateName = getStateName(feature);
        const stateCode = getStateCode(feature);

        if (stateCode && rainfallSelector && [...rainfallSelector.options].some(option => option.value === stateCode && !option.disabled)) {
            selectedRainfallCode = stateCode;
            rainfallSelector.value = stateCode;
            renderRainfallChart(stateCode);
            renderRegionalTemperatureChart(stateCode);
        }

        updateText("selected-place", "Selected Indian state");
        updateText("location-name", stateName);

        updateText(
            "location-description",
            `${stateName} selected. Annual rainfall and temperature trends are shown below.`
        );

        const selectedStats = stateClimateStats.get(stateCode);
        updateText("temperature-value", selectedStats && Number.isFinite(selectedStats.temperature) ? `${selectedStats.temperature.toFixed(1)} °C` : "-- °C");
        updateText("rainfall-value", selectedStats && Number.isFinite(selectedStats.rainfall) ? `${Math.round(selectedStats.rainfall).toLocaleString("en-IN")} mm` : "-- mm");

        map.fitBounds(layer.getBounds(), {
            padding: [30, 30],
            maxZoom: 8,
            animate: true
        });

        layer.bindPopup(
            `<strong>${stateName}</strong><br>Indian state selected`
        ).openPopup();

        console.log("Selected state:", stateName);
    }

    /* =================================
       WORLD MAP AND COUNTRY NAVIGATION
    ================================= */
    const backToWorldButton = document.getElementById("back-to-world");
    const mapHeadingTitle = document.querySelector(".map-heading h2");
    const mapHeadingDescription = document.querySelector(".map-heading p");

    function showWorldView() {
        currentView = "world";
        if (stateLayer && map.hasLayer(stateLayer)) map.removeLayer(stateLayer);
        if (backToWorldButton) backToWorldButton.hidden = true;
        if (mapHeadingTitle) mapHeadingTitle.textContent = "World Climate Explorer";
        if (mapHeadingDescription) mapHeadingDescription.textContent = "Select India to explore its states and regional climate patterns";
        updateText("selected-place", "World Overview");
        updateText("location-name", "Explore Countries");
        updateText("location-description", "Click India to explore its states. Other countries are selectable on the map.");
        updateText("temperature-value", "-- °C");
        updateText("rainfall-value", "-- mm");
        if (!worldLayer) { loadWorldMap(); return; }
        if (!map.hasLayer(worldLayer)) worldLayer.addTo(map);
        map.fitBounds(worldLayer.getBounds(), { padding: [18, 18], animate: true });
    }

    async function loadWorldMap() {
        try {
            const response = await fetch("./data/countries.geojson");
            if (!response.ok) throw new Error("Could not load countries.geojson");
            const data = await response.json();
            worldLayer = L.geoJSON(data, {
                style: normalStyle,
                onEachFeature: (feature, layer) => {
                    const props = feature.properties || {};
                    const countryName = props.name || props.NAME || props.ADMIN || props.NAME_EN || "Country";
                    layer.bindTooltip(countryName);
                    layer.on("mouseover", () => layer.setStyle(hoverStyle()));
                    layer.on("mouseout", () => { if (selectedLayer !== layer) worldLayer.resetStyle(layer); });
                    layer.bindPopup(`<strong>${countryName}</strong><br>Country selected`);
                    layer.on("click", () => {
                        const countryCode = props["ISO3166-1-Alpha-2"] || props.ISO_A2 || "";
                        if (countryCode === "IN" || countryName.toLowerCase() === "india") {
                            enterIndia();
                            return;
                        }
                        if (selectedLayer && worldLayer) worldLayer.resetStyle(selectedLayer);
                        selectedLayer = layer;
                        layer.setStyle(selectedStyle());
                        updateText("selected-place", "Selected Country");
                        updateText("location-name", countryName);
                        updateText("location-description", "Country selected. Country-level climate summaries are not included in this dashboard; select India to explore the available regional data.");
                        updateText("temperature-value", "-- °C");
                        updateText("rainfall-value", "-- mm");
                        layer.openPopup();
                    });
                }
            }).addTo(map);
            map.fitBounds(worldLayer.getBounds(), { padding: [18, 18], animate: true });
        } catch (error) {
            console.error("World map loading error:", error);
            updateText("location-description", "Could not load country boundaries. Check data/countries.geojson.");
        }
    }

    if (backToWorldButton) backToWorldButton.addEventListener("click", showWorldView);

    /* =================================
       9. LOAD INDIA STATES
    ================================= */

    function enterIndia() {

        if (currentView === "india") return;

        currentView = "india";
        selectedLayer = null;
        if (worldLayer && map.hasLayer(worldLayer)) map.removeLayer(worldLayer);
        if (backToWorldButton) backToWorldButton.hidden = false;
        if (mapHeadingTitle) mapHeadingTitle.textContent = "India Regional Explorer";
        if (mapHeadingDescription) mapHeadingDescription.textContent = "Select a state to explore its climate patterns";

        updateText("selected-place", "India");
        updateText("location-name", "Indian States");
        updateText(
            "location-description",
            "Loading Indian state boundaries..."
        );

        updateText("temperature-value", "-- °C");
        updateText("rainfall-value", "-- mm");

        if (heading) {
            heading.textContent = "Regional Analysis";
        }

        // Load the state GeoJSON file.
        fetch("./data/india_states.geojson")
            .then(response => {
                if (!response.ok) {
                    throw new Error(
                        "Could not load india_states.geojson"
                    );
                }

                return response.json();
            })
            .then(data => {

                if (currentView !== "india") return;

                if (!data.features || !data.features.length) {
                    throw new Error("No state features found.");
                }

                if (stateLayer && map.hasLayer(stateLayer)) {
                    map.removeLayer(stateLayer);
                }

                selectedStateLayer = null;

                stateLayer = L.geoJSON(data, {

                    style: climateStateStyle,

                    onEachFeature: function(feature, layer) {

                        const stateName = getStateName(feature);

                        layer.bindTooltip(stateName);

                        layer.on("mouseover", function() {
                            if (selectedStateLayer !== layer) {
                                layer.setStyle(hoverStyle());
                            }
                        });

                        layer.on("mouseout", function() {
                            if (selectedStateLayer !== layer) {
                                stateLayer.resetStyle(layer);
                            }
                        });

                        layer.on("click", function() {
                            selectState(feature, layer);
                        });
                    }

                }).addTo(map);

                map.fitBounds(stateLayer.getBounds(), { padding: [20, 20], animate: true });
                refreshClimateOverlay();

                updateText("selected-place", "India");
                updateText("location-name", "Explore Indian States");
                updateText(
                    "location-description",
                    "Click any state to explore its climate."
                );

                console.log(
                    "Indian state boundaries loaded!",
                    data.features.length,
                    "features"
                );

            })
            .catch(error => {

                console.error("India map loading error:", error);

                updateText(
                    "location-description",
                    "Could not load Indian state boundaries. Check the data folder and filename."
                );
            });
    }

    /* =================================
       DASHBOARD NAVIGATION
    ================================= */
    const pageSections = {
        states: ["rainfall-analysis"],
        temperature: ["temperature-analysis"],
        rainfall: ["precipitation-analysis"],
        insights: ["climate-insights"],
        methodology: ["methodology-section"]
    };
    const pageTitles = { states:"Regional Analysis", temperature:"Temperature Analysis", rainfall:"Precipitation Analysis", insights:"Climate Insights", methodology:"Data & Methodology" };
    function showPage(page) {
        links.forEach(link => link.classList.toggle("active", link.dataset.view === page));
        Object.values(pageSections).flat().forEach(id => { const el=document.getElementById(id); if(el) el.hidden=true; });
        const mapLayout=document.querySelector(".map-layout");
        if (mapLayout) mapLayout.hidden = page !== "states";
        (pageSections[page] || []).forEach(id => { const el=document.getElementById(id); if(el) el.hidden=false; });
        if (heading) heading.textContent=pageTitles[page] || "Regional Analysis";
        window.scrollTo({top:0,behavior:"smooth"});
        if (page === "states" && currentView !== "india") enterIndia();
        if (page === "states") requestAnimationFrame(()=>map.invalidateSize({pan:false}));
        if (window.Plotly) requestAnimationFrame(()=>document.querySelectorAll(".js-plotly-plot").forEach(el=>{ if(el._fullLayout && el.offsetParent) Plotly.Plots.resize(el); }));
    }
    links.forEach(link=>link.addEventListener("click",event=>{event.preventDefault();showPage(link.dataset.view);}));
    const overlaySelect=document.getElementById("climate-overlay-variable");
    if (overlaySelect) overlaySelect.addEventListener("change",()=>{overlayVariable=overlaySelect.value;refreshClimateOverlay();});
    showPage("states");
    loadStateClimateOverlayData();

});
