import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rippleCurrent,
  dissipatedPower,
  sohPercent,
  overCurrentDecision,
  voltageStatus,
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

test('voltageStatus boundaries', () => {
  assert.equal(voltageStatus(0.04, 0.05, 0.1), 'Aman');
  assert.equal(voltageStatus(0.05, 0.05, 0.1), 'Cek');
  assert.equal(voltageStatus(0.10, 0.05, 0.1), 'Ganti');
  assert.equal(voltageStatus(0.11, 0.05, 0.1), 'Ganti');
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
  assert.equal(overCurrentDecision(50, 300), false, '50A should be FALSE at RSS 300Ah');
  assert.equal(overCurrentDecision(50, 200), true, '50A should be TRUE at TSS/ER 200Ah');
  assert.equal(overCurrentDecision(40, 200), false, '40A is exactly C/5, not exceeding');
  assert.equal(overCurrentDecision(40.0001, 200), true, '40.0001A exceeds C/5');
  assert.equal(overCurrentDecision(60, 300), false, '60A is exactly C/5 for RSS');
  assert.equal(overCurrentDecision(60.0001, 300), true, '60.0001A exceeds C/5 for RSS');
});

test('voltageStatus uses absolute deviation from reference', () => {
  assert.equal(voltageStatus(0.04, 0.05, 0.1), 'Aman');
  assert.equal(voltageStatus(0.05, 0.05, 0.1), 'Cek');
  assert.equal(voltageStatus(0.10, 0.05, 0.1), 'Ganti');
  assert.equal(voltageStatus(0.20, 0.05, 0.1), 'Ganti');
});

test('sohPercent: standard cases', () => {
  // New cell: measured == healthy → 100%
  assert.ok(Math.abs(sohPercent(300, 300) - 100) < 1e-9);
  // 80% SOH (typical end-of-life threshold)
  assert.ok(Math.abs(sohPercent(240, 300) - 80) < 1e-9);
  // 50% SOH
  assert.ok(Math.abs(sohPercent(150, 300) - 50) < 1e-9);
});

test('sohPercent: handles invalid inputs', () => {
  assert.equal(sohPercent(null, 300), null);
  assert.equal(sohPercent(300, null), null);
  assert.equal(sohPercent(300, 0), null);
  assert.equal(sohPercent(NaN, 300), null);
  assert.equal(sohPercent(300, NaN), null);
});
