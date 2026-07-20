import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rippleCurrent,
  dissipatedPower,
  sohPercent,
  overCurrentDecision,
  batteryStatus,
  mean,
  normalizeIrOhms,
  tempClass,
  renderRowHTML,
} from '../app.js';

test('rippleCurrent matches spreadsheet row 1', () => {
  const i = rippleCurrent(0.005, 0.563);
  assert.ok(Math.abs(i - 0.0088809946) < 1e-6, `got ${i}`);
});

test('dissipatedPower matches spreadsheet row 1', () => {
  const p = dissipatedPower(0.005, 0.563);
  assert.ok(Math.abs(p - 4.4408e-5) < 1e-7, `got ${p}`);
});

test('dissipatedPower matches spreadsheet row 2', () => {
  const p = dissipatedPower(0.1171, 0.7812);
  assert.ok(Math.abs(p - 0.01754) < 1e-4, `got ${p}`);
});

test('overCurrentDecision: 60.0001A at 300Ah exceeds C/5', () => {
  assert.equal(overCurrentDecision(60.0001, 300), true);
  assert.equal(overCurrentDecision(59.9, 300), false);
});

test('overCurrentDecision: sheet TRUE cases', () => {
  assert.equal(overCurrentDecision(136.7, 300), true);
});

test('overCurrentDecision: sheet FALSE cases', () => {
  assert.equal(overCurrentDecision(8.88, 300), false);
});

test('normalizeIrOhms: mΩ → Ω', () => {
  assert.equal(normalizeIrOhms(563, 'mohm'), 0.563);
  assert.equal(normalizeIrOhms(0.563, 'ohm'), 0.563);
  assert.equal(normalizeIrOhms(0, 'mohm'), 0);
  assert.equal(normalizeIrOhms(0, 'ohm'), 0);
});

test('mean ignores null/undefined values', () => {
  const m1 = mean([2.2, 2.3, 2.4]);
  assert.ok(Math.abs(m1 - 2.3) < 1e-9, `got ${m1}`);
  const m2 = mean([2.2, null, 2.4]);
  assert.ok(Math.abs(m2 - 2.3) < 1e-9, `got ${m2}`);
  assert.equal(mean([null, null]), null);
  assert.equal(mean([]), null);
});

test('comma decimal separator converts to period (Indonesian locale)', () => {
  const raw = '2,2338';
  const normalized = raw.replace(',', '.');
  const num = parseFloat(normalized);
  assert.ok(Math.abs(num - 2.2338) < 1e-9, `got ${num}`);
});

test('overCurrentDecision changes with capacity profile', () => {
  assert.equal(overCurrentDecision(50, 300), false);
  assert.equal(overCurrentDecision(50, 200), true);
  assert.equal(overCurrentDecision(40, 200), false);
  assert.equal(overCurrentDecision(40.0001, 200), true);
  assert.equal(overCurrentDecision(60, 300), false);
  assert.equal(overCurrentDecision(60.0001, 300), true);
});

test('sohPercent: standard cases', () => {
  assert.ok(Math.abs(sohPercent(300, 300) - 100) < 1e-9);
  assert.ok(Math.abs(sohPercent(240, 300) - 80) < 1e-9);
  assert.ok(Math.abs(sohPercent(150, 300) - 50) < 1e-9);
});

test('sohPercent: handles invalid inputs', () => {
  assert.equal(sohPercent(null, 300), null);
  assert.equal(sohPercent(300, null), null);
  assert.equal(sohPercent(300, 0), null);
  assert.equal(sohPercent(NaN, 300), null);
  assert.equal(sohPercent(300, NaN), null);
});

// batteryStatus tests
const cfg = { batasAtas: 2.5, batasBawah: 2.0, irBaselineRss: 0.00075, irBaselineTssEr: 0.00085 };

