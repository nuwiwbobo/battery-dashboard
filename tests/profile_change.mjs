// tests/profile_change.mjs — verify the change handler logic works end-to-end
// Run: ~/.local/node20/bin/node tests/profile_change.mjs

import {
  computeRowDerived,
  overCurrentDecision,
  rippleCurrent,
} from '../app.js';

// Simulate two rows from the smoke test that should toggle on profile change
const rows = [
  { id: 1, cellVoltage: 2.1978, ir: 0.7812, irUnit: 'mohm', rippleVoltage: 0.1171 },  // I=149.9A, always TRUE
  { id: 3, cellVoltage: 2.2617, ir: 0.5485, irUnit: 'mohm', rippleVoltage: 0.0325 },  // I=59.3A, FALSE on RSS, TRUE on TSS/ER
  { id: 1.5, cellVoltage: 2.0, ir: 1.0, irUnit: 'mohm', rippleVoltage: 0.06 },       // I=60A, FALSE on RSS, TRUE on TSS/ER
];

const rssConfig = { capacityProfile: 'RSS', rssCapacity: 300, tssErCapacity: 200, surfaceArea: 0.2814, h: 4.6, tempAmanMax: 3, tempCekMax: 8, voltAmanMax: 0.05, voltCekMax: 0.1 };
const tssConfig = { ...rssConfig, capacityProfile: 'TSS/ER' };

console.log('Row | I_ripple (A) | RSS (60A thr) | TSS/ER (40A thr)');
console.log('----|--------------|---------------|-----------------');
rows.forEach(row => {
  const dRss = computeRowDerived(row, rows, rssConfig);
  const dTss = computeRowDerived(row, rows, tssConfig);
  console.log(
    `  ${String(row.id).padEnd(3)}| ` +
    `${dRss.iRipple.toFixed(2).padStart(13)} | ` +
    `${String(dRss.overCurrent).padEnd(13)} | ` +
    `${String(dTss.overCurrent).padEnd(13)}`
  );
});

// Assertions
const d3Rss = computeRowDerived(rows[1], rows, rssConfig);
const d3Tss = computeRowDerived(rows[1], rows, tssConfig);
console.log(`\nRow 3 (I=${d3Rss.iRipple.toFixed(2)}A):`);
console.log(`  RSS profile (60A threshold): overCurrent = ${d3Rss.overCurrent}`);
console.log(`  TSS/ER profile (40A threshold): overCurrent = ${d3Tss.overCurrent}`);

if (d3Rss.overCurrent === d3Tss.overCurrent) {
  console.error('FAIL: row 3 should have different overCurrent on different profiles');
  process.exit(1);
} else {
  console.log('PASS: profile change correctly toggles overCurrent');
}
