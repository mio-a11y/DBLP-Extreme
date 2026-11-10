const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
  const elements = new Map();
  function get(id) {
    if (!elements.has(id)) elements.set(id, { value: '', checked: false, disabled: false, innerHTML: '', textContent: '', style: {} });
    return elements.get(id);
  }
  Object.assign(get('sk-input'), { value: 'neural' });
  get('sk-sort').value = 'relevance';
  get('sk-size').value = '10';
  get('sk-fuzzy-level').value = '1';
  get('sk-results').innerHTML = '<div>empty state</div>';
  const pending = [];
  const context = vm.createContext({
    document: { getElementById: get },
    window: { location: { origin: 'http://test' } },
    URLSearchParams, AbortController,
    // Deliberately ignore abort: ownership must also reject responses already in flight.
    fetch(url) { return new Promise(resolve => pending.push({ url, resolve })); },
  });
  let source = fs.readFileSync(path.join(__dirname, '../frontend/js/app.js'), 'utf8');
  source = source.replace(/^import[\s\S]*?from\s+"[^"]+";\s*/gm, '').replace(/\nbootstrap\(\);\s*$/, '');
  vm.runInContext(source, context);
  return { get, pending, search: () => context.doSearchKeyword() };
}
function response(title, sort) {
  return { ok: true, json: async () => ({ docs: [{ title, year: '2025', authors: 'Test', journal: 'Test' }], total: 1, meta: { total_hits: 1, page_size: 10, sort } }) };
}

test('older relevance response cannot overwrite latest-year results or release its loading state', async () => {
  const h = harness();
  const older = h.search();
  h.get('sk-sort').value = 'newest';
  const latest = h.search();
  assert.match(h.pending[1].url, /sort%3Anewest/);
  h.pending[0].resolve(response('OLD', undefined));
  await older;
  assert.equal(h.get('sk-btn').disabled, true);
  h.pending[1].resolve(response('NEW', 'sort:newest'));
  await latest;
  assert.match(h.get('sk-results').innerHTML, /NEW/);
  assert.doesNotMatch(h.get('sk-results').innerHTML, /OLD/);
  assert.match(h.get('sk-hint').textContent, /按年份排序/);
});

test('clearing the input invalidates an in-flight result and restores the empty state', async () => {
  const h = harness();
  const older = h.search();
  h.get('sk-input').value = '';
  await h.search();
  h.pending[0].resolve(response('STALE', undefined));
  await older;
  assert.equal(h.get('sk-results').innerHTML, '<div>empty state</div>');
  assert.equal(h.get('sk-btn').disabled, false);
});

test('a slow previous response arriving last cannot replace the chosen sort order', async () => {
  const h = harness();
  const older = h.search();
  h.get('sk-sort').value = 'newest';
  const latest = h.search();
  h.pending[1].resolve(response('NEWEST', 'sort:newest'));
  await latest;
  h.pending[0].resolve(response('OBSOLETE', undefined));
  await older;
  assert.match(h.get('sk-results').innerHTML, /NEWEST/);
  assert.doesNotMatch(h.get('sk-results').innerHTML, /OBSOLETE/);
});

test('legacy backend metadata is reported rather than silently pretending sort succeeded', async () => {
  const h = harness();
  const query = h.search();
  h.pending[0].resolve({ ok: true, json: async () => ({ docs: [{ title: 'Old backend' }] }) });
  await query;
  assert.match(h.get('sk-hint').textContent, /后端版本过旧/);
  assert.equal(h.get('sk-results').innerHTML, '');
});
