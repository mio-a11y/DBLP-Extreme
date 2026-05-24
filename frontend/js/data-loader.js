// 数据加载层：优先读后端导出 (../build/data/)，失败 fallback 到本地 mock/
// 暴露 isMockMode() 让 UI 显示数据源徽标

const REAL_BASE = "../build/data";
const MOCK_BASE = "mock";

let _useMock = null;

async function probeRealData() {
  try {
    const r = await fetch(`${REAL_BASE}/f3_top100.json`, { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
}

export async function initDataSource() {
  if (_useMock !== null) return _useMock;
  const realOk = await probeRealData();
  _useMock = !realOk;
  return _useMock;
}

export function isMockMode() {
  return _useMock !== false;
}

function base() {
  return _useMock ? MOCK_BASE : REAL_BASE;
}

async function fetchJson(path) {
  const r = await fetch(`${base()}/${path}`);
  if (!r.ok) throw new Error(`无法加载 ${path}: HTTP ${r.status}`);
  return r.json();
}

export async function loadTop100() {
  return fetchJson("f3_top100.json");
}

export async function loadYearKeywords() {
  return fetchJson("f4_year_keywords.json");
}

export async function loadCliqueCounts() {
  return fetchJson("f6_clique_counts.json");
}

export async function computeClique(order) {
  const url = `${window.location.origin}/api/clique?order=${encodeURIComponent(order)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`聚团计算失败: HTTP ${r.status}`);
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data;
}

// 作者名 → 安全文件名
// 规则：lowercase、空格→_、去掉非 [a-z0-9_-] 字符
// 后端必须用同一规则。若想稳一点也可改成 encodeURIComponent。
export function authorToSlug(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "");
}

export async function loadEgo(authorName) {
  // mock 模式下统一返回 sample.json
  if (_useMock) {
    return fetchJson("ego/sample.json");
  }
  const url = `${window.location.origin}/api/ego?name=${encodeURIComponent(authorName)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`无法加载 ego 数据: HTTP ${r.status}`);
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data;
}
