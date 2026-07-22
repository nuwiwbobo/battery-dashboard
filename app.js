'use strict';

// Build: 2026-07-22-r12 (Manual Firebase Upload/Download & Local Storage)

// ====================================================================
// Calculations & Helper Functions
// ====================================================================

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

function batteryStatus(cellVoltage, ir, soh, batasAtas, batasBawah, irBaseline) {
  if (cellVoltage == null || ir == null || soh == null) return null;
  if (isNaN(cellVoltage) || isNaN(ir) || isNaN(soh)) return null;
  if (batasAtas == null || batasBawah == null || irBaseline == null) return null;
  if (batasAtas <= batasBawah) return null;
  if (irBaseline <= 0) return null;

  if (soh > 80) {
    if (ir < irBaseline * 1.2 && cellVoltage > batasAtas) return 'Aman';
    if (ir > irBaseline * 1.2 && cellVoltage < batasAtas) return 'Cek';
  } else {
    if (ir > irBaseline * 1.5 || cellVoltage < batasBawah) return 'Tidak Layak';
    const isIrWarning = (ir > irBaseline * 1.2) && (ir < irBaseline * 1.5);
    const isVoltageWarning = (cellVoltage > batasBawah) && (cellVoltage < batasAtas);
    if (isIrWarning || isVoltageWarning) return 'Cek';
    if (ir < irBaseline * 1.2 && cellVoltage > batasAtas) return 'Aman';
  }
  return 'Cek';
}

