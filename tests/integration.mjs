// tests/integration.mjs — simulate the actual browser flow
// Run: ~/.local/node20/bin/node tests/integration.mjs

// Minimal DOM stub
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

// Load app.js as if it were a script
const fs = await import('fs');
const appCode = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
// Strip the bootstrap block (it would try to run on import)
// Actually, the bootstrap just adds an event listener to DOMContentLoaded, so it should be safe.

// Use a Function constructor to run app.js with our globals
const wrapped = `(function(document, window, localStorage, setTimeout) {
  ${appCode}
  return { state, computeRowDerived, updateRowInPlace, wireEvents, renderConfig, sohPercent };
})`;
const fn = eval(wrapped);
const { state, computeRowDerived, updateRowInPlace, wireEvents, renderConfig, sohPercent } = fn(document, window, localStorage, setTimeout);

// Manually call wireEvents since we don't trigger DOMContentLoaded in the test
wireEvents();

// Now simulate user flow
console.log('=== Test 1: Initial state ===');
console.log('Reference voltage:', state.config.referenceVoltage);

// Simulate setting a row's voltage
state.rows = [
  { id: 1, cellVoltage: 1.9, ir: 0.563, irUnit: 'mohm', rippleVoltage: 0.005 },
  { id: 2, cellVoltage: 2.5, ir: 0.5, irUnit: 'mohm', rippleVoltage: 0.05 },
];

// Simulate the reference voltage input change
console.log('\n=== Test 2: User changes reference voltage to 2.25 ===');
const refInput = document.getElementById('config-reference');
refInput.value = '2.25';
console.log('refInput.value before dispatch:', refInput.value);
console.log('refInput.classList before dispatch:', Array.from(refInput.classList));
refInput.dispatchEvent({ type: 'input', target: refInput });
console.log('refInput.value after dispatch:', refInput.value);
console.log('refInput.classList after dispatch:', Array.from(refInput.classList));
console.log('State config after input:', state.config.referenceVoltage);
console.log('Row 1 vDev:', computeRowDerived(state.rows[0], state.config).vDev);
console.log('Expected row 1 vDev: 1.9 - 2.25 =', 1.9 - 2.25);

const actual = computeRowDerived(state.rows[0], state.config).vDev;
const expected = 1.9 - 2.25;
if (Math.abs(actual - expected) > 1e-9) {
  console.error('FAIL: state.config.referenceVoltage update or compute is broken');
  process.exit(1);
} else {
  console.log('PASS: vDev correctly reflects new reference voltage');
}

console.log('\n=== Test 3: SOH calculation ===');
// Simulate setting measured capacity and temperature
state.rows[0].measuredCapacity = 240;  // 80% of 300 healthy
state.rows[0].temperature = 25.5;
const d = computeRowDerived(state.rows[0], state.config);
console.log('Row 1 SOH:', d.soh, '(expected 80)');
console.log('Row 1 temperature:', d.temperature, '(expected 25.5)');
if (Math.abs(d.soh - 80) > 1e-9) {
  console.error('FAIL: SOH not computed correctly');
  process.exit(1);
}
if (d.temperature !== 25.5) {
  console.error('FAIL: temperature not passed through');
  process.exit(1);
}
console.log('PASS: SOH and temperature work correctly');

console.log('\n=== Test 4: healthyCapacity change updates SOH ===');
const healthyEl = document.getElementById('config-healthy');
healthyEl.value = '200';
healthyEl.dispatchEvent({ type: 'input', target: healthyEl });
const d2 = computeRowDerived(state.rows[0], state.config);
console.log('State config healthyCapacity:', state.config.healthyCapacity);
console.log('Row 1 SOH (240/200):', d2.soh, '(expected 120)');
if (Math.abs(d2.soh - 120) > 1e-9) {
  console.error('FAIL: SOH did not update on healthyCapacity change');
  process.exit(1);
}
console.log('PASS: SOH updates when healthyCapacity changes');
