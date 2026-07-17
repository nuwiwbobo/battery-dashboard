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
