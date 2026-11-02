---
name: review-diff
description: 变更审查：识别行为回退、边界缺陷和缺失的验证证据。
---

# Review a change

1. Read the task and actual changed files, then follow the affected call sites and data flow.
2. Check correctness and compatibility at realistic triggers, not hypothetical style preferences.
3. Inspect error handling, cancellation, persistence order, authorization boundaries and replay behavior when affected.
4. State each actionable finding with the precise file/location, triggering conditions and concrete impact.
5. Distinguish confirmed findings from unanswered questions. Do not invent test failures or claim checks that were not run.
6. Do not alter reviewed files unless the user explicitly asks for implementation.

Deliver: findings ordered by impact; if none, say so and identify the checks and limits.
