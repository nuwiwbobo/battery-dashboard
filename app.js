'use strict';

// Build: 2026-07-20-r4 (battery status: SOH AND (V OR IR))

function normalizeIrOhms(ir, unit) {
  if (ir == null || isNaN(ir)) return null;
  return unit === 'mohm' ? ir / 1000 : ir;
}

function rippleCurrent(vRipple, irOhms) {
  if (vRipple == null || irOhms == null || irOhms === 0) return null;
  if (isNaN(vRipple) || isNaN(irOhms)) return null;
  return vRipple / irOhms;
}

function dissipatedPower(vRipple, irOhms) {
  if (vRipple == null || irOhms == null || irOhms === 0) return null;
  if (isNaN(vRipple) || isNaN(irOhms)) return null;
  return (vRipple * vRipple) / irOhms;
}

// COMMENTED OUT: temperature prediction is now user-entered, not calculated.
// Kept here for reference; can be re-enabled if calc-based temp is needed again.
/*
function predictedTemp(power, area, h) {
  if (power == null || area == null || h == null) return null;
  if (area <= 0 || h <= 0) return null;
  if (isNaN(power) || isNaN(area) || isNaN(h)) return null;
  return power / (area * h);
}

function surfaceArea(d1, d2, d3) {
  if (d1 == null || d2 == null || d3 == null) return null;
  if ([d1, d2, d3].some(v => v < 0 || isNaN(v))) return null;
  return 2 * (d1 * d2 + d1 * d3 + d2 * d3);
}
*/

function sohPercent(measuredCapacity, healthyCapacity) {
  if (measuredCapacity == null || healthyCapacity == null) return null;
  if (healthyCapacity <= 0) return null;
  if (isNaN(measuredCapacity) || isNaN(healthyCapacity)) return null;
  return (measuredCapacity / healthyCapacity) * 100;
}

function overCurrentDecision(rippleCurrent, capacity) {
  if (rippleCurrent == null || capacity == null) return null;
  if (capacity <= 0) return null;
  if (isNaN(rippleCurrent) || isNaN(capacity)) return null;
  return rippleCurrent > (capacity / 5);
}

// COMMENTED OUT: temperature check is no longer a decision column.
// Temperature is now user-entered and displayed as a raw value, no thresholds applied.
/*
function tempCheckDecision(predictedTemp, amanMax, cekMax) {
  if (predictedTemp == null) return null;
  if (isNaN(predictedTemp)) return null;
  if (predictedTemp < amanMax) return 'Aman';
  if (predictedTemp < cekMax) return 'Cek';
  return 'Ganti';
}
*/

function voltageStatus(absDeviation, amanMax, cekMax) {
  if (absDeviation == null) return null;
  if (isNaN(absDeviation)) return null;
  if (absDeviation < amanMax) return 'Aman';
  if (absDeviation < cekMax) return 'Cek';
  return 'Ganti';
}

// Combined battery status: SOH AND (cell voltage OR internal resistance)
// 3 levels: Aman | Cek | Tidak Layak
// Inputs:
//   cellVoltage: V (number or null)
//   ir:          ohms (number or null) — already normalized to Ω
//   soh:         % (number or null, e.g. 85 means 85%)
//   batasAtas, batasBawah: V thresholds
//   irBaseline:  ohms (e.g. 0.00075 for RSS, 0.00085 for TSS/ER)
function batteryStatus(cellVoltage, ir, soh, batasAtas, batasBawah, irBaseline) {
  if (cellVoltage == null || ir == null || soh == null) return null;
  if (isNaN(cellVoltage) || isNaN(ir) || isNaN(soh)) return null;
  if (batasAtas == null || batasBawah == null || irBaseline == null) return null;
  if (batasAtas <= batasBawah) return null;  // invalid config
  if (irBaseline <= 0) return null;

  // SOH gate: must be > 80% to be Aman
  const sohOk = soh > 80;

  // Voltage zones
  const voltageOk = cellVoltage > batasAtas;
  const voltageWarning = cellVoltage > batasBawah && cellVoltage <= batasAtas;
  const voltageBad = cellVoltage <= batasBawah;

  // IR zones (compared to baseline)
  const irOk = ir < irBaseline * 1.2;
  const irWarning = ir >= irBaseline * 1.2 && ir <= irBaseline * 1.5;
  const irBad = ir > irBaseline * 1.5;

  // Aman: SOH > 80% AND (V > batas_atas OR IR < 120% baseline)
  if (sohOk && (voltageOk || irOk)) return 'Aman';

  // Cek: V between batas OR IR 120-150% (must be Cek-eligible = not Aman)
  if (voltageWarning || irWarning) return 'Cek';

  // Tidak Layak: V < batas_bawah OR IR > 150%
  if (voltageBad || irBad) return 'Tidak Layak';

  // SOH <= 80% means it can't be Aman. With V/IR in OK range, default to Cek.
  return 'Cek';
}

