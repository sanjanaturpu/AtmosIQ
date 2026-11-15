
import xarray as xr
import pandas as pd
import numpy as np
from pathlib import Path

BASE = Path("data/temperature")
OUTPUT = Path("data/processed")
OUTPUT.mkdir(parents=True, exist_ok=True)

print("Loading temperature datasets...")

max_ds = xr.open_dataset(
    BASE / "maxtemp.nc",
    engine="h5netcdf",
    group="tmax"
)

min_ds = xr.open_dataset(
    BASE / "mintemp.nc",
    engine="h5netcdf",
    group="tmin"
)

tmax = max_ds["tmax"]
tmin = min_ds["tmin"]

# Confirm matching coordinates
xr.align(tmax, tmin, join="exact")

dates = pd.DatetimeIndex(tmax.time.values)

def calculate_summary(tx, tn, expected_days):
    paired = tx.notnull() & tn.notnull()

    mean_temp = ((tx + tn) / 2).where(paired)

    result = xr.Dataset({
        "tmax_mean_c": tx.mean("time", skipna=True),
        "tmin_mean_c": tn.mean("time", skipna=True),
        "tmean_mean_c": mean_temp.mean("time", skipna=True),

        "tmax_valid_days": tx.count("time"),
        "tmin_valid_days": tn.count("time"),
        "tmean_valid_days": paired.sum("time")
    })

    df = result.to_dataframe().reset_index()

    df["tmax_coverage_pct"] = (
        df["tmax_valid_days"] / expected_days * 100
    )

    df["tmin_coverage_pct"] = (
        df["tmin_valid_days"] / expected_days * 100
    )

    df["tmean_coverage_pct"] = (
        df["tmean_valid_days"] / expected_days * 100
    )

    return df.dropna(
        subset=["tmax_mean_c", "tmin_mean_c", "tmean_mean_c"],
        how="all"
    )


# --------------------------------
# 1. ANNUAL TEMPERATURE
# --------------------------------

print("\nProcessing annual temperatures...")

annual_results = []

for year in range(1991, 2025):

    indices = np.where(dates.year == year)[0]

    if len(indices) == 0:
        continue

    tx = tmax.isel(time=indices)
    tn = tmin.isel(time=indices)

    expected = len(pd.date_range(
        f"{year}-01-01",
        f"{year}-12-31"
    ))

    df = calculate_summary(tx, tn, expected)

    df["year"] = year

    annual_results.append(df)

    print("Processed:", year)

annual = pd.concat(annual_results, ignore_index=True)

annual.to_csv(
    OUTPUT / "annual_temperature_grid.csv",
    index=False
)


# --------------------------------
# 2. SEASONAL TEMPERATURE
# --------------------------------

print("\nProcessing seasonal temperatures...")

seasons = {
    "Winter (DJF)": [12, 1, 2],
    "Summer (MAM)": [3, 4, 5],
    "Monsoon (JJAS)": [6, 7, 8, 9],
    "Post-monsoon (ON)": [10, 11]
}

seasonal_results = []

for year in range(1991, 2025):

    for season, months in seasons.items():

        if season == "Winter (DJF)":
            mask = (
                ((dates.year == year) & np.isin(dates.month, [1, 2]))
                |
                ((dates.year == year - 1) & (dates.month == 12))
            )

            start = pd.Timestamp(year - 1, 12, 1)
            end = pd.Timestamp(year, 3, 1) - pd.Timedelta(days=1)

        else:
            mask = (
                (dates.year == year)
                & np.isin(dates.month, months)
            )

            start_month = months[0]
            end_month = months[-1] + 1

            start = pd.Timestamp(year, start_month, 1)

            if end_month == 13:
                end = pd.Timestamp(year + 1, 1, 1) - pd.Timedelta(days=1)
            else:
                end = pd.Timestamp(year, end_month, 1) - pd.Timedelta(days=1)

        indices = np.where(mask)[0]

        if len(indices) == 0:
            continue

        expected = len(pd.date_range(start, end))

        tx = tmax.isel(time=indices)
        tn = tmin.isel(time=indices)

        df = calculate_summary(tx, tn, expected)

        df["year"] = year
        df["season"] = season

        seasonal_results.append(df)

    print("Processed seasonal data:", year)


seasonal = pd.concat(seasonal_results, ignore_index=True)

seasonal.to_csv(
    OUTPUT / "seasonal_temperature_grid.csv",
    index=False
)


# --------------------------------
# 3. FINISH
# --------------------------------

max_ds.close()
min_ds.close()

print("\n================================")
print("TEMPERATURE PROCESSING COMPLETE")
print("================================")

print("Annual records:", len(annual))
print("Seasonal records:", len(seasonal))

print("\nFiles created:")
print(OUTPUT / "annual_temperature_grid.csv")
print(OUTPUT / "seasonal_temperature_grid.csv")
