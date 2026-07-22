'use strict';

// Build: 2026-07-21-r11 (remove login, hardcode Firebase URL, auto-sync)
//
// SECURITY NOTE: This dashboard has NO authentication. It syncs directly
// to a public Firebase Realtime Database (URL hardcoded below). Anyone
// with the URL can read and modify the state. Suitable for a private
// team or a single shared dashboard; for public deployment, add Firebase
// Authentication and tighten the database rules.

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

// Combined battery status: SOH AND worst-of-(V, IR)
// 3 levels: Aman | Cek | Tidak Layak
// Priority: V and IR are each classified independently into ok/warning/bad.
// The "worse" zone wins. Then SOH gate is applied:
//   - SOH > 80% AND combined zone is ok  → Aman
//   - combined zone is warning            → Cek
//   - combined zone is bad                → Tidak Layak
//   - SOH ≤ 80% (any zone)                → Cek
function batteryStatus(cellVoltage, ir, soh, batasAtas, batasBawah, irBaseline) {
  // 1. Input Validation & Null Checks
  if (cellVoltage == null || ir == null || soh == null) return null;
  if (isNaN(cellVoltage) || isNaN(ir) || isNaN(soh)) return null;
  if (batasAtas == null || batasBawah == null || irBaseline == null) return null;
  if (batasAtas <= batasBawah) return null;
  if (irBaseline <= 0) return null;

  // 2. Logic Implementation based on specified conditions
  
  // --- Case 1: SOH > 80% ---
  if (soh > 80) {
    if (ir < irBaseline * 1.2 && cellVoltage > batasAtas) {
      return 'Aman';
    }
    if (ir > irBaseline * 1.2 && cellVoltage < batasAtas) {
      return 'Cek'; // WARNING -> 'Cek'
    }
  } 
  
  // --- Case 2: SOH <= 80% (soh < 80% branch) ---
  else {
    // Condition 1: BAD / Tidak Layak
    // (ir > irBaseline * 1.5 OR cellVoltage < batasBawah)
    if (ir > irBaseline * 1.5 || cellVoltage < batasBawah) {
      return 'Tidak Layak'; // BAD -> 'Tidak Layak'
    }

    // Condition 2: WARNING / Cek
    // (ir Baseline * 1.2 < ir < irBaseline * 1.5 OR batasBawah < cellVoltage < batasAtas)
    const isIrInWarningRange = (ir > irBaseline * 1.2) && (ir < irBaseline * 1.5);
    const isVoltageInWarningRange = (cellVoltage > batasBawah) && (cellVoltage < batasAtas);

    if (isIrInWarningRange || isVoltageInWarningRange) {
      return 'Cek'; // WARNING -> 'Cek'
    }

    // Condition 3: AMAN
    if (ir < irBaseline * 1.2 && cellVoltage > batasAtas) {
      return 'Aman';
    }
  }

  // Fallback status for border/uncovered condition boundaries (e.g., cellVoltage == batasAtas)
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

// Map CSV column names (lowercased, normalized) to dashboard fields.
// Uses substring matching: "cell_voltage" → contains "voltage" → cellVoltage
// Check order: most-specific substring first to avoid false positives.
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

  // First non-empty line: could be header OR a data row.
  // We try to detect: if the first line contains a known keyword
  // treat it as a header. Otherwise treat all lines as data with default ordering.
  const firstCells = lines[0].split(',').map(c => c.trim().replace(/^"|"$/g, '').toLowerCase());
  const firstLineHasKnownHeader = firstCells.some(cell =>
    Object.values(CSV_COLUMN_MAP).some(aliases => aliases.some(a => cell.includes(a)))
  );

  let headerColumns = null;
  let dataLines;
  if (firstLineHasKnownHeader) {
    headerColumns = firstCells;
    dataLines = lines.slice(1);
  } else {
    // No recognizable header — assume default column order
    dataLines = lines;
  }

  // Build column index → dashboard field map
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
      // Default positional order: battery_no, cell_voltage, temperature, ir, capacity, ripple_voltage
      return {
        battery_no: parseNumberOrNull(cells[0]),
        cellVoltage: parseNumberOrNull(cells[1]),
        temperature: parseNumberOrNull(cells[2]),
        ir: parseNumberOrNull(cells[3]),
        measuredCapacity: parseNumberOrNull(cells[4]),
        rippleVoltage: parseNumberOrNull(cells[5]),
      };
    }
    // Header-driven: pick out known fields by column name
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
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') return;
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
    // rowData is now an object {cellVoltage, temperature, ir, ...}
    // Accept both array (legacy) and object (new) format
    let fields;
    if (Array.isArray(rowData)) {
      // Legacy array format: [battery_no, cell_voltage, temperature, ir, capacity, ripple_voltage]
      // Also handles 5-column CSVs (like ADM.csv)
      fields = {
        cellVoltage: rowData[1],
        temperature: rowData[2],
        ir: rowData[3],
        measuredCapacity: rowData[4],
        rippleVoltage: rowData.length >= 6 ? rowData[5] : null,
      };
    } else if (typeof rowData === 'object' && rowData !== null) {
      fields = rowData;
    } else {
      return;
    }
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
    
    // Trigger synchronization if you are syncing with Firebase
    if (typeof markStateModified === 'function') {
      markStateModified();
    } else if (typeof schedulePush === 'function') {
      schedulePush();
    }
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
    console.log(`Successfully imported ${count} cells.`);
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
  const filename = `district_${name}_${date}.csv`;
  downloadCSV(filename, csv);
}
// ====================================================================
// Firebase Realtime Database cloud sync
// ====================================================================
//
// State is stored at FIREBASE_DB_URL + '/state.json'. The REST API is used
// directly (no Firebase SDK) — PUT to write, GET to read. No auth token
// is required because access is gated by the URL itself. See README
// for security notes and the rules the user should apply.
let pushTimeout = null;
let isDirty = false; // Tracks if local state has un-pushed changes
let localBaselineState = null; // Snapshot of last synced state for comparison

