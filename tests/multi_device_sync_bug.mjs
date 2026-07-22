// Test for multi-device sync bug: data deletion when two devices have different data
// This test reproduces the bug where Device B's local data is lost when pulling from Firebase

// Mock browser environment
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
  focus() {}
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
const setInterval = (fn, ms) => ({ unref: () => {} });
const confirm = () => true;

const fs = await import('fs');
const appCode = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const wrapped = `(function(document, window, localStorage, setTimeout, setInterval, confirm) {
  ${appCode}
  return {
    state, getState, setState, loadState, saveState,
    pullFromFirebase, pushToFirebase, schedulePush, markStateModified, setSyncStatus,
    DEFAULT_CONFIG,
  };
})`;
const fn = eval(wrapped);
const api = fn(document, window, localStorage, setTimeout, setInterval, confirm);
const {
  getState, setState, loadState, pullFromFirebase, pushToFirebase, markStateModified,
  DEFAULT_CONFIG,
} = api;

let assertCount = 0;
function assert(cond, msg) {
  assertCount++;
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

// ====================================================================
// Test: Two devices with different data - Device B should not lose local data
// ====================================================================

async function runTest() {
console.log('\n=== Test: Multi-device sync preserves local data ===');

// Scenario: Device B has local data (rows 3,4), Firebase has Device A's data (rows 1,2)
// Expected: After pull, Device B should have BOTH sets of data (merged), not just Device A's

// Step 1: Set up Device B's local state in localStorage (simulating a device that has been used before)
const deviceBLocalData = {
  config: { ...DEFAULT_CONFIG },
  rows: [
    { id: 1, cellVoltage: 3.3, ir: 0.3, irUnit: 'mohm', rippleVoltage: 0.003, measuredCapacity: null, temperature: null },
    { id: 2, cellVoltage: 4.4, ir: 0.4, irUnit: 'mohm', rippleVoltage: 0.004, measuredCapacity: null, temperature: null },
  ],
  districts: [{ id: 1, name: 'Device B District', rowIds: [1, 2] }],
  lastSyncedAt: null, // Never synced before
};
localStorage.setItem('battery-dashboard-state-v1', JSON.stringify(deviceBLocalData));

// Load state from localStorage (this initializes localBaselineState)
loadState();

// Step 2: Mock Firebase to return Device A's data (different rows with different IDs)
const deviceAFirebaseData = {
  version: 1,
  updatedAt: '2099-01-01T00:00:00.000Z', // Newer than Device B's lastSyncedAt (null)
  config: { ...DEFAULT_CONFIG },
  rows: [
    { id: 3, cellVoltage: 1.1, ir: 0.1, irUnit: 'mohm', rippleVoltage: 0.001, measuredCapacity: null, temperature: null },
    { id: 4, cellVoltage: 2.2, ir: 0.2, irUnit: 'mohm', rippleVoltage: 0.002, measuredCapacity: null, temperature: null },
  ],
  districts: [{ id: 2, name: 'Device A District', rowIds: [3, 4] }],
};

const originalFetch = globalThis.fetch;
globalThis.fetch = (url) => {
  if (url.includes('/state.json')) {
    return Promise.resolve({
      ok: true,
      json: async () => deviceAFirebaseData,
    });
  }
  return Promise.resolve({ ok: true, json: async () => null });
};

// Step 3: Pull from Firebase (simulating Device B's first sync)
await pullFromFirebase();

// Step 4: Verify Device B's local data is preserved
const stateAfterPull = getState();

console.log(`\nState after pull:`);
console.log(`  Rows count: ${stateAfterPull.rows.length}`);
console.log(`  Row IDs: ${stateAfterPull.rows.map(r => r.id).join(', ')}`);

// BUG: Currently, Device B's rows [3,4] are LOST because pullFromFirebase()
// takes the "No local changes, safe to replace entirely" path (line 398-409)
// which REPLACES state.rows with remote.rows (Device A's rows [1,2]).

// Expected: Should have all 4 rows (merged)
assert(stateAfterPull.rows.length === 4, 'Should have 4 rows after merge (2 from Device A + 2 from Device B)');
assert(stateAfterPull.rows.some(r => r.id === 3), 'Should have Device A row 3');
assert(stateAfterPull.rows.some(r => r.id === 4), 'Should have Device A row 4');
assert(stateAfterPull.rows.some(r => r.id === 1), 'Should have Device B row 1 (NOT DELETED)');
assert(stateAfterPull.rows.some(r => r.id === 2), 'Should have Device B row 2 (NOT DELETED)');

// Step 5: Verify districts are also merged
assert(stateAfterPull.districts.length === 2, 'Should have 2 districts (one from each device)');
assert(stateAfterPull.districts.some(d => d.name === 'Device A District'), 'Should have Device A district');
assert(stateAfterPull.districts.some(d => d.name === 'Device B District'), 'Should have Device B district');

console.log(`\nAll ${assertCount} assertions passed!`);

globalThis.fetch = originalFetch;
}

runTest().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
