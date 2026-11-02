---
name: frontend-accessibility
description: 界面实现与无障碍检查：键盘操作、语义、响应式与状态反馈。
---

# Frontend accessibility

Use when implementing or reviewing UI. Preserve the existing component system.

1. Identify the intended user flow, existing tokens and component conventions. Inspect before changing.
2. Implement semantic buttons, links, headings and labelled inputs. Keep visible focus and predictable tab order.
3. Check keyboard access, Escape behavior and focus return for dialogs and menus.
4. Check narrow and wide viewports for overflow, readable controls and useful empty/loading/error states.
5. Respect reduced motion. Keep status text available without relying on color alone.
6. For translated UI, inspect both short and long labels; preserve user-entered data during language changes.
7. Verify the concrete change using the available browser or tests. If unavailable, report the exact unverified steps.

Deliver: changed files, user-visible behavior, checks performed and remaining issues. See references/checklist.md for a compact review list.
