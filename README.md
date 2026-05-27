# DBLP Extreme — 科学文献搜索与可视化系统

数据结构大作业，基于 DBLP 数据集（1260 万篇文献）的全文检索与作者合作网络分析工具。

## 环境要求

- **g++** (MinGW-w64 on Windows, 或系统自带 on Linux/macOS)
- **CMake** ≥ 3.16
- **Python** ≥ 3.8
- 约 **18 GB** 磁盘空间（XML 5GB + 索引缓存 ~7GB + 内存 7-8GB）

## 快速启动

### 1. 克隆仓库

```bash
git clone https://github.com/mio-a11y/DBLP-Extreme.git
cd Datastructure-Project-DBLP-main
```

### 2. 下载数据文件

从 [DBLP 官网](https://dblp.org/xml/dblp.xml.gz) 下载 `dblp.xml.gz`，解压后放到 `build/` 目录下：

```bash
# 将 dblp.xml (约 5GB) 放入 build/ 目录
```

### 3. 启动 Web 服务

```bash
python server.py
```

首次启动约 60-90 秒加载索引并构建缓存，之后看到：

```
==============================================================
  DBLP Extreme 搜索服务已启动
  前端地址: http://localhost:8080/
==============================================================
```

### 4. 打开浏览器

访问 **http://localhost:8080/**

## 功能概览

| Tab | 功能 | 说明 |
|-----|------|------|
| 按作者搜索 | 精确 + 模糊匹配 | 支持分页（每页 20 条），自动容错匹配 |
| 按标题搜索 | 关键词索引加速 | 支持分页（每页 20 条），最多 500 条结果 |
| 关键字搜索 | BM25 全文检索 | 支持模糊搜索、AND/OR 模式、年份排序、输入自动补全提示 |
| 合作关系图 | 实时 ego 网络 | 输入任意作者名，生成合作网络图，点击节点查看论文 |
| Top 100 | 作者发文排名 | 表格 + 横向条形图，点击作者跳转合作网络 |
| 年度热词 | 逐年关键词趋势 | 柱状图 / 词云切换，下拉切换年份 |
| 聚团统计 | 完全子图计数 | 选择 2-12 阶，对数坐标柱状图，支持缓存 |

### 关键字搜索特性

- **BM25 Block-Max WAND** 算法，千万级文献秒级响应
- **输入提示**：输入时自动弹出前缀/子串补全建议，按文档频率排序，支持键盘 ↑↓ Enter 导航
- **模糊搜索**：基于编辑距离的拼写容错（trigram 索引加速）
- **AND/OR 模式**：可选择必须包含所有词或任一匹配
- **排序**：相关度优先 / 最新年份优先
- **结果上限 500 条**，分页浏览

## 项目结构

```
├── CMakeLists.txt          # C++ 编译配置
├── server.py               # Python HTTP 服务器（API + 静态文件）
├── include/                # C++ 头文件
├── src/                    # C++ 源码
│   ├── main.cpp            # 入口 + --serve 模式
│   └── ExtremeEngine.cpp   # 核心引擎 (搜索/聚团/ego/补全)
├── frontend/               # Web 前端
│   ├── index.html
│   ├── styles.css
│   └── js/
│       ├── app.js          # 主逻辑 + 搜索 + 分页 + 输入提示
│       ├── data-loader.js  # 数据加载层 (API + 缓存 + mock fallback)
│       ├── charts.js       # Chart.js 图表 + Canvas 词云
│       └── graph.js        # Cytoscape.js 合作网络图
├── config/                 # 停用词/查询模板
└── build/
    ├── dblp.xml            # (需自行下载)
    ├── segments/           # (首次运行自动生成)
    └── data/               # 导出数据 (Top100/年度热词/聚团)
```

## API 端点

| 路由 | 参数 | 说明 |
|------|------|------|
| `/api/search/author` | `q`, `page`, `size` | 作者搜索 |
| `/api/search/title` | `q`, `page`, `size` | 标题搜索 |
| `/api/search/keyword` | `q` | 关键字 BM25 搜索（page/size 内嵌于 q） |
| `/api/suggest/keyword` | `q` | 关键字输入补全建议 |
| `/api/ego` | `name` | 作者合作 ego 网络 |
| `/api/clique` | `order` | 聚团统计（指定最大阶数） |
| `/api/status` | — | 服务健康检查 |
