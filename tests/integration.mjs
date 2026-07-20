// tests/integration.mjs — simulate the actual browser flow
// Run: ~/.local/node20/bin/node tests/integration.mjs

class Element {
  constructor(tag, id) {
    this.tagName = tag;
    this.id = id || '';
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.classList = { add: (c) => { this._classes = (this._classes || new Set()); this._classes.add(c); }, remove: (c) => { if (this._classes) this._classes.delete(c); } };
    this.dataset = {};
    this.children = [];
    this.parent = null;
    this._listeners = {};
    this.style = {};
    this._cells = [];
    this.hidden = false;
  }
  addEventListener(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }
  dispatchEvent(event) {
    const handlers = this._listeners[event.type] || [];
    handlers.forEach(h => h(event));
  }
  appendChild(child) {
    child.parent = this;
    this.children.push(child);
  }
  set className(v) { this._className = v; }
  get className() { return this._className; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
}

const elements = new Map();
const document = {
  getElementById: (id) => {
    if (!elements.has(id)) elements.set(id, new Element('div', id));
    return elements.get(id);
  },
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

const fs = await import('fs');
const appCode = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const wrapped = `(function(document, window, localStorage, setTimeout) {
  ${appCode}
  return { state, computeRowDerived, updateRowInPlace, wireEvents, renderConfig, sohPercent, batteryStatus };
})`;
const fn = eval(wrapped);
const { state, computeRowDerived, updateRowInPlace, wireEvents, renderConfig, sohPercent, batteryStatus } = fn(document, window, localStorage, setTimeout);

wireEvents();

console.log('=== Test 1: Initial state ===');
console.log('batasAtas:', state.config.batasAtas);
console.log('batasBawah:', state.config.batasBawah);
console.log('irBaselineRss:', state.config.irBaselineRss);

console.log('\n=== Test 2: All good → Aman ===');
state.rows = [
  { id: 1, cellVoltage: 2.6, ir: 0.0007, irUnit: 'ohm', rippleVoltage: 0.005, measuredCapacity: 280, temperature: 25 },
];
const d1 = computeRowDerived(state.rows[0], state.config);
console.log('Row 1 status:', d1.status, '(V=2.6 ok, IR=0.7mΩ ok, SOH=93% > 80% → Aman)');
if (d1.status !== 'Aman') {
  console.error('FAIL: expected Aman');
  process.exit(1);
}

console.log('\n=== Test 3: V ok + IR bad → Tidak Layak (priority: IR worse wins) ===');
// RSS baseline 0.00075, 150% = 0.001125. Use IR 0.0012.
state.rows[0].ir = 0.0012;
state.rows[0].irUnit = 'ohm';
const d3 = computeRowDerived(state.rows[0], state.config);
console.log('Row 1 status with IR=1.2mΩ (bad) and V=2.6 (ok):', d3.status, '(V ok, IR bad → Tidak Layak)');
if (d3.status !== 'Tidak Layak') {
  console.error('FAIL: expected Tidak Layak (IR bad wins over V ok)');
  process.exit(1);
}

console.log('\n=== Test 4: V ok + IR warning → Cek (priority: IR worse wins) ===');
// IR 0.0010 is in warning range (0.0009-0.001125)
state.rows[0].ir = 0.0010;
const d4 = computeRowDerived(state.rows[0], state.config);
console.log('Row 1 status with IR=1.0mΩ (warning):', d4.status, '(V ok, IR warning → Cek)');
if (d4.status !== 'Cek') {
  console.error('FAIL: expected Cek (IR warning wins over V ok)');
  process.exit(1);
}

console.log('\n=== Test 5: Change profile to TSS/ER → IR 1.0mΩ is now ok → Aman ===');
const profileEl = document.getElementById('config-profile');
profileEl.value = 'TSS/ER';
profileEl.dispatchEvent({ type: 'change', target: profileEl });
// TSS/ER baseline 0.00085, 120% = 0.00102. IR 0.0010 < 0.00102 → ok.
const d5 = computeRowDerived(state.rows[0], state.config);
console.log('Row 1 status with TSS/ER profile (IR=1.0mΩ now ok):', d5.status);
if (d5.status !== 'Aman') {
  console.error('FAIL: expected Aman under TSS/ER baseline');
  process.exit(1);
}

console.log('\n=== Test 6: V bad → Tidak Layak regardless of IR ===');
profileEl.value = 'RSS';
profileEl.dispatchEvent({ type: 'change', target: profileEl });
state.rows[0].cellVoltage = 1.9;  // below batas_bawah 2.0
state.rows[0].ir = 0.0007;       // IR ok
const d6 = computeRowDerived(state.rows[0], state.config);
console.log('Row 1 status with V=1.9 (bad), IR ok:', d6.status);
if (d6.status !== 'Tidak Layak') {
  console.error('FAIL: expected Tidak Layak (V bad wins)');
  process.exit(1);
}

console.log('\n=== Test 7: SOH=80% exactly → Cek ===');
state.rows[0].cellVoltage = 2.6;
state.rows[0].measuredCapacity = 240;  // 240/300 = 80%
const d7 = computeRowDerived(state.rows[0], state.config);
console.log('Row 1 status with SOH=80%:', d7.status);
if (d7.status !== 'Cek') {
  console.error('FAIL: expected Cek for SOH=80%');
  process.exit(1);
}

console.log('\n=== Test 8: SOH<80% with IR bad → Tidak Layak (bad escalates over SOH default) ===');
state.rows[0].cellVoltage = 2.6;
state.rows[0].ir = 0.0012;       // bad
state.rows[0].measuredCapacity = 100;  // 33% SOH
const d8 = computeRowDerived(state.rows[0], state.config);
console.log('Row 1 status with SOH=33%, IR bad:', d8.status);
if (d8.status !== 'Tidak Layak') {
  console.error('FAIL: expected Tidak Layak (IR bad escalates over SOH Cek default)');
  process.exit(1);
}

console.log('\nAll integration tests PASSED');
