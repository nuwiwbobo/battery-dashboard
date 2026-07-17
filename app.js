'use strict';

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

function overCurrentDecision(rippleCurrent, capacity) {
  if (rippleCurrent == null || capacity == null) return null;
  if (capacity <= 0) return null;
  if (isNaN(rippleCurrent) || isNaN(capacity)) return null;
  return rippleCurrent > (capacity / 5);
}

function tempCheckDecision(predictedTemp, amanMax, cekMax) {
  if (predictedTemp == null) return null;
  if (isNaN(predictedTemp)) return null;
  if (predictedTemp < amanMax) return 'Aman';
  if (predictedTemp < cekMax) return 'Cek';
  return 'Ganti';
}

function voltageStatus(absDeviation, amanMax, cekMax) {
  if (absDeviation == null) return null;
  if (isNaN(absDeviation)) return null;
  if (absDeviation < amanMax) return 'Aman';
  if (absDeviation < cekMax) return 'Cek';
  return 'Ganti';
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
  h: 4.6,
  surfaceArea: 0.2814,
  surfaceDims: { d1: 0.17, d2: 0.15, d3: 0.36 },
  rssCapacity: 300,
  tssErCapacity: 200,
  capacityProfile: 'RSS',
  tempAmanMax: 3,
  tempCekMax: 8,
  voltAmanMax: 0.05,
  voltCekMax: 0.1,
};

