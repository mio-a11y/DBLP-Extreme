const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
  class Element {
    constructor() {
      this.value = ''; this.textContent = ''; this.style = {}; this.dataset = {};
      this.children = []; this.events = {}; this.attributes = {};
      this.classList = { toggle() {} };
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    replaceChildren() { this.children = []; }
    appendChild(child) { this.children.push(child); }
    addEventListener(name, handler) { this.events[name] = handler; }
    querySelectorAll() { return this.children; }
  }
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const input = get('sk-input');
  const menu = get('sk-suggest');
  const status = get('sk-suggest-status');
  const document = { getElementById: get, activeElement: input, createElement: () => new Element() };
  const pending = [];
  let searches = 0;
  const context = vm.createContext({ document, URLSearchParams, AbortController,
    setTimeout: () => 1, clearTimeout() {},
    fetch(url) { return new Promise(resolve => pending.push({ url, resolve })); },
  });
  const source = fs.readFileSync(path.join(__dirname, '../frontend/js/keyword-controls.js'), 'utf8').replace('export function', 'function');
  vm.runInContext(source, context);
  context.bindKeywordControls({ search: () => searches++, invalidate() {}, apiBase: 'http://test/api' });
  return { input, menu, status, pending, get searches() { return searches; } };
}
const result = terms => ({ ok: true, json: async () => ({ terms }) });

test('slow suggestions for an older input never replace the current prefix', async () => {
  const h = harness();
  h.input.value = 'ne';
  const older = h.input.events.focus();
  h.input.value = 'graph lea';
  const latest = h.input.events.focus();
  h.pending[1].resolve(result(['learning']));
  await latest;
  h.pending[0].resolve(result(['neural']));
  await older;
  assert.equal(h.menu.children.length, 1);
  assert.equal(h.menu.children[0].textContent, 'graph learning');
  h.input.events.keydown({ key: 'ArrowDown', preventDefault() {} });
  h.input.events.keydown({ key: 'Enter', preventDefault() {} });
  assert.equal(h.input.value, 'graph learning');
  assert.equal(h.searches, 1);
});

test('Escape closes and invalidates an in-flight suggestion request', async () => {
  const h = harness();
  h.input.value = 'neur';
  const request = h.input.events.focus();
  h.input.events.keydown({ key: 'Escape' });
  h.pending[0].resolve(result(['neural']));
  await request;
  assert.equal(h.menu.style.display, 'none');
  assert.equal(h.menu.children.length, 0);
  assert.equal(h.input.attributes['aria-expanded'], 'false');
});

test('backend suggestion errors are shown rather than silently swallowed', async () => {
  const h = harness();
  h.input.value = 'neur';
  const request = h.input.events.focus();
  h.pending[0].resolve({ ok: true, json: async () => ({ error: 'Unknown command: SUGGEST' }) });
  await request;
  assert.match(h.status.textContent, /Unknown command: SUGGEST/);
  assert.equal(h.menu.style.display, 'none');
});
