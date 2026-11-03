---
name: test-driven-fix
description: 先复现失败测试，再最小改动修复，最后确认全绿。
---

# Test-Driven Fix

1. 定位或编写能复现问题的测试。
2. 确认测试失败。
3. 做最小代码修改。
4. 再跑测试；用 Pizza 原生 `cli` 跑测试（timeout 单位为毫秒），等待命令完成后再继续。