test('batteryStatus: Aman — SOH>80% AND V>batas_atas', () => {
  // 2.6V (>2.5), 85% SOH, IR 0.0007 (< 0.00075*1.2 = 0.0009)
  assert.equal(batteryStatus(2.6, 0.0007, 85, cfg.batasAtas, cfg.batasBawah, cfg.irBaselineRss), 'Aman');
});

test('batteryStatus: V warning + IR ok + SOH>80% → Cek (worst-of: V warning wins)', () => {
  // 2.3V (between 2.0 and 2.5 = warning), 85% SOH, IR 0.0007 (ok)
  // With worst-of priority, V warning escalates to Cek even though IR is OK.
  assert.equal(batteryStatus(2.3, 0.0007, 85, cfg.batasAtas, cfg.batasBawah, cfg.irBaselineRss), 'Cek');
});

test('batteryStatus: Tidak Layak — V < batas_bawah AND SOH<80%', () => {
  assert.equal(batteryStatus(1.9, 0.0007, 75, cfg.batasAtas, cfg.batasBawah, cfg.irBaselineRss), 'Tidak Layak');
});

test('batteryStatus: Tidak Layak — IR > 150% baseline AND SOH<80% (V in OK range)', () => {
  // 150% of 0.00075 = 0.001125. V=2.6 (>2.5, OK), IR=0.0012 (> 0.001125, bad), SOH=75 (<80) → Tidak Layak
  assert.equal(batteryStatus(2.6, 0.0012, 75, cfg.batasAtas, cfg.batasBawah, cfg.irBaselineRss), 'Tidak Layak');
});

test('batteryStatus: Cek — V in warning range AND SOH<80%', () => {
  // 2.3V (between 2.0 and 2.5), 75% SOH, IR ok
  assert.equal(batteryStatus(2.3, 0.0007, 75, cfg.batasAtas, cfg.batasBawah, cfg.irBaselineRss), 'Cek');
});

test('batteryStatus: Cek — IR 120-150% baseline AND SOH<80%', () => {
  // IR 0.0010 (between 0.0009 and 0.001125), 75% SOH, V ok
  assert.equal(batteryStatus(2.6, 0.0010, 75, cfg.batasAtas, cfg.batasBawah, cfg.irBaselineRss), 'Cek');
});

test('batteryStatus: SOH exactly 80% defaults to Cek', () => {
  assert.equal(batteryStatus(2.6, 0.0007, 80, cfg.batasAtas, cfg.batasBawah, cfg.irBaselineRss), 'Cek');
});

test('batteryStatus: SOH<80% with V and IR both in OK range → Cek (gate fails)', () => {
  assert.equal(batteryStatus(2.6, 0.0007, 75, cfg.batasAtas, cfg.batasBawah, cfg.irBaselineRss), 'Cek');
});

test('batteryStatus: TSS/ER profile uses different IR baseline', () => {
  // TSS/ER baseline is 0.00085, 120% = 0.00102, 150% = 0.001275
  // IR 0.0010 is < 0.00102 → Aman-eligible on IR, V also good → Aman
  assert.equal(batteryStatus(2.6, 0.0010, 85, cfg.batasAtas, cfg.batasBawah, cfg.irBaselineTssEr), 'Aman');
  // Same IR but RSS profile: 0.0010 > 0.0009 (RSS 120%) → IR warning, SOH<80% → Cek
  assert.equal(batteryStatus(2.6, 0.0010, 75, cfg.batasAtas, cfg.batasBawah, cfg.irBaselineRss), 'Cek');
});

test('batteryStatus: null inputs return null', () => {
  assert.equal(batteryStatus(null, 0.0007, 85, cfg.batasAtas, cfg.batasBawah, cfg.irBaselineRss), null);
  assert.equal(batteryStatus(2.6, null, 85, cfg.batasAtas, cfg.batasBawah, cfg.irBaselineRss), null);
  assert.equal(batteryStatus(2.6, 0.0007, null, cfg.batasAtas, cfg.batasBawah, cfg.irBaselineRss), null);
  assert.equal(batteryStatus(2.6, 0.0007, 85, null, cfg.batasBawah, cfg.irBaselineRss), null);
  assert.equal(batteryStatus(2.6, 0.0007, 85, cfg.batasAtas, cfg.batasBawah, null), null);
});

