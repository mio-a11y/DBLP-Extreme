# F7 可视化前端

科学文献管理系统 F7 部分：作者合作关系图 + 论文列表 + F3/F4/F6 数据可视化。

## 启动

需要本地静态 HTTP 服务（直接 `file://` 打开会因 fetch 限制失败）。

**重要：必须从项目根目录（包含 `frontend/` 和 `build/` 的那一层）起服务**，否则前端无法访问 `../build/data/`（http.server 只服务 CWD 下的文件）。

```bash
cd d:/一些文档/DB大作业/Datastructure-Project-DBLP-main
python -m http.server 8080
```

浏览器打开 <http://localhost:8080/frontend/>（注意末尾的 `/frontend/`）。

启动后右上角徽标显示数据来源：
- **数据源: Mock (开发模式)** —— `../build/data/` 不存在，正在用本目录下的 `mock/` 假数据
- **数据源: 后端导出** —— 已连上真实数据

## 功能

| Tab | 内容 | 数据来源 |
|---|---|---|
| 作者合作关系图 | 输入作者名 → Cytoscape 渲染 ego 网络（节点大小=发文数，边粗细=合作次数）。点击节点切换右侧论文列表。 | `ego/<slug>.json` |
| F3 Top 100 | 左侧表格 + 右侧横向条形图。点击作者名跳到 Tab 1。 | `f3_top100.json` |
| F4 年度热词 | 年份下拉 + 柱状图。 | `f4_year_keywords.json` |
| F6 聚团统计 | 各阶完全子图数量柱状图（y 轴对数）。 | `f6_clique_counts.json` |

---

## 给后端队友：JSON 契约

前端从 `DBLP_Extreme/build/data/` 读取以下文件。请在 `execute_f7_export_report()` 中实现这些导出。

### 1. `data/f3_top100.json`

```json
[
  {"rank": 1, "name": "Hector Garcia-Molina", "paper_count": 523},
  {"rank": 2, "name": "Jeffrey D. Ullman", "paper_count": 487}
]
```

数据已在 `ExtremeEngine::f3_top100_cache_` 中（`std::vector<std::pair<std::size_t, std::string_view>>`），直接序列化即可。`rank` 从 1 开始。

### 2. `data/f4_year_keywords.json`

```json
{
  "1990": [{"term": "database", "freq": 1234}, {"term": "system", "freq": 980}],
  "1991": [...]
}
```

每年最多 10 条，按 `freq` 降序。数据来自 `ExtremeEngine::compute_f4_top10_for_year(year)`。

### 3. `data/f6_clique_counts.json`

```json
{"2": 1234567, "3": 234567, "4": 45678, "5": 8901}
```

key 是阶数（字符串），value 是该阶完全子图个数。数据来自 `execute_f6_global_ranking()` 内部统计。

### 4. `data/ego/<slug>.json`

每位作者一个文件。`<slug>` 规则：

```cpp
// 作者名 lowercase；空格替换为 '_'；保留 [a-z0-9_-]，其他字符去掉
std::string author_to_slug(std::string_view name);
// 例: "Jeffrey D. Ullman" -> "jeffrey_d_ullman"
//     "Hector Garcia-Molina" -> "hector_garcia-molina"
```

前端 `data-loader.js::authorToSlug()` 用同一规则。务必一致。

文件结构：

```json
{
  "center": "Jeffrey D. Ullman",
  "nodes": [
    {"id": "Jeffrey D. Ullman", "paper_count": 512},
    {"id": "Alfred V. Aho", "paper_count": 287}
  ],
  "edges": [
    {"source": "Jeffrey D. Ullman", "target": "Alfred V. Aho", "weight": 38}
  ],
  "papers_by_author": {
    "Jeffrey D. Ullman": [
      {"doc_id": 1001, "title": "...", "year": 1982, "journal": "...", "ee": "https://..."}
    ]
  }
}
```

要点：
- `nodes` 包含中心作者 + 所有 1-hop 邻居
- `edges` 至少包含中心到每个邻居的边；邻居之间若也有合作关系也可加入（方便看出小圈子）。每条边的 `weight` 是合作论文数。
- `papers_by_author` 至少包含中心作者的论文。邻居的论文可选，前端会优雅降级（"暂无论文数据"）。
- 现有 `search_collaborators()` 只输出名字、没有合作次数，需扩展：扫描作者 posting list 时统计每个共作者出现次数即得到 `weight`。

### 后端实现建议（菜单 [8]）

```
8. F7 可视化数据导出
  [1] 导出全局数据（f3/f4/f6）
  [2] 输入作者名 → 导出单个 ego JSON
  [3] 批量导出 F3 Top 100 作者的 ego JSON（演示用）
```

或者更简单：菜单 [8] 一次性把 1+3 全做了，然后菜单 [9] 单独支持按需输入作者名。

---

## 文件结构

```
frontend/
  index.html          单页四 Tab
  styles.css
  js/
    app.js            入口、Tab 路由、事件绑定
    data-loader.js    JSON fetch、mock fallback、authorToSlug
    graph.js          Cytoscape 渲染
    charts.js         Chart.js (F3/F4/F6)
  mock/
    f3_top100.json
    f4_year_keywords.json
    f6_clique_counts.json
    ego/sample.json   mock 模式下任意作者都返回这个
```

## 依赖

通过 CDN 引入，无需 npm：

- Cytoscape.js 3.30.2
- Chart.js 4.4.4

离线展示前提前打开一次让浏览器缓存即可，或自行下载到本地。
