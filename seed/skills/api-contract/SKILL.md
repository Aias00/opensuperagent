---
name: api-contract
description: 接口契约检查：输入校验、错误语义、鉴权、幂等和兼容性。
---

# API contract

1. Record method, path, caller, authentication and the success/error response shapes before implementing.
2. Validate required fields, types, bounds and allowed values before side effects. Never trust model-generated parameters.
3. Distinguish invalid input, denied access, missing resources, conflicts and uncertain upstream outcomes.
4. Keep secrets out of responses and logs. Preserve request signatures against the original bytes where applicable.
5. Define replay/idempotency behavior and persistence ordering for writes; do not promise exactly-once remote execution without evidence.
6. Add focused request-level checks for success and relevant failure boundaries. Verify backward compatibility.
7. Report the implemented contract and any migration needs. Use templates/contract.md for the handoff.
