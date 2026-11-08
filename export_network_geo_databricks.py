# Run in a Databricks Python notebook cell (not on your Mac).
# This exports a small JSON file of verified stations and historical train stop order.
# Read from your existing Silver Delta table. Update SILVER_TABLE if needed.

from pyspark.sql import functions as F, Window
import json

SILVER_TABLE = "workspace.default.silver_railway"  # change if your clean Silver table has a different name
OUTPUT = "/Volumes/workspace/default/railway_gold/exports/network_geo.json"

df = spark.table(SILVER_TABLE)
required = {"station_code", "lat", "lng", "train_no", "seq"}
missing = required - set(df.columns)
if missing:
    raise ValueError(f"Silver dataset missing required columns: {sorted(missing)}")

valid = (df.filter(F.col("lat").between(6, 38) & F.col("lng").between(68, 98))
    .filter(F.col("station_code").isNotNull()))
# Use median coordinates to guard against outlier locations.
station_names = F.col("station_name") if "station_name" in valid.columns else F.col("station_code")
stations = (valid.groupBy("station_code")
    .agg(F.expr("percentile_approx(lat, 0.5)").alias("lat"),
         F.expr("percentile_approx(lng, 0.5)").alias("lng"),
         F.first(station_names, ignorenulls=True).alias("station_name"))
    .orderBy("station_code").collect())

# Deduplicate per train and station; earliest sequence gives a stable historical stop order.
route_df = (valid.groupBy("train_no", "station_code")
    .agg(F.min("seq").alias("first_seq")))
if "train_name" in valid.columns:
    names = valid.groupBy("train_no").agg(F.first("train_name", ignorenulls=True).alias("train_name"))
    route_df = route_df.join(names, "train_no", "left")
else:
    route_df = route_df.withColumn("train_name", F.col("train_no").cast("string"))
route_rows = route_df.orderBy("train_no", "first_seq", "station_code").collect()
routes = {}
for row in route_rows:
    key = str(row["train_no"])
    entry = routes.setdefault(key, {"train_no": row["train_no"], "train_name": row["train_name"], "stops": []})
    entry["stops"].append(row["station_code"])

payload = {"stations": [r.asDict(recursive=True) for r in stations], "routes": list(routes.values()),
           "note": "Historical station locations and stop sequences. Lines between stops are schematic, not track geometry."}
# dbutils.fs.put writes a single UTF-8 JSON file to the Unity Catalog Volume.
dbutils.fs.put(OUTPUT, json.dumps(payload, default=str, ensure_ascii=False), overwrite=True)
print(f"Exported {len(stations)} stations and {len(routes)} train sequences to {OUTPUT}")
print("Download network_geo.json from the Volume and place it in your local dashboard's data/ folder.")
