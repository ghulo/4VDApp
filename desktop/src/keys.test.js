// node --test src/  (no Electron needed)
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { keyAction, pathOf } = require('./keys.js');

const down = (key, control = false) => ({ type: 'keyDown', key, control });

test('F5 reloads the dashboard but is left to the Counter, where it picks the customer', () => {
  assert.equal(keyAction(down('F5'), '/'), 'reload');
  assert.equal(keyAction(down('F5'), '/sales'), 'reload');
  assert.equal(keyAction(down('F5'), '/counter'), null);
  assert.equal(keyAction(down('F5'), '/counter/'), null);
  assert.equal(keyAction(down('F5'), '/counters-report'), 'reload');
});

test('Ctrl+R still reloads, the Counter too', () => {
  assert.equal(keyAction(down('r', true), '/counter'), 'reload');
  assert.equal(keyAction(down('R', true), '/'), 'reload');
  assert.equal(keyAction(down('r'), '/counter'), null);
});

test('F10 (price check) and other keys are left to the page; F11 is full screen; zoom keys', () => {
  assert.equal(keyAction(down('F10'), '/counter'), null);
  assert.equal(keyAction(down('F9'), '/counter'), null);
  assert.equal(keyAction(down('F11'), '/counter'), 'fullscreen');
  assert.equal(keyAction(down('+', true), '/'), 'zoomIn');
  assert.equal(keyAction(down('-', true), '/'), 'zoomOut');
  assert.equal(keyAction(down('0', true), '/'), 'zoomReset');
  assert.equal(keyAction({ type: 'keyUp', key: 'F5' }, '/'), null);
});

test('the path of a page address', () => {
  assert.equal(pathOf('https://4vd.app/counter?add=3'), '/counter');
  assert.equal(pathOf('file:///C:/app/loading.html'), '/C:/app/loading.html');
  assert.equal(pathOf('not a url'), '');
});
