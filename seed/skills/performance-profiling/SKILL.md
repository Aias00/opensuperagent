---
name: performance-profiling
description: 性能分析：建立基线、定位瓶颈并比较优化前后的结果。
---

# Performance profiling

1. Identify the workload and user-facing metric: latency, throughput, memory or responsiveness.
2. Establish a bounded, repeatable baseline. Record environment and sample count without fabricated precision.
3. Inspect the critical path and choose one hypothesis. Account for warm-up, caching and unrelated background load.
4. Profile only authorized local workloads. Do not run stress tests against external production services.
5. Compare before/after behavior using the same inputs; report variation and any correctness tradeoff.
6. Add a targeted regression only when it protects a meaningful performance boundary.

Deliver: baseline, evidence, proposed or implemented change, measured outcome and practical limits.
