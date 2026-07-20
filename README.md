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
- **Auto-save:** State persists to `localStorage` on every change
- **Offline:** No network, no CDN, no build step

## Usage

1. Open `index.html` in any modern browser (Chrome, Firefox, Safari, Edge)
2. Edit cells directly in the table
3. Use `+ Add row` to add cells, checkboxes + `Delete selected` to remove
4. Adjust thresholds in the Configuration panel
5. Data auto-saves; refresh-safe

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

The summary footer shows counts of each status across all rows.

## Calculation Formulas

- **Ripple current (A rms):** `I = V_ripple / IR` (IR normalized to Ω if entered in mΩ)
- **Dissipated power (W):** `P = V_ripple² / IR`
- **SOH (%):** `(measured_capacity / healthy_capacity) × 100`
- **Over current:** `TRUE if I_ripple > capacity / 5`

## IR Unit Handling

Each row has a unit dropdown (`Ω` or `mΩ`). The dashboard defaults to **mΩ** because typical Li-ion cell internal resistance is in the 20–100 mΩ range.

## Tests

```bash
node tests/test.mjs
node tests/smoke.mjs
node tests/integration.mjs
```

- `test.mjs` — 23 unit tests for pure calc functions
- `smoke.mjs` — runs all 19 sample rows
- `integration.mjs` — simulates browser flow

No dependencies required.

## File Structure

```
battery-dashboard/
├── index.html      # Page structure
├── style.css       # Layout, status colors
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