/**
 * Call this function whenever the user modifies data locally.
 * It marks the state as modified and schedules the debounced push.
 */
function markStateModified() {
  isDirty = true;
  schedulePush();
}

async function pullFromFirebase() {
  if (typeof fetch === 'undefined') return;
  try {
    setSyncStatus('Syncing...');
    const res = await fetch(`${FIREBASE_DB_URL.replace(/\/$/, '')}/state.json`);
    if (!res.ok) {
      setSyncStatus('Sync error');
      return;
    }
    const remote = await res.json();
    if (!remote || !remote.updatedAt) {
      setSyncStatus('No remote state');
      return;
    }

    // Don't pull over local uncommitted changes unless necessary
    if (remote.updatedAt === state.lastSyncedAt && !isDirty) {
      setSyncStatus('Synced');
      return;
    }

    // Merge or accept remote state
    state = {
      config: { ...DEFAULT_CONFIG, ...(remote.config || {}) },
      districts: Array.isArray(remote.districts) ? remote.districts : state.districts,
      rows: Array.isArray(remote.rows) ? remote.rows : state.rows,
      lastSyncedAt: remote.updatedAt,
      banner: null,
    };

    // Deep clone baseline to track future local changes
    localBaselineState = JSON.parse(JSON.stringify(state));
    isDirty = false;

    saveState();
    render();
    setSyncStatus('Synced');
  } catch (e) {
    console.error('Pull failed:', e);
    setSyncStatus('Sync error');
  }
}

