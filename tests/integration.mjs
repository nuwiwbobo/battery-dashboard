// tests/integration.mjs — simulate the actual browser flow
// Run: ~/.local/node20/bin/node tests/integration.mjs

// Lightweight DOM fake. innerHTML is stored as a string, dispatchEvent bubbles
// up through manually-set parent chains (we use createElement + manual parent
// in tests where bubbling is needed; for most assertions we just verify state).
class Element {
  constructor(tag, id) {
    this.tagName = tag;
    this.id = id || '';
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this._classes = new Set();
    this.classList = {
      add: (c) => this._classes.add(c),
      remove: (c) => this._classes.delete(c),
      contains: (c) => this._classes.has(c),
    };
    this.dataset = {};
    this.children = [];
    this.parent = null;
    this._listeners = {};
    this.style = {};
    this._cells = [];
    this.hidden = false;
  }
  get innerHTML() { return this._innerHTML || ''; }
  set innerHTML(v) { this._innerHTML = v; }
  focus() {}
  get className() {
    if (!this._classNameExplicit && this._classes.size > 0) {
      return Array.from(this._classes).join(' ');
    }
    return this._className || '';
  }
  set className(v) {
    this._className = v;
    this._classNameExplicit = true;
    this._classes = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  addEventListener(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }
  dispatchEvent(event) {
    let el = this;
    while (el) {
      const handlers = el._listeners[event.type] || [];
      handlers.forEach(h => h(event));
      el = el.parent;
    }
  }
  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  querySelectorAll() { return []; }
  querySelector() { return null; }
}

const elements = new Map();
const document = {
  getElementById: (id) => {
    if (!elements.has(id)) elements.set(id, new Element('div', id));
    return elements.get(id);
  },
  createElement: (tag) => new Element(tag, ''),
  addEventListener: () => {},
  querySelectorAll: () => [],
  querySelector: () => null,
};
const window = { addEventListener: () => {} };
const localStorage = {
  _data: {},
  getItem(k) { return this._data[k] || null; },
  setItem(k, v) { this._data[k] = v; },
  removeItem(k) { delete this._data[k]; },
};
const setTimeout = (fn, ms) => {};
const setInterval = (fn, ms) => ({ unref: () => {} });
const clearInterval = () => {};
const confirm = () => true;  // always accept for tests

const fs = await import('fs');
const appCode = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const wrapped = `(function(document, window, localStorage, setTimeout, setInterval, confirm) {
  ${appCode}
  return {
    getState,
    computeRowDerived,
    updateRowInPlace,
    wireEvents,
    renderConfig,
    sohPercent,
    batteryStatus,
    addDistrict,
    addRowToDistrict,
    deleteSelectedInDistrict,
    deleteDistrict,
    renameDistrict,
    renderDistricts,
    renderDistrictHTML,
    renderRowHTML,
    loadState,
    saveState,
    getRowsForDistrict,
    escapeHTML,
    parseCSV,
    rowsToCSV,
    addCSVToDistrict,
    importCSV,
    exportCSV,
    pullFromFirebase,
    pushToFirebase,
    schedulePush,
    setSyncStatus,
    isLoggedIn,
    showLogin,
    showApp,
    handleLogin,
    bootstrap,
  };
})`;
const fn = eval(wrapped);
const api = fn(document, window, localStorage, setTimeout, setInterval, confirm);
const { computeRowDerived, wireEvents, handleLogin, isLoggedIn, pullFromFirebase, pushToFirebase, schedulePush, setSyncStatus } = api;
let state = api.getState();

function refreshState() { state = api.getState(); }

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

wireEvents();

console.log('=== Test 1: Initial state ===');
assert(state.config.batasAtas === 2.5, 'batasAtas initial');
assert(state.config.batasBawah === 2, 'batasBawah initial');
assert(state.config.irBaselineRss === 0.00075, 'irBaselineRss initial');
assert(state.districts.length === 1, 'one default district');
assert(state.districts[0].name === 'Default', 'default district name');
assert(state.districts[0].rowIds[0] === 1, 'default district has sample row');

console.log('\n=== Test 2: All good → Aman ===');
state.rows = [
  { id: 1, cellVoltage: 2.6, ir: 0.0007, irUnit: 'ohm', rippleVoltage: 0.005, measuredCapacity: 280, temperature: 25 },
];
const d1 = computeRowDerived(state.rows[0], state.config);
assert(d1.status === 'Aman', 'Aman');

console.log('\n=== Test 3: V ok + IR bad → Tidak Layak (priority: IR worse wins) ===');
state.rows[0].ir = 0.0012;
state.rows[0].irUnit = 'ohm';
const d3 = computeRowDerived(state.rows[0], state.config);
assert(d3.status === 'Tidak Layak', 'Tidak Layak (IR bad)');

console.log('\n=== Test 4: V ok + IR warning → Cek (priority: IR worse wins) ===');
state.rows[0].ir = 0.0010;
const d4 = computeRowDerived(state.rows[0], state.config);
assert(d4.status === 'Cek', 'Cek (IR warning)');

console.log('\n=== Test 5: Change profile to TSS/ER → IR 1.0mΩ is now ok → Aman ===');
const profileEl = document.getElementById('config-profile');
profileEl.value = 'TSS/ER';
profileEl.dispatchEvent({ type: 'change', target: profileEl });
const d5 = computeRowDerived(state.rows[0], state.config);
assert(d5.status === 'Aman', 'Aman under TSS/ER');

console.log('\n=== Test 6: V bad → Tidak Layak regardless of IR ===');
profileEl.value = 'RSS';
profileEl.dispatchEvent({ type: 'change', target: profileEl });
state.rows[0].cellVoltage = 1.9;
state.rows[0].ir = 0.0007;
const d6 = computeRowDerived(state.rows[0], state.config);
assert(d6.status === 'Tidak Layak', 'Tidak Layak (V bad)');

console.log('\n=== Test 7: SOH=80% exactly → Cek ===');
state.rows[0].cellVoltage = 2.6;
state.rows[0].measuredCapacity = 240;
const d7 = computeRowDerived(state.rows[0], state.config);
assert(d7.status === 'Cek', 'Cek (SOH=80%)');

console.log('\n=== Test 8: SOH<80% with IR bad → Tidak Layak ===');
state.rows[0].cellVoltage = 2.6;
state.rows[0].ir = 0.0012;
state.rows[0].measuredCapacity = 100;
const d8 = computeRowDerived(state.rows[0], state.config);
assert(d8.status === 'Tidak Layak', 'Tidak Layak (IR bad + SOH<80%)');

// ====================================================================
// Feature 1: Districts
// ====================================================================

console.log('\n=== Test 9: addDistrict via add-district-btn click ===');
const addDistrictBtn = document.getElementById('add-district-btn');
addDistrictBtn.dispatchEvent({ type: 'click', target: addDistrictBtn });
assert(state.districts.length === 2, 'addDistrict adds new district');
assert(state.districts[1].rowIds.length === 0, 'new district starts empty');
assert(state.districts[1].name === 'District 2', 'new district has default name');

console.log('\n=== Test 10: addRowToDistrict adds row to specific district ===');
const initialRowCount = state.rows.length;
const district1RowCountBefore = state.districts[0].rowIds.length;
api.addRowToDistrict(1);
assert(state.rows.length === initialRowCount + 1, 'row added to state.rows');
assert(state.districts[0].rowIds.length === district1RowCountBefore + 1, 'row added to district 1 rowIds');
const newRowId = state.districts[0].rowIds[state.districts[0].rowIds.length - 1];
assert(newRowId > 0, 'new row has a positive id');
assert(state.rows.find(r => r.id === newRowId), 'new row exists in state.rows');

console.log('\n=== Test 11: addRowToDistrict to district 2 (empty) ===');
api.addRowToDistrict(2);
assert(state.districts[1].rowIds.length === 1, 'row added to district 2');

console.log('\n=== Test 12: renameDistrict updates name ===');
api.renameDistrict(1, 'Site A - 2026-07-20');
assert(state.districts[0].name === 'Site A - 2026-07-20', 'district renamed');

console.log('\n=== Test 13: renameDistrict ignores empty string ===');
api.renameDistrict(1, '   ');
assert(state.districts[0].name === 'Site A - 2026-07-20', 'empty rename ignored');

console.log('\n=== Test 14: renameDistrict fired via blur event on contenteditable ===');
// Set up: h3 with class district-name and dataset.districtId=2, attached to districts-container
const container = document.getElementById('districts-container');
const h3 = document.createElement('h3');
h3.classList.add('district-name');
h3.dataset.districtId = 2;
h3.textContent = 'Site B - 2026-07-21';
container.appendChild(h3);
h3.dispatchEvent({ type: 'blur', target: h3 });
assert(state.districts[1].name === 'Site B - 2026-07-21', 'district renamed via blur event');

console.log('\n=== Test 15: deleteDistrict removes district and its rows ===');
// District 2 has 1 row (added in Test 11). Delete it.
const rowsBefore = state.rows.length;
const district2RowIds = [...state.districts[1].rowIds];
api.deleteDistrict(2);
assert(state.districts.length === 1, 'district 2 removed');
assert(state.districts.find(d => d.id === 2) === undefined, 'district 2 not in state');
assert(state.rows.length === rowsBefore - district2RowIds.length, 'rows of deleted district removed');
assert(!state.rows.some(r => district2RowIds.includes(r.id)), 'no orphan rows remain');

console.log('\n=== Test 16: deleteDistrict with no confirm cancels ===');
// Add a district, attempt delete, then return false from confirm
const realConfirm = confirm;
globalThis.confirm = () => false;
api.addDistrict();  // district 3
assert(state.districts.length === 2, 'district 3 added');
api.deleteDistrict(3);
assert(state.districts.length === 2, 'district 3 NOT deleted when confirm=false');
globalThis.confirm = realConfirm;

// ====================================================================
// Feature 2: Temperature color coding
// ====================================================================

console.log('\n=== Test 17: renderRowHTML applies temp-warn for temp 27 ===');
const { renderRowHTML } = await import('../app.js');
const row27 = { id: 99, cellVoltage: 2.5, ir: 0.5, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 300, temperature: 27 };
const html27 = renderRowHTML(row27, 1, state.config);
assert(html27.includes('temp-warn'), 'temp-warn in HTML for 27');
assert(!html27.includes('temp-bad'), 'no temp-bad for 27');

console.log('\n=== Test 18: renderRowHTML applies temp-bad for temp 30 ===');
const row30 = { id: 99, cellVoltage: 2.5, ir: 0.5, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 300, temperature: 30 };
const html30 = renderRowHTML(row30, 1, state.config);
assert(html30.includes('temp-bad'), 'temp-bad in HTML for 30');
assert(!html30.includes('temp-warn'), 'no temp-warn for 30');

console.log('\n=== Test 19: renderRowHTML applies no temp class for temp 25 ===');
const row25 = { id: 99, cellVoltage: 2.5, ir: 0.5, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 300, temperature: 25 };
const html25 = renderRowHTML(row25, 1, state.config);
assert(!html25.includes('temp-warn'), 'no temp-warn for 25');
assert(!html25.includes('temp-bad'), 'no temp-bad for 25');
assert(html25.includes('data-field="temperature"'), 'temp input present');

console.log('\n=== Test 20: renderRowHTML applies no temp class for null ===');
const rowNull = { id: 99, cellVoltage: 2.5, ir: 0.5, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 300, temperature: null };
const htmlNull = renderRowHTML(rowNull, 1, state.config);
assert(!htmlNull.includes('temp-warn'), 'no temp-warn for null');
assert(!htmlNull.includes('temp-bad'), 'no temp-bad for null');

// ====================================================================
// Migration: loadState without districts creates default
// ====================================================================

console.log('\n=== Test 21: Migration — loaded state without districts gets default ===');
// Simulate an old-format save: no districts field
localStorage._data['battery-dashboard-state-v1'] = JSON.stringify({
  config: { capacityProfile: 'RSS', healthyCapacity: 300, batasAtas: 2.5, batasBawah: 2.0 },
  rows: [
    { id: 1, cellVoltage: 2.5, ir: 0.5, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 280, temperature: 25 },
    { id: 2, cellVoltage: 2.4, ir: 0.6, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 270, temperature: 26 },
  ],
});
api.loadState();
refreshState();
assert(state.districts.length === 1, 'one default district created');
assert(state.districts[0].name === 'Default', 'default name');
assert(state.districts[0].rowIds.length === 2, 'all rows assigned to default');
assert(state.districts[0].rowIds.includes(1), 'row id 1 in default');
assert(state.districts[0].rowIds.includes(2), 'row id 2 in default');

console.log('\n=== Test 22: Migration — stale rowIds (referencing deleted rows) are filtered ===');
localStorage._data['battery-dashboard-state-v1'] = JSON.stringify({
  config: { capacityProfile: 'RSS', healthyCapacity: 300, batasAtas: 2.5, batasBawah: 2.0 },
  rows: [
    { id: 1, cellVoltage: 2.5, ir: 0.5, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 280, temperature: 25 },
  ],
  districts: [
    { id: 1, name: 'Test', rowIds: [1, 99, 100] },  // 99, 100 don't exist
  ],
});
api.loadState();
refreshState();
assert(state.districts.length === 1, 'one district');
assert(state.districts[0].rowIds.length === 1, 'stale rowIds filtered');
assert(state.districts[0].rowIds[0] === 1, 'only valid rowId remains');

// ====================================================================
// Feature: per-district numbering
// ====================================================================

console.log('\n=== Test 23: per-district numbering — row at index 3 shows "# 3" (not global id) ===');
// Set up a 5-row district with non-sequential global ids to clearly distinguish
// the district-local index from the global id
api.loadState();  // reset to default
refreshState();
state.rows = [
  { id: 10, cellVoltage: 2.5, ir: 0.0005, irUnit: 'ohm', rippleVoltage: 0.005, measuredCapacity: 300, temperature: 25 },
  { id: 20, cellVoltage: 2.6, ir: 0.0006, irUnit: 'ohm', rippleVoltage: 0.006, measuredCapacity: 300, temperature: 25 },
  { id: 30, cellVoltage: 2.7, ir: 0.0007, irUnit: 'ohm', rippleVoltage: 0.007, measuredCapacity: 300, temperature: 25 },
  { id: 40, cellVoltage: 2.8, ir: 0.0008, irUnit: 'ohm', rippleVoltage: 0.008, measuredCapacity: 300, temperature: 25 },
  { id: 50, cellVoltage: 2.9, ir: 0.0009, irUnit: 'ohm', rippleVoltage: 0.009, measuredCapacity: 300, temperature: 25 },
];
state.districts = [{ id: 1, name: 'Site A', rowIds: [10, 20, 30, 40, 50] }];
const distContainer = document.getElementById('districts-container');
api.renderDistricts();
const distHTML = distContainer.innerHTML;
// The row with global id 30 is at district-local index 3 → should show "# 3"
const tr30 = distHTML.match(/<tr data-row-id="30">[\s\S]*?<\/tr>/);
assert(tr30, 'found row 30 tr');
const tds30 = tr30[0].match(/<td[^>]*>[\s\S]*?<\/td>/g);
assert(tds30[1].trim() === '<td>3</td>', `row 30 should show "# 3" (district-local), got: ${tds30[1]}`);
// First row (id 10) should show "# 1"
const tr10 = distHTML.match(/<tr data-row-id="10">[\s\S]*?<\/tr>/);
const tds10 = tr10[0].match(/<td[^>]*>[\s\S]*?<\/td>/g);
assert(tds10[1].trim() === '<td>1</td>', `row 10 should show "# 1", got: ${tds10[1]}`);
// Last row (id 50) should show "# 5"
const tr50 = distHTML.match(/<tr data-row-id="50">[\s\S]*?<\/tr>/);
const tds50 = tr50[0].match(/<td[^>]*>[\s\S]*?<\/td>/g);
assert(tds50[1].trim() === '<td>5</td>', `row 50 should show "# 5", got: ${tds50[1]}`);

console.log('\n=== Test 24: per-district numbering — second district starts at "# 1" ===');
// Add a new district with rows that have higher global ids
api.addDistrict();  // district 2
api.addRowToDistrict(2);  // first new row in district 2
api.addRowToDistrict(2);  // second new row in district 2
refreshState();
// First row in district 2 has whatever global id nextRowId() gave it
const d2FirstId = state.districts[1].rowIds[0];
api.renderDistricts();
const dist2HTML = distContainer.innerHTML;
const trFirst = dist2HTML.match(new RegExp(`<tr data-row-id="${d2FirstId}">[\\s\\S]*?<\\/tr>`));
assert(trFirst, `row ${d2FirstId} (first in district 2) in HTML`);
const tdsFirst = trFirst[0].match(/<td[^>]*>[\s\S]*?<\/td>/g);
assert(tdsFirst[1].trim() === '<td>1</td>', `first row in district 2 (id ${d2FirstId}) should show "# 1", got: ${tdsFirst[1]}`);
// The "#" column in district 1's first row (id 10) should still be 1 (its own district-local index)
const tr10Again = dist2HTML.match(/<tr data-row-id="10">[\s\S]*?<\/tr>/);
assert(tr10Again, 'row 10 in district 1 still rendered');
const tds10Again = tr10Again[0].match(/<td[^>]*>[\s\S]*?<\/td>/g);
assert(tds10Again[1].trim() === '<td>1</td>', `district 1 row 10 should still show "# 1"`);

// ====================================================================
// Feature: CSV import
// ====================================================================

console.log('\n=== Test 25: renderDistricts HTML includes Import/Export CSV buttons ===');
api.renderDistricts();
const buttonsHTML = distContainer.innerHTML;
assert(buttonsHTML.includes('import-csv-btn'), 'Import CSV button present');
assert(buttonsHTML.includes('export-csv-btn'), 'Export CSV button present');
assert(buttonsHTML.includes('import-csv-input'), 'hidden file input present');

console.log('\n=== Test 26: addCSVToDistrict — add rows from parsed CSV ===');
const initialRows = state.rows.length;
const initialRowIds = [...state.districts[0].rowIds];
const parsedCSV = [
  ['1', '2.5', '25', '0.0005', '300', '0.005'],
  ['2', '2.6', '26', '0.0006', '290', '0.006'],
  ['3', '2.7', '27', '0.0007', '280', '0.007'],
];
const added = api.addCSVToDistrict(1, parsedCSV);
refreshState();
assert(added === 3, '3 rows added');
assert(state.rows.length === initialRows + 3, 'state.rows has 3 more entries');
assert(state.districts[0].rowIds.length === initialRowIds.length + 3, 'district 1 has 3 more rowIds');
// Verify one of the new rows
const newRow = state.rows[state.rows.length - 1];
assert(newRow.cellVoltage === 2.7, 'last new row has cellVoltage 2.7');
assert(newRow.temperature === 27, 'last new row has temperature 27');
assert(newRow.ir === 0.0007, 'last new row has ir 0.0007');
assert(newRow.irUnit === 'ohm', 'irUnit defaults to ohm for CSV imports');
assert(newRow.measuredCapacity === 280, 'last new row has measuredCapacity 280');
assert(newRow.rippleVoltage === 0.007, 'last new row has rippleVoltage 0.007');

console.log('\n=== Test 27: addCSVToDistrict — invalid rows are skipped ===');
const stateRowsBeforeMixed = state.rows.length;
const mixedCSV = [
  ['1', '2.5', '25', '0.0005', '300', '0.005'],
  ['bad-row-only-5-cols'],     // not 6 columns, should be skipped
  null,                         // null, should be skipped
  ['2', 'abc', '26', '0.0006', '290', '0.006'],  // cellVoltage is 'abc', should still add (null)
];
const addedMixed = api.addCSVToDistrict(1, mixedCSV);
refreshState();
assert(addedMixed === 2, '2 valid rows added (bad-row and null skipped)');
// Verify the 'abc' row was added with null cellVoltage
const lastRow = state.rows[state.rows.length - 1];
assert(lastRow.cellVoltage === null, 'abc → null cellVoltage');

console.log('\n=== Test 28: rowsToCSV — exports district rows in CSV format ===');
const district1Rows = api.getRowsForDistrict(state.districts[0]);
const csv = api.rowsToCSV(district1Rows);
const lines = csv.split('\n');
assert(lines[0] === 'battery_no,cell_voltage,temperature,ir,capacity,ripple_voltage', 'header correct');
// First data line should be "1,..." (district-local 1-based)
assert(lines[1].startsWith('1,'), `first data line starts with "1,", got: ${lines[1]}`);
// All data lines start with 1, 2, 3, ... (district-local, 1-based)
lines.slice(1).forEach((line, i) => {
  assert(line.startsWith(`${i + 1},`), `line ${i+2} should start with "${i+1},", got: ${line}`);
});

console.log('\n=== Test 29: CSV roundtrip — write → export → parse → equal ===');
const originalRows = [
  { id: 1, cellVoltage: 2.5, ir: 0.0005, irUnit: 'ohm', rippleVoltage: 0.005, measuredCapacity: 300, temperature: 25 },
  { id: 2, cellVoltage: 2.6, ir: 0.0006, irUnit: 'ohm', rippleVoltage: 0.006, measuredCapacity: 290, temperature: 26 },
];
const exported = api.rowsToCSV(originalRows);
const reparsed = api.parseCSV(exported);
assert(reparsed.length === 2, 'reparsed has 2 rows');
assert(reparsed[0][0] === '1', 'reparsed[0][0] = "1" (district-local)');
assert(reparsed[0][1] === '2.5', 'reparsed[0][1] = "2.5"');
assert(reparsed[0][3] === '0.0005', 'reparsed[0][3] = "0.0005" (ohms)');
assert(reparsed[1][0] === '2', 'reparsed[1][0] = "2" (district-local)');
assert(reparsed[1][1] === '2.6', 'reparsed[1][1] = "2.6"');

// ====================================================================
// Feature: Firebase cloud sync (function existence only — fetch not stubbed in Node)
// ====================================================================

console.log('\n=== Test 30: Firebase sync functions are defined ===');
assert(typeof api.pullFromFirebase === 'function', 'pullFromFirebase is a function');
assert(typeof api.pushToFirebase === 'function', 'pushToFirebase is a function');
assert(typeof api.schedulePush === 'function', 'schedulePush is a function');
assert(typeof api.setSyncStatus === 'function', 'setSyncStatus is a function');
assert(typeof api.importCSV === 'function', 'importCSV is a function');
assert(typeof api.exportCSV === 'function', 'exportCSV is a function');
assert(typeof api.handleLogin === 'function', 'handleLogin is a function');
assert(typeof api.isLoggedIn === 'function', 'isLoggedIn is a function');
assert(typeof api.bootstrap === 'function', 'bootstrap is a function');

// ====================================================================
// Feature: Cloud sync config (Firebase DB URL instead of Gist creds)
// ====================================================================

console.log('\n=== Test 31: DEFAULT_CONFIG has cloudSync object with safe defaults ===');
// Re-read state (was reset by test 23's loadState call)
refreshState();
assert(state.config.cloudSync !== undefined, 'cloudSync object present');
assert(state.config.cloudSync.enabled === false, 'cloudSync.enabled defaults to false');
assert(state.config.cloudSync.firebaseDbUrl === '', 'cloudSync.firebaseDbUrl defaults to empty string');
// Legacy Gist fields must NOT exist on the new config shape
assert(state.config.cloudSync.gistId === undefined, 'cloudSync.gistId removed');
assert(state.config.cloudSync.gistToken === undefined, 'cloudSync.gistToken removed');

console.log('\n=== Test 32: loadState preserves cloudSync (firebaseDbUrl) from localStorage ===');
localStorage._data['battery-dashboard-state-v1'] = JSON.stringify({
  config: {
    capacityProfile: 'RSS',
    healthyCapacity: 300,
    batasAtas: 2.5,
    batasBawah: 2.0,
    cloudSync: {
      enabled: true,
      firebaseDbUrl: 'https://example-rtdb.firebaseio.com',
    },
  },
  rows: [{ id: 1, cellVoltage: 2.5, ir: 0.5, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 280, temperature: 25 }],
  districts: [{ id: 1, name: 'Test', rowIds: [1] }],
});
api.loadState();
refreshState();
assert(state.config.cloudSync.enabled === true, 'cloudSync.enabled loaded from storage');
assert(state.config.cloudSync.firebaseDbUrl === 'https://example-rtdb.firebaseio.com', 'cloudSync.firebaseDbUrl loaded from storage');

console.log('\n=== Test 33: saveState persists cloudSync (firebaseDbUrl) to localStorage ===');
api.loadState();  // reset to defaults
refreshState();
state.config.cloudSync.enabled = true;
state.config.cloudSync.firebaseDbUrl = 'https://persist-test.firebaseio.com';
api.saveState();
const persisted = JSON.parse(localStorage._data['battery-dashboard-state-v1']);
assert(persisted.config.cloudSync.enabled === true, 'cloudSync.enabled persisted');
assert(persisted.config.cloudSync.firebaseDbUrl === 'https://persist-test.firebaseio.com', 'cloudSync.firebaseDbUrl persisted');

console.log('\n=== Test 34: Toggling cloud-sync checkbox updates state ===');
api.loadState();  // reset to defaults (cloudSync.enabled = false)
refreshState();
const csEnabledEl = document.getElementById('config-cloud-sync-enabled');
csEnabledEl.checked = true;
csEnabledEl.dispatchEvent({ type: 'change', target: csEnabledEl });
assert(state.config.cloudSync.enabled === true, 'toggling checkbox ON updates state');
csEnabledEl.checked = false;
csEnabledEl.dispatchEvent({ type: 'change', target: csEnabledEl });
assert(state.config.cloudSync.enabled === false, 'toggling checkbox OFF updates state');

console.log('\n=== Test 35: Disabling cloud sync sets status to "Cloud sync disabled" ===');
api.loadState();
refreshState();
const syncStatusEl = document.getElementById('sync-status');
// After load, the bootstrap only sets status when document is defined and DOMContentLoaded
// fires. In our mock, DOMContentLoaded never fires, so the status is whatever the
// fake element started with (empty). Manually call setSyncStatus via the API and
// verify it lands on the DOM element.
api.setSyncStatus('Cloud sync disabled');
assert(syncStatusEl.textContent === 'Cloud sync disabled', 'setSyncStatus("Cloud sync disabled") reaches DOM');

console.log('\n=== Test 36: Firebase database URL input updates state on input ===');
api.loadState();
refreshState();
const csUrlEl = document.getElementById('cloud-sync-url');
csUrlEl.value = 'https://new-url.firebaseio.com';
csUrlEl.dispatchEvent({ type: 'input', target: csUrlEl });
assert(state.config.cloudSync.firebaseDbUrl === 'https://new-url.firebaseio.com', 'firebaseDbUrl input updates state');

console.log('\n=== Test 37: pullFromFirebase no-op when cloudSync is disabled ===');
api.loadState();
refreshState();
const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = () => { fetchCalls++; return Promise.resolve({ ok: true, json: async () => ({}) }); };
try {
  api.pullFromFirebase();
  assert.equal = assert;  // alias for readability
  assert(fetchCalls === 0, 'fetch NOT called when cloudSync is disabled');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('\n=== Test 38: pullFromFirebase no-op when URL is empty (even if enabled) ===');
api.loadState();
refreshState();
state.config.cloudSync.enabled = true;
state.config.cloudSync.firebaseDbUrl = '';
let fetchCalls2 = 0;
globalThis.fetch = () => { fetchCalls2++; return Promise.resolve({ ok: true, json: async () => ({}) }); };
try {
  api.pullFromFirebase();
  assert(fetchCalls2 === 0, 'fetch NOT called when URL is empty');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('\n=== Test 39: pullFromFirebase calls fetch when URL is set ===');
api.loadState();
refreshState();
state.config.cloudSync.enabled = true;
state.config.cloudSync.firebaseDbUrl = 'https://test.firebaseio.com';
let fetchCalls3 = 0;
let lastUrl = null;
globalThis.fetch = (url) => {
  fetchCalls3++;
  lastUrl = url;
  return Promise.resolve({ ok: true, json: async () => ({}) });
};
try {
  api.pullFromFirebase();
  assert(fetchCalls3 === 1, 'fetch called once');
  assert(lastUrl === 'https://test.firebaseio.com/state.json', 'fetch hits <url>/state.json');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('\n=== Test 40: pullFromFirebase updates state when remote is newer ===');
api.loadState();
refreshState();
state.config.cloudSync.enabled = true;
state.config.cloudSync.firebaseDbUrl = 'https://pull-test.firebaseio.com';
state.lastSyncedAt = '2020-01-01T00:00:00.000Z';  // old timestamp
let fetchCalls4 = 0;
globalThis.fetch = () => {
  fetchCalls4++;
  return Promise.resolve({
    ok: true,
    json: async () => ({
      version: 1,
      updatedAt: '2026-07-21T12:00:00.000Z',
      config: { capacityProfile: 'TSS/ER', healthyCapacity: 200, batasAtas: 2.5, batasBawah: 2.0 },
      districts: [{ id: 99, name: 'RemoteDistrict', rowIds: [] }],
      rows: [{ id: 77, cellVoltage: 1.5, ir: 0.001, irUnit: 'ohm', rippleVoltage: 0.01, measuredCapacity: 100, temperature: 40 }],
    }),
  });
};
try {
  await api.pullFromFirebase();
  assert(fetchCalls4 === 1, 'fetch called');
  refreshState();
  assert(state.lastSyncedAt === '2026-07-21T12:00:00.000Z', 'lastSyncedAt updated to remote');
  assert(state.districts.length === 1 && state.districts[0].name === 'RemoteDistrict', 'districts replaced from remote');
  assert(state.rows.length === 1 && state.rows[0].id === 77, 'rows replaced from remote');
  assert(state.config.capacityProfile === 'TSS/ER', 'config updated from remote');
} finally {
  globalThis.fetch = originalFetch;
}

// ====================================================================
// Feature: Login screen
// ====================================================================

console.log('\n=== Test 41: isLoggedIn is false initially (no localStorage entry) ===');
localStorage._data = {};  // clear auth
api.loadState();
refreshState();
assert(api.isLoggedIn() === false, 'isLoggedIn() returns false with no entry');

console.log('\n=== Test 42: isLoggedIn is true after correct login ===');
localStorage._data = {};
const userEl = document.getElementById('login-username');
const passEl = document.getElementById('login-password');
const errEl = document.getElementById('login-error');
userEl.value = 'admin';
passEl.value = 'battery2026';
api.handleLogin({ preventDefault: () => {} });
assert(api.isLoggedIn() === true, 'isLoggedIn() is true after correct login');
assert(localStorage._data['battery-dashboard-auth'] === 'ok', 'auth stored in localStorage');

console.log('\n=== Test 42b: handleLogin calls preventDefault when event is provided ===');
let preventDefaultCalled = false;
api.handleLogin({ preventDefault: () => { preventDefaultCalled = true; }, stopPropagation: () => {} });
assert(preventDefaultCalled, 'preventDefault was called on the event');

console.log('\n=== Test 43: isLoggedIn stays false after wrong password (error shown) ===');
localStorage._data = {};
errEl.hidden = true;
errEl.textContent = '';
userEl.value = 'admin';
passEl.value = 'wrong';
api.handleLogin({ preventDefault: () => {} });
assert(api.isLoggedIn() === false, 'isLoggedIn stays false after wrong password');
assert(errEl.hidden === false, 'login-error is shown');
assert(errEl.textContent === 'Invalid username or password', 'error message set');

console.log('\n=== Test 44: isLoggedIn stays false after wrong username ===');
localStorage._data = {};
errEl.hidden = true;
userEl.value = 'not-admin';
passEl.value = 'battery2026';
api.handleLogin({ preventDefault: () => {} });
assert(api.isLoggedIn() === false, 'isLoggedIn stays false after wrong username');

console.log('\n=== Test 45: showLogin hides app-content and shows overlay ===');
localStorage._data = {};
api.showLogin();
const overlay = document.getElementById('login-overlay');
const app = document.getElementById('app-content');
assert(overlay.hidden === false, 'login overlay visible after showLogin');
assert(app.hidden === true, 'app content hidden after showLogin');

console.log('\n=== Test 46: showApp shows app-content and hides overlay ===');
api.showApp();
assert(document.getElementById('login-overlay').hidden === true, 'overlay hidden after showApp');
assert(document.getElementById('app-content').hidden === false, 'app content visible after showApp');

console.log('\nAll integration tests PASSED');