function mean(arr) {
  const valid = arr.filter(v => v != null && !isNaN(v) && typeof v === 'number');
  if (valid.length === 0) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

// ====================================================================
// CSV import/export
// ====================================================================

const CSV_COLUMN_MAP = {
  rippleVoltage: ['ripple', 'vripple', 'v_ripple', 'vrms'],
  measuredCapacity: ['cap', 'capacity', 'ah', 'measured'],
  ir: ['ir', 'int_res', 'resistance', 'res'],
  temperature: ['temp', 'temperature'],
  cellVoltage: ['voltage', 'v_min', 'v_minimum', 'volt', 'cell_v'],
};

function parseCSV(text) {
  if (typeof text !== 'string') return [];
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
  if (lines.length < 1) return [];

  const firstCells = lines[0].split(',').map(c => c.trim().replace(/^"|"$/g, '').toLowerCase());
  const firstLineHasKnownHeader = firstCells.some(cell =>
    Object.values(CSV_COLUMN_MAP).some(aliases => aliases.some(a => cell.includes(a)))
  );

  let headerColumns = null;
  let dataLines = firstLineHasKnownHeader ? (headerColumns = firstCells, lines.slice(1)) : lines;

  const fieldForIndex = (cellIdx) => {
    if (!headerColumns) return null;
    const col = headerColumns[cellIdx];
    if (!col) return null;
    for (const [field, aliases] of Object.entries(CSV_COLUMN_MAP)) {
      if (aliases.some(a => col.includes(a))) return field;
    }
    return null;
  };

  return dataLines.map(line => {
    const cells = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (!headerColumns) {
      return {
        battery_no: parseNumberOrNull(cells[0]),
        cellVoltage: parseNumberOrNull(cells[1]),
        temperature: parseNumberOrNull(cells[2]),
        ir: parseNumberOrNull(cells[3]),
        measuredCapacity: parseNumberOrNull(cells[4]),
        rippleVoltage: parseNumberOrNull(cells[5]),
      };
    }
    const row = {};
    for (let i = 0; i < cells.length; i++) {
      const field = fieldForIndex(i);
      if (field) row[field] = parseNumberOrNull(cells[i]);
    }
    return row;
  });
}

function parseNumberOrNull(s) {
  if (s == null) return null;
  const trimmed = String(s).trim();
  if (trimmed === '') return null;
  const normalized = trimmed.replace(',', '.');
  const num = parseFloat(normalized);
  return isNaN(num) ? null : num;
}

function rowsToCSV(rows) {
  const header = 'battery_no,cell_voltage,temperature,ir,capacity,ripple_voltage';
  const lines = rows.map((r, i) => {
    const irOhms = r.ir != null ? (r.irUnit === 'mohm' ? r.ir / 1000 : r.ir) : '';
    return [
      i + 1,
      r.cellVoltage ?? '',
      r.temperature ?? '',
      irOhms,
      r.measuredCapacity ?? '',
      r.rippleVoltage ?? '',
    ].join(',');
  });
  return [header, ...lines].join('\n');
}

function downloadCSV(filename, content) {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
}

function addCSVToDistrict(districtId, parsedRows) {
  const district = state.districts.find(d => d.id === districtId);
  if (!district) return 0;
  let added = 0;

  parsedRows.forEach(rowData => {
    let fields = Array.isArray(rowData) ? {
      cellVoltage: rowData[1],
      temperature: rowData[2],
      ir: rowData[3],
      measuredCapacity: rowData[4],
      rippleVoltage: rowData.length >= 6 ? rowData[5] : null,
    } : (typeof rowData === 'object' && rowData !== null ? rowData : null);

    if (!fields) return;

    const newRow = {
      id: nextRowId(),
      cellVoltage: parseNumberOrNull(fields.cellVoltage),
      temperature: parseNumberOrNull(fields.temperature),
      ir: parseNumberOrNull(fields.ir),
      irUnit: 'mohm',
      measuredCapacity: parseNumberOrNull(fields.measuredCapacity),
      rippleVoltage: parseNumberOrNull(fields.rippleVoltage),
    };

    state.rows.push(newRow);
    if (!Array.isArray(district.rowIds)) district.rowIds = [];
    district.rowIds.push(newRow.id);
    added++;
  });

  if (added > 0) {
    saveState();
    if (typeof renderDistricts === 'function') renderDistricts();
  }
  return added;
}

function importCSV(districtId, file) {
  if (typeof FileReader === 'undefined' || !file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const parsed = parseCSV(text);
    const count = addCSVToDistrict(districtId, parsed);
    showBanner(`Successfully imported ${count} cells.`);
  };
  reader.readAsText(file);
}

function exportCSV(districtId) {
  const district = state.districts.find(d => d.id === districtId);
  if (!district) return;
  const rows = getRowsForDistrict(district);
  const csv = rowsToCSV(rows);
  const date = new Date().toISOString().slice(0, 10);
  const name = sanitizeFilename(district.name);
  downloadCSV(`district_${name}_${date}.csv`, csv);
}

// ====================================================================
// Firebase Manual Sync Logic
// ====================================================================

const FIREBASE_DB_URL = 'https://battery-dashboard-af4ce-default-rtdb.asia-southeast1.firebasedatabase.app';

async function downloadFromFirebase() {
  if (typeof fetch === 'undefined') return;
  setSyncStatus('Downloading...');

  try {
    const res = await fetch(`${FIREBASE_DB_URL.replace(/\/$/, '')}/state.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    const remote = await res.json();
    if (!remote) {
      showBanner('Cloud database is empty.');
      setSyncStatus('Idle');
      return;
    }

    const remoteDistricts = remote.districts || [];
    const remoteRows = remote.rows || [];
    const remoteConfig = { ...DEFAULT_CONFIG, ...(remote.config || {}) };

    state = {
      config: remoteConfig,
      districts: remoteDistricts,
      rows: remoteRows,
      lastSyncedAt: remote.updatedAt || new Date().toISOString(),
      banner: null,
    };

    saveState(false); // Save locally without setting modified status
    render();

    setSyncStatus('Downloaded');
    showBanner('📥 Successfully downloaded latest data from Firebase.');
  } catch (e) {
    console.error('Download failed:', e);
    setSyncStatus('Error');
    showBanner(`❌ Download failed: ${e.message}`);
  }
}

async function uploadToFirebase() {
  if (typeof fetch === 'undefined') return;
  setSyncStatus('Uploading...');

  try {
    const baseUrl = FIREBASE_DB_URL.replace(/\/$/, '');
    const updatedAt = new Date().toISOString();

    const payload = {
      config: state.config,
      districts: state.districts,
      rows: state.rows,
      updatedAt: updatedAt,
      version: 1
    };

    const res = await fetch(`${baseUrl}/state.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    state.lastSyncedAt = updatedAt;
    saveState(false);

    setSyncStatus('Uploaded');
    showBanner('📤 Successfully uploaded data to Firebase.');
  } catch (e) {
    console.error('Upload failed:', e);
    setSyncStatus('Error');
    showBanner(`❌ Upload failed: ${e.message}`);
  }
}

function setSyncStatus(text) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('sync-status');
  if (el) el.textContent = text;
}

function showBanner(message) {
  const el = document.getElementById('banner');
  if (!el) {
    alert(message);
    return;
  }
  el.textContent = message;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 5000);
}

