# Battery Cell Monitoring Dashboard

Single-page HTML/JS/CSS tool for monitoring battery cell health.

## Features

- **Per-cell input:** Cell voltage, internal resistance (Ω or mΩ), ripple voltage (V rms), measured capacity (Ah), temperature (°C)
- **Live calculations:** Ripple current, dissipated power, SOH (state of health) percentage
- **Decision flag:** Combined **Status** = `Aman` / `Cek` / `Tidak Layak` based on:
  - **SOH** (measured / healthy capacity) must be > 80% to be Aman
  - **AND (cell voltage OR internal resistance)** — if either is in the OK range, that sub-check passes
- **Per-profile IR baselines:** RSS = 0.75 mΩ, TSS/ER = 0.85 mΩ (120% / 150% thresholds)
- **Configurable:** Capacity profile (RSS/TSS/ER), healthy capacity, voltage thresholds (batas atas/bawah)
- **Districts:** Group rows by named location/date. Each district has its own table, summary, and add/delete-row buttons. Add new districts with `+ New district`. District name is editable (click the header to edit, blur to save).
- **Per-district numbering:** The "#" column shows the district-local index (1, 2, 3... within each district), not the global row id. The global id is still used internally for `data-row-id` attributes.
- **Temperature color coding:** Temperature input is highlighted based on value:
  - `≤ 25 °C` or empty → default
  - `25 < T < 30 °C` → yellow/orange (`temp-warn`)
  - `≥ 30 °C` → red (`temp-bad`)
- **CSV import/export:** Each district has `Import CSV` and `Export CSV` buttons. CSV stores IR in ohms (raw, no unit conversion needed) and excludes the computed `Status` column.
- **Cloud sync (Gist):** State is automatically pushed to a GitHub Gist (debounced 5s after each change) and polled for remote changes every 30s. Status indicator in the header shows `Syncing...`, `Synced`, or `Offline`.
- **Auto-save:** State persists to `localStorage` on every change
- **Offline:** No network, no CDN, no build step

## Usage

1. Open `index.html` in any modern browser (Chrome, Firefox, Safari, Edge)
2. Edit cells directly in the table
3. Use `+ Add row` to add cells, checkboxes + `Delete selected` to remove
4. Use `+ New district` to group cells by site/date; click district name to rename
5. Use `Import CSV` / `Export CSV` to bulk import or save a district's data
6. Adjust thresholds in the Configuration panel
7. Data auto-saves locally AND syncs to Gist (cloud); refresh-safe

## Configuration

| Field | Default | Description |
|---|---|---|
| Capacity profile | RSS | Switches between RSS (300Ah) and TSS/ER (200Ah) battery profiles; also selects which IR baseline to use |
| Healthy capacity | 300 Ah | Denominator for SOH = measured/healthy × 100% |
| Batas atas (V) | 2.5 V | Upper voltage threshold. V > batas_atas = OK |
| Batas bawah (V) | 2.0 V | Lower voltage threshold. V ≤ batas_bawah = bad |

Hardcoded defaults (not editable in v1):
- IR baseline RSS: 0.75 mΩ
- IR baseline TSS/ER: 0.85 mΩ

## Status Decision Logic

For each cell, the status is computed as:

```
SOH = (measured_capacity / healthy_capacity) × 100

voltage_ok      = V > batas_atas
voltage_warning = batas_bawah < V ≤ batas_atas
voltage_bad     = V ≤ batas_bawah

ir_ok      = IR < 120% × baseline
ir_warning = 120% × baseline ≤ IR ≤ 150% × baseline
ir_bad     = IR > 150% × baseline

if (SOH > 80) AND (voltage_ok OR ir_ok):         status = Aman
elif (voltage_warning OR ir_warning):             status = Cek
elif (voltage_bad OR ir_bad):                     status = Tidak Layak
else:                                              status = Cek   (SOH ≤ 80% defaults here)
```

Each district shows its own summary (Mean V, counts of Aman/Cek/Tidak Layak) above its table.

## Calculation Formulas

- **Ripple current (A rms):** `I = V_ripple / IR` (IR normalized to Ω if entered in mΩ)
- **Dissipated power (W):** `P = V_ripple² / IR`
- **SOH (%):** `(measured_capacity / healthy_capacity) × 100`
- **Over current:** `TRUE if I_ripple > capacity / 5`

## IR Unit Handling

Each row has a unit dropdown (`Ω` or `mΩ`). The dashboard defaults to **mΩ** because typical Li-ion cell internal resistance is in the 20–100 mΩ range.

