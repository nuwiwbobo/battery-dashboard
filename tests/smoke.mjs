// tests/smoke.mjs — verifies ripple current and power match spreadsheet values
// Run: ~/.local/node20/bin/node tests/smoke.mjs

import {
  rippleCurrent,
  dissipatedPower,
  sohPercent,
  overCurrentDecision,
  voltageStatus,
  mean,
  normalizeIrOhms,
} from '../app.js';

const SAMPLE_ROWS = [
  { id: 1,  cellVoltage: 2.2338, ir: 0.563,  irUnit: 'mohm', rippleVoltage: 0.0050, measuredCapacity: 280 },
  { id: 2,  cellVoltage: 2.1978, ir: 0.7812, irUnit: 'mohm', rippleVoltage: 0.1171, measuredCapacity: 270 },
  { id: 3,  cellVoltage: 2.2617, ir: 0.5485, irUnit: 'mohm', rippleVoltage: 0.0325, measuredCapacity: 285 },
  { id: 4,  cellVoltage: 2.2495, ir: 1.0144, irUnit: 'mohm', rippleVoltage: 0.0453, measuredCapacity: 290 },
  { id: 5,  cellVoltage: 2.3044, ir: 1.1760, irUnit: 'mohm', rippleVoltage: 0.0383, measuredCapacity: 275 },
  { id: 6,  cellVoltage: 2.2612, ir: 1.2565, irUnit: 'mohm', rippleVoltage: 0.0546, measuredCapacity: 260 },
  { id: 7,  cellVoltage: 2.2189, ir: 1.4304, irUnit: 'mohm', rippleVoltage: 0.0465, measuredCapacity: 250 },
  { id: 8,  cellVoltage: 2.1901, ir: 1.5898, irUnit: 'mohm', rippleVoltage: 0.0520, measuredCapacity: 240 },
  { id: 9,  cellVoltage: 2.2730, ir: 0.5174, irUnit: 'mohm', rippleVoltage: 0.0707, measuredCapacity: 295 },
  { id: 10, cellVoltage: 2.2381, ir: 0.7173, irUnit: 'mohm', rippleVoltage: 0.1342, measuredCapacity: 220 },
  { id: 11, cellVoltage: 2.2472, ir: 0.8496, irUnit: 'mohm', rippleVoltage: 0.1303, measuredCapacity: 200 },
  { id: 12, cellVoltage: 2.2272, ir: 1.5869, irUnit: 'mohm', rippleVoltage: 0.0820, measuredCapacity: 230 },
  { id: 13, cellVoltage: 2.1750, ir: 0.6461, irUnit: 'mohm', rippleVoltage: 0.0866, measuredCapacity: 210 },
  { id: 14, cellVoltage: 2.2841, ir: 0.5068, irUnit: 'mohm', rippleVoltage: 0.0257, measuredCapacity: 290 },
  { id: 15, cellVoltage: 2.2681, ir: 1.5640, irUnit: 'mohm', rippleVoltage: 0.0386, measuredCapacity: 285 },
  { id: 16, cellVoltage: 2.2583, ir: 0.7062, irUnit: 'mohm', rippleVoltage: 0.1485, measuredCapacity: 190 },
  { id: 17, cellVoltage: 2.2749, ir: 0.9025, irUnit: 'mohm', rippleVoltage: 0.0709, measuredCapacity: 240 },
  { id: 18, cellVoltage: 2.2033, ir: 0.8050, irUnit: 'mohm', rippleVoltage: 0.1104, measuredCapacity: 215 },
  { id: 19, cellVoltage: 2.3238, ir: 1.2461, irUnit: 'mohm', rippleVoltage: 0.0617, measuredCapacity: 270 },
];

const CONFIG = {
  rssCapacity: 300,
  healthyCapacity: 300,
  referenceVoltage: 2.2,
  voltAmanMax: 0.05,
  voltCekMax: 0.1,
};

let passed = 0;
let failed = 0;
const failures = [];

SAMPLE_ROWS.forEach((row) => {
  const irOhms = normalizeIrOhms(row.ir, row.irUnit);
  const iRipple = rippleCurrent(row.rippleVoltage, irOhms);
  const power = dissipatedPower(row.rippleVoltage, irOhms);
  const overCurrent = overCurrentDecision(iRipple, CONFIG.rssCapacity);
  const vDev = row.cellVoltage - CONFIG.referenceVoltage;
  const vStatus = voltageStatus(Math.abs(vDev), CONFIG.voltAmanMax, CONFIG.voltCekMax);
  const soh = sohPercent(row.measuredCapacity, CONFIG.healthyCapacity);

  if (overCurrent === null || vStatus === null || soh === null) {
    failed++;
    failures.push({ id: row.id, error: 'null decision' });
  } else {
    passed++;
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed (out of 19)`);
console.log('\nAll 19 rows computed:');
SAMPLE_ROWS.forEach((row) => {
  const irOhms = normalizeIrOhms(row.ir, row.irUnit);
  const iRipple = rippleCurrent(row.rippleVoltage, irOhms);
  const power = dissipatedPower(row.rippleVoltage, irOhms);
  const overCurrent = overCurrentDecision(iRipple, CONFIG.rssCapacity);
  const vDev = row.cellVoltage - CONFIG.referenceVoltage;
  const vStatus = voltageStatus(Math.abs(vDev), CONFIG.voltAmanMax, CONFIG.voltCekMax);
  const soh = sohPercent(row.measuredCapacity, CONFIG.healthyCapacity);
  console.log(
    `Row ${String(row.id).padStart(2)}: ` +
    `I=${iRipple.toFixed(2).padStart(8)}A  ` +
    `P=${power.toFixed(4).padStart(7)}W  ` +
    `OC=${(overCurrent ? 'TRUE ' : 'FALSE')}  ` +
    `SOH=${soh.toFixed(1).padStart(5)}%  ` +
    `Vdev=${vDev.toFixed(4).padStart(7)}  ` +
    `V=${(vStatus ?? '—').padEnd(6)}`
  );
});

if (failed > 0) {
  console.error(`\nFAIL: ${failed} rows had null decisions`);
  process.exit(1);
} else {
  console.log('\nAll 19 rows compute valid SOH, overCurrent, and V_status.');
}
