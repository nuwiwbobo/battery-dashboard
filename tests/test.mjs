import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rippleCurrent,
  dissipatedPower,
  predictedTemp,
  surfaceArea,
  overCurrentDecision,
  tempCheckDecision,
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

test('predictedTemp matches spreadsheet row 2', () => {
  const t = predictedTemp(0.01754, 0.2814, 4.6);
  assert.ok(Math.abs(t - 0.01355) < 1e-4, `got ${t}`);
});

test('surfaceArea from rectangular prism dimensions', () => {
  const a = surfaceArea(0.17, 0.15, 0.36);
  assert.ok(Math.abs(a - 0.2814) < 1e-9, `got ${a}`);
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

test('tempCheckDecision boundaries', () => {
  assert.equal(tempCheckDecision(2.9, 3, 8), 'Aman');
  assert.equal(tempCheckDecision(3.0, 3, 8), 'Cek');
  assert.equal(tempCheckDecision(8.0, 3, 8), 'Ganti');
  assert.equal(tempCheckDecision(8.1, 3, 8), 'Ganti');
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
  // Simulating the input handler: replace ',' with '.' before parseFloat
  const raw = '2,2338';
  const normalized = raw.replace(',', '.');
  const num = parseFloat(normalized);
  assert.ok(Math.abs(num - 2.2338) < 1e-9, `got ${num}`);
});
