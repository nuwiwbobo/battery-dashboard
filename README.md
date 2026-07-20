# Battery Cell Monitoring Dashboard

Single-page HTML/JS/CSS tool for monitoring battery cell health. Mirrors the calculation logic of an existing battery monitoring spreadsheet.

## Features

- **Per-cell input:** Cell voltage, internal resistance (Ω or mΩ), ripple voltage (V rms), measured capacity (Ah), temperature (°C)
- **Live calculations:** Ripple current, dissipated power, SOH (state of health) percentage
- **Decision flags:**
  - **Over Current** — TRUE if ripple current exceeds battery capacity / 5
  - **V Status** — `Aman` (|dev| < 0.05V), `Cek` (0.05–0.1V), `Ganti` (> 0.1V) deviation from reference voltage
- **Configurable:** Capacity profile (RSS/TSS/ER), reference voltage, healthy capacity
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
| Capacity profile | RSS | Which capacity to use for over-current check (RSS=300Ah, TSS/ER=200Ah) |
| Reference voltage | 2.2 V | Each cell's voltage is compared against this fixed value to compute V_dev and V_status |
| Healthy capacity | 300 Ah | The "new" / maximum capacity used as the denominator for SOH calculation |

Hardcoded defaults (not editable in v1):
- Volt Aman max = 0.05 V
- Volt Cek max = 0.1 V

## Calculation Formulas

- **Ripple current (A rms):** `I = V_ripple / IR` (IR normalized to Ω if entered in mΩ)
- **Dissipated power (W):** `P = V_ripple² / IR`
- **SOH (%):** `(measured_capacity / healthy_capacity) × 100`
- **Over current:** `TRUE if I_ripple > capacity / 5`
- **Voltage deviation:** `cell_voltage − reference_voltage`
- **V status:** `Aman if |dev| < 0.05`, `Cek if 0.05 ≤ |dev| < 0.1`, `Ganti if |dev| ≥ 0.1`

> **Note:** Temperature is now entered manually per cell. Earlier versions calculated a predicted temperature rise from dissipated power and surface area; that logic has been removed and the temp prediction code is preserved as comments in `app.js` if needed in the future.

## IR Unit Handling

Each row has a unit dropdown (`Ω` or `mΩ`). The dashboard defaults to **mΩ** because typical Li-ion cell internal resistance is in the 20–100 mΩ range, and the reference spreadsheet's "IR (in ohm)" column actually contains mΩ values.

## Tests

```bash
node tests/test.mjs
node tests/smoke.mjs
node tests/integration.mjs
```

- `test.mjs` — 14 unit tests for pure calc functions
- `smoke.mjs` — runs all 19 sample rows from the reference spreadsheet
- `integration.mjs` — simulates browser flow (state, render, event wiring)

No dependencies required.

## File Structure

```
battery-dashboard/
├── index.html      # Page structure
├── style.css       # Layout, status colors
├── app.js          # Calc functions, state, render, event wiring
├── tests/
│   ├── test.mjs        # Unit tests
│   ├── smoke.mjs       # Spreadsheet cross-check (19 rows)
│   └── integration.mjs # Browser flow simulation
└── README.md
```

## Known Limitations (v1)

- Single-user, single-machine (no cloud sync, no multi-user)
- No file import/export (CSV/XLSX)
- No time-series / historical tracking
- Desktop browser only