// ====================================================================
// Local State Management
// ====================================================================

const STORAGE_KEY = 'battery-dashboard-state-v1';
const DEFAULT_DISTRICT_NAME = 'Default';

const DEFAULT_CONFIG = {
  rssCapacity: 300,
  tssErCapacity: 200,
  capacityProfile: 'RSS',
  healthyCapacity: 300,
  batasAtas: 2.5,
  batasBawah: 2.0,
  irBaselineRss: 0.00075,
  irBaselineTssEr: 0.00085,
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
  districts: [
    { id: 1, name: DEFAULT_DISTRICT_NAME, rowIds: [1] },
  ],
  banner: null,
};

function nextRowId() {
  return state.rows.length === 0 ? 1 : Math.max(...state.rows.map(r => r.id)) + 1;
}

function nextDistrictId() {
  return state.districts.length === 0 ? 1 : Math.max(...state.districts.map(d => d.id)) + 1;
}

function getRowsForDistrict(district) {
  if (!district) return [];
  return district.rowIds
    .map(id => state.rows.find(r => r.id === id))
    .filter(r => r != null);
}

function escapeHTML(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    if (!parsed.config || !Array.isArray(parsed.rows)) return;

    const rows = parsed.rows.map((r, i) => ({
      id: i + 1,
      cellVoltage: r.cellVoltage ?? null,
      ir: r.ir ?? null,
      irUnit: r.irUnit === 'mohm' ? 'mohm' : 'ohm',
      rippleVoltage: r.rippleVoltage ?? null,
      measuredCapacity: (typeof r.measuredCapacity === 'number' && !isNaN(r.measuredCapacity)) ? r.measuredCapacity : null,
      temperature: (typeof r.temperature === 'number' && !isNaN(r.temperature)) ? r.temperature : null,
    }));

    let districts = Array.isArray(parsed.districts) ? parsed.districts.map((d, i) => ({
      id: (typeof d.id === 'number' && !isNaN(d.id)) ? d.id : i + 1,
      name: (typeof d.name === 'string' && d.name.length > 0) ? d.name : `District ${i + 1}`,
      rowIds: Array.isArray(d.rowIds) ? d.rowIds.filter(id => rows.some(r => r.id === id)) : [],
    })) : [];

    if (districts.length === 0) {
      districts.push({ id: 1, name: DEFAULT_DISTRICT_NAME, rowIds: rows.map(r => r.id) });
    }

    state = {
      config: {
        ...DEFAULT_CONFIG,
        capacityProfile: (parsed.config.capacityProfile === 'TSS/ER') ? 'TSS/ER' : 'RSS',
        healthyCapacity: parsed.config.healthyCapacity || DEFAULT_CONFIG.healthyCapacity,
        batasAtas: parsed.config.batasAtas || DEFAULT_CONFIG.batasAtas,
        batasBawah: parsed.config.batasBawah || DEFAULT_CONFIG.batasBawah,
      },
      rows,
      districts,
      lastSyncedAt: (typeof parsed.lastSyncedAt === 'string') ? parsed.lastSyncedAt : null,
      banner: null,
    };
  } catch (err) {
    console.error('Failed to load local state:', err);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      config: state.config,
      rows: state.rows,
      districts: state.districts,
      lastSyncedAt: state.lastSyncedAt,
    }));
  } catch (err) {
    console.error('Save failed:', err);
  }
}

// ====================================================================
// Rendering & Calculation Bridge
// ====================================================================

