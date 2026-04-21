# AGENTS — Project-specific guidance for coding agents

Purpose: short, actionable instructions so AI coding agents can be productive in this repo.

- Key files to inspect when working on orders/alerts:
  - [server.js](server.js) — API endpoints, DB schema migrations, and alerts/orders handling.
  - [menu.html](menu.html) — customer-facing ordering UI and QR param parsing.
  - [staff-panel.html](staff-panel.html) — staff UI for orders/alerts, notifications, and polling.
  - [admin.html](admin.html) — admin alerts, notifications and order printing.
  - [sw.js](sw.js) — service worker used for push/showNotification and vibrate support.

- Recent change: Room-service support
  - Orders now accept an optional `room` parameter (URL param `?room=123` or POST body `room`).
  - `orders` table: new column `room_label` added (migration present in `server.js`). Orders are inserted with `room_label` when provided.
  - Alerts: customers can send `room` instead of `table`; server normalizes message into `table_label` as `Room: N` and stores in `table_alerts`.
  - Staff and admin UIs now render `room` text when `table_label` is not present and will vibrate devices/show notifications when new alerts arrive.

- Testing checklist for agents making related changes:
  1. Create a menu QR URL with `?room=502` and open `menu.html`.
  2. Place an order and confirm `/api/menus/:id/orders` receives `room` and DB row has `room_label` set.
  3. Trigger a waiter alert (`callWaiter()`) using `room` and verify staff panel shows "Room: 502" and that device vibrates when alerts arrive.
  4. Verify admin notifications and print/receipt flows still work for room orders.

- Conventions
  - Sanitize all customer-supplied strings using existing helpers (`sanitizeStr`, `escapeHtml`).
  - Prefer minimal, incremental DB migrations via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in `initDB()` rather than full DDL rewriting.
  - Use `navigator.vibrate()` in-page and service-worker `showNotification(..., vibrate)` for system-level vibration where supported.

- If implementing related features, update these files only and add tests or manual verification steps to PR description.

If you want, I can open a follow-up PR that adds a small e2e checklist or unit tests for the new `room` field.
