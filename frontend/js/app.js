// 入口：搜索 Tab + 可视化 Tab 路由、事件绑定

import {
  initDataSource,
  isMockMode,
  loadTop100,
  loadYearKeywords,
  loadCliqueCounts,
  computeClique,
  loadEgo,
} from "./data-loader.js";
import { renderEgo } from "./graph.js";
import {
  renderTop100Chart,
  renderYearChart,
  renderCliqueChart,
} from "./charts.js";

// ---------- 状态 ----------
const state = {
  top100: null,
  years: null,
  cliques: null,
  currentEgo: null,
  loaded: {},
};

// ---------- Tab 切换 ----------
function setActiveTab(tabName) {
  document.querySelectorAll(".tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tabName);
  });
  document.querySelectorAll(".view").forEach((v) => {
    v.classList.toggle("active", v.id === `view-${tabName}`);
  });
}

async function showTab(tabName) {
  setActiveTab(tabName);
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
  } else if (tabName === "years" && !state.loaded.years) {
    await loadYearsView();
    state.loaded.years = true;
  } else if (tabName === "cliques") {
    await loadCliquesView();
  }
}

// ---------- API 调用 ----------
const API_BASE = window.location.origin + "/api";

async function apiSearch(endpoint, query) {
  const url = `${API_BASE}/search/${endpoint}?q=${encodeURIComponent(query)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

// ---------- 搜索结果渲染 ----------
function renderSearchResults(containerId, hintId, data, query) {
  const container = document.getElementById(containerId);
  const hint = document.getElementById(hintId);

  if (data.error) {
    hint.textContent = `错误: ${data.error}`;
    container.innerHTML = "";
    return;
  }

  const docs = data.docs || [];
  hint.textContent = query ? `找到 ${data.total} 条结果` : "";

  if (docs.length === 0) {
    container.innerHTML =
      '<div class="loading">未找到匹配结果，请尝试其他关键词。</div>';
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
}

// ---------- 搜索处理 ----------
async function doSearchAuthor() {
  const input = document.getElementById("sa-input");
  const btn = document.getElementById("sa-btn");
  const hint = document.getElementById("sa-hint");
  const q = input.value.trim();
  if (!q) return;

  btn.disabled = true;
  hint.textContent = "搜索中…";
  try {
    const data = await apiSearch("author", q);
    renderSearchResults("sa-results", "sa-hint", data, q);
  } catch (e) {
    hint.textContent = `搜索失败: ${e.message}`;
    document.getElementById("sa-results").innerHTML = "";
  } finally {
    btn.disabled = false;
  }
}

async function doSearchTitle() {
  const input = document.getElementById("st-input");
  const btn = document.getElementById("st-btn");
  const hint = document.getElementById("st-hint");
  const q = input.value.trim();
  if (!q) return;

  btn.disabled = true;
  hint.textContent = "搜索中…";
  try {
    const data = await apiSearch("title", q);
    renderSearchResults("st-results", "st-hint", data, q);
  } catch (e) {
    hint.textContent = `搜索失败: ${e.message}`;
    document.getElementById("st-results").innerHTML = "";
  } finally {
    btn.disabled = false;
  }
}

async function doSearchKeyword() {
  const input = document.getElementById("sk-input");
  const btn = document.getElementById("sk-btn");
  const hint = document.getElementById("sk-hint");
  const q = input.value.trim();
  if (!q) return;

  btn.disabled = true;
  hint.textContent = "搜索中…";
  try {
    const data = await apiSearch("keyword", q);
    renderSearchResults("sk-results", "sk-hint", data, q);
  } catch (e) {
    hint.textContent = `搜索失败: ${e.message}`;
    document.getElementById("sk-results").innerHTML = "";
  } finally {
    btn.disabled = false;
  }
}

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
    tr.innerHTML = `<td class="rank">${d.rank}</td><td>${escapeHtml(d.name)}</td><td class="num">${d.paper_count}</td>`;
    tr.addEventListener("click", () => {
      document.getElementById("author-input").value = d.name;
      showTab("graph");
      loadGraphView(d.name);
    });
    tbody.appendChild(tr);
  });
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
    renderYearChart(data[years[0]]);
  }
}

async function loadCliquesView() {
  await doComputeClique();
}

async function doComputeClique() {
  const btn = document.getElementById("clique-compute-btn");
  const hint = document.getElementById("clique-hint");
  const info = document.getElementById("clique-info");
  const order = parseInt(document.getElementById("clique-order-select").value, 10);

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
  await initDataSource();
  const badge = document.getElementById("data-source-badge");
  if (isMockMode()) {
    badge.textContent = "数据源: Mock";
    badge.classList.add("mock");
  } else {
    badge.textContent = "数据源: 后端导出";
    badge.classList.add("real");
  }

  // Tab 切换
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });

  // 作者搜索
  document.getElementById("sa-btn").addEventListener("click", doSearchAuthor);
  document.getElementById("sa-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearchAuthor();
  });

  // 标题搜索
  document.getElementById("st-btn").addEventListener("click", doSearchTitle);
  document.getElementById("st-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearchTitle();
  });

  // 关键字搜索
  document.getElementById("sk-btn").addEventListener("click", doSearchKeyword);
  document.getElementById("sk-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearchKeyword();
  });

  // 合作关系图
  document.getElementById("render-btn").addEventListener("click", () => {
    const name = document.getElementById("author-input").value.trim();
    if (name) loadGraphView(name);
  });
  document.getElementById("author-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
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
      renderYearChart(state.years[e.target.value]);
    }
  });

  // 默认显示作者搜索页
  await showTab("search-author");
}

bootstrap();