function computeRowDerived(row, config) {
  const irOhms = normalizeIrOhms(row.ir, row.irUnit);
  const iRipple = rippleCurrent(row.rippleVoltage, irOhms);
  const power = dissipatedPower(row.rippleVoltage, irOhms);
  const capacity = config.capacityProfile === 'RSS' ? config.rssCapacity : config.tssErCapacity;
  const overCurrent = overCurrentDecision(iRipple, capacity);
  const soh = sohPercent(row.measuredCapacity, config.healthyCapacity);
  const irBaseline = config.capacityProfile === 'RSS' ? config.irBaselineRss : config.irBaselineTssEr;
  const status = batteryStatus(row.cellVoltage, irOhms, soh, config.batasAtas, config.batasBawah, irBaseline);

  return { irOhms, iRipple, power, overCurrent, soh, temperature: row.temperature, status };
}

function formatNumber(n, digits = 4) {
  if (n == null || isNaN(n)) return '—';
  if (Math.abs(n) >= 1000 || Math.abs(n) < 0.001) return n.toExponential(2);
  return Number(n).toFixed(digits);
}

function render() {
  renderConfig();
  renderDistricts();
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
  const capacity = state.config.capacityProfile === 'RSS' ? state.config.rssCapacity : state.config.tssErCapacity;
  el.textContent = `${capacity / 5} A`;
}

function updateBaselineDisplay() {
  const el = document.getElementById('ir-baseline');
  if (!el) return;
  const baseline = state.config.capacityProfile === 'RSS' ? state.config.irBaselineRss : state.config.irBaselineTssEr;
  el.textContent = `${(baseline * 1000).toFixed(2)} mΩ`;
}

function statusClass(status) {
  if (status === 'Aman') return 'status-aman';
  if (status === 'Cek') return 'status-cek';
  if (status === 'Tidak Layak') return 'status-tidak-layak';
  return '';
}

function tempClass(t) {
  if (t == null || isNaN(t)) return '';
  if (t >= 30) return 'temp-bad';
  if (t > 25) return 'temp-warn';
  return '';
}

function renderRowHTML(row, districtIndex, config) {
  const d = computeRowDerived(row, config);
  const tempCls = tempClass(row.temperature);
  const tempClassAttr = tempCls ? ' ' + tempCls : '';
  const idx = (typeof districtIndex === 'number' && districtIndex > 0) ? districtIndex : row.id;
  return `
    <tr data-row-id="${row.id}">
      <td><input type="checkbox" class="row-select" data-row-id="${row.id}"></td>
      <td>${idx}</td>
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
      <td><input type="text" inputmode="decimal" class="cell-input${tempClassAttr}" data-field="temperature" data-row-id="${row.id}" value="${row.temperature ?? ''}"></td>
      <td class="derived">${formatNumber(d.iRipple, 4)}</td>
      <td class="derived">${formatNumber(d.power, 6)}</td>
      <td class="derived">${d.soh == null ? '—' : d.soh.toFixed(2) + '%'}</td>
      <td class="derived ${d.overCurrent === true ? 'status-true' : d.overCurrent === false ? 'status-false' : ''}">${d.overCurrent == null ? '—' : d.overCurrent ? 'TRUE' : 'FALSE'}</td>
      <td class="derived ${statusClass(d.status)}">${d.status ?? '—'}</td>
    </tr>
  `;
}

function renderDistrictSummaryHTML(district) {
  const districtRows = getRowsForDistrict(district);
  const voltages = districtRows.map(r => r.cellVoltage).filter(v => v != null && !isNaN(v));
  const meanV = mean(voltages);
  let aman = 0, cek = 0, tidakLayak = 0;
  districtRows.forEach(row => {
    const d = computeRowDerived(row, state.config);
    if (d.status === 'Aman') aman++;
    else if (d.status === 'Cek') cek++;
    else if (d.status === 'Tidak Layak') tidakLayak++;
  });
  return `
    <div class="district-summary">
      <span>Mean V: <strong>${formatNumber(meanV, 4)}</strong></span>
      <span>Aman: <strong>${aman}</strong></span>
      <span>Cek: <strong>${cek}</strong></span>
      <span>Tidak Layak: <strong>${tidakLayak}</strong></span>
    </div>
  `;
}

