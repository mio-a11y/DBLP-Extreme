import { initMobileLayout, syncMobileNavigation, refreshRankingPages } from "./mobile-layout.js?v=mobile-20261111-1";
import { bindKeywordControls } from "./keyword-controls.js?v=keyword-fix-20261110-1";
// 入口：搜索 Tab + 可视化 Tab 路由、事件绑定

import {
  initDataSource,
  isMockMode,
  loadTop100,
  loadYearKeywords,
  loadCliqueCounts,
  computeClique,
  loadEgo,
} from "./data-loader.js?v=academic-20261110-2";
import { renderEgo, resizeGraph } from "./graph.js?v=academic-20261110-2";
import {
  renderTop100Chart,
  renderYearChart,
  renderCliqueChart,
  renderWordCloud,
} from "./charts.js?v=mobile-20261111-1";

// ---------- 状态 ----------
const state = {
  top100: null,
  years: null,
  cliques: null,
  currentEgo: null,
  loaded: {},
};

// 页面文案与导航共用原有 Tab 标识，不改变接口或查询参数。
const viewCopy = {
  'search-author': ['作者检索', 'LITERATURE DISCOVERY / 01', '从一位作者，开始探索。', '检索学术文献，连接研究者与知识。你的下一条研究线索，从这里开始。'],
  'search-title': ['标题检索', 'LITERATURE DISCOVERY / 02', '沿着标题，找到新的线索。', '从熟悉的词句出发，发现与你的研究有关的论文。'],
  'search-keyword': ['关键词检索', 'LITERATURE DISCOVERY / 03', '让研究主题，逐渐清晰。', '组合关键词、调整匹配方式，在文献中找到更相关的答案。'],
  'graph': ['合作网络', 'RESEARCH CONNECTIONS / 04', '看见研究者之间的连接。', '以作者为中心，探索合作关系，并查看每个节点背后的论文。'],
  'top100': ['高产作者', 'RESEARCH INSIGHTS / 05', '从学术足迹，认识研究者。', '按发文数量浏览 Top 100 作者，点击姓名进一步探索合作网络。'],
  'years': ['年度热词', 'RESEARCH INSIGHTS / 06', '在时间里，发现研究的脉络。', '选择年份，以柱状图或词云观察当年的高频研究主题。'],
  'cliques': ['聚团统计', 'RESEARCH INSIGHTS / 07', '探索紧密相连的学术群体。', '统计合作网络中的完全子图；阶数越高，计算可能需要更长时间。'],
};

