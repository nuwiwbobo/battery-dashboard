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
- **Temperature color coding:** Temperature input is highlighted based on value:
  - `≤ 25 °C` or empty → default
  - `25 < T < 30 °C` → yellow/orange (`temp-warn`)
  - `≥ 30 °C` → red (`temp-bad`)
- **Auto-save:** State persists to `localStorage` on every change
- **Offline:** No network, no CDN, no build step

## Usage

1. Open `index.html` in any modern browser (Chrome, Firefox, Safari, Edge)
2. Edit cells directly in the table
3. Use `+ Add row` to add cells, checkboxes + `Delete selected` to remove
4. Use `+ New district` to group cells by site/date; click district name to rename
5. Adjust thresholds in the Configuration panel
6. Data auto-saves; refresh-safe

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
  ]
}
```

Row IDs are global (across all districts). Each row belongs to exactly one district.
The first time the app is opened, one default district is created containing the sample row.
Old saves without a `districts` field are migrated automatically (all rows go into a "Default" district).

## Tests

```bash
node tests/test.mjs
node tests/smoke.mjs
node tests/integration.mjs
```

- `test.mjs` — 41 unit tests for pure calc functions + `tempClass` + `renderRowHTML`
- `smoke.mjs` — runs all 19 sample rows
- `integration.mjs` — 22 tests simulating browser flow (districts, temp class, migration)

No dependencies required.

## File Structure

```
battery-dashboard/
├── index.html      # Page structure
├── style.css       # Layout, status colors, district styles, temp colors
├── app.js          # Calc functions, state, render, event wiring
├── tests/
│   ├── test.mjs
│   ├── smoke.mjs
│   └── integration.mjs
└── README.md
```

## Known Limitations (v1)

- Single-user, single-machine (no cloud sync, no multi-user)
- No file import/export
- No time-series / historical tracking
- Desktop browser only

