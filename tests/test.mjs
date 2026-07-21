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
  parseCSV,
  rowsToCSV,
  parseNumberOrNull,
  pullFromGist,
  pushToGist,
  schedulePush,
  setSyncStatus,
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
  const html = renderRowHTML(row, 1, ROW_HTML_CONFIG);
  assert.ok(html.includes('temp-warn'), `expected temp-warn in row HTML, got: ${html}`);
  assert.ok(!html.includes('temp-bad'), `expected no temp-bad, got: ${html}`);
  assert.ok(html.includes('value="27"'), `expected value="27", got: ${html}`);
});

test('renderRowHTML: temp-bad class for temperature 30', () => {
  const row = { id: 1, cellVoltage: 2.5, ir: 0.5, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 300, temperature: 30 };
  const html = renderRowHTML(row, 1, ROW_HTML_CONFIG);
  assert.ok(html.includes('temp-bad'), `expected temp-bad in row HTML, got: ${html}`);
  assert.ok(!html.includes('temp-warn'), `expected no temp-warn, got: ${html}`);
});

test('renderRowHTML: no temp class for temperature 25', () => {
  const row = { id: 1, cellVoltage: 2.5, ir: 0.5, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 300, temperature: 25 };
  const html = renderRowHTML(row, 1, ROW_HTML_CONFIG);
  assert.ok(!html.includes('temp-warn'), `expected no temp-warn for 25, got: ${html}`);
  assert.ok(!html.includes('temp-bad'), `expected no temp-bad for 25, got: ${html}`);
  // Locate the temp input element and check its class attribute
  const inputMatch = html.match(/<input[^>]*data-field="temperature"[^>]*>/);
  assert.ok(inputMatch, 'temp input found in HTML');
  assert.ok(inputMatch[0].includes('class="cell-input"'), 'class is exactly "cell-input" (no extra)');
});

test('renderRowHTML: no temp class for null temperature', () => {
  const row = { id: 1, cellVoltage: 2.5, ir: 0.5, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 300, temperature: null };
  const html = renderRowHTML(row, 1, ROW_HTML_CONFIG);
  assert.ok(!html.includes('temp-warn'), `expected no temp-warn for null, got: ${html}`);
  assert.ok(!html.includes('temp-bad'), `expected no temp-bad for null, got: ${html}`);
});

test('renderRowHTML: includes data-row-id and data-field attributes', () => {
  const row = { id: 42, cellVoltage: 2.5, ir: 0.5, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 300, temperature: 25 };
  const html = renderRowHTML(row, 1, ROW_HTML_CONFIG);
  assert.ok(html.includes('data-row-id="42"'), `expected data-row-id="42" in HTML`);
  assert.ok(html.includes('data-field="cellVoltage"'));
  assert.ok(html.includes('data-field="temperature"'));
});

// ====================================================================
// Per-district numbering (Feature: "#" column uses district-local index)
// ====================================================================

test('renderRowHTML: # column shows district-local index, not global row.id', () => {
  // global id is 7 (would have been #7 in old code); district index is 3 (1-based)
  const row = { id: 7, cellVoltage: 2.5, ir: 0.5, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 300, temperature: 25 };
  const html = renderRowHTML(row, 3, ROW_HTML_CONFIG);
  // The "#" column is the second <td> in the row
  const tr = html.match(/<tr[^>]*>([\s\S]*)<\/tr>/);
  assert.ok(tr, 'found <tr>');
  const tds = tr[1].match(/<td[^>]*>[\s\S]*?<\/td>/g);
  assert.ok(tds && tds.length >= 2, 'found tds');
  assert.equal(tds[1].trim(), '<td>3</td>', '# column should be district-local index');
  assert.ok(html.includes('data-row-id="7"'), 'data-row-id still uses global id');
});

test('renderRowHTML: # column with district index 1 shows "1"', () => {
  const row = { id: 100, cellVoltage: 2.5, ir: 0.5, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 300, temperature: 25 };
  const html = renderRowHTML(row, 1, ROW_HTML_CONFIG);
  const tr = html.match(/<tr[^>]*>([\s\S]*)<\/tr>/);
  const tds = tr[1].match(/<td[^>]*>[\s\S]*?<\/td>/g);
  assert.equal(tds[1].trim(), '<td>1</td>', '# column = 1');
});

