---
name: incident-diagnosis
description: 故障诊断：收集时间线、定位故障层并提出可验证的恢复步骤。
---

# Incident diagnosis

1. State the symptom, affected scope, first/last known times and current impact.
2. Gather available logs and health/read-only status near the event, keeping credentials out of output.
3. Separate transport, authentication, authorization, application and downstream failures. Use exact status codes when available.
4. Build a short evidence-backed timeline and test the most likely explanation with a bounded read-only check.
5. Preserve unknown outcomes. Do not retry uncertain writes or restart/change services without task authorization.
6. Propose recovery with a success check and rollback; distinguish performed checks from proposed actions.

Deliver: facts, likely cause, supporting evidence, current status and next recovery action.
