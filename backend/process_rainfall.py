
from pathlib import Path
from datetime import datetime, timedelta
import calendar

import h5py
import numpy as np
import pandas as pd
import geopandas as gpd
from shapely.geometry import box

# ==========================================
# PATHS AND SETTINGS
# ==========================================

ROOT = Path(__file__).resolve().parent.parent

DATA_FOLDER = ROOT / "data" / "rainfall"
STATE_FILE = ROOT / "data" / "india_states.geojson"
OUTPUT_FOLDER = ROOT / "data" / "processed"

OUTPUT_FOLDER.mkdir(parents=True, exist_ok=True)

CHUNK_SIZE = 120
MIN_CELL_COVERAGE = 0.90
MIN_STATE_COVERAGE = 0.90

# Equal-area projection for area calculations
AREA_CRS = "EPSG:6933"


# ==========================================
# STEP 1: READ AND ACCUMULATE DAILY RAINFALL
# ==========================================

def load_annual_rainfall():

    files = sorted(DATA_FOLDER.glob("*.nc"))

    if not files:
        raise FileNotFoundError(
            f"No NetCDF files found in {DATA_FOLDER}"
        )

    annual_sums = {}
    annual_counts = {}

    reference_lat = None
    reference_lon = None

    print("\nPROCESSING DAILY RAINFALL FILES")

    for file in files:

        print(f"\nReading {file.name}")

        with h5py.File(file, "r") as f:

            group = f["rain"]

            rainfall = group["rain"]
            lat = group["lat"][:]
            lon = group["lon"][:]
            time = group["time"][:]

            units = group["time"].attrs["units"]

            if isinstance(units, bytes):
                units = units.decode()

            origin = units.split("since")[1].strip()
            start_date = datetime.strptime(
                origin, "%Y-%m-%d"
            )

            # Confirm all files use the same grid
            if reference_lat is None:
                reference_lat = lat
                reference_lon = lon
            else:
                if not np.array_equal(reference_lat, lat):
                    raise ValueError("Latitude grids do not match")

                if not np.array_equal(reference_lon, lon):
                    raise ValueError("Longitude grids do not match")

            total_days = len(time)

            for start in range(0, total_days, CHUNK_SIZE):

                end = min(start + CHUNK_SIZE, total_days)

                block = rainfall[start:end, :, :]

                dates = [
                    start_date + timedelta(days=int(day))
                    for day in time[start:end]
                ]

                years = np.array([d.year for d in dates])

                for year in np.unique(years):

                    mask = years == year
                    yearly_block = block[mask]

                    # Ignore NaN values, but count valid observations
                    yearly_sum = np.nansum(
                        yearly_block, axis=0
                    )

                    yearly_count = np.isfinite(
                        yearly_block
                    ).sum(axis=0)

                    if year not in annual_sums:
                        annual_sums[year] = np.zeros(
                            (len(lat), len(lon)),
                            dtype=np.float64
                        )

                        annual_counts[year] = np.zeros(
                            (len(lat), len(lon)),
                            dtype=np.int32
                        )

                    annual_sums[year] += yearly_sum
                    annual_counts[year] += yearly_count

        print(f"Finished {file.name}")

    # Calculate annual totals and coverage
    annual_results = {}

    for year in sorted(annual_sums):

        expected_days = (
            366 if calendar.isleap(year) else 365
        )

        coverage = annual_counts[year] / expected_days

        # Exclude cells with insufficient daily observations
        annual_total = annual_sums[year].copy()

        annual_total[
            coverage < MIN_CELL_COVERAGE
        ] = np.nan

        annual_results[year] = {
            "rainfall": annual_total,
            "coverage": coverage
        }

    return reference_lat, reference_lon, annual_results


# ==========================================
# STEP 2: CREATE RAINFALL GRID POLYGONS
# ==========================================

def calculate_edges(coordinates):

    differences = np.diff(coordinates)

    if not np.allclose(
        differences, differences[0],
        rtol=0, atol=1e-6
    ):
        raise ValueError(
            "Grid coordinates are not evenly spaced"
        )

    edges = np.empty(len(coordinates) + 1)

    edges[1:-1] = (
        coordinates[:-1] + coordinates[1:]
    ) / 2

    edges[0] = coordinates[0] - differences[0] / 2
    edges[-1] = coordinates[-1] + differences[-1] / 2

    return edges


def create_grid(lat, lon):

    lat_edges = calculate_edges(lat)
    lon_edges = calculate_edges(lon)

    records = []

    for i in range(len(lat)):
        for j in range(len(lon)):

            geometry = box(
                lon_edges[j],
                lat_edges[i],
                lon_edges[j + 1],
                lat_edges[i + 1]
            )

            records.append({
                "row": i,
                "col": j,
                "latitude": lat[i],
                "longitude": lon[j],
                "geometry": geometry
            })

    grid = gpd.GeoDataFrame(
        records,
        geometry="geometry",
        crs="EPSG:4326"
    )

    return grid


