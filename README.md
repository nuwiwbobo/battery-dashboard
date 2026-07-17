# Battery Cell Monitoring Dashboard

Single-page HTML/JS/CSS tool for monitoring battery cell health. Mirrors the calculation logic of an existing battery monitoring spreadsheet.

## Features

- **Per-cell input:** Cell voltage, internal resistance (Ω or mΩ), ripple voltage (V rms)
- **Live calculations:** Ripple current, dissipated power, predicted temperature rise
- **Decision flags:**
  - **Over Current** — TRUE if ripple current exceeds battery capacity / 5
  - **Temp Check** — `Aman` (< 3°C), `Cek` (3–8°C), `Ganti` (> 8°C)
  - **V Status** — `Aman` (|dev| < 0.05V), `Cek` (0.05–0.1V), `Ganti` (> 0.1V)
- **Configurable thresholds:** heat-transfer coefficient, surface area, capacities, temp/voltage limits
- **Auto-save:** State persists to `localStorage` on every change
- **Offline:** No network, no CDN, no build step

## Usage

1. Open `index.html` in any modern browser (Chrome, Firefox, Safari, Edge)
2. Edit cells directly in the table
3. Use `+ Add row` to add cells, checkboxes + `Delete selected` to remove
4. Adjust thresholds in the Configuration panel
5. Data auto-saves; refresh-safe

## Configuration

Only one configurable parameter in the UI — all others use hardcoded defaults.

| Field | Default | Description |
|---|---|---|
| Capacity profile | RSS | Which capacity to use for over-current check (RSS=300Ah, TSS/ER=200Ah) |

Hardcoded defaults (not editable in v1):
- h = 4.6 W/m²·°C
- Surface area = 0.2814 m²
- RSS Capacity = 300 Ah
- TSS/ER Capacity = 200 Ah
- Temp Aman max = 3 °C
- Temp Cek max = 8 °C
- Volt Aman max = 0.05 V
- Volt Cek max = 0.1 V

## Calculation Formulas

- **Ripple current (A rms):** `I = V_ripple / IR` (IR normalized to Ω if entered in mΩ)
- **Dissipated power (W):** `P = V_ripple² / IR`
- **Predicted temp rise (°C):** `ΔT = P / (surface_area × h)`
- **Over current:** `TRUE if I_ripple > capacity / 5`
- **Temp check:** `Aman if ΔT < 3`, `Cek if 3 ≤ ΔT < 8`, `Ganti if ΔT ≥ 8`
- **Voltage deviation:** `cell_voltage − mean(cell_voltage)`
- **V status:** `Aman if |dev| < 0.05`, `Cek if 0.05 ≤ |dev| < 0.1`, `Ganti if |dev| ≥ 0.1`

## IR Unit Handling

Each row has a unit dropdown (`Ω` or `mΩ`). The dashboard defaults to **mΩ** because typical Li-ion cell internal resistance is in the 20–100 mΩ range, and the reference spreadsheet's "IR (in ohm)" column actually contains mΩ values (a labeling inconsistency in the source spreadsheet). If your instrument gives you Ω, switch the unit per row.

## Tests

```bash
node tests/test.mjs
node tests/smoke.mjs
```

- `test.mjs` — 12 unit tests for pure calc functions (Node's built-in `node:test`)
- `smoke.mjs` — runs all 19 sample rows from the reference spreadsheet and prints computed values

No dependencies required.

## File Structure

```
battery-dashboard/
├── index.html      # Page structure
├── style.css       # Layout, status colors
├── app.js          # Calc functions, state, render, event wiring
├── tests/
│   ├── test.mjs    # Unit tests (12 tests, all pure calc functions)
│   └── smoke.mjs   # Spreadsheet cross-check (19 rows)
└── README.md
```

## Known Limitations (v1)

- Single-user, single-machine (no cloud sync, no multi-user)
- No file import/export (CSV/XLSX)
- No time-series / historical tracking
- Desktop browser only (not mobile-optimized)

## Spreadsheet Discrepancies

The reference spreadsheet has a few inconsistencies at threshold boundaries (e.g., row 2 shows dT=13.55°C but Temp=Cek, which contradicts the formula `ΔT ≥ 8 → Ganti`). The dashboard follows the spec formula strictly. If you need to reproduce the spreadsheet's exact (inconsistent) behavior, you would need to adjust the threshold logic in `app.js`.