const SAMPLE_ROW = {
  id: 1,
  cellVoltage: 2.2338,
  ir: 0.563,
  irUnit: 'mohm',
  rippleVoltage: 0.005,
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
      config: { ...DEFAULT_CONFIG, ...parsed.config },
      rows: parsed.rows.map((r, i) => ({
        id: i + 1,
        cellVoltage: r.cellVoltage ?? null,
        ir: r.ir ?? null,
        irUnit: r.irUnit === 'mohm' ? 'mohm' : 'ohm',
        rippleVoltage: r.rippleVoltage ?? null,
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

function computeRowDerived(row, allRows, config) {
  const irOhms = normalizeIrOhms(row.ir, row.irUnit);
  const iRipple = rippleCurrent(row.rippleVoltage, irOhms);
  const power = dissipatedPower(row.rippleVoltage, irOhms);
  const dT = predictedTemp(power, config.surfaceArea, config.h);

  const capacity = config.capacityProfile === 'RSS'
    ? config.rssCapacity
    : config.tssErCapacity;
  const overCurrent = overCurrentDecision(iRipple, capacity);
  const tempCheck = tempCheckDecision(dT, config.tempAmanMax, config.tempCekMax);

  const voltages = allRows
    .map(r => r.cellVoltage)
    .filter(v => v != null && !isNaN(v));
  const meanV = mean(voltages);
  const vDev = (row.cellVoltage != null && meanV != null)
    ? row.cellVoltage - meanV
    : null;
  const vStatus = (vDev != null)
    ? voltageStatus(Math.abs(vDev), config.voltAmanMax, config.voltCekMax)
    : null;

  return {
    irOhms,
    iRipple,
    power,
    dT,
    overCurrent,
    tempCheck,
    vDev,
    vStatus,
    meanV,
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
  const c = state.config;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('config-h', c.h);
  set('config-area', c.surfaceArea);
  set('config-d1', c.surfaceDims.d1);
  set('config-d2', c.surfaceDims.d2);
  set('config-d3', c.surfaceDims.d3);
  set('config-rss', c.rssCapacity);
  set('config-tss', c.tssErCapacity);
  set('config-profile', c.capacityProfile);
  set('config-temp-aman', c.tempAmanMax);
  set('config-temp-cek', c.tempCekMax);
  set('config-volt-aman', c.voltAmanMax);
  set('config-volt-cek', c.voltCekMax);
}

function renderTable() {
  const tbody = document.getElementById('cell-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  state.rows.forEach(row => {
    const d = computeRowDerived(row, state.rows, state.config);
    const tr = document.createElement('tr');
    tr.dataset.rowId = row.id;
    tr.innerHTML = `
      <td><input type="checkbox" class="row-select" data-row-id="${row.id}"></td>
      <td>${row.id}</td>
      <td><input type="number" step="0.0001" class="cell-input" data-field="cellVoltage" data-row-id="${row.id}" value="${row.cellVoltage ?? ''}"></td>
      <td><input type="number" step="0.0001" class="cell-input" data-field="ir" data-row-id="${row.id}" value="${row.ir ?? ''}"></td>
      <td>
        <select class="cell-input" data-field="irUnit" data-row-id="${row.id}">
          <option value="ohm" ${row.irUnit === 'ohm' ? 'selected' : ''}>Ω</option>
          <option value="mohm" ${row.irUnit === 'mohm' ? 'selected' : ''}>mΩ</option>
        </select>
      </td>
      <td><input type="number" step="0.0001" class="cell-input" data-field="rippleVoltage" data-row-id="${row.id}" value="${row.rippleVoltage ?? ''}"></td>
      <td class="derived">${formatNumber(d.iRipple, 4)}</td>
      <td class="derived">${formatNumber(d.power, 6)}</td>
      <td class="derived">${formatNumber(d.dT, 4)}</td>
      <td class="derived ${d.overCurrent === true ? 'status-true' : d.overCurrent === false ? 'status-false' : ''}">${d.overCurrent == null ? '—' : d.overCurrent ? 'TRUE' : 'FALSE'}</td>
      <td class="derived ${statusClass(d.tempCheck)}">${d.tempCheck ?? '—'}</td>
      <td class="derived">${formatNumber(d.vDev, 4)}</td>
      <td class="derived ${statusClass(d.vStatus)}">${d.vStatus ?? '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function statusClass(status) {
  if (status === 'Aman') return 'status-aman';
  if (status === 'Cek') return 'status-cek';
  if (status === 'Ganti') return 'status-ganti';
  return '';
}

function renderSummary() {
  const voltages = state.rows.map(r => r.cellVoltage).filter(v => v != null && !isNaN(v));
  const meanV = mean(voltages);
  document.getElementById('mean-v').textContent = formatNumber(meanV, 4);

  let aman = 0, cek = 0, ganti = 0;
  state.rows.forEach(row => {
    const d = computeRowDerived(row, state.rows, state.config);
    [d.tempCheck, d.vStatus].forEach(s => {
      if (s === 'Aman') aman++;
      else if (s === 'Cek') cek++;
      else if (s === 'Ganti') ganti++;
    });
  });
  document.getElementById('count-aman').textContent = aman;
  document.getElementById('count-cek').textContent = cek;
  document.getElementById('count-ganti').textContent = ganti;
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
      const raw = target.value;
      if (raw === '' || raw === '-') {
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
        } else {
          target.classList.remove('invalid');
          row[field] = num;
        }
      }
    }
    saveState();
    render();
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

  // Config inputs
  const configBindings = [
    ['config-h', 'h', 'number'],
    ['config-area', 'surfaceArea', 'number'],
    ['config-rss', 'rssCapacity', 'number'],
    ['config-tss', 'tssErCapacity', 'number'],
    ['config-profile', 'capacityProfile', 'string'],
    ['config-temp-aman', 'tempAmanMax', 'number'],
    ['config-temp-cek', 'tempCekMax', 'number'],
    ['config-volt-aman', 'voltAmanMax', 'number'],
    ['config-volt-cek', 'voltCekMax', 'number'],
  ];
  configBindings.forEach(([elId, key, type]) => {
    const el = document.getElementById(elId);
    el.addEventListener('input', () => {
      const val = type === 'number' ? parseFloat(el.value) : el.value;
      if (type === 'number' && (isNaN(val) || val < 0)) {
        el.classList.add('invalid');
        return;
      }
      el.classList.remove('invalid');
      state.config[key] = val;
      saveState();
      render();
    });
  });

  // Surface area dimension inputs
  ['config-d1', 'config-d2', 'config-d3'].forEach((elId, idx) => {
    const key = ['d1', 'd2', 'd3'][idx];
    const el = document.getElementById(elId);
    el.addEventListener('input', () => {
      const val = parseFloat(el.value);
      if (!isNaN(val) && val >= 0) {
        state.config.surfaceDims[key] = val;
        saveState();
      }
    });
  });

  // Apply dimensions → area
  document.getElementById('apply-dims-btn').addEventListener('click', () => {
    const { d1, d2, d3 } = state.config.surfaceDims;
    const area = surfaceArea(d1, d2, d3);
    if (area == null) {
      showBanner('Cannot compute area: invalid dimensions');
      return;
    }
    state.config.surfaceArea = area;
    document.getElementById('config-area').value = area;
    saveState();
    render();
  });
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
    predictedTemp,
    surfaceArea,
    overCurrentDecision,
    tempCheckDecision,
    voltageStatus,
    mean,
  };
}
