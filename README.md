# Battery Cell Monitoring Dashboard

Single-page HTML/JS/CSS tool for monitoring battery cell health with district-level configurations and cloud persistence.

## Key Changes in Current Version

* **Per-District Configuration:** Configuration settings (`capacityProfile`, `healthyCapacity`, `batasAtas`, `batasBawah`) now live inside each district card rather than globally in the header.
* **Firebase Realtime Database Integration:** Replaced GitHub Gist with Firebase Realtime Database for cloud storage via REST API.
* **Auto-Download on Load:** Automatically fetches the latest database state when opening or refreshing the web page.
* **Manual Cloud Sync:** On-demand **Download** and **Upload** buttons in the header replace continuous auto-push polling to prevent typing disruptions and race conditions.

## Features

* **Per-cell Input:** Cell voltage, internal resistance ($\Omega$ or $\text{m}\Omega$), ripple voltage ($\text{V rms}$), measured capacity ($\text{Ah}$), and temperature ($^\circ\text{C}$).
* **Live Calculations:** Ripple current, dissipated power, SOH (State of Health) percentage, and over-current checks.
* **Decision Flag:** Combined **Status** (`Aman` / `Cek` / `Tidak Layak`) evaluated dynamically per district.
* **Per-District Configuration:** Each district manages its own battery profile (`RSS` / `TSS/ER`), target capacity, voltage bounds, and IR baseline thresholds independently.
* **Districts Management:** Group rows by site or date. Add, rename, or delete entire districts with isolated cell tables and summaries.
* **Per-District Numbering:** District-local index formatting for clear row mapping (`#` column).
* **Temperature Color Coding:** Real-time visual feedback for cell temperature:
* $\le 25^\circ\text{C}$ or empty $\rightarrow$ Default
* $25^\circ\text{C} < T < 30^\circ\text{C}$ $\rightarrow$ Warning (Yellow)
* $\ge 30^\circ\text{C}$ $\rightarrow$ Bad (Red)


* **CSV Import/Export:** Import and export CSV data per district. Imports append rows safely without overwriting existing data.
* **Auto-Download & Local Persistence:** State persists instantly to browser `localStorage` on any edit and auto-downloads fresh cloud data on page load.
* **Offline Resilient:** If cloud connection fails or drops, the dashboard gracefully falls back to local storage and displays a notification banner.

---

## Usage

1. Open `index.html` in any modern web browser.
2. The page automatically fetches the latest database state from Firebase on load.
3. Edit cell metrics directly in the district tables or adjust individual district configurations.
4. Click **📥 Download** to manually pull the latest cloud snapshot.
5. Click **📤 Upload** to push your local edits to the Firebase database.
6. Use `+ New district` to create new site groupings or `Import CSV` / `Export CSV` for bulk operations.

---

## Configuration Options (Per District)

Each district card contains a dedicated configuration panel:

| Field | Default | Description |
| --- | --- | --- |
| Profile | `RSS` | Switches between **RSS** ($300\,\text{Ah}$, $0.75\,\text{m}\Omega$ baseline) and **TSS/ER** ($200\,\text{Ah}$, $0.85\,\text{m}\Omega$ baseline). |
| Healthy Cap (Ah) | `300` | Baseline capacity used for SOH calculation: $\text{SOH} = (\text{Measured} / \text{Healthy}) \times 100\%$. |
| Batas Atas (V) | `2.5` | Upper voltage limit threshold ($V > \text{batas\_atas}$). |
| Batas Bawah (V) | `2.0` | Lower voltage limit threshold ($V \le \text{batas\_bawah}$). |

---

## Status Decision Logic

For each cell row within a district, status is evaluated using that district's active configuration:

```text
SOH = (measured_capacity / healthy_capacity) * 100

IF SOH > 80%:
    IF (ir < irBaseline * 1.2) AND (cellVoltage > batasAtas) -> Aman
    IF (ir > irBaseline * 1.2) AND (cellVoltage < batasAtas) -> Cek
ELSE (SOH <= 80%):
    IF (ir > irBaseline * 1.5) OR (cellVoltage < batasBawah) -> Tidak Layak
    IF (ir in Warning Range) OR (cellVoltage in Warning Range) -> Cek
    IF (ir < irBaseline * 1.2) AND (cellVoltage > batasAtas) -> Aman

```

---

## Calculation Formulas

* **Ripple Current ($\text{A rms}$):** $I = \frac{V_{\text{ripple}}}{\text{IR}_{\text{ohms}}}$
* **Dissipated Power ($\text{W}$):** $P = \frac{V_{\text{ripple}}^2}{\text{IR}_{\text{ohms}}}$
* **State of Health ($\%$):** $\text{SOH} = \left(\frac{\text{Measured Capacity}}{\text{Healthy Capacity}}\right) \times 100$
* **Over Current Flag:** `TRUE` if $I_{\text{ripple}} > \frac{\text{District Capacity}}{5}$

---

## CSV Data Format

Exported CSVs maintain district-local indices and omit computed columns:

| Column | Name | Type | Notes |
| --- | --- | --- | --- |
| 1 | `battery_no` | Integer | District-local index (`#`) |
| 2 | `cell_voltage` | Number ($\text{V}$) | Raw cell voltage |
| 3 | `temperature` | Number ($^\circ\text{C}$) | Raw temperature |
| 4 | `ir` | Number ($\Omega$) | Stored in raw **Ohms** |
| 5 | `capacity` | Number ($\text{Ah}$) | Measured capacity |
| 6 | `ripple_voltage` | Number ($\text{V rms}$) | Ripple voltage |

---

## File Structure

```text
battery-dashboard/
├── index.html      # Header sync controls, districts container, toast banner
├── style.css       # MRT Jakarta theme, district cards, modal toasts, temp highlights
└── app.js          # District logic, per-district configs, CSV parser, Firebase REST sync

```
