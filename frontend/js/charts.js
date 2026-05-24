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
