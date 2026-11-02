---
name: regression-testing
description: 回归验证：构造复现、边界用例、并发与稳定的故障断言。
---

# Regression testing

1. Translate the requested behavior into observable outcomes and identify the smallest failing example.
2. Separate product failures from fixture or timing failures. Avoid asserting implementation details.
3. Choose meaningful boundaries: empty/invalid input, duplicates, ordering, cancellation and partial failure when relevant.
4. Use temporary workspaces and deterministic local fixtures. Prefer explicit readiness/condition checks over sleeps.
5. For concurrent work, verify attribution and ordering as well as total counts. Confirm real side effects, not just status labels.
6. Keep the regression small enough to explain; run the relevant suite and report exact results.
7. Wait for owned processes and output callbacks before deleting fixture directories.

Deliver: reproduction, expected/observed results, tests run and remaining unverified paths. Use templates/cases.md.