test('batteryStatus: invalid config (atas <= bawah) returns null', () => {
  assert.equal(batteryStatus(2.0, 0.0007, 85, 2.0, 2.5, cfg.irBaselineRss), null);
});

// Priority tests: worst-of-V-and-IR wins
test('batteryStatus priority: V ok + IR bad + SOH>80% → Tidak Layak (IR worse wins)', () => {
  // V=2.6 (ok), IR=0.0012 (>150% baseline 0.001125), SOH=90%
  assert.equal(batteryStatus(2.6, 0.0012, 90, cfg.batasAtas, cfg.batasBawah, cfg.irBaselineRss), 'Tidak Layak');
});

test('batteryStatus priority: V ok + IR warning + SOH>80% → Cek (IR worse wins)', () => {
  // V=2.6 (ok), IR=0.0010 (warning: 0.0009-0.001125), SOH=90%
  assert.equal(batteryStatus(2.6, 0.0010, 90, cfg.batasAtas, cfg.batasBawah, cfg.irBaselineRss), 'Cek');
});

test('batteryStatus priority: V bad + IR ok + SOH>80% → Tidak Layak (V worse wins)', () => {
  // V=1.9 (bad: ≤2.0), IR=0.0007 (ok), SOH=90%
  assert.equal(batteryStatus(1.9, 0.0007, 90, cfg.batasAtas, cfg.batasBawah, cfg.irBaselineRss), 'Tidak Layak');
});

test('batteryStatus priority: V warning + IR ok + SOH>80% → Cek (V worse wins)', () => {
  // V=2.3 (warning: 2.0-2.5), IR=0.0007 (ok), SOH=90%
  assert.equal(batteryStatus(2.3, 0.0007, 90, cfg.batasAtas, cfg.batasBawah, cfg.irBaselineRss), 'Cek');
});

test('batteryStatus priority: V bad + IR bad + SOH>80% → Tidak Layak', () => {
  // V=1.9 (bad), IR=0.0015 (bad), SOH=90%
  assert.equal(batteryStatus(1.9, 0.0015, 90, cfg.batasAtas, cfg.batasBawah, cfg.irBaselineRss), 'Tidak Layak');
});

test('batteryStatus priority: V ok + IR ok + SOH=80% → Cek (gate fails)', () => {
  // Everything OK but SOH exactly 80 → Cek
  assert.equal(batteryStatus(2.6, 0.0007, 80, cfg.batasAtas, cfg.batasBawah, cfg.irBaselineRss), 'Cek');
});

test('batteryStatus priority: V ok + IR ok + SOH=50% → Cek (SOH<80% defaults Cek even with good V/IR)', () => {
  assert.equal(batteryStatus(2.6, 0.0007, 50, cfg.batasAtas, cfg.batasBawah, cfg.irBaselineRss), 'Cek');
});

test('batteryStatus priority: V ok + IR bad + SOH=50% → Tidak Layak (IR bad wins over SOH<80% Cek default)', () => {
  // SOH<80% would default to Cek, but IR bad escalates to Tidak Layak
  assert.equal(batteryStatus(2.6, 0.0012, 50, cfg.batasAtas, cfg.batasBawah, cfg.irBaselineRss), 'Tidak Layak');
});

// ====================================================================
// tempClass helper (Feature 2: temperature color coding)
// ====================================================================

test('tempClass: returns temp-bad for temp >= 30', () => {
  assert.equal(tempClass(30), 'temp-bad');
  assert.equal(tempClass(35.5), 'temp-bad');
  assert.equal(tempClass(50), 'temp-bad');
  assert.equal(tempClass(100), 'temp-bad');
});