async function pushToFirebase() {
  if (typeof fetch === 'undefined') return;

  // 1. GUARD: If nothing was changed locally, skip the push entirely
  if (!isDirty) {
    setSyncStatus('Synced');
    return;
  }

  try {
    setSyncStatus('Syncing...');
    const baseUrl = FIREBASE_DB_URL.replace(/\/$/, '');

    // 2. CONCURRENCY CHECK: Fetch remote metadata to see if another device updated state
    const remoteCheckRes = await fetch(`${baseUrl}/state/updatedAt.json`);
    if (remoteCheckRes.ok) {
      const remoteUpdatedAt = await remoteCheckRes.json();
      
      // If remote has newer data than our last sync point, pull first to avoid overwriting
      if (remoteUpdatedAt && remoteUpdatedAt > state.lastSyncedAt) {
        console.warn('Remote data is newer. Merging before push...');
        await pullFromFirebase();
        // After pull, re-evaluate if local changes still need to be pushed
        if (!isDirty) return;
      }
    }

    const updatedAt = new Date().toISOString();

    // 3. DIFF & PATCH: Construct a fine-grained payload containing ONLY modified nodes
    const deltaPayload = {
      updatedAt: updatedAt,
      version: 1
    };

    if (JSON.stringify(state.config) !== JSON.stringify(localBaselineState?.config)) {
      deltaPayload.config = state.config;
    }
    if (JSON.stringify(state.districts) !== JSON.stringify(localBaselineState?.districts)) {
      deltaPayload.districts = state.districts;
    }
    if (JSON.stringify(state.rows) !== JSON.stringify(localBaselineState?.rows)) {
      deltaPayload.rows = state.rows;
    }

    // 4. Send HTTP PATCH instead of PUT to update only modified fields
    const res = await fetch(`${baseUrl}/state.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deltaPayload),
    });

    if (!res.ok) {
      setSyncStatus('Sync error');
      return;
    }

    // 5. Update local tracking state
    state.lastSyncedAt = updatedAt;
    localBaselineState = JSON.parse(JSON.stringify(state));
    isDirty = false;

    saveState();
    setSyncStatus('Synced');
  } catch (e) {
    console.error('Push failed:', e);
    setSyncStatus('Sync error');
  }
}

function schedulePush() {
  if (typeof process !== 'undefined' && process.versions && process.versions.node) return;
  if (typeof setTimeout === 'undefined') return;
  
  // Do not schedule if there are no local changes
  if (!isDirty) return;

  if (pushTimeout != null && typeof clearTimeout !== 'undefined') {
    clearTimeout(pushTimeout);
  }
  pushTimeout = setTimeout(pushToFirebase, SYNC_PUSH_DEBOUNCE_MS);
}

function setSyncStatus(text) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('sync-status');
  if (el) el.textContent = text;
}

// ====================================================================
// Firebase sync config
// ====================================================================

// Hardcoded Firebase Realtime Database URL — no login, no user setup required.
// All devices using this URL share the same dashboard state.
// Security: anyone with the URL can read/write. To restrict, add Firebase Auth
// and tighten the rules at https://console.firebase.google.com/.
const FIREBASE_DB_URL = 'https://battery-dashboard-af4ce-default-rtdb.asia-southeast1.firebasedatabase.app';
const SYNC_POLL_INTERVAL_MS = 3000;
const SYNC_PUSH_DEBOUNCE_MS = 1000;

// ====================================================================
// State management (browser-only)
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
  districts: [
    { id: 1, name: DEFAULT_DISTRICT_NAME, rowIds: [1] },
  ],
  banner: null,
};

function nextRowId() {
  return state.rows.length === 0
    ? 1
    : Math.max(...state.rows.map(r => r.id)) + 1;
}

function nextDistrictId() {
  return state.districts.length === 0
    ? 1
    : Math.max(...state.districts.map(d => d.id)) + 1;
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
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid shape');
    if (!parsed.config || !Array.isArray(parsed.rows)) throw new Error('missing fields');
    const rows = parsed.rows.map((r, i) => ({
      id: i + 1,
      cellVoltage: r.cellVoltage ?? null,
      ir: r.ir ?? null,
      irUnit: r.irUnit === 'mohm' ? 'mohm' : 'ohm',
      rippleVoltage: r.rippleVoltage ?? null,
      measuredCapacity: (typeof r.measuredCapacity === 'number' && !isNaN(r.measuredCapacity)) ? r.measuredCapacity : null,
      temperature: (typeof r.temperature === 'number' && !isNaN(r.temperature)) ? r.temperature : null,
    }));

    let districts = [];
    if (Array.isArray(parsed.districts) && parsed.districts.length > 0) {
      districts = parsed.districts.map((d, i) => ({
        id: (typeof d.id === 'number' && !isNaN(d.id)) ? d.id : i + 1,
        name: (typeof d.name === 'string' && d.name.length > 0) ? d.name : `District ${i + 1}`,
        rowIds: Array.isArray(d.rowIds)
          ? d.rowIds.filter(id => rows.some(r => r.id === id))
          : [],
      }));
    }

    if (districts.length === 0) {
      districts.push({
        id: 1,
        name: DEFAULT_DISTRICT_NAME,
        rowIds: rows.map(r => r.id),
      });
    } else {
      const assigned = new Set();
      districts.forEach(d => d.rowIds.forEach(id => assigned.add(id)));
      const unassigned = rows.filter(r => !assigned.has(r.id));
      if (unassigned.length > 0) {
        districts[0].rowIds.push(...unassigned.map(r => r.id));
      }
    }

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
      rows,
      districts,
      lastSyncedAt: (typeof parsed.lastSyncedAt === 'string') ? parsed.lastSyncedAt : null,
      banner: null,
    };
  } catch (err) {
    console.error('Failed to load state:', err);
    showBanner('Saved data was corrupt, started fresh');
    state = {
      config: { ...DEFAULT_CONFIG },
      rows: [{ ...SAMPLE_ROW }],
      districts: [{ id: 1, name: DEFAULT_DISTRICT_NAME, rowIds: [1] }],
      lastSyncedAt: null,
      banner: null,
    };
  }
}

function saveState() {
  markStateModified();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      config: state.config,
      rows: state.rows,
      districts: state.districts,
      lastSyncedAt: state.lastSyncedAt,
    }));
  } catch (err) {
    if (err.name === 'QuotaExceededError') {
      showBanner("Couldn't auto-save (storage full); export your data before closing");
    } else {
      console.error('Save failed:', err);
    }
  }
  schedulePush();
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
// District CRUD (browser-only; mutates state, persists, re-renders)
// ====================================================================

function addDistrict() {
  const newId = nextDistrictId();
  state.districts.push({
    id: newId,
    name: `District ${newId}`,
    rowIds: [],
  });
  saveState();
  renderDistricts();
}

function addRowToDistrict(districtId) {
  const district = state.districts.find(d => d.id === districtId);
  if (!district) return;
  const newRow = {
    id: nextRowId(),
    cellVoltage: null,
    ir: null,
    irUnit: 'mohm',
    rippleVoltage: null,
    measuredCapacity: null,
    temperature: null,
  };
  state.rows.push(newRow);
  district.rowIds.push(newRow.id);
  saveState();
  renderDistricts();
}

function deleteSelectedInDistrict(districtId) {
  const district = state.districts.find(d => d.id === districtId);
  if (!district) return;
  const selected = Array.from(
    document.querySelectorAll(`.district[data-district-id="${districtId}"] .row-select:checked`)
  ).map(cb => parseInt(cb.dataset.rowId, 10));
  if (selected.length === 0) {
    showBanner('No rows selected');
    return;
  }
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
  if (trimmed.length === 0) return;
  if (trimmed === district.name) return;
  district.name = trimmed;
  saveState();
}

// ====================================================================
// Event wiring (browser-only)
// ====================================================================

function wireEvents() {
  // Cell table inputs (delegated on districts container)
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
      const district = state.districts.find(d => d.rowIds.includes(rowId));
      if (district) updateDistrictSummaryInPlace(district.id);
    });

    // District actions (delegated click)
    container.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof Object) || !target.classList) return;

      if (target.classList.contains('add-row-btn')) {
        const districtId = parseInt(target.dataset.districtId, 10);
        addRowToDistrict(districtId);
      } else if (target.classList.contains('delete-selected-btn')) {
        const districtId = parseInt(target.dataset.districtId, 10);
        deleteSelectedInDistrict(districtId);
      } else if (target.classList.contains('district-delete-btn')) {
        const districtId = parseInt(target.dataset.districtId, 10);
        deleteDistrict(districtId);
      } else if (target.classList.contains('import-csv-btn')) {
        const districtId = parseInt(target.dataset.districtId, 10);
        const input = container.querySelector(`.import-csv-input[data-district-id="${districtId}"]`);
        if (input) input.click();
      } else if (target.classList.contains('export-csv-btn')) {
        const districtId = parseInt(target.dataset.districtId, 10);
        exportCSV(districtId);
      }
    });

    // District name editing (delegated blur on contenteditable h3)
    container.addEventListener('blur', (e) => {
      const target = e.target;
      if (!target.classList || !target.classList.contains('district-name')) return;
      const districtId = parseInt(target.dataset.districtId, 10);
      renameDistrict(districtId, target.textContent);
    }, true);

    // CSV import (delegated change on hidden file inputs)
    container.addEventListener('change', (e) => {
      const target = e.target;
      if (!target.classList || !target.classList.contains('import-csv-input')) return;
      const districtId = parseInt(target.dataset.districtId, 10);
      const file = target.files && target.files[0];
      if (file) importCSV(districtId, file);
      target.value = '';
    });
  }

  // Add district (singleton)
  const addDistrictBtn = document.getElementById('add-district-btn');
  if (addDistrictBtn) {
    addDistrictBtn.addEventListener('click', addDistrict);
  }

  // Reset all
  document.getElementById('reset-btn').addEventListener('click', () => {
    if (!confirm('Clear all data and start fresh?')) return;
    localStorage.removeItem(STORAGE_KEY);
    state = {
      config: { ...DEFAULT_CONFIG },
      rows: [{ ...SAMPLE_ROW }],
      districts: [{ id: 1, name: DEFAULT_DISTRICT_NAME, rowIds: [1] }],
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
      state.districts.forEach(d => updateDistrictSummaryInPlace(d.id));
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
      state.districts.forEach(d => updateDistrictSummaryInPlace(d.id));
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
      state.districts.forEach(d => updateDistrictSummaryInPlace(d.id));
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
      state.districts.forEach(d => updateDistrictSummaryInPlace(d.id));
    });
  }

  // No more cloud sync input handlers — sync is hardcoded and automatic
}

// ====================================================================
// Bootstrap (browser-only)
// ====================================================================

function bootstrap() {
  loadState();
  render();
  wireEvents();
  // Always sync with Firebase — no enable flag, no URL input required
  pullFromFirebase();
  if (typeof setInterval !== 'undefined') {
    setInterval(pullFromFirebase, SYNC_POLL_INTERVAL_MS);
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    bootstrap();
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
    tempClass,
    renderRowHTML,
    parseCSV,
    rowsToCSV,
    parseNumberOrNull,
    addCSVToDistrict,
    importCSV,
    exportCSV,
    pullFromFirebase,
    pushToFirebase,
    schedulePush,
    markStateModified,
    setSyncStatus,
    bootstrap,
    DEFAULT_CONFIG,
    SAMPLE_ROW,
    DEFAULT_DISTRICT_NAME,
    FIREBASE_DB_URL,
    SYNC_POLL_INTERVAL_MS,
    SYNC_PUSH_DEBOUNCE_MS,
  };
}
