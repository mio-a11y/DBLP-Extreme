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
  renderWordCloud,
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

async function doSearchKeyword(pageNum = 1) {
  const input = document.getElementById("sk-input");
  const btn = document.getElementById("sk-btn");
  const hint = document.getElementById("sk-hint");
  const q = input.value.trim();
  if (!q) return;

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
    const data = await apiSearch("keyword", queryStr);
    // 保存当前查询状态用于翻页
    state.keywordQuery = { q, queryStr, data, pageNum };
    renderKeywordResults(data, q, pageNum);
  } catch (e) {
    hint.textContent = `搜索失败: ${e.message}`;
    document.getElementById("sk-results").innerHTML = "";
  } finally {
    btn.disabled = false;
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
  const totalHits = meta.total_hits || data.total || docs.length;
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

  // 关键字搜索（防抖 300ms）+ 输入提示（防抖 120ms）
  {
    let skTimer = null;
    let suggestTimer = null;
    let suggestIndex = -1;
    const skInput = document.getElementById("sk-input");
    const skSuggest = document.getElementById("sk-suggest");

    const skDebounce = () => {
      if (skTimer) clearTimeout(skTimer);
      skTimer = setTimeout(doSearchKeyword, 300);
    };

    const closeSuggest = () => {
      skSuggest.style.display = "none";
      skSuggest.innerHTML = "";
      suggestIndex = -1;
    };

    const selectSuggest = (term) => {
      const val = skInput.value;
      // 替换最后一个 token 为选中的补全词
      const lastSpace = val.lastIndexOf(" ");
      const prefix = lastSpace >= 0 ? val.substring(0, lastSpace + 1) : "";
      skInput.value = prefix + term;
      closeSuggest();
      // 立即搜索
      if (skTimer) { clearTimeout(skTimer); skTimer = null; }
      doSearchKeyword();
    };

    const fetchSuggest = async () => {
      const val = skInput.value;
      if (val.length < 1) { closeSuggest(); return; }
      try {
        const r = await fetch(`/api/suggest/keyword?q=${encodeURIComponent(val)}`);
        if (!r.ok) { closeSuggest(); return; }
        const data = await r.json();
        if (data.error || !data.terms || data.terms.length === 0) { closeSuggest(); return; }
        suggestIndex = -1;
        const items = data.terms.map((t, i) =>
          `<div class="suggest-item" data-idx="${i}" data-term="${escapeHtml(t)}">${escapeHtml(t)}</div>`
        ).join("");
        skSuggest.innerHTML = items;
        skSuggest.style.display = "";
        // 绑定点击
        skSuggest.querySelectorAll(".suggest-item").forEach((el) => {
          el.addEventListener("mousedown", (e) => {
            e.preventDefault();
            selectSuggest(el.dataset.term);
          });
        });
      } catch {
        closeSuggest();
      }
    };

    skInput.addEventListener("input", () => {
      skDebounce();
      if (suggestTimer) clearTimeout(suggestTimer);
      suggestTimer = setTimeout(fetchSuggest, 120);
    });
    skInput.addEventListener("keydown", (e) => {
      const items = skSuggest.querySelectorAll(".suggest-item");
      if (e.key === "ArrowDown" && items.length > 0) {
        e.preventDefault();
        suggestIndex = Math.min(suggestIndex + 1, items.length - 1);
        items.forEach((el, i) => el.classList.toggle("active", i === suggestIndex));
      } else if (e.key === "ArrowUp" && items.length > 0) {
        e.preventDefault();
        suggestIndex = Math.max(suggestIndex - 1, -1);
        items.forEach((el, i) => el.classList.toggle("active", i === suggestIndex));
      } else if (e.key === "Enter") {
        if (suggestIndex >= 0 && items.length > 0) {
          e.preventDefault();
          const sel = items[suggestIndex];
          if (sel) selectSuggest(sel.dataset.term);
          return;
        }
        if (skTimer) { clearTimeout(skTimer); skTimer = null; }
        closeSuggest();
        doSearchKeyword();
      } else if (e.key === "Escape") {
        closeSuggest();
      }
    });
    skInput.addEventListener("blur", () => {
      // 延迟关闭，让 mousedown 先触发
      setTimeout(closeSuggest, 150);
    });
    skInput.addEventListener("focus", () => {
      if (skInput.value.length >= 1) fetchSuggest();
    });
    document.getElementById("sk-btn").addEventListener("click", () => {
      if (skTimer) { clearTimeout(skTimer); skTimer = null; }
      closeSuggest();
      doSearchKeyword();
    });

    // 搜索选项变更时立即重新搜索
    const skReSearch = () => {
      if (skTimer) { clearTimeout(skTimer); skTimer = null; }
      closeSuggest();
      doSearchKeyword();
    };
    document.getElementById("sk-fuzzy").addEventListener("change", skReSearch);
    document.getElementById("sk-fuzzy-level").addEventListener("change", skReSearch);
    document.getElementById("sk-mode-and").addEventListener("change", skReSearch);
    document.getElementById("sk-sort").addEventListener("change", skReSearch);
    document.getElementById("sk-size").addEventListener("change", skReSearch);
  }

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
      renderYearView(state.years[e.target.value]);
    }
  });

  // 词云 / 柱状图切换
  document.querySelectorAll(".toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".toggle-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      yearViewMode = btn.dataset.view;
      const sel = document.getElementById("year-select");
      if (state.years && sel.value && state.years[sel.value]) {
        renderYearView(state.years[sel.value]);
      }
    });
  });

  // 窗口大小变化时重绘词云（Canvas 需要精确尺寸）
  window.addEventListener("resize", () => {
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
