// Keyword input owns its suggestion requests; stale responses never reopen the menu.
export function bindKeywordControls({ search, invalidate, apiBase }) {
  const input = document.getElementById('sk-input');
  const menu = document.getElementById('sk-suggest');
  const status = document.getElementById('sk-suggest-status');
  let searchTimer;
  let suggestTimer;
  let controller;
  let generation = 0;
  let selected = -1;
  let composing = false;

  function closeSuggestions() {
    clearTimeout(suggestTimer);
    controller?.abort();
    generation += 1;
    menu.style.display = 'none';
    menu.replaceChildren();
    selected = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function choose(term) {
    const value = input.value;
    const boundary = value.lastIndexOf(' ');
    input.value = (boundary >= 0 ? value.slice(0, boundary + 1) : '') + term;
    closeSuggestions();
    status.textContent = '';
    clearTimeout(searchTimer);
    search();
  }

  async function suggest() {
    closeSuggestions();
    status.textContent = '';
    const value = input.value;
    if (!value.trim() || /\s$/.test(value) || document.activeElement !== input) return;
    const requestId = generation;
    const requestController = new AbortController();
    controller = requestController;
    const current = () => requestId === generation && input.value === value && document.activeElement === input;
    const timeout = setTimeout(() => requestController.abort(), 8000);
    try {
      const params = new URLSearchParams({ q: value });
      const response = await fetch(`${apiBase}/suggest/keyword?${params}`, {
        signal: requestController.signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`接口返回 HTTP ${response.status}`);
      const data = await response.json();
      if (!current()) return;
      if (data.error) throw new Error(data.error);
      if (!Array.isArray(data.terms)) throw new Error('接口没有返回补全词列表，请检查后端版本');
      const prefix = value.slice(0, value.lastIndexOf(' ') + 1);
      for (const [index, term] of data.terms.entries()) {
        const item = document.createElement('div');
        item.className = 'suggest-item';
        item.id = `keyword-suggestion-${index}`;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', 'false');
        item.dataset.term = String(term);
        item.textContent = prefix + term;
        item.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          choose(item.dataset.term);
        });
        menu.appendChild(item);
      }
      if (data.terms.length) {
        menu.style.display = '';
        input.setAttribute('aria-expanded', 'true');
      }
    } catch (error) {
      if (!current()) return;
      status.textContent = error.name === 'AbortError'
        ? '自动补全响应超时，可以继续输入或点击检索。'
        : `自动补全暂不可用：${error.message}`;
    } finally {
      clearTimeout(timeout);
    }
  }

  function schedule() {
    invalidate();
    clearTimeout(searchTimer);
    closeSuggestions();
    status.textContent = '';
    if (composing) return;
    suggestTimer = setTimeout(suggest, 120);
    searchTimer = setTimeout(() => search(), 300);
  }

  input.addEventListener('input', (event) => { if (!event.isComposing) schedule(); });
  input.addEventListener('compositionstart', () => {
    composing = true;
    invalidate();
    clearTimeout(searchTimer);
    closeSuggestions();
  });
  input.addEventListener('compositionend', () => { composing = false; schedule(); });
  input.addEventListener('focus', suggest);
  input.addEventListener('blur', closeSuggestions);
  input.addEventListener('keydown', (event) => {
    if (event.isComposing || composing) return;
    const items = [...menu.querySelectorAll('.suggest-item')];
    if (event.key === 'ArrowDown' && items.length) {
      event.preventDefault();
      selected = Math.min(selected + 1, items.length - 1);
    } else if (event.key === 'ArrowUp' && items.length) {
      event.preventDefault();
      selected = Math.max(selected - 1, -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      clearTimeout(searchTimer);
      if (selected >= 0 && items[selected]) choose(items[selected].dataset.term);
      else { closeSuggestions(); search(); }
      return;
    } else if (event.key === 'Escape') {
      closeSuggestions();
      return;
    } else return;
    items.forEach((item, index) => {
      const active = index === selected;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    if (items[selected]) input.setAttribute('aria-activedescendant', items[selected].id);
    else input.removeAttribute('aria-activedescendant');
  });

  function submit() {
    clearTimeout(searchTimer);
    closeSuggestions();
    status.textContent = '';
    search();
  }
  document.getElementById('sk-btn').addEventListener('click', submit);
  for (const id of ['sk-fuzzy', 'sk-fuzzy-level', 'sk-mode-and', 'sk-sort', 'sk-size']) {
    document.getElementById(id).addEventListener('change', submit);
  }
}