test('renderRowHTML: # column falls back to row.id when districtIndex invalid', () => {
  const row = { id: 42, cellVoltage: 2.5, ir: 0.5, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 300, temperature: 25 };
  const html = renderRowHTML(row, 0, ROW_HTML_CONFIG);
  const tr = html.match(/<tr[^>]*>([\s\S]*)<\/tr>/);
  const tds = tr[1].match(/<td[^>]*>[\s\S]*?<\/td>/g);
  assert.equal(tds[1].trim(), '<td>42</td>', 'fallback to row.id when districtIndex=0');
});

// ====================================================================
// CSV import/export
// ====================================================================

test('parseCSV: skips header, returns trimmed cells', () => {
  const csv = 'battery_no,cell_voltage,temperature,ir,capacity,ripple_voltage\n1,2.5,25,0.000563,300,0.005\n2,2.6,26,0.0006,290,0.006';
  const rows = parseCSV(csv);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ['1', '2.5', '25', '0.000563', '300', '0.005']);
  assert.deepEqual(rows[1], ['2', '2.6', '26', '0.0006', '290', '0.006']);
});

test('parseCSV: skips empty lines', () => {
  const csv = 'header\n1,2,3,4,5,6\n\n7,8,9,10,11,12\n';
  const rows = parseCSV(csv);
  assert.equal(rows.length, 2);
});

test('parseCSV: returns empty array for empty input', () => {
  assert.deepEqual(parseCSV(''), []);
  assert.deepEqual(parseCSV('\n\n\n'), []);
});

test('parseCSV: only header returns empty array', () => {
  const csv = 'battery_no,cell_voltage,temperature,ir,capacity,ripple_voltage';
  assert.deepEqual(parseCSV(csv), []);
});

test('parseCSV: trims whitespace from each cell', () => {
  const csv = 'header\n  1 , 2.5 , 25 , 0.000563 , 300 , 0.005 ';
  const rows = parseCSV(csv);
  assert.deepEqual(rows[0], ['1', '2.5', '25', '0.000563', '300', '0.005']);
});

test('parseNumberOrNull: parses numbers', () => {
  assert.equal(parseNumberOrNull('2.5'), 2.5);
  assert.equal(parseNumberOrNull('0.000563'), 0.000563);
  assert.equal(parseNumberOrNull('-3.14'), -3.14);
});

test('parseNumberOrNull: handles comma decimal separator', () => {
  assert.equal(parseNumberOrNull('2,5'), 2.5);
  assert.equal(parseNumberOrNull('0,000563'), 0.000563);
});

test('parseNumberOrNull: returns null for empty/invalid', () => {
  assert.equal(parseNumberOrNull(''), null);
  assert.equal(parseNumberOrNull(null), null);
  assert.equal(parseNumberOrNull(undefined), null);
  assert.equal(parseNumberOrNull('abc'), null);
  assert.equal(parseNumberOrNull('   '), null);
});

test('rowsToCSV: emits header and 1-based battery_no', () => {
  const rows = [
    { id: 7, cellVoltage: 2.5, ir: 0.000563, irUnit: 'ohm', rippleVoltage: 0.005, measuredCapacity: 300, temperature: 25 },
    { id: 8, cellVoltage: 2.6, ir: 0.0006, irUnit: 'ohm', rippleVoltage: 0.006, measuredCapacity: 290, temperature: 26 },
  ];
  const csv = rowsToCSV(rows);
  const lines = csv.split('\n');
  assert.equal(lines[0], 'battery_no,cell_voltage,temperature,ir,capacity,ripple_voltage');
  assert.equal(lines[1], '1,2.5,25,0.000563,300,0.005');
  assert.equal(lines[2], '2,2.6,26,0.0006,290,0.006');
});

test('rowsToCSV: converts mohm to ohms in IR column', () => {
  // 0.5 mΩ = 0.0005 Ω (clean float conversion, avoids 0.563/1000 = 0.0005629999... precision issues)
  const rows = [
    { id: 1, cellVoltage: 2.5, ir: 0.5, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 300, temperature: 25 },
  ];
  const csv = rowsToCSV(rows);
  const lines = csv.split('\n');
  assert.equal(lines[1], '1,2.5,25,0.0005,300,0.005');
});

