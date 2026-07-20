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

console.log('\n=== Test 2: Set up a row, verify battery status ===');
state.rows = [
  { id: 1, cellVoltage: 2.6, ir: 0.0007, irUnit: 'mohm', rippleVoltage: 0.005, measuredCapacity: 280, temperature: 25 },
];
const d1 = computeRowDerived(state.rows[0], state.config);
console.log('Row 1 status:', d1.status, '(expected Aman: V=2.6 > 2.5, SOH=93.3% > 80%)');
if (d1.status !== 'Aman') {
  console.error('FAIL: expected Aman');
  process.exit(1);
}

console.log('\n=== Test 3: Change batas atas to 2.7, status should update ===');
const atasEl = document.getElementById('config-batas-atas');
atasEl.value = '2.7';
atasEl.dispatchEvent({ type: 'input', target: atasEl });
const d2 = computeRowDerived(state.rows[0], state.config);
console.log('Row 1 status after batas_atas=2.7:', d2.status, '(V=2.6 now in warning, but IR=0.0007 still OK → OR → Aman)');
if (d2.status !== 'Aman') {
  console.error('FAIL: expected Aman (OR of V/IR means one OK is enough)');
  process.exit(1);
}

console.log('\n=== Test 4: Change IR to 0.0010Ω (=1mΩ, >120% of 0.00075=0.0009) ===');
state.rows[0].ir = 0.0010;
state.rows[0].irUnit = 'ohm';  // 0.0010 Ω = 1 mΩ
const d3 = computeRowDerived(state.rows[0], state.config);
console.log('Row 1 status with IR=1mΩ:', d3.status, '(V warning, IR warning → Cek)');
if (d3.status !== 'Cek') {
  console.error('FAIL: expected Cek');
  process.exit(1);
}

console.log('\n=== Test 5: Change profile to TSS/ER, IR=0.0010 now < 120% of 0.00085*1.2=0.00102 ===');
const profileEl = document.getElementById('config-profile');
profileEl.value = 'TSS/ER';
profileEl.dispatchEvent({ type: 'change', target: profileEl });
const d4 = computeRowDerived(state.rows[0], state.config);
console.log('Row 1 status with TSS/ER profile:', d4.status, '(expected Aman: IR 0.0010 < 0.00102 in TSS/ER, V still warning but IR OK → Aman)');
if (d4.status !== 'Aman') {
  console.error('FAIL: expected Aman under TSS/ER baseline');
  process.exit(1);
}

console.log('\n=== Test 6: SOH exactly 80% → Cek ===');
state.rows[0].measuredCapacity = 240;  // 240/300 = 80%
const d5 = computeRowDerived(state.rows[0], state.config);
console.log('Row 1 status with SOH=80%:', d5.status, '(expected Cek: SOH=80% is not >80%, defaults to Cek)');
if (d5.status !== 'Cek') {
  console.error('FAIL: expected Cek for SOH=80%');
  process.exit(1);
}

console.log('\nAll integration tests PASSED');