function mean(arr) {
  const valid = arr.filter(v => v != null && !isNaN(v) && typeof v === 'number');
  if (valid.length === 0) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

// ====================================================================
// State management (browser-only)
// ====================================================================

const STORAGE_KEY = 'battery-dashboard-state-v1';

const DEFAULT_CONFIG = {
  rssCapacity: 300,
  tssErCapacity: 200,
  capacityProfile: 'RSS',
  healthyCapacity: 300,
  batasAtas: 2.5,
  batasBawah: 2.0,
  irBaselineRss: 0.00075,      // 0.75 mΩ
  irBaselineTssEr: 0.00085,    // 0.85 mΩ
};

const SAMPLE_ROW = {
  id: 1,
  cellVoltage: 2.2338,
  ir: 0.563,
  irUnit: 'mohm',
  rippleVoltage: 0.005,
  measuredCapacity: null,
  temperature: null,
};

let state = {
  config: { ...DEFAULT_CONFIG },
  rows: [{ ...SAMPLE_ROW }],
  banner: null,
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid shape');
    if (!parsed.config || !Array.isArray(parsed.rows)) throw new Error('missing fields');
    state = {
      config: {
        ...DEFAULT_CONFIG,
        capacityProfile: (parsed.config.capacityProfile === 'TSS/ER') ? 'TSS/ER' : 'RSS',
        healthyCapacity: (typeof parsed.config.healthyCapacity === 'number' && !isNaN(parsed.config.healthyCapacity) && parsed.config.healthyCapacity > 0)
          ? parsed.config.healthyCapacity
          : DEFAULT_CONFIG.healthyCapacity,
        batasAtas: (typeof parsed.config.batasAtas === 'number' && !isNaN(parsed.config.batasAtas))
          ? parsed.config.batasAtas
          : DEFAULT_CONFIG.batasAtas,
        batasBawah: (typeof parsed.config.batasBawah === 'number' && !isNaN(parsed.config.batasBawah))
          ? parsed.config.batasBawah
          : DEFAULT_CONFIG.batasBawah,
      },
      rows: parsed.rows.map((r, i) => ({
        id: i + 1,
        cellVoltage: r.cellVoltage ?? null,
        ir: r.ir ?? null,
        irUnit: r.irUnit === 'mohm' ? 'mohm' : 'ohm',
        rippleVoltage: r.rippleVoltage ?? null,
        measuredCapacity: (typeof r.measuredCapacity === 'number' && !isNaN(r.measuredCapacity)) ? r.measuredCapacity : null,
        temperature: (typeof r.temperature === 'number' && !isNaN(r.temperature)) ? r.temperature : null,
      })),
      banner: null,
    };
  } catch (err) {
    console.error('Failed to load state:', err);
    showBanner('Saved data was corrupt, started fresh');
    state = {
      config: { ...DEFAULT_CONFIG },
      rows: [{ ...SAMPLE_ROW }],
      banner: null,
    };
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      config: state.config,
      rows: state.rows,
    }));
  } catch (err) {
    if (err.name === 'QuotaExceededError') {
      showBanner("Couldn't auto-save (storage full); export your data before closing");
    } else {
      console.error('Save failed:', err);
    }
  }
}

function showBanner(message) {
  const el = document.getElementById('banner');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 5000);
}