test('rowsToCSV: mohm → ohms is approximately correct for non-clean values', () => {
  // Verify the conversion happens (within float precision tolerance)
  const rows = [
    { id: 1, cellVoltage: 2.5, ir: 0.563, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 300, temperature: 25 },
  ];
  const csv = rowsToCSV(rows);
  const lines = csv.split('\n');
  const irField = parseFloat(lines[1].split(',')[3]);
  assert.ok(Math.abs(irField - 0.000563) < 1e-12, `IR should be ~0.000563, got ${irField}`);
});

test('rowsToCSV: empty values become empty strings', () => {
  const rows = [
    { id: 1, cellVoltage: null, ir: null, irUnit: 'mohm', rippleVoltage: null, measuredCapacity: null, temperature: null },
  ];
  const csv = rowsToCSV(rows);
  const lines = csv.split('\n');
  assert.equal(lines[1], '1,,,,,');
});

test('CSV roundtrip: write rows → export → parse → equivalent', () => {
  const original = [
    { id: 1, cellVoltage: 2.2338, ir: 0.563, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 280, temperature: 25 },
    { id: 2, cellVoltage: 2.1978, ir: 0.7812, irUnit: 'mohm', rippleVoltage: 0.1171, measuredCapacity: 270, temperature: 27 },
    { id: 3, cellVoltage: 2.5, ir: null, irUnit: 'mohm', rippleVoltage: 0.01, measuredCapacity: 300, temperature: null },
  ];
  const csv = rowsToCSV(original);
  const parsed = parseCSV(csv);
  assert.equal(parsed.length, 3);

  // Round-tripped first row
  assert.equal(parseNumberOrNull(parsed[0][1]), original[0].cellVoltage);
  assert.equal(parseNumberOrNull(parsed[0][2]), original[0].temperature);
  // IR is stored in ohms, so mohm/1000 = ohm
  assert.equal(parseNumberOrNull(parsed[0][3]), original[0].ir / 1000);
  assert.equal(parseNumberOrNull(parsed[0][4]), original[0].measuredCapacity);
  assert.equal(parseNumberOrNull(parsed[0][5]), original[0].rippleVoltage);

  // Third row has null IR — should be empty string in CSV, null after parse
  assert.equal(parsed[2][3], '');
  assert.equal(parseNumberOrNull(parsed[2][3]), null);
});

// ====================================================================
// Gist cloud sync (Feature 3) — function existence and graceful no-op
// ====================================================================

test('pullFromGist: defined and does not throw when fetch is undefined', async () => {
  assert.equal(typeof pullFromGist, 'function');
  // Without fetch, pullFromGist should be a no-op (return undefined, not throw)
  await pullFromGist();
});

test('pushToGist: defined and does not throw when fetch is undefined', async () => {
  assert.equal(typeof pushToGist, 'function');
  await pushToGist();
});

test('schedulePush: defined and does not throw when setTimeout is undefined', () => {
  assert.equal(typeof schedulePush, 'function');
  schedulePush();
});

test('setSyncStatus: defined and is a no-op when document is undefined', () => {
  assert.equal(typeof setSyncStatus, 'function');
  setSyncStatus('test');
});

// ====================================================================
// Cloud sync config gating — when disabled or credentials missing, the
// sync functions must be a safe no-op (do not call fetch, do not throw).
// ====================================================================

test('pullFromGist: no-op when cloudSync is disabled (does not call fetch)', async () => {
  // Install a fetch spy; the function should return before ever using it.
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => { fetchCalls++; return Promise.resolve({ ok: true, json: () => ({}) }); };
  try {
    // The module's `state` is initialized with cloudSync.enabled = false,
    // so the first guard fires and the function returns immediately.
    const result = await pullFromGist();
    assert.equal(result, undefined, 'returns undefined when disabled');
    assert.equal(fetchCalls, 0, 'fetch was not called when cloudSync is disabled');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('pushToGist: no-op when cloudSync is disabled (does not call fetch)', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => { fetchCalls++; return Promise.resolve({ ok: true }); };
  try {
    const result = await pushToGist();
    assert.equal(result, undefined, 'returns undefined when disabled');
    assert.equal(fetchCalls, 0, 'fetch was not called when cloudSync is disabled');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