// ---------- Tab 切换 ----------
function setActiveTab(tabName) {
  syncMobileNavigation(tabName);
  const copy = viewCopy[tabName];
  if (copy) {
    ['current-location', 'page-eyebrow', 'page-title', 'page-description'].forEach((id, i) => {
      document.getElementById(id).textContent = copy[i];
    });
    document.title = `${copy[0]} · DBLP Extreme`;
  }
  document.querySelectorAll(".tab").forEach((b) => {
    const active = b.dataset.tab === tabName;
    b.classList.toggle("active", active);
    if (active) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  document.querySelectorAll(".view").forEach((v) => {
    v.classList.toggle("active", v.id === `view-${tabName}`);
  });
}

async function showTab(tabName) {
  setActiveTab(tabName);
  if (tabName === "graph") requestAnimationFrame(resizeGraph);
  if (tabName === "years" && state.loaded.years && yearViewMode === "cloud") {
    const year = document.getElementById('year-select').value;
    if (state.years?.[year]) requestAnimationFrame(() => renderWordCloud(state.years[year]));
  }
  if (state.loaded[tabName]) return;

  if (tabName === "search-author") {
    state.loaded[tabName] = true;
  } else if (tabName === "search-title") {
    state.loaded[tabName] = true;
  } else if (tabName === "search-keyword") {
    state.loaded[tabName] = true;
  } else if (tabName === "graph" && !state.loaded.graph) {
    await loadGraphView(await pickDefaultAuthor());
    state.loaded.graph = true;
  } else if (tabName === "top100" && !state.loaded.top100) {
    await loadTop100View();
    state.loaded.top100 = true;
  } else if (tabName === "years") {
    if (!state.loaded.years) {
      await loadYearsView();
    }
    // 每次切换到该 Tab 都重绘（Canvas 在隐藏时尺寸归零）
    const sel = document.getElementById("year-select");
    if (state.years && sel.value && state.years[sel.value]) {
      if (yearViewMode === "cloud") {
        requestAnimationFrame(() => renderWordCloud(state.years[sel.value]));
      }
    }
    state.loaded.years = true;
  } else if (tabName === "cliques") {
    await loadCliquesView();
  }
}

// ---------- API 调用 ----------
const API_BASE = window.location.origin + "/api";

async function apiSearch(endpoint, query, extraParams = {}, signal) {
  const params = new URLSearchParams({ q: query, ...extraParams });
  const url = `${API_BASE}/search/${endpoint}?${params}`;
  const r = await fetch(url, { signal, cache: 'no-store' });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

// ---------- 搜索结果渲染 ----------
function renderSearchResults(containerId, hintId, pagerId, data, query) {
  const container = document.getElementById(containerId);
  const hint = document.getElementById(hintId);
  const pager = pagerId ? document.getElementById(pagerId) : null;

  if (data.error) {
    hint.textContent = `错误: ${data.error}`;
    container.innerHTML = "";
    if (pager) pager.style.display = "none";
    return;
  }

  const docs = data.docs || [];
  const totalHits = data.total || docs.length;
  hint.textContent = query ? `找到 ${totalHits} 条结果` : "";

  if (docs.length === 0) {
    container.innerHTML =
      '<div class="loading">未找到匹配结果，请尝试其他关键词。</div>';
    if (pager) pager.style.display = "none";
    return;
  }

  let html = "";
  // 作者搜索额外信息
  if (data.meta) {
    const m = data.meta;
    if (m.type === "author_info") {
      html += `<div class="result-meta-header">作者 <strong>${escapeHtml(m.name)}</strong> | 论文数: <strong>${m.paper_count}</strong></div>`;
    } else if (m.type === "fuzzy_info") {
      html += `<div class="result-meta-header">搜索 "<strong>${escapeHtml(m.query)}</strong>" → 匹配 <strong>${escapeHtml(m.matched)}</strong> | 论文数: <strong>${m.paper_count}</strong></div>`;
    }
  }

  for (const doc of docs) {
    const title = escapeHtml(doc.title);
    const year = doc.year || "?";
    const journal = escapeHtml(doc.journal);
    const authors = escapeHtml(doc.authors);
    const ee = doc.ee && doc.ee !== "-" ? doc.ee : null;

    html += `<div class="result-card">
      <div class="r-title">${ee ? `<a href="${escapeHtml(ee)}" target="_blank" rel="noopener">${title}</a>` : title}</div>
      <div class="r-meta">
        ${authors !== "-" ? `<span><span class="label">作者</span> ${authors}</span>` : ""}
        <span><span class="label">年份</span> ${year}</span>
        ${journal !== "-" ? `<span><span class="label">期刊</span> ${journal}</span>` : ""}
      </div>
    </div>`;
  }
  container.innerHTML = html;

  // 分页控件
  if (pager && data.page && data.page_size) {
    const pageNum = data.page;
    const pageSize = data.page_size;
    const totalPages = Math.max(1, Math.ceil(totalHits / pageSize));
    if (totalPages > 1) {
      const goToFn = pagerId === "sa-pager" ? "_saGoTo" : "_stGoTo";
      let phtml = "";
      phtml += `<button ${pageNum <= 1 ? "disabled" : ""} onclick="window.${goToFn}(${pageNum - 1})">上一页</button>`;
      phtml += `<span class="page-info">第 ${pageNum} / ${totalPages} 页</span>`;
      phtml += `<button ${pageNum >= totalPages ? "disabled" : ""} onclick="window.${goToFn}(${pageNum + 1})">下一页</button>`;
      pager.innerHTML = phtml;
      pager.style.display = "flex";
      return;
    }
  }
  if (pager) pager.style.display = "none";
}

// ---------- 搜索处理 ----------
async function doSearchAuthor(pageNum = 1) {
  const input = document.getElementById("sa-input");
  const btn = document.getElementById("sa-btn");
  const hint = document.getElementById("sa-hint");
  const q = input.value.trim();
  if (!q) return;

  btn.disabled = true;
  hint.textContent = "搜索中…";
  try {
    const data = await apiSearch("author", q, { page: pageNum, size: 20 });
    state.authorQuery = { q, data, pageNum };
    renderSearchResults("sa-results", "sa-hint", "sa-pager", data, q);
  } catch (e) {
    hint.textContent = `搜索失败: ${e.message}`;
    document.getElementById("sa-results").innerHTML = "";
    document.getElementById("sa-pager").style.display = "none";
  } finally {
    btn.disabled = false;
  }
}

async function doSearchTitle(pageNum = 1) {
  const input = document.getElementById("st-input");
  const btn = document.getElementById("st-btn");
  const hint = document.getElementById("st-hint");
  const q = input.value.trim();
  if (!q) return;

  btn.disabled = true;
  hint.textContent = "搜索中…";
  try {
    const data = await apiSearch("title", q, { page: pageNum, size: 20 });
    state.titleQuery = { q, data, pageNum };
    renderSearchResults("st-results", "st-hint", "st-pager", data, q);
  } catch (e) {
    hint.textContent = `搜索失败: ${e.message}`;
    document.getElementById("st-results").innerHTML = "";
    document.getElementById("st-pager").style.display = "none";
  } finally {
    btn.disabled = false;
  }
}

// 全局分页跳转
window._saGoTo = function(pageNum) {
  document.getElementById("sa-results").innerHTML = '<div class="loading">加载中…</div>';
  doSearchAuthor(pageNum);
};
window._stGoTo = function(pageNum) {
  document.getElementById("st-results").innerHTML = '<div class="loading">加载中…</div>';
  doSearchTitle(pageNum);
};

let keywordRequestId = 0;
let keywordController = null;
const keywordEmptyState = document.getElementById('sk-results').innerHTML;
function invalidateKeywordSearch() {
  keywordRequestId += 1;
  keywordController?.abort();
}

async function doSearchKeyword(pageNum = 1) {
  invalidateKeywordSearch();
  const requestId = keywordRequestId;
  const controller = new AbortController();
  keywordController = controller;
  const input = document.getElementById("sk-input");
  const btn = document.getElementById("sk-btn");
  const hint = document.getElementById("sk-hint");
  const q = input.value.trim();
  if (!q) {
    hint.textContent = '';
    document.getElementById('sk-results').innerHTML = keywordEmptyState;
    document.getElementById('sk-pager').style.display = 'none';
    btn.disabled = false;
    return;
  }

  // 构建带选项的查询字符串
  const fuzzyCb = document.getElementById("sk-fuzzy");
  const fuzzyLevel = document.getElementById("sk-fuzzy-level").value;
  const modeAnd = document.getElementById("sk-mode-and").checked;
  const sortSel = document.getElementById("sk-sort").value;
  const sizeSel = document.getElementById("sk-size").value;

  let queryStr = q;
  if (fuzzyCb && !fuzzyCb.checked) {
    queryStr += " fuzzy:off";
  } else {
    queryStr += ` fuzzy:${fuzzyLevel} fuzzyexp:8`;
  }
  if (modeAnd) queryStr += " mode:and";
  if (sortSel === "newest") queryStr += " sort:newest";
  queryStr += ` page:${pageNum} size:${sizeSel}`;

  btn.disabled = true;
  hint.textContent = "搜索中…";
  try {
    const data = await apiSearch("keyword", queryStr, {}, controller.signal);
    if (requestId !== keywordRequestId) return;
    if (!data.error && !data.meta) throw new Error('后端版本过旧，请重新编译 C++ 程序后重启服务');
    if (!data.error && sortSel === 'newest' && data.docs?.length && data.meta?.sort !== 'sort:newest') {
      throw new Error('后端没有应用年份排序，请更新 C++ 程序后重试');
    }
    // 保存当前查询状态用于翻页
    state.keywordQuery = { q, queryStr, data, pageNum };
    renderKeywordResults(data, q, pageNum);
  } catch (e) {
    if (requestId !== keywordRequestId || e.name === 'AbortError') return;
    hint.textContent = `搜索失败: ${e.message}`;
    document.getElementById("sk-results").innerHTML = "";
    document.getElementById("sk-pager").style.display = "none";
  } finally {
    if (requestId === keywordRequestId) btn.disabled = false;
  }
}

function renderKeywordResults(data, query, pageNum) {
  const container = document.getElementById("sk-results");
  const hint = document.getElementById("sk-hint");
  const pager = document.getElementById("sk-pager");

  if (data.error) {
    hint.textContent = `错误: ${data.error}`;
    container.innerHTML = "";
    pager.style.display = "none";
    return;
  }

  const docs = data.docs || [];
  const meta = data.meta || {};
  const totalHits = meta.total_hits ?? data.total ?? docs.length;
  const pageSize = meta.page_size || 20;
  const totalPages = Math.max(1, Math.ceil(totalHits / pageSize));

  let hintParts = [`找到 ${totalHits} 条结果`];
  if (meta.mode && meta.mode.endsWith("and")) hintParts.push("AND 模式");
  if (meta.sort && meta.sort.endsWith("newest")) hintParts.push("按年份排序");
  if (meta.fuzzy && meta.fuzzy !== "fuzzy:off") hintParts.push(`容错: ${meta.fuzzy.replace("fuzzy:", "编辑距离 ")}`);
  hint.textContent = hintParts.join(" | ");

  if (docs.length === 0) {
    container.innerHTML = '<div class="loading">未找到匹配结果，请尝试其他关键词或关闭"必须包含所有词"。</div>';
    pager.style.display = "none";
    return;
  }

  let html = "";
  for (const doc of docs) {
    const title = escapeHtml(doc.title);
    const year = doc.year || "?";
    const journal = escapeHtml(doc.journal);
    const authors = escapeHtml(doc.authors);
    const ee = doc.ee && doc.ee !== "-" ? doc.ee : null;

    html += `<div class="result-card">
      <div class="r-title">${ee ? `<a href="${escapeHtml(ee)}" target="_blank" rel="noopener">${title}</a>` : title}</div>
      <div class="r-meta">
        ${authors !== "-" ? `<span><span class="label">作者</span> ${authors}</span>` : ""}
        <span><span class="label">年份</span> ${year}</span>
        ${journal !== "-" ? `<span><span class="label">期刊</span> ${journal}</span>` : ""}
      </div>
    </div>`;
  }
  container.innerHTML = html;

  // 分页控件
  if (totalPages > 1) {
    let phtml = "";
    phtml += `<button ${pageNum <= 1 ? "disabled" : ""} onclick="window._skGoTo(${pageNum - 1})">上一页</button>`;
    phtml += `<span class="page-info">第 ${pageNum} / ${totalPages} 页</span>`;
    phtml += `<button ${pageNum >= totalPages ? "disabled" : ""} onclick="window._skGoTo(${pageNum + 1})">下一页</button>`;
    pager.innerHTML = phtml;
    pager.style.display = "flex";
  } else {
    pager.style.display = "none";
  }
}

// 全局分页跳转辅助
window._skGoTo = function(pageNum) {
  document.getElementById("sk-results").innerHTML = '<div class="loading">加载中…</div>';
  doSearchKeyword(pageNum);
};

// ---------- 可视化 Tab 逻辑 (原有) ----------
async function pickDefaultAuthor() {
  if (state.top100 && state.top100.length > 0) return state.top100[0].name;
  try {
    state.top100 = await loadTop100();
    if (state.top100.length > 0) return state.top100[0].name;
  } catch (e) {
    console.warn("加载 Top 100 失败", e);
  }
  return "H. Vincent Poor";
}

async function loadGraphView(authorName) {
  const hint = document.getElementById("graph-hint");
  hint.textContent = `正在加载 ${authorName} 的合作网络…`;
  try {
    const ego = await loadEgo(authorName);
    state.currentEgo = ego;
    renderEgo(ego, showPapersFor);
    hint.textContent = `已渲染：${ego.center}（${ego.nodes.length} 节点 / ${ego.edges.length} 边）`;
  } catch (err) {
    hint.textContent = `加载失败：${err.message}`;
  }
}

function showPapersFor(authorName) {
  const ego = state.currentEgo;
  if (!ego) return;
  const papers =
    (ego.papers_by_author && ego.papers_by_author[authorName]) || [];
  const titleEl = document.getElementById("paper-panel-title");
  const countEl = document.getElementById("paper-panel-count");
  const listEl = document.getElementById("paper-list");

  titleEl.textContent = authorName;
  countEl.textContent = `${papers.length} 篇`;
  listEl.innerHTML = "";

  if (papers.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "暂无论文数据";
    listEl.appendChild(li);
    return;
  }

  papers.forEach((p) => {
    const li = document.createElement("li");
    const meta = [p.year, p.journal].filter(Boolean).join(" · ");
    const ee = p.ee ? ` · <a href="${p.ee}" target="_blank" rel="noopener">链接</a>` : "";
    li.innerHTML = `<div class="ptitle">${escapeHtml(p.title)}</div><div class="pmeta">${escapeHtml(meta)}${ee}</div>`;
    listEl.appendChild(li);
  });
}

async function loadTop100View() {
  try {
    const data = await loadTop100();
    state.top100 = data;
    renderTop100Table(data);
    renderTop100Chart(data, parseInt(document.getElementById("top100-range").value, 10));
  } catch (err) {
    console.error(err);
  }
}

function renderTop100Table(data) {
  const tbody = document.querySelector("#top100-table tbody");
  tbody.innerHTML = "";
  data.forEach((d) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="rank">${d.rank}</td><td><button class="author-link" type="button">${escapeHtml(d.name)}</button></td><td class="num">${d.paper_count}</td>`;
    tr.addEventListener("click", () => {
      document.getElementById("author-input").value = d.name;
      showTab("graph");
      loadGraphView(d.name);
    });
    tbody.appendChild(tr);
  });
  refreshRankingPages();
}

async function loadYearsView() {
  try {
    const data = await loadYearKeywords();
    state.years = data;
    populateYearSelect(data);
  } catch (err) {
    console.error(err);
  }
}

function populateYearSelect(data) {
  const sel = document.getElementById("year-select");
  const years = Object.keys(data).sort((a, b) => parseInt(b) - parseInt(a));
  sel.innerHTML = "";
  years.forEach((y) => {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    sel.appendChild(opt);
  });
  if (years.length > 0) {
    sel.value = years[0];
    renderYearView(data[years[0]]);
  }
}

let yearViewMode = "chart";
function renderYearView(yearData) {
  if (yearViewMode === "chart") {
    document.getElementById("year-chart-wrap").style.display = "";
    document.getElementById("year-cloud-wrap").style.display = "none";
    renderYearChart(yearData);
  } else {
    document.getElementById("year-chart-wrap").style.display = "none";
    document.getElementById("year-cloud-wrap").style.display = "";
    // 等待 DOM 可见后再渲染，确保 canvas 尺寸正确
    requestAnimationFrame(() => renderWordCloud(yearData));
  }
}

async function loadCliquesView() {
  if (!state.cliques) document.getElementById("clique-hint").textContent = "选择最大阶数后点击开始计算。完整数据计算可能较久，并影响搜索响应。";
  state.loaded.cliques = true;
}

async function doComputeClique() {
  const btn = document.getElementById("clique-compute-btn");
  const hint = document.getElementById("clique-hint");
  const info = document.getElementById("clique-info");
  const order = parseInt(document.getElementById("clique-order-select").value, 10);

  if (!Number.isInteger(order) || order < 2 || order > 5) {
    hint.textContent = "聚团最大阶数只能选择 2 至 5。";
    return;
  }

  btn.disabled = true;
  hint.textContent = `正在计算 ${order} 阶聚团…`;
  info.style.display = "none";
  try {
    const data = await computeClique(order);
    state.cliques = data.counts;
    renderCliqueChart(data.counts);
    const countStr = Object.entries(data.counts)
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .map(([k, v]) => `${k}-阶: ${Number(v).toLocaleString()}`)
      .join(" | ");
    info.innerHTML = `作者数: <strong>${Number(data.author_count).toLocaleString()}</strong> | 边数: <strong>${Number(data.edge_count).toLocaleString()}</strong> | 论文数: <strong>${Number(data.paper_count).toLocaleString()}</strong>${data.cached ? " | <span class='badge real'>缓存</span>" : ""}<br>${countStr}`;
    info.style.display = "block";
    hint.textContent = `已完成 ${data.max_order} 阶统计`;
  } catch (e) {
    hint.textContent = `计算失败: ${e.message}`;
    info.style.display = "none";
  } finally {
    btn.disabled = false;
  }
}

// ---------- 工具 ----------
function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------- 启动 ----------
async function bootstrap() {
  initMobileLayout();
  window.matchMedia('(max-width: 960px)').addEventListener('change', () => {
    if (state.years && yearViewMode === 'chart') {
      const year = document.getElementById('year-select').value;
      if (state.years[year]) renderYearChart(state.years[year]);
    }
  });
  await initDataSource();
  const badge = document.getElementById("data-source-badge");
  if (isMockMode()) {
    badge.textContent = "统计数据：示例";
    badge.title = "统计图表当前使用示例数据；文献搜索仍需连接后端 API。";
    badge.classList.add("mock");
  } else {
    badge.textContent = "统计数据：后端导出";
    badge.title = "统计图表来自后端导出的数据文件。";
    badge.classList.add("real");
  }

  // 快捷入口保留既有路由与搜索处理。
  document.querySelectorAll('[data-open-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      showTab(button.dataset.openTab);
      document.getElementById('main-content').focus({ preventScroll: true });
    });
  });
  document.querySelectorAll('[data-search-target]').forEach((button) => {
    button.addEventListener('click', () => {
      const prefix = button.dataset.searchTarget;
      document.getElementById(`${prefix}-input`).value = button.dataset.query;
      ({ sa: doSearchAuthor, st: doSearchTitle, sk: doSearchKeyword })[prefix]();
    });
  });

  // Tab 切换
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });

  // 作者搜索
  document.getElementById("sa-btn").addEventListener("click", () => doSearchAuthor());
  document.getElementById("sa-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) doSearchAuthor();
  });

  // 标题搜索
  document.getElementById("st-btn").addEventListener("click", () => doSearchTitle());
  document.getElementById("st-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) doSearchTitle();
  });

  bindKeywordControls({ search: doSearchKeyword, invalidate: invalidateKeywordSearch, apiBase: API_BASE });

  // 合作关系图
  document.getElementById("render-btn").addEventListener("click", () => {
    const name = document.getElementById("author-input").value.trim();
    if (name) loadGraphView(name);
  });
  document.getElementById("author-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      const name = e.target.value.trim();
      if (name) loadGraphView(name);
    }
  });

  // Top 100 范围选择
  document.getElementById("top100-range").addEventListener("change", (e) => {
    if (state.top100) {
      renderTop100Chart(state.top100, parseInt(e.target.value, 10));
    }
  });

  // 聚团计算
  document.getElementById("clique-compute-btn").addEventListener("click", doComputeClique);

  // 年份选择
  document.getElementById("year-select").addEventListener("change", (e) => {
    if (state.years && state.years[e.target.value]) {
      renderYearView(state.years[e.target.value]);
    }
  });

  // 词云 / 柱状图切换
  document.querySelectorAll(".toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".toggle-btn").forEach((b) => { b.classList.remove("active"); b.setAttribute("aria-pressed", "false"); });
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
      yearViewMode = btn.dataset.view;
      const sel = document.getElementById("year-select");
      if (state.years && sel.value && state.years[sel.value]) {
        renderYearView(state.years[sel.value]);
      }
    });
  });

  // 窗口大小变化时重绘词云（Canvas 需要精确尺寸）
  window.addEventListener("resize", () => {
    if (document.getElementById('view-graph').classList.contains('active')) {
      requestAnimationFrame(resizeGraph);
    }
    if (yearViewMode === "cloud" && state.years) {
      const sel = document.getElementById("year-select");
      if (sel.value && state.years[sel.value]) {
        renderWordCloud(state.years[sel.value]);
      }
    }
  });

  // 默认显示作者搜索页
  await showTab("search-author");
}

bootstrap();
