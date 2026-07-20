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

test('batteryStatus: Aman — SOH>80% AND IR<120% baseline (even with V in warning range)', () => {
  // 2.3V (between 2.0 and 2.5), 85% SOH, IR 0.0007 (< 0.0009)
  assert.equal(batteryStatus(2.3, 0.0007, 85, cfg.batasAtas, cfg.batasBawah, cfg.irBaselineRss), 'Aman');
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
  assert.equal(batteryStatus(2.3, 0.0007, 85, 2.0, 2.5, cfg.irBaselineRss), null);
});
