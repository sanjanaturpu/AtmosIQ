
from pathlib import Path
import calendar

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import box


# =========================================
# PATHS
# =========================================

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
PROCESSED = DATA / "processed"

STATE_FILE = DATA / "india_states.geojson"
ANNUAL_FILE = PROCESSED / "annual_temperature_grid.csv"
SEASONAL_FILE = PROCESSED / "seasonal_temperature_grid.csv"

VARIABLES = ["tmax", "tmin", "tmean"]

PROCESSED.mkdir(parents=True, exist_ok=True)


# =========================================
# LOAD BOUNDARIES AND GRID
# =========================================

print("Loading state boundaries and temperature grid...")

states = gpd.read_file(STATE_FILE).to_crs("EPSG:6933")

states = states[["shapeName", "shapeISO", "geometry"]].copy()
states["geometry"] = states.geometry.make_valid()

annual_grid = pd.read_csv(ANNUAL_FILE)

# Use each unique temperature grid location once.
locations = annual_grid[["lat", "lon"]].drop_duplicates()

cells = gpd.GeoDataFrame(
    locations,
    geometry=[
        box(lon - 0.5, lat - 0.5, lon + 0.5, lat + 0.5)
        for lat, lon in zip(locations["lat"], locations["lon"])
    ],
    crs="EPSG:4326"
).to_crs("EPSG:6933")


# =========================================
# CALCULATE GRID / STATE INTERSECTIONS
# =========================================

print("Calculating grid-cell intersections...")

overlaps = gpd.overlay(
    cells,
    states,
    how="intersection"
)

overlaps["overlap_area_km2"] = (
    overlaps.geometry.area / 1_000_000
)

# Combine fragments belonging to the same grid cell and state.
weights = (
    overlaps.groupby(["lat", "lon", "shapeISO", "shapeName"])
    ["overlap_area_km2"]
    .sum()
    .reset_index()
)

# Ignore negligible total spatial overlaps.
state_areas = weights.groupby("shapeISO")[
    "overlap_area_km2"
].sum()

usable_codes = state_areas[state_areas >= 1.0].index

weights = weights[
    weights["shapeISO"].isin(usable_codes)
].copy()

print("States/UTs with usable overlap:", len(usable_codes))

print("\nStates/UTs excluded due to negligible overlap:")
print(
    states.loc[
        ~states["shapeISO"].isin(usable_codes),
        "shapeName"
    ].tolist()
)


# =========================================
# EXPECTED NUMBER OF DAYS
# =========================================

def expected_days(year, season=None):

    if season is None:
        return 366 if calendar.isleap(int(year)) else 365

    year = int(year)

    if season == "Winter (DJF)":
        return (
            31 + 31 +
            calendar.monthrange(year, 2)[1]
        )

    if season == "Summer (MAM)":
        return 31 + 30 + 31

    if season == "Monsoon (JJAS)":
        return 30 + 31 + 31 + 30

    if season == "Post-monsoon (ON)":
        return 31 + 30

    raise ValueError(f"Unknown season: {season}")


# =========================================
# AREA-WEIGHTED AGGREGATION
# =========================================

def aggregate_temperature(df, seasonal=False):

    print("\nJoining temperature data to state intersections...")

    df = df.merge(
        weights,
        on=["lat", "lon"],
        how="inner"
    )

    group_columns = ["shapeISO", "year"]

    if seasonal:
        group_columns.append("season")

    results = []

    for keys, group in df.groupby(group_columns):

        if not isinstance(keys, tuple):
            keys = (keys,)

        state_code = keys[0]
        year = int(keys[1])
        season = keys[2] if seasonal else None

        area = group["overlap_area_km2"].to_numpy()

        expected = expected_days(year, season)

        result = {
            "shapeISO": state_code,
            "year": year,
            "season": season if seasonal else None,
            "grid_cells": group[["lat", "lon"]].drop_duplicates().shape[0],
            "overlap_area_km2": area.sum()
        }

        for variable in VARIABLES:

            mean_col = f"{variable}_mean_c"
            days_col = f"{variable}_valid_days"

            means = group[mean_col].to_numpy(dtype=float)
            days = group[days_col].to_numpy(dtype=float)

            valid = (
                np.isfinite(means)
                & np.isfinite(days)
                & (days > 0)
            )

            # Area multiplied by valid days gives
            # an area-day weighting.
            area_days = area[valid] * days[valid]

            if valid.any() and area_days.sum() > 0:

                result[mean_col] = np.average(
                    means[valid],
                    weights=area_days
                )

            else:
                result[mean_col] = np.nan

            # Coverage relative to all intersecting
            # grid-cell area and expected calendar days.
            valid_days_area = np.sum(area * np.nan_to_num(days))

            result[f"{variable}_coverage_pct"] = (
                100 * valid_days_area /
                (area.sum() * expected)
            )

            result[f"{variable}_valid_days_avg"] = (
                valid_days_area / area.sum()
            )

            result[f"{variable}_cells_with_data"] = int(valid.sum())

        results.append(result)

    summary = pd.DataFrame(results)

    # Preserve every state/UT, year and season,
    # including regions with no usable temperature data.
    years = sorted(df["year"].unique())

    if seasonal:

        seasons = [
            "Winter (DJF)",
            "Summer (MAM)",
            "Monsoon (JJAS)",
            "Post-monsoon (ON)"
        ]

        skeleton = pd.MultiIndex.from_product(
            [
                states["shapeISO"].unique(),
                years,
                seasons
            ],
            names=["shapeISO", "year", "season"]
        ).to_frame(index=False)

    else:

        skeleton = pd.MultiIndex.from_product(
            [
                states["shapeISO"].unique(),
                years
            ],
            names=["shapeISO", "year"]
        ).to_frame(index=False)

    output = skeleton.merge(
        summary,
        on=group_columns,
        how="left"
    )

    output = output.merge(
        states[["shapeISO", "shapeName"]],
        on="shapeISO",
        how="left"
    )

    return output


# =========================================
# ANNUAL PROCESSING
# =========================================

print("\nProcessing annual state temperatures...")

annual = pd.read_csv(ANNUAL_FILE)

annual_state = aggregate_temperature(annual)

annual_output = (
    PROCESSED / "state_annual_temperature_area_weighted.csv"
)

annual_state.to_csv(annual_output, index=False)

print("Annual records:", len(annual_state))
print("Saved:", annual_output)


# =========================================
# SEASONAL PROCESSING
# =========================================

print("\nProcessing seasonal state temperatures...")

seasonal = pd.read_csv(SEASONAL_FILE)

seasonal_state = aggregate_temperature(
    seasonal,
    seasonal=True
)

seasonal_output = (
    PROCESSED / "state_seasonal_temperature_area_weighted.csv"
)

seasonal_state.to_csv(seasonal_output, index=False)

print("Seasonal records:", len(seasonal_state))
print("Saved:", seasonal_output)


# =========================================
# COMPLETION
# =========================================

print("\n======================================")
print("AREA-WEIGHTED PROCESSING COMPLETE")
print("======================================")

print("Annual records:", len(annual_state))
print("Seasonal records:", len(seasonal_state))

print("\nOutput files:")
print(annual_output)
print(seasonal_output)

print("\nANNUAL DATA COVERAGE BY STATE:")

print(
    annual_state.groupby("shapeName")["tmean_mean_c"]
    .count()
    .sort_values()
    .to_string()
)
