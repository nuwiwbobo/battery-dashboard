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
const confirm = () => true;  // always accept for tests

const fs = await import('fs');
const appCode = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const wrapped = `(function(document, window, localStorage, setTimeout, confirm) {
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
    loadState,
    saveState,
    getRowsForDistrict,
    escapeHTML,
  };
})`;
const fn = eval(wrapped);
const api = fn(document, window, localStorage, setTimeout, confirm);
const { computeRowDerived, wireEvents } = api;
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
const html27 = renderRowHTML(row27, state.config);
assert(html27.includes('temp-warn'), 'temp-warn in HTML for 27');
assert(!html27.includes('temp-bad'), 'no temp-bad for 27');

console.log('\n=== Test 18: renderRowHTML applies temp-bad for temp 30 ===');
const row30 = { id: 99, cellVoltage: 2.5, ir: 0.5, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 300, temperature: 30 };
const html30 = renderRowHTML(row30, state.config);
assert(html30.includes('temp-bad'), 'temp-bad in HTML for 30');
assert(!html30.includes('temp-warn'), 'no temp-warn for 30');

console.log('\n=== Test 19: renderRowHTML applies no temp class for temp 25 ===');
const row25 = { id: 99, cellVoltage: 2.5, ir: 0.5, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 300, temperature: 25 };
const html25 = renderRowHTML(row25, state.config);
assert(!html25.includes('temp-warn'), 'no temp-warn for 25');
assert(!html25.includes('temp-bad'), 'no temp-bad for 25');
assert(html25.includes('data-field="temperature"'), 'temp input present');

console.log('\n=== Test 20: renderRowHTML applies no temp class for null ===');
const rowNull = { id: 99, cellVoltage: 2.5, ir: 0.5, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 300, temperature: null };
const htmlNull = renderRowHTML(rowNull, state.config);
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

console.log('\nAll integration tests PASSED');
