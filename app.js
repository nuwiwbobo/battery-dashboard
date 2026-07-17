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
  irUnit: 'ohm',
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
