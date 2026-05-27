# F7 可视化前端

科学文献管理系统 F7 部分：搜索 + 合作网络图 + 论文列表 + F3/F4/F6 数据可视化。

## 启动

### 生产模式（推荐）

由项目根目录的 `server.py` 统一提供服务（API + 静态文件）：

```bash
cd Datastructure-Project-DBLP-main
python server.py
```

浏览器打开 **http://localhost:8080/**，右上角徽标显示数据来源（Mock / 后端导出）。

### 独立开发（Mock 数据）

前端可脱离后端独立调试，`data-loader.js` 会自动 fallback 到 `mock/` 假数据：

```bash
cd Datastructure-Project-DBLP-main
python -m http.server 8080
# 浏览器打开 http://localhost:8080/frontend/
```

## 功能

| Tab | 内容 | 数据来源 |
|---|---|---|
| 按作者搜索 | 精确 + 模糊匹配，分页（每页 20 条） | `/api/search/author` |
| 按标题搜索 | 关键词索引加速，分页（每页 20 条） | `/api/search/title` |
| 关键字搜索 | BM25 全文检索，支持模糊搜索、AND/OR 模式、年份排序、**输入自动补全提示** | `/api/search/keyword` + `/api/suggest/keyword` |
| 合作关系图 | 输入作者名 → Cytoscape 渲染 ego 网络（节点大小=发文数，边粗细=合作次数）。点击节点切换右侧论文列表。 | `/api/ego` 或 `ego/<slug>.json` |
| Top 100 | 左侧表格 + 右侧横向条形图。点击作者名跳到合作网络 Tab。 | `f3_top100.json` |
| 年度热词 | 年份下拉 + **柱状图 / 词云切换**。Canvas 手写词云，螺旋布局 + 碰撞检测。 | `f4_year_keywords.json` |
| 聚团统计 | 各阶完全子图数量柱状图（y 轴对数坐标）。支持 2-12 阶，有缓存。 | `/api/clique` 或 `f6_clique_counts.json` |

## API 端点

| 路由 | 参数 | 说明 |
|------|------|------|
| `/api/search/author` | `q`, `page`, `size` | 作者搜索（分页） |
| `/api/search/title` | `q`, `page`, `size` | 标题搜索（分页） |
| `/api/search/keyword` | `q` | 关键字 BM25 搜索 |
| `/api/suggest/keyword` | `q` | 关键字输入补全建议 |
| `/api/ego` | `name` | 作者合作 ego 网络 |
| `/api/clique` | `order` | 聚团统计 |
| `/api/status` | — | 健康检查 |

---

## 给后端队友：JSON 契约

若不打 HTTP API，前端也支持从 `build/data/` 直接读取 JSON 文件。

### 1. `data/f3_top100.json`

```json
[
  {"rank": 1, "name": "Hector Garcia-Molina", "paper_count": 523}
]
```

数据已在 `ExtremeEngine::f3_top100_cache_` 中，`rank` 从 1 开始。

### 2. `data/f4_year_keywords.json`

```json
{
  "1990": [{"term": "database", "freq": 1234}],
  "1991": [{"term": "system", "freq": 980}]
}
```

每年最多 10 条，按 `freq` 降序。

### 3. `data/f6_clique_counts.json`

```json
{"2": 1234567, "3": 234567, "4": 45678, "5": 8901}
```

key 是阶数（字符串），value 是该阶完全子图个数。

### 4. `data/ego/<slug>.json`

每位作者一个文件。`<slug>` 规则：

```cpp
// 作者名 lowercase；空格替换为 '_'；保留 [a-z0-9_-]，其他字符去掉
std::string author_to_slug(std::string_view name);
// 例: "Jeffrey D. Ullman" -> "jeffrey_d_ullman"
//     "Hector Garcia-Molina" -> "hector_garcia-molina"
```

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

---

## 文件结构

```
frontend/
  index.html          单页 7 Tab
  styles.css
  js/
    app.js            入口、Tab 路由、搜索、分页、输入提示
    data-loader.js    JSON fetch、mock fallback、authorToSlug
    graph.js          Cytoscape 合作网络渲染
    charts.js         Chart.js 图表 + Canvas 词云
  mock/
    f3_top100.json
    f4_year_keywords.json
    f6_clique_counts.json
    ego/sample.json
```

## 依赖

通过 CDN 引入，无需 npm：

- Cytoscape.js 3.30.2
- Chart.js 4.4.4
