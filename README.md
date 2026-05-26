# DBLP Extreme — 科学文献搜索与可视化系统

数据结构大作业，基于 DBLP 数据集的全文检索与作者合作网络分析工具。

## 环境要求

- **g++** (MinGW-w64 on Windows, 或系统自带 on Linux/macOS)
- **CMake** ≥ 3.16
- **Python** ≥ 3.8
- 约 **10 GB** 磁盘空间（XML 5GB + 索引缓存 ~4GB）

## 快速启动

### 1. 克隆仓库

```bash
git clone <仓库地址>
cd Datastructure-Project-DBLP-main
```

### 2. 下载数据文件

从 [DBLP 官网](https://dblp.org/xml/dblp.xml.gz) 下载 `dblp.xml.gz`，解压后放到 `build/` 目录下：

```bash
mkdir -p build
# 将 dblp.xml (约 5GB) 放入 build/ 目录
```


### 3. 首次运行（构建索引缓存）

```bash
./dblp_extreme
```

等待约 5 分钟，程序会自动解析 XML 并生成二进制索引缓存到 `segments/` 目录。后续启动将直接加载缓存，几秒内就绪。

看到交互菜单后按 Ctrl+C 退出。

### 4. 启动 Web 服务

```bash
cd ..          # 回到项目根目录
python server.py
```

首次启动约 60 秒加载索引，之后看到：

```
==============================================================
  DBLP Extreme 搜索服务已启动
  前端地址: http://localhost:8080/
==============================================================
```

### 6. 打开浏览器

访问 **http://localhost:8080/**

## 功能概览

| Tab | 功能 | 说明 |
|-----|------|------|
| 按作者搜索 | Token 化模糊匹配 | 实时查询，支持中英文作者名 |
| 按标题搜索 | 关键词索引加速 | 500 条结果 |
| 关键字搜索 | BM25 全文检索 | 500 条结果 |
| 合作关系图 | 实时计算 | 输入任意作者名，生成合作网络（50 人上限） |
| Top 100 | 作者发文排名 | 表格 + 水平条形图 |
| 年度热词 | 逐年关键词趋势 | 下拉切换年份 |
| 聚团统计 | 可配置阶数 | 选择 2-12 阶，实时/缓存计算 |

## 项目结构

```
├── CMakeLists.txt          # C++ 编译配置
├── server.py               # Python HTTP 服务器
├── include/                # C++ 头文件
├── src/                    # C++ 源码
│   ├── main.cpp            # 入口 + --serve 模式
│   └── ExtremeEngine.cpp   # 核心引擎 (搜索/聚团/ego网络)
├── frontend/               # Web 前端
│   ├── index.html
│   ├── styles.css
│   └── js/
│       ├── app.js          # 主逻辑 + 搜索处理
│       ├── data-loader.js  # 数据加载层 (API + 缓存)
│       ├── charts.js       # Chart.js 图表
│       └── graph.js        # Cytoscape.js 合作网络图
├── config/                 # 停用词/查询模板
└── build/
    ├── dblp.xml            # (需自行下载)
    ├── segments/           # (首次运行自动生成)
    └── data/               # 导出数据 (Top100/年度热词/聚团)
```
