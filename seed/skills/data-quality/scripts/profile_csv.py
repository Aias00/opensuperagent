#!/usr/bin/env python3
"""Print a reproducible CSV quality profile; never modify the input file."""
import argparse
import csv
import json
from collections import Counter

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("path")
args = parser.parse_args()
with open(args.path, encoding="utf-8-sig", newline="") as source:
    reader = csv.reader(source)
    headers = next(reader, [])
    rows = list(reader)
counts = Counter(tuple(row) for row in rows)
profile = {
    "rows": len(rows),
    "columns": headers,
    "column_count": len(headers),
    "duplicate_rows": sum(n - 1 for n in counts.values()),
    "blank_by_column": {
        name: sum(i >= len(row) or not row[i].strip() for row in rows)
        for i, name in enumerate(headers)
    },
    "inconsistent_width_rows": sum(len(row) != len(headers) for row in rows),
}
print(json.dumps(profile, ensure_ascii=False, indent=2))
