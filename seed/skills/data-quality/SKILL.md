---
name: data-quality
description: 数据质量分析：缺失、重复、字段类型与可复核的统计结果。
---

# Data quality

1. Establish the dataset source, encoding, delimiter, row grain and expected schema. Keep source data unchanged.
2. Inspect headers and a small sample; count rows, columns, missing cells and exact duplicate rows.
3. Distinguish empty strings, zero and null-like labels according to the stated contract.
4. Validate numerical/date fields with explicit parsing rules. State denominators, exclusions and ambiguous cases.
5. Use scripts/profile_csv.py for a dependency-free initial CSV profile when useful. Review its output before drawing conclusions.
6. Write derived reports or scripts only inside the Task workspace. Avoid exposing raw private records in summaries.

Deliver: reproducible counts, quality issues, assumptions and concrete next actions. Do not infer causation from descriptive statistics.