function getState() { return state; }
function setState(newState) {
  state = newState;
  saveState();
}

// ====================================================================
// Derived calculations (per row)
// ====================================================================

function computeRowDerived(row, config) {
  const irOhms = normalizeIrOhms(row.ir, row.irUnit);
  const iRipple = rippleCurrent(row.rippleVoltage, irOhms);
  const power = dissipatedPower(row.rippleVoltage, irOhms);

  const capacity = config.capacityProfile === 'RSS'
    ? config.rssCapacity
    : config.tssErCapacity;
  const overCurrent = overCurrentDecision(iRipple, capacity);

  const soh = sohPercent(row.measuredCapacity, config.healthyCapacity);
  const irBaseline = config.capacityProfile === 'RSS'
    ? config.irBaselineRss
    : config.irBaselineTssEr;
  const status = batteryStatus(
    row.cellVoltage,
    irOhms,
    soh,
    config.batasAtas,
    config.batasBawah,
    irBaseline
  );

  return {
    irOhms,
    iRipple,
    power,
    overCurrent,
    soh,
    temperature: row.temperature,
    status,
  };
}

function formatNumber(n, digits = 4) {
  if (n == null || isNaN(n)) return '—';
  if (Math.abs(n) >= 1000 || Math.abs(n) < 0.001) return n.toExponential(2);
  return Number(n).toFixed(digits);
}

// ====================================================================
// Render
// ====================================================================

function render() {
  renderConfig();
  renderTable();
  renderSummary();
}

function renderConfig() {
  const el = document.getElementById('config-profile');
  if (el) el.value = state.config.capacityProfile;
  const healthyEl = document.getElementById('config-healthy');
  if (healthyEl) healthyEl.value = state.config.healthyCapacity;
  const atasEl = document.getElementById('config-batas-atas');
  if (atasEl) atasEl.value = state.config.batasAtas;
  const bawahEl = document.getElementById('config-batas-bawah');
  if (bawahEl) bawahEl.value = state.config.batasBawah;
  updateThresholdDisplay();
  updateBaselineDisplay();
}

function updateThresholdDisplay() {
  const el = document.getElementById('oc-threshold');
  if (!el) return;
  const capacity = state.config.capacityProfile === 'RSS'
    ? state.config.rssCapacity
    : state.config.tssErCapacity;
  el.textContent = `${capacity / 5} A`;
}

function updateBaselineDisplay() {
  const el = document.getElementById('ir-baseline');
  if (!el) return;
  const baseline = state.config.capacityProfile === 'RSS'
    ? state.config.irBaselineRss
    : state.config.irBaselineTssEr;
  el.textContent = `${(baseline * 1000).toFixed(2)} mΩ`;
}