## Districts (data model)

State shape:

```js
state = {
  config: { ... },
  rows: [ /* all rows, regardless of district */ ],
  districts: [
    { id: 1, name: "Site A - 2026-07-20", rowIds: [1, 2, 3] },
    { id: 2, name: "Site B - 2026-07-21", rowIds: [4, 5] }
  ],
  lastSyncedAt: "2026-07-21T06:30:00Z"  // for Gist sync
}
```

Row IDs are global (across all districts). Each row belongs to exactly one district.
The first time the app is opened, one default district is created containing the sample row.
Old saves without a `districts` field are migrated automatically (all rows go into a "Default" district).

### Per-district numbering

The `#` column in each district's table shows the **district-local index** (1-based position in that district's `rowIds` array), not the global row id. The global `row.id` is still used as the `data-row-id` attribute on each `<tr>` for event delegation.

## CSV Import/Export

Each district section has `Import CSV` and `Export CSV` buttons.

### CSV format

The CSV is intentionally minimal — only the input fields, not the derived ones. `Status` is computed at import time using the current configuration.

**Columns** (in this exact order):

| # | Column | Type | Notes |
|---|---|---|---|
| 1 | `battery_no` | integer | 1-based district-local index (matches the on-screen `#` column) |
| 2 | `cell_voltage` | number (V) | empty = null |
| 3 | `temperature` | number (°C) | empty = null |
| 4 | `ir` | number (Ω) | **stored in ohms** (not mΩ). E.g. `0.000563` for 0.563 mΩ. |
| 5 | `capacity` | number (Ah) | measured capacity (used for SOH); empty = null |
| 6 | `ripple_voltage` | number (V rms) | empty = null |

**Header row** (first line) is required and skipped during import.
**Empty values** are accepted (treated as null).
**Comma decimal separator** is accepted on import (Indonesian locale).
**Invalid cells** (e.g. `abc` in a number column) are coerced to null.

### Export filename

`district_<sanitized-name>_<YYYY-MM-DD>.csv`. The district name has non-alphanumeric characters replaced with `_`, truncated to 50 chars.

### Import behavior

Rows are **appended** to the chosen district (existing rows are preserved). New rows get fresh global ids and are added to the district's `rowIds` array in import order.

## Cloud Sync (Gist)

The dashboard uses a GitHub Gist to sync state across browsers/machines. The Gist ID and token are **hardcoded** in `app.js` (this is a personal dashboard — do not share the token).

**Sync behavior:**
- **Pull:** On app load and every 30 seconds, fetch the Gist and compare its `updatedAt` to `state.lastSyncedAt`. If the remote is newer, replace local state and re-render.
- **Push:** 5 seconds after the last local change (debounced), push the current state to the Gist. A pending push flag prevents the next pull from clobbering our own change.
- **Status indicator:** Top-right of the header shows `⏳ Syncing...`, `Synced`, or `Offline` (if the push/PATCH fails).

**Gist file:** `state.json` — contains `{ version, updatedAt, config, districts, rows }`.

**Conflict resolution:** Last-writer-wins. If both sides change, the second pull to win will overwrite. In practice the debounce + poll cycle (5s push, 30s pull) means single-user edits don't conflict.

**Note:** The sync uses a personal access token. The Gist itself is public for read, but writes require the token. Do not commit this dashboard to a public repo without revoking the token.

## Tests

```bash
node tests/test.mjs
node tests/smoke.mjs
node tests/integration.mjs
```

- `test.mjs` — 61 unit tests for pure calc functions + `tempClass` + `renderRowHTML` + CSV helpers + gist function stubs
- `smoke.mjs` — runs all 19 sample rows
- `integration.mjs` — 30 tests simulating browser flow (districts, per-district numbering, CSV import/export, gist sync function existence, migration)

No dependencies required.

## File Structure

```
battery-dashboard/
├── index.html      # Page structure + sync-status indicator
├── style.css       # Layout, status colors, district styles, temp colors, sync status
├── app.js          # Calc functions, state, render, event wiring, CSV, Gist sync
├── tests/
│   ├── test.mjs
│   ├── smoke.mjs
│   └── integration.mjs
└── README.md
```

## Known Limitations

- Single-user, Gist-based sync (no multi-user conflict resolution; last-writer-wins)
- CSV import is simple split-on-comma (no quote escaping; commas in values will break parsing)
- No time-series / historical tracking
- Desktop browser only
- Gist token is hardcoded — keep the repo private