function renderDistrictHTML(district) {
  const districtRows = getRowsForDistrict(district);
  const tableRowsHTML = districtRows.map((row, idx) => renderRowHTML(row, idx + 1, state.config)).join('');
  return `
    <div class="district" data-district-id="${district.id}">
      <div class="district-header">
        <h3 class="district-name" contenteditable="true" data-district-id="${district.id}">${escapeHTML(district.name)}</h3>
        <button type="button" class="district-delete-btn" data-district-id="${district.id}">Delete district</button>
      </div>
      ${renderDistrictSummaryHTML(district)}
      <div class="table-wrapper">
        <table class="cell-table">
          <thead>
            <tr>
              <th></th>
              <th>#</th>
              <th>Cell V (V)</th>
              <th>IR</th>
              <th>Unit</th>
              <th>V_ripple (V rms)</th>
              <th>Measured Cap (Ah)</th>
              <th>Temp (°C)</th>
              <th>I_ripple (A rms)</th>
              <th>P (W)</th>
              <th>SOH (%)</th>
              <th>Over Current</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${tableRowsHTML}</tbody>
        </table>
      </div>
      <div class="actions">
        <button type="button" class="add-row-btn" data-district-id="${district.id}">+ Add row</button>
        <button type="button" class="delete-selected-btn" data-district-id="${district.id}">Delete selected</button>
        <button type="button" class="import-csv-btn" data-district-id="${district.id}">Import CSV</button>
        <button type="button" class="export-csv-btn" data-district-id="${district.id}">Export CSV</button>
        <input type="file" class="import-csv-input" data-district-id="${district.id}" accept=".csv" style="display:none">
      </div>
    </div>
  `;
}

function renderDistricts() {
  const container = document.getElementById('districts-container');
  if (!container) return;
  container.innerHTML = state.districts.map(renderDistrictHTML).join('');
}

function updateRowInPlace(rowId) {
  const row = state.rows.find(r => r.id === rowId);
  if (!row) return;
  const tr = document.querySelector(`tr[data-row-id="${rowId}"]`);
  if (!tr) return;
  const d = computeRowDerived(row, state.config);
  const cells = tr.querySelectorAll('td');
  if (cells.length < 13) return;
  const tempInput = cells[7].querySelector('input');
  if (tempInput) {
    tempInput.value = row.temperature ?? '';
    tempInput.className = 'cell-input ' + tempClass(row.temperature);
  }
  cells[8].textContent = formatNumber(d.iRipple, 4);
  cells[9].textContent = formatNumber(d.power, 6);
  cells[10].textContent = d.soh == null ? '—' : d.soh.toFixed(2) + '%';
  cells[11].className = 'derived ' + (d.overCurrent === true ? 'status-true' : d.overCurrent === false ? 'status-false' : '');
  cells[11].textContent = d.overCurrent == null ? '—' : d.overCurrent ? 'TRUE' : 'FALSE';
  cells[12].className = 'derived ' + statusClass(d.status);
  cells[12].textContent = d.status ?? '—';
}

function updateDistrictSummaryInPlace(districtId) {
  const district = state.districts.find(d => d.id === districtId);
  if (!district) return;
  const section = document.querySelector(`.district[data-district-id="${districtId}"] .district-summary`);
  if (!section) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = renderDistrictSummaryHTML(district);
  section.replaceWith(wrap.firstElementChild);
}

// ====================================================================
// District Operations & Event Handlers
// ====================================================================

function addDistrict() {
  const newId = nextDistrictId();
  state.districts.push({ id: newId, name: `District ${newId}`, rowIds: [] });
  saveState();
  renderDistricts();
}

function addRowToDistrict(districtId) {
  const district = state.districts.find(d => d.id === districtId);
  if (!district) return;
  const newRow = { id: nextRowId(), cellVoltage: null, ir: null, irUnit: 'mohm', rippleVoltage: null, measuredCapacity: null, temperature: null };
  state.rows.push(newRow);
  district.rowIds.push(newRow.id);
  saveState();
  renderDistricts();
}

function deleteSelectedInDistrict(districtId) {
  const district = state.districts.find(d => d.id === districtId);
  if (!district) return;
  const selected = Array.from(document.querySelectorAll(`.district[data-district-id="${districtId}"] .row-select:checked`)).map(cb => parseInt(cb.dataset.rowId, 10));
  if (selected.length === 0) return showBanner('No rows selected');
  if (!confirm(`Delete ${selected.length} row(s)?`)) return;
  state.rows = state.rows.filter(r => !selected.includes(r.id));
  district.rowIds = district.rowIds.filter(id => !selected.includes(id));
  saveState();
  renderDistricts();
}

