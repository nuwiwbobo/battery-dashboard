// tests/profile_change_dom.mjs — verify the change handler updates rows
// Run: ~/.local/node20/bin/node tests/profile_change_dom.mjs

// Stub minimal DOM
const elements = new Map();
class Element {
  constructor(id) {
    this.id = id;
    this.value = '';
    this.classList = { add: () => {}, remove: () => {} };
    this.dataset = {};
    this.children = [];
    this.tagName = '';
    this._innerHTML = '';
    this._textContent = '';
    this._cells = [];
    this.hidden = true;
  }
  set innerHTML(v) { this._innerHTML = v; }
  get innerHTML() { return this._innerHTML; }
  set textContent(v) { this._textContent = v; }
  get textContent() { return this._textContent; }
  appendChild(child) { this.children.push(child); }
  addEventListener() {}
  querySelectorAll() { return []; }
  querySelector() { return null; }
}
global.document = {
  getElementById: (id) => {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  },
  addEventListener: () => {},
  querySelectorAll: () => [],
  querySelector: () => null,
};
global.window = { addEventListener: () => {} };
global.localStorage = {
  _data: {},
  getItem(k) { return this._data[k] || null; },
  setItem(k, v) { this._data[k] = v; },
  removeItem(k) { delete this._data[k]; },
};

// Import app.js
const app = (await import('../app.js')).default || (await import('../app.js'));
console.log('app module loaded, exports:', Object.keys(app));

// Simulate user changes profile to TSS/ER
const profileEl = document.getElementById('config-profile');
profileEl.value = 'TSS/ER';
console.log('profileEl.value =', profileEl.value);

// Manually trigger what the change handler does
app.state.config.capacityProfile = profileEl.value;
console.log('state.config.capacityProfile =', app.state.config.capacityProfile);

// Add a row at I=50A
const testRow = { id: 1, cellVoltage: 2.0, ir: 1.0, irUnit: 'mohm', rippleVoltage: 0.05 };
app.state.rows = [testRow];

// Compute derived with new config
const dRss = app.computeRowDerived(testRow, app.state.rows, { ...app.state.config, capacityProfile: 'RSS' });
const dTss = app.computeRowDerived(testRow, app.state.rows, { ...app.state.config, capacityProfile: 'TSS/ER' });
console.log(`\nWith I=50A row:`);
console.log(`  RSS (60A threshold): overCurrent = ${dRss.overCurrent}`);
console.log(`  TSS/ER (40A threshold): overCurrent = ${dTss.overCurrent}`);

if (dRss.overCurrent === dTss.overCurrent) {
  console.error('\nFAIL: row should toggle based on profile');
  process.exit(1);
} else {
  console.log('\nPASS: profile change correctly toggles overCurrent');
  console.log('Conclusion: the calc logic is correct. The bug is in the UI event wiring.');
}