# ==========================================
# STEP 3: INTERSECT GRID WITH STATE BOUNDARIES
# ==========================================

def create_state_intersections(grid):

    print("\nLOADING STATE BOUNDARIES")

    states = gpd.read_file(STATE_FILE)

    if states.crs is None:
        raise ValueError("State GeoJSON has no CRS")

    states = states.to_crs("EPSG:4326")

    states = states[
        ["shapeName", "shapeISO", "geometry"]
    ].copy()

    states = states.to_crs(AREA_CRS)
    grid = grid.to_crs(AREA_CRS)

    print("Calculating grid-state intersections...")

    intersections = gpd.overlay(
        grid,
        states,
        how="intersection",
        keep_geom_type=False
    )

    intersections["overlap_area"] = (
        intersections.geometry.area
    )

    intersections = intersections[
        intersections["overlap_area"] > 0
    ].copy()

    print(
        "Grid-state intersections:",
        len(intersections)
    )

    return intersections


# ==========================================
# STEP 4: EXPORT ANNUAL GRID DATA
# ==========================================

def export_grid_data(lat, lon, annual_results):

    print("\nEXPORTING ANNUAL GRID DATA")

    records = []

    for year, result in annual_results.items():

        rainfall = result["rainfall"]
        coverage = result["coverage"]

        for i in range(len(lat)):
            for j in range(len(lon)):

                value = rainfall[i, j]

                records.append({
                    "year": year,
                    "latitude": lat[i],
                    "longitude": lon[j],
                    "rainfall_mm": (
                        float(value)
                        if np.isfinite(value)
                        else np.nan
                    ),
                    "coverage": float(coverage[i, j])
                })

    df = pd.DataFrame(records)

    output = OUTPUT_FOLDER / "annual_rainfall_grid.csv"
    df.to_csv(output, index=False)

    print("Saved:", output)


# ==========================================
# STEP 5: CALCULATE STATE-WISE RAINFALL
# ==========================================

def calculate_state_rainfall(
    intersections,
    annual_results
):

    print("\nCALCULATING STATE-WISE RAINFALL")

    intersections = intersections.copy()

    rows = intersections["row"].to_numpy(dtype=int)
    cols = intersections["col"].to_numpy(dtype=int)

    weights = intersections["overlap_area"].to_numpy()

    state_ids = intersections["shapeISO"].to_numpy()

    total_area = (
        intersections.groupby("shapeISO")["overlap_area"]
        .sum()
        .to_dict()
    )

    annual_records = []

    for year, result in annual_results.items():

        rainfall = result["rainfall"]

        # Extract grid values for each intersection
        values = rainfall[rows, cols]

        for state_id in intersections["shapeISO"].unique():

            mask = state_ids == state_id

            state_values = values[mask]
            state_weights = weights[mask]

            valid = np.isfinite(state_values)

            valid_area = state_weights[valid].sum()
            full_area = total_area[state_id]

            coverage = (
                valid_area / full_area
                if full_area > 0 else 0
            )

            if (
                coverage >= MIN_STATE_COVERAGE
                and valid_area > 0
            ):

                weighted_rainfall = np.average(
                    state_values[valid],
                    weights=state_weights[valid]
                )

            else:
                weighted_rainfall = np.nan

            state_name = intersections.loc[
                intersections["shapeISO"] == state_id,
                "shapeName"
            ].iloc[0]

            annual_records.append({
                "year": year,
                "state": state_name,
                "state_code": state_id,
                "annual_rainfall_mm": weighted_rainfall,
                "valid_area_coverage": coverage
            })

    df = pd.DataFrame(annual_records)

    output = OUTPUT_FOLDER / "state_annual_rainfall.csv"
    df.to_csv(output, index=False)

    print("Saved:", output)

    # Summary across all available years
    summary = (
        df.groupby(["state", "state_code"])
        ["annual_rainfall_mm"]
        .agg(
            mean_annual_rainfall="mean",
            minimum_annual_rainfall="min",
            maximum_annual_rainfall="max",
            valid_years="count"
        )
        .reset_index()
    )

    summary_output = (
        OUTPUT_FOLDER / "state_rainfall_summary.csv"
    )

    summary.to_csv(summary_output, index=False)

    print("Saved:", summary_output)

    return df, summary


# ==========================================
# MAIN
# ==========================================

def main():

    print("=" * 55)
    print("ATMOSIQ | INDIA RAINFALL PROCESSING")
    print("=" * 55)

    lat, lon, annual_results = load_annual_rainfall()

    print("\nYears processed:", len(annual_results))
    print("Grid dimensions:", len(lat), "x", len(lon))

    grid = create_grid(lat, lon)

    intersections = create_state_intersections(grid)

    export_grid_data(lat, lon, annual_results)

    annual_df, summary_df = calculate_state_rainfall(
        intersections,
        annual_results
    )

    print("\nPROCESSING COMPLETE!")
    print("Annual state records:", len(annual_df))
    print("State summary records:", len(summary_df))
    print("Output folder:", OUTPUT_FOLDER)


if __name__ == "__main__":
    main()