test('tempClass: returns temp-warn for 25 < temp < 30', () => {
  assert.equal(tempClass(25.1), 'temp-warn');
  assert.equal(tempClass(27), 'temp-warn');
  assert.equal(tempClass(29), 'temp-warn');
  assert.equal(tempClass(29.99), 'temp-warn');
});

test('tempClass: returns empty for temp <= 25', () => {
  assert.equal(tempClass(25), '');
  assert.equal(tempClass(20), '');
  assert.equal(tempClass(0), '');
  assert.equal(tempClass(-10), '');
});

test('tempClass: returns empty for null, undefined, NaN', () => {
  assert.equal(tempClass(null), '');
  assert.equal(tempClass(undefined), '');
  assert.equal(tempClass(NaN), '');
});

test('tempClass: returns empty for non-numeric strings (defensive)', () => {
  // parseFloat('abc') is NaN; treated like null/NaN
  assert.equal(tempClass('not a number'), '');
});

// ====================================================================
// renderRowHTML helper (extracted from renderTable; applies temp class)
// ====================================================================

const ROW_HTML_CONFIG = {
  rssCapacity: 300,
  tssErCapacity: 200,
  capacityProfile: 'RSS',
  healthyCapacity: 300,
  batasAtas: 2.5,
  batasBawah: 2.0,
  irBaselineRss: 0.00075,
  irBaselineTssEr: 0.00085,
};

test('renderRowHTML: temp-warn class for temperature 27', () => {
  const row = { id: 1, cellVoltage: 2.5, ir: 0.5, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 300, temperature: 27 };
  const html = renderRowHTML(row, ROW_HTML_CONFIG);
  assert.ok(html.includes('temp-warn'), `expected temp-warn in row HTML, got: ${html}`);
  assert.ok(!html.includes('temp-bad'), `expected no temp-bad, got: ${html}`);
  assert.ok(html.includes('value="27"'), `expected value="27", got: ${html}`);
});

test('renderRowHTML: temp-bad class for temperature 30', () => {
  const row = { id: 1, cellVoltage: 2.5, ir: 0.5, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 300, temperature: 30 };
  const html = renderRowHTML(row, ROW_HTML_CONFIG);
  assert.ok(html.includes('temp-bad'), `expected temp-bad in row HTML, got: ${html}`);
  assert.ok(!html.includes('temp-warn'), `expected no temp-warn, got: ${html}`);
});

test('renderRowHTML: no temp class for temperature 25', () => {
  const row = { id: 1, cellVoltage: 2.5, ir: 0.5, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 300, temperature: 25 };
  const html = renderRowHTML(row, ROW_HTML_CONFIG);
  assert.ok(!html.includes('temp-warn'), `expected no temp-warn for 25, got: ${html}`);
  assert.ok(!html.includes('temp-bad'), `expected no temp-bad for 25, got: ${html}`);
  // Locate the temp input element and check its class attribute
  const inputMatch = html.match(/<input[^>]*data-field="temperature"[^>]*>/);
  assert.ok(inputMatch, 'temp input found in HTML');
  assert.ok(inputMatch[0].includes('class="cell-input"'), 'class is exactly "cell-input" (no extra)');
});

test('renderRowHTML: no temp class for null temperature', () => {
  const row = { id: 1, cellVoltage: 2.5, ir: 0.5, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 300, temperature: null };
  const html = renderRowHTML(row, ROW_HTML_CONFIG);
  assert.ok(!html.includes('temp-warn'), `expected no temp-warn for null, got: ${html}`);
  assert.ok(!html.includes('temp-bad'), `expected no temp-bad for null, got: ${html}`);
});

test('renderRowHTML: includes data-row-id and data-field attributes', () => {
  const row = { id: 42, cellVoltage: 2.5, ir: 0.5, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 300, temperature: 25 };
  const html = renderRowHTML(row, ROW_HTML_CONFIG);
  assert.ok(html.includes('data-row-id="42"'), `expected data-row-id="42" in HTML`);
  assert.ok(html.includes('data-field="cellVoltage"'));
  assert.ok(html.includes('data-field="temperature"'));
});