function renderTable() {
  const tbody = document.getElementById('cell-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  state.rows.forEach(row => {
    const d = computeRowDerived(row, state.config);
    const tr = document.createElement('tr');
    tr.dataset.rowId = row.id;
    tr.innerHTML = `
      <td><input type="checkbox" class="row-select" data-row-id="${row.id}"></td>
      <td>${row.id}</td>
      <td><input type="text" inputmode="decimal" class="cell-input" data-field="cellVoltage" data-row-id="${row.id}" value="${row.cellVoltage ?? ''}"></td>
      <td><input type="text" inputmode="decimal" class="cell-input" data-field="ir" data-row-id="${row.id}" value="${row.ir ?? ''}"></td>
      <td>
        <select class="cell-input" data-field="irUnit" data-row-id="${row.id}">
          <option value="ohm" ${row.irUnit === 'ohm' ? 'selected' : ''}>Ω</option>
          <option value="mohm" ${row.irUnit === 'mohm' ? 'selected' : ''}>mΩ</option>
        </select>
      </td>
      <td><input type="text" inputmode="decimal" class="cell-input" data-field="rippleVoltage" data-row-id="${row.id}" value="${row.rippleVoltage ?? ''}"></td>
      <td><input type="text" inputmode="decimal" class="cell-input" data-field="measuredCapacity" data-row-id="${row.id}" value="${row.measuredCapacity ?? ''}"></td>
      <td><input type="text" inputmode="decimal" class="cell-input" data-field="temperature" data-row-id="${row.id}" value="${row.temperature ?? ''}"></td>
      <td class="derived">${formatNumber(d.iRipple, 4)}</td>
      <td class="derived">${formatNumber(d.power, 6)}</td>
      <td class="derived">${d.soh == null ? '—' : d.soh.toFixed(2) + '%'}</td>
      <td class="derived ${d.overCurrent === true ? 'status-true' : d.overCurrent === false ? 'status-false' : ''}">${d.overCurrent == null ? '—' : d.overCurrent ? 'TRUE' : 'FALSE'}</td>
      <td class="derived ${statusClass(d.status)}">${d.status ?? '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function statusClass(status) {
  if (status === 'Aman') return 'status-aman';
  if (status === 'Cek') return 'status-cek';
  if (status === 'Tidak Layak') return 'status-tidak-layak';
  return '';
}

function updateRowInPlace(rowId) {
  const row = state.rows.find(r => r.id === rowId);
  if (!row) return;
  const tr = document.querySelector(`#cell-tbody tr[data-row-id="${rowId}"]`);
  if (!tr) return;
  const d = computeRowDerived(row, state.config);
  const cells = tr.querySelectorAll('td');
  if (cells.length < 13) return;
  cells[8].textContent = formatNumber(d.iRipple, 4);
  cells[9].textContent = formatNumber(d.power, 6);
  cells[10].textContent = d.soh == null ? '—' : d.soh.toFixed(2) + '%';
  cells[11].className = 'derived ' + (d.overCurrent === true ? 'status-true' : d.overCurrent === false ? 'status-false' : '');
  cells[11].textContent = d.overCurrent == null ? '—' : d.overCurrent ? 'TRUE' : 'FALSE';
  cells[12].className = 'derived ' + statusClass(d.status);
  cells[12].textContent = d.status ?? '—';
}

function renderSummary() {
  const voltages = state.rows.map(r => r.cellVoltage).filter(v => v != null && !isNaN(v));
  const meanV = mean(voltages);
  document.getElementById('mean-v').textContent = formatNumber(meanV, 4);

  let aman = 0, cek = 0, tidakLayak = 0;
  state.rows.forEach(row => {
    const d = computeRowDerived(row, state.config);
    if (d.status === 'Aman') aman++;
    else if (d.status === 'Cek') cek++;
    else if (d.status === 'Tidak Layak') tidakLayak++;
  });
  document.getElementById('count-aman').textContent = aman;
  document.getElementById('count-cek').textContent = cek;
  document.getElementById('count-tidak-layak').textContent = tidakLayak;
}

// ====================================================================
// Event wiring (browser-only)
// ====================================================================

function wireEvents() {
  // Cell table inputs (delegated)
  const tbody = document.getElementById('cell-tbody');
  tbody.addEventListener('input', (e) => {
    const target = e.target;
    if (!target.classList.contains('cell-input')) return;
    const rowId = parseInt(target.dataset.rowId, 10);
    const field = target.dataset.field;
    const row = state.rows.find(r => r.id === rowId);
    if (!row) return;

    if (field === 'irUnit') {
      row.irUnit = target.value;
    } else {
      const raw = target.value.replace(',', '.');
      if (raw === '' || raw === '-' || raw === '.') {
        row[field] = null;
        target.classList.remove('invalid');
      } else {
        const num = parseFloat(raw);
        if (isNaN(num)) {
          target.classList.add('invalid');
          return;
        }
        if (field === 'cellVoltage' && (num <= 0 || num > 5)) {
          target.classList.add('invalid');
          row[field] = num;
        } else if (field === 'ir' && num <= 0) {
          target.classList.add('invalid');
          row[field] = num;
        } else if (field === 'rippleVoltage' && num < 0) {
          target.classList.add('invalid');
          row[field] = num;
        } else if (field === 'measuredCapacity' && num < 0) {
          target.classList.add('invalid');
          row[field] = num;
        } else if (field === 'temperature') {
          target.classList.remove('invalid');
          row[field] = num;
        } else {
          target.classList.remove('invalid');
          row[field] = num;
        }
      }
    }
    saveState();
    updateRowInPlace(rowId);
    renderSummary();
  });

  // Add row
  document.getElementById('add-row-btn').addEventListener('click', () => {
    const nextId = state.rows.length === 0
      ? 1
      : Math.max(...state.rows.map(r => r.id)) + 1;
    state.rows.push({
      id: nextId,
      cellVoltage: null,
      ir: null,
      irUnit: 'mohm',
      rippleVoltage: null,
      measuredCapacity: null,
      temperature: null,
    });
    saveState();
    render();
  });

  // Delete selected
  document.getElementById('delete-selected-btn').addEventListener('click', () => {
    const selected = Array.from(document.querySelectorAll('.row-select:checked'))
      .map(cb => parseInt(cb.dataset.rowId, 10));
    if (selected.length === 0) {
      showBanner('No rows selected');
      return;
    }
    if (!confirm(`Delete ${selected.length} row(s)?`)) return;
    state.rows = state.rows.filter(r => !selected.includes(r.id));
    state.rows.forEach((r, i) => { r.id = i + 1; });
    saveState();
    render();
  });

  // Select all
  document.getElementById('select-all').addEventListener('click', (e) => {
    document.querySelectorAll('.row-select').forEach(cb => {
      cb.checked = e.target.checked;
    });
  });

  // Reset all
  document.getElementById('reset-btn').addEventListener('click', () => {
    if (!confirm('Clear all data and start fresh?')) return;
    localStorage.removeItem(STORAGE_KEY);
    state = {
      config: { ...DEFAULT_CONFIG },
      rows: [{ ...SAMPLE_ROW }],
      banner: null,
    };
    render();
  });

  // Config: capacity profile select
  const profileEl = document.getElementById('config-profile');
  if (profileEl) {
    const onProfileChange = () => {
      state.config.capacityProfile = profileEl.value;
      saveState();
      updateThresholdDisplay();
      updateBaselineDisplay();
      state.rows.forEach(r => updateRowInPlace(r.id));
      renderSummary();
    };
    profileEl.addEventListener('change', onProfileChange);
    profileEl.addEventListener('input', onProfileChange);
  }

  // Config: healthy capacity input
  const healthyEl = document.getElementById('config-healthy');
  if (healthyEl) {
    healthyEl.addEventListener('input', () => {
      const raw = healthyEl.value.replace(',', '.');
      const val = parseFloat(raw);
      if (isNaN(val) || val <= 0) {
        healthyEl.classList.add('invalid');
        return;
      }
      healthyEl.classList.remove('invalid');
      state.config.healthyCapacity = val;
      saveState();
      state.rows.forEach(r => updateRowInPlace(r.id));
      renderSummary();
    });
  }

  // Config: batas atas (V)
  const atasEl = document.getElementById('config-batas-atas');
  if (atasEl) {
    atasEl.addEventListener('input', () => {
      const raw = atasEl.value.replace(',', '.');
      const val = parseFloat(raw);
      if (isNaN(val) || val <= 0) {
        atasEl.classList.add('invalid');
        return;
      }
      atasEl.classList.remove('invalid');
      state.config.batasAtas = val;
      saveState();
      state.rows.forEach(r => updateRowInPlace(r.id));
      renderSummary();
    });
  }

  // Config: batas bawah (V)
  const bawahEl = document.getElementById('config-batas-bawah');
  if (bawahEl) {
    bawahEl.addEventListener('input', () => {
      const raw = bawahEl.value.replace(',', '.');
      const val = parseFloat(raw);
      if (isNaN(val) || val <= 0) {
        bawahEl.classList.add('invalid');
        return;
      }
      bawahEl.classList.remove('invalid');
      state.config.batasBawah = val;
      saveState();
      state.rows.forEach(r => updateRowInPlace(r.id));
      renderSummary();
    });
  }
}

// ====================================================================
// Bootstrap (browser-only)
// ====================================================================

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    loadState();
    render();
    wireEvents();
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeIrOhms,
    rippleCurrent,
    dissipatedPower,
    sohPercent,
    overCurrentDecision,
    batteryStatus,
    mean,
  };
}
