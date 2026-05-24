// Cytoscape ego-network 渲染
// 暴露 renderEgo(egoData, onNodeClick)，调用方传入数据和节点点击回调

let cy = null;

const STYLE = [
  {
    selector: "node",
    style: {
      "background-color": "#5b8ed4",
      label: "data(label)",
      "font-size": 11,
      color: "#1f2933",
      "text-valign": "bottom",
      "text-margin-y": 4,
      "text-outline-color": "#fff",
      "text-outline-width": 2,
      width: "data(size)",
      height: "data(size)",
      "border-width": 1,
      "border-color": "#2b3a67",
    },
  },
  {
    selector: "node.center",
    style: {
      "background-color": "#d04a4a",
      "border-color": "#a32020",
      "border-width": 2,
      "font-weight": "bold",
      "font-size": 13,
    },
  },
  {
    selector: "node:selected",
    style: {
      "border-color": "#f5a623",
      "border-width": 3,
    },
  },
  {
    selector: "edge",
    style: {
      "line-color": "#b0bcd0",
      "curve-style": "bezier",
      width: "data(width)",
      opacity: 0.7,
    },
  },
  {
    selector: "edge:selected",
    style: {
      "line-color": "#f5a623",
      opacity: 1,
    },
  },
];

// paper_count → 节点直径
function sizeForPapers(n, maxPapers) {
  const minSize = 22;
  const maxSize = 70;
  if (maxPapers <= 0) return minSize;
  const ratio = Math.sqrt(n / maxPapers); // sqrt 让小作者也能看清
  return minSize + (maxSize - minSize) * ratio;
}

// weight → 边宽度
function widthForWeight(w, maxWeight) {
  const minW = 1;
  const maxW = 8;
  if (maxWeight <= 0) return minW;
  return minW + (maxW - minW) * (w / maxWeight);
}

function ensureCy() {
  if (cy) return cy;
  cy = cytoscape({
    container: document.getElementById("cy"),
    style: STYLE,
    layout: { name: "cose", animate: false },
    wheelSensitivity: 0.2,
    minZoom: 0.2,
    maxZoom: 3,
  });
  return cy;
}

export function renderEgo(ego, onNodeClick) {
  const cyInst = ensureCy();
  const maxPapers = Math.max(...ego.nodes.map((n) => n.paper_count || 1));
  const maxWeight = Math.max(...ego.edges.map((e) => e.weight || 1), 1);

  const elements = [
    ...ego.nodes.map((n) => ({
      data: {
        id: n.id,
        label: n.id,
        size: sizeForPapers(n.paper_count || 1, maxPapers),
        paper_count: n.paper_count || 0,
      },
      classes: n.id === ego.center ? "center" : "",
    })),
    ...ego.edges.map((e) => ({
      data: {
        id: `${e.source}__${e.target}`,
        source: e.source,
        target: e.target,
        width: widthForWeight(e.weight || 1, maxWeight),
        weight: e.weight || 0,
      },
    })),
  ];

  cyInst.elements().remove();
  cyInst.add(elements);
  cyInst.layout({
    name: "cose",
    animate: false,
    nodeRepulsion: () => 8000,
    idealEdgeLength: () => 100,
    padding: 30,
  }).run();
  cyInst.fit(null, 40);

  cyInst.off("tap", "node");
  cyInst.on("tap", "node", (evt) => {
    const id = evt.target.data("id");
    if (typeof onNodeClick === "function") onNodeClick(id);
  });

  // 默认显示中心作者的论文
  if (typeof onNodeClick === "function") onNodeClick(ego.center);
}

export function clearGraph() {
  if (cy) cy.elements().remove();
}
