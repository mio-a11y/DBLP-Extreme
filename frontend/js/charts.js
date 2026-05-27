// Chart.js 图表：F3 Top100, F4 年度热词, F6 聚团统计

let top100Chart = null;
let yearChart = null;
let cliqueChart = null;

const BAR_COLOR = "#5b8ed4";
const BAR_COLOR_HOVER = "#2b3a67";

export function renderTop100Chart(top100, limit) {
  const data = top100.slice(0, limit);
  const ctx = document.getElementById("top100-chart").getContext("2d");

  if (top100Chart) top100Chart.destroy();
  top100Chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.map((d) => d.name),
      datasets: [
        {
          label: "发文数",
          data: data.map((d) => d.paper_count),
          backgroundColor: BAR_COLOR,
          hoverBackgroundColor: BAR_COLOR_HOVER,
          borderRadius: 3,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.parsed.x} 篇`,
          },
        },
      },
      scales: {
        x: { beginAtZero: true, ticks: { font: { size: 11 } } },
        y: { ticks: { font: { size: 10 }, autoSkip: false } },
      },
    },
  });
}

export function renderYearChart(yearData) {
  const ctx = document.getElementById("year-chart").getContext("2d");

  if (yearChart) yearChart.destroy();
  yearChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: yearData.map((d) => d.term),
      datasets: [
        {
          label: "出现频次",
          data: yearData.map((d) => d.freq),
          backgroundColor: BAR_COLOR,
          hoverBackgroundColor: BAR_COLOR_HOVER,
          borderRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.parsed.y} 次`,
          },
        },
      },
      scales: {
        x: { ticks: { font: { size: 13 } } },
        y: { beginAtZero: true },
      },
    },
  });
}

// ---------- 词云 ----------
let wordCloudData = null;
const WC_COLORS = [
  "#2b3a67", "#5b8ed4", "#e07030", "#3e8c5a", "#c94d6a",
  "#6b4d99", "#d4892a", "#407090", "#a04050", "#558844",
];

export function renderWordCloud(yearData) {
  wordCloudData = yearData;
  const canvas = document.getElementById("year-cloud");
  const wrap = document.getElementById("year-cloud-wrap");
  if (!canvas) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = wrap.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  if (w <= 0 || h <= 0) return;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  if (!yearData || yearData.length === 0) {
    ctx.fillStyle = "#6b7785";
    ctx.font = "16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("暂无数据", w / 2, h / 2);
    return;
  }

  // 按频次降序排列
  const sorted = [...yearData].sort((a, b) => b.freq - a.freq);
  const maxFreq = sorted[0].freq;
  const minFreq = sorted[sorted.length - 1].freq;
  const fRange = maxFreq - minFreq || 1;

  // 已放置词的位置记录
  const placed = [];

  function overlaps(x, y, tw, th) {
    const pad = 3;
    for (const r of placed) {
      if (
        x - pad < r.x + r.w &&
        x + tw + pad > r.x &&
        y - pad < r.y + r.h &&
        y + th + pad > r.y
      ) {
        return true;
      }
    }
    return false;
  }

  for (let idx = 0; idx < sorted.length; idx++) {
    const item = sorted[idx];
    const fontSize = Math.round(14 + ((item.freq - minFreq) / fRange) * 58);
    ctx.font = `bold ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    const metrics = ctx.measureText(item.term);
    const tw = metrics.width;
    const th = fontSize * 1.1;

    let px = w / 2;
    let py = h / 2;
    let angle = Math.random() * Math.PI * 2;
    let radius = 0;
    const step = 1.8;
    let found = false;

    for (let attempt = 0; attempt < 3000; attempt++) {
      px = w / 2 + radius * Math.cos(angle);
      py = h / 2 + radius * Math.sin(angle);
      angle += 0.5;
      radius += step * (0.5 + 1.0 / (angle * 0.3 + 1));

      // 确保在画布内
      if (px < 2 || py < 2 || px + tw > w - 2 || py + th > h - 2) continue;
      if (overlaps(px, py, tw, th)) continue;

      found = true;
      break;
    }

    if (!found) {
      // 无法放置时用随机位置兜底
      for (let fallback = 0; fallback < 200; fallback++) {
        px = Math.random() * (w - tw - 4) + 2;
        py = Math.random() * (h - th - 4) + 2;
        if (!overlaps(px, py, tw, th)) { found = true; break; }
      }
    }

    if (found) {
      placed.push({ x: px, y: py, w: tw, h: th });
      ctx.fillStyle = WC_COLORS[idx % WC_COLORS.length];
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(item.term, px, py);
    }
  }
}

export function renderCliqueChart(cliqueCounts) {
  const ctx = document.getElementById("clique-chart").getContext("2d");
  const entries = Object.entries(cliqueCounts)
    .map(([k, v]) => [parseInt(k, 10), v])
    .sort((a, b) => a[0] - b[0]);

  if (cliqueChart) cliqueChart.destroy();
  cliqueChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: entries.map(([k]) => `阶 ${k}`),
      datasets: [
        {
          label: "完全子图个数",
          data: entries.map(([, v]) => v),
          backgroundColor: BAR_COLOR,
          hoverBackgroundColor: BAR_COLOR_HOVER,
          borderRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.parsed.y.toLocaleString()} 个`,
          },
        },
      },
      scales: {
        y: {
          type: "logarithmic",
          ticks: {
            callback: (v) => v.toLocaleString(),
          },
        },
      },
    },
  });
}