function deleteDistrict(districtId) {
  const district = state.districts.find(d => d.id === districtId);
  if (!district) return;
  if (!confirm(`Delete district "${district.name}" and all its rows?`)) return;
  const idsToRemove = new Set(district.rowIds);
  state.rows = state.rows.filter(r => !idsToRemove.has(r.id));
  state.districts = state.districts.filter(d => d.id !== districtId);
  saveState();
  renderDistricts();
}

function renameDistrict(districtId, newName) {
  const district = state.districts.find(d => d.id === districtId);
  if (!district) return;
  const trimmed = (newName || '').trim();
  if (trimmed.length === 0 || trimmed === district.name) return;
  district.name = trimmed;
  saveState();
}

function wireEvents() {
  // Sync Buttons
  const downloadBtn = document.getElementById('download-db-btn');
  if (downloadBtn) downloadBtn.addEventListener('click', downloadFromFirebase);

  const uploadBtn = document.getElementById('upload-db-btn');
  if (uploadBtn) uploadBtn.addEventListener('click', uploadToFirebase);

  // Table inputs delegation
  const container = document.getElementById('districts-container');
  if (container) {
    container.addEventListener('input', (e) => {
      const target = e.target;
      if (!target.classList || !target.classList.contains('cell-input')) return;
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
          target.classList.remove('invalid');
          row[field] = num;
        }
      }
      saveState();
      updateRowInPlace(rowId);
      const district = state.districts.find(d => d.rowIds.includes(rowId));
      if (district) updateDistrictSummaryInPlace(district.id);
    });

    container.addEventListener('click', (e) => {
      const target = e.target;
      if (!target.classList) return;

      if (target.classList.contains('add-row-btn')) addRowToDistrict(parseInt(target.dataset.districtId, 10));
      else if (target.classList.contains('delete-selected-btn')) deleteSelectedInDistrict(parseInt(target.dataset.districtId, 10));
      else if (target.classList.contains('district-delete-btn')) deleteDistrict(parseInt(target.dataset.districtId, 10));
      else if (target.classList.contains('import-csv-btn')) {
        const input = container.querySelector(`.import-csv-input[data-district-id="${target.dataset.districtId}"]`);
        if (input) input.click();
      } else if (target.classList.contains('export-csv-btn')) exportCSV(parseInt(target.dataset.districtId, 10));
    });

    container.addEventListener('blur', (e) => {
      const target = e.target;
      if (target.classList && target.classList.contains('district-name')) {
        renameDistrict(parseInt(target.dataset.districtId, 10), target.textContent);
      }
    }, true);

    container.addEventListener('change', (e) => {
      const target = e.target;
      if (target.classList && target.classList.contains('import-csv-input')) {
        const file = target.files && target.files[0];
        if (file) importCSV(parseInt(target.dataset.districtId, 10), file);
        target.value = '';
      }
    });
  }

  const addDistrictBtn = document.getElementById('add-district-btn');
  if (addDistrictBtn) addDistrictBtn.addEventListener('click', addDistrict);

  const resetBtn = document.getElementById('reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (!confirm('Clear all local data and start fresh?')) return;
      localStorage.removeItem(STORAGE_KEY);
      state = {
        config: { ...DEFAULT_CONFIG },
        rows: [{ ...SAMPLE_ROW }],
        districts: [{ id: 1, name: DEFAULT_DISTRICT_NAME, rowIds: [1] }],
        banner: null,
      };
      render();
    });
  }

  const profileEl = document.getElementById('config-profile');
  if (profileEl) {
    profileEl.addEventListener('change', () => {
      state.config.capacityProfile = profileEl.value;
      saveState();
      updateThresholdDisplay();
      updateBaselineDisplay();
      state.rows.forEach(r => updateRowInPlace(r.id));
      state.districts.forEach(d => updateDistrictSummaryInPlace(d.id));
    });
  }
}

function bootstrap() {
  loadState();
  render();
  wireEvents();
  setSyncStatus('Idle');
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', bootstrap);
}
