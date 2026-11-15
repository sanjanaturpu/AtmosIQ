"""Download IMD daily gridded Tmax and Tmin data for AtmosIQ.

Archive period requested: 1991-2024 (to match the current rainfall analysis).
Source: IMD gridded daily temperature archive, 1 degree x 1 degree.
"""
from pathlib import Path
import sys

try:
    import imdlib as imd
except ImportError:
    print("Missing package: imdlib")
    print("Install it from the VS Code terminal with: py -m pip install imdlib")
    sys.exit(1)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = PROJECT_ROOT / "data" / "temperature" / "raw"
START_YEAR = 1991
END_YEAR = 2024
YEARS_EXPECTED = END_YEAR - START_YEAR + 1

RAW_DIR.mkdir(parents=True, exist_ok=True)

print("AtmosIQ temperature data download")
print(f"Years: {START_YEAR}-{END_YEAR}")
print("Variables: daily maximum (tmax) and daily minimum (tmin)")
print("Source: India Meteorological Department (IMD)")
print(f"Destination: {RAW_DIR}")
print("This may take a while. Keep the terminal open until it finishes.\n")

for variable in ("tmax", "tmin"):
    print(f"\nDownloading {variable.upper()}...")
    try:
        imd.get_data(
            variable,
            START_YEAR,
            END_YEAR,
            fn_format="yearwise",
            file_dir=str(RAW_DIR),
            sub_dir=True,
        )
    except Exception as exc:
        print(f"\nDownload for {variable} did not complete: {exc}")
        print("You can rerun this script after checking your internet connection.")
        sys.exit(2)

    variable_dir = RAW_DIR / variable
    found = sorted(variable_dir.glob("*.grd")) if variable_dir.exists() else []
    print(f"{variable.upper()}: found {len(found)} yearly .grd files (expected {YEARS_EXPECTED}).")

print("\nDownload step finished.")
print("Check data/temperature/raw/tmax and data/temperature/raw/tmin.")
print("Do not rename or edit the .grd files. Next, AtmosIQ will validate and process them.")
