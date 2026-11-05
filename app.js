"use strict";

const PRIVATE_WIKI = "https://github.com/chc0331/PEIM/blob/main/";
const RELATED = {
  conceptually_related_to: "관련",
  references: "참조",
  cites: "인용",
  implements: "구현",
  rationale_for: "근거",
  shares_data_with: "데이터 공유"
};
const elements = {
  search: document.getElementById("search"),
  hint: document.getElementById("search-hint"),
  results: document.getElementById("results"),
  summary: document.getElementById("summary"),
  graph: document.getElementById("graph"),
  caption: document.getElementById("graph-caption"),
  details: document.getElementById("details"),
  builtAt: document.getElementById("built-at")
};
let data;
let nodesById;
let adjacent;
let selectedId;
let network;

function norm(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("ko-KR");
}

function textNode(tag, content, className) {
  const el = document.createElement(tag);
  el.textContent = content;
  if (className) el.className = className;
  return el;
}

function resultButton(node) {
  const li = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = node.label;
  button.setAttribute("aria-current", String(node.id === selectedId));
  const alias = (node.aliases || []).find(value => norm(value) !== norm(node.label));
  if (alias) button.appendChild(textNode("small", alias));
  button.addEventListener("click", () => select(node.id));
  li.appendChild(button);
  return li;
}

function searchResults() {
  const q = norm(elements.search.value.trim());
  elements.results.replaceChildren();
  let matches;
  if (q) {
    matches = data.nodes.map(node => {
      const labels = [node.label, ...(node.aliases || [])].map(norm);
      const score = labels.includes(q) ? 0 : labels.some(value => value.startsWith(q)) ? 1 : labels.some(value => value.includes(q)) ? 2 : 3;
      return {node, score};
    }).filter(item => item.score < 3).sort((a, b) => a.score - b.score || a.node.label.localeCompare(b.node.label, "ko")).slice(0, 12).map(item => item.node);
  } else {
    const examples = ["데이터 거버넌스", "AI 거버넌스", "DevOps", "TLS 1.3", "정규화"];
    matches = examples.map(label => data.nodes.find(node => node.label === label)).filter(Boolean);
  }
  elements.hint.textContent = q ? `검색 결과 ${matches.length}개${matches.length === 12 ? " (상위 12개)" : ""}` : "시작 예시 · 중요도 순위가 아닙니다";
  if (!matches.length) elements.results.appendChild(textNode("li", "일치하는 개념이 없습니다.", "hint"));
  matches.forEach(node => elements.results.appendChild(resultButton(node)));
}

function neighborhood(id, depth) {
  const seen = new Set([id]);
  let frontier = [id];
  for (let step = 0; step < depth; step++) {
    const next = [];
    for (const current of frontier) {
      for (const neighbor of adjacent.get(current) || []) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

function relationLabel(edge) {
  return RELATED[edge.relation] || edge.relation.replaceAll("_", " ");
}

function showGraph() {
  const focus = nodesById.get(selectedId);
  const depth = Number(document.querySelector('input[name="depth"]:checked').value);
  const visible = neighborhood(selectedId, depth);
  const edges = data.edges.filter(edge => visible.has(edge.source) && visible.has(edge.target));
  elements.caption.textContent = `${focus.label} · ${visible.size}개 노드 · ${edges.length}개 연결`;
  elements.graph.setAttribute("aria-label", `${focus.label}에서 ${depth}단계까지의 관련 개념 ${visible.size}개와 연결 ${edges.length}개`);
  if (network) network.destroy();
  if (!window.vis || !window.vis.Network) {
    elements.graph.replaceChildren(textNode("p", "그래프 라이브러리를 불러오지 못했습니다. 오른쪽 관련 개념 목록은 이용할 수 있습니다.", "graph-error"));
    return;
  }
  const displayNodes = [...visible].map(id => {
    const node = nodesById.get(id);
    const selected = id === selectedId;
    const document = node.file_type === "document";
    return {
      id,
      label: node.label,
      title: node.label,
      shape: "dot",
      size: selected ? 25 : document ? 14 : 17,
      color: {background: selected ? "#e5a545" : document ? "#8394a5" : "#397fa8", border: selected ? "#9d6416" : "#ffffff"},
      font: {color: "#14263d", size: selected ? 16 : 13, face: "sans-serif", strokeWidth: 5, strokeColor: "#ffffff"},
      borderWidth: 2
    };
  });
  const displayEdges = edges.map((edge, index) => ({
    id: index,
    from: edge.source,
    to: edge.target,
    arrows: "to",
    title: `${relationLabel(edge)} · ${edge.confidence}`,
    color: {color: "#9db1c0", hover: "#176a9c"},
    width: 1.5
  }));
  network = new vis.Network(elements.graph, {nodes: displayNodes, edges: displayEdges}, {
    autoResize: true,
    interaction: {hover: true, navigationButtons: true, keyboard: true},
    layout: {improvedLayout: true},
    physics: {stabilization: {iterations: 150}, barnesHut: {gravitationalConstant: -3800, springLength: 140}}
  });
  network.once("stabilized", () => {
    network.setOptions({physics: false});
    network.fit({animation: {duration: 300}});
  });
  network.on("click", event => {
    if (event.nodes.length) select(event.nodes[0]);
  });
}

function showDetails() {
  const node = nodesById.get(selectedId);
  const panel = elements.details;
  panel.replaceChildren();
  panel.appendChild(textNode("h3", node.label, "node-title"));
  panel.appendChild(textNode("span", node.review_status || node.document_status, "status"));
  panel.appendChild(textNode("p", node.description || "이 노드의 별도 설명은 기준 위키에서 확인할 수 있습니다.", "description"));
  const source = textNode("p", "위키 문서: ", "meta");
  const link = document.createElement("a");
  link.href = PRIVATE_WIKI + node.source_file.split("/").map(encodeURIComponent).join("/");
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = node.source_file.replace("wiki/concepts/", "");
  source.appendChild(link);
  if (node.source_location) source.appendChild(document.createTextNode(` · ${node.source_location}`));
  panel.appendChild(source);
  panel.appendChild(textNode("h3", "직접 연결된 개념"));
  const relations = data.edges.filter(edge => edge.source === selectedId || edge.target === selectedId);
  const list = document.createElement("ul");
  list.className = "relation-list";
  relations.sort((a, b) => (nodesById.get(a.source === selectedId ? a.target : a.source).label).localeCompare(nodesById.get(b.source === selectedId ? b.target : b.source).label, "ko"));
  for (const edge of relations) {
    const outgoing = edge.source === selectedId;
    const other = nodesById.get(outgoing ? edge.target : edge.source);
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${outgoing ? "→" : "←"} ${other.label}`;
    button.appendChild(textNode("small", `${relationLabel(edge)} · ${edge.confidence === "EXTRACTED" ? "문서에 명시된 연결" : edge.confidence === "INFERRED" ? "추론된 연결" : "불확실한 연결"}`));
    button.addEventListener("click", () => select(other.id));
    li.appendChild(button);
    list.appendChild(li);
  }
  panel.appendChild(list);
}

function select(id) {
  selectedId = id;
  searchResults();
  showDetails();
  showGraph();
}

async function start() {
  try {
    const response = await fetch("./graph-data.json", {cache: "no-store"});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
    nodesById = new Map(data.nodes.map(node => [node.id, node]));
    adjacent = new Map(data.nodes.map(node => [node.id, new Set()]));
    for (const edge of data.edges) {
      adjacent.get(edge.source).add(edge.target);
      adjacent.get(edge.target).add(edge.source);
    }
    elements.summary.textContent = `개념 문서에서 추출한 ${data.nodes.length.toLocaleString("ko-KR")}개 노드 · ${data.edges.length.toLocaleString("ko-KR")}개 연결`;
    elements.builtAt.textContent = `그래프 빌드: ${data.built_at}`;
    elements.search.addEventListener("input", searchResults);
    document.querySelectorAll('input[name="depth"]').forEach(input => input.addEventListener("change", showGraph));
    const first = data.nodes.find(node => node.label === "데이터 거버넌스") || data.nodes[0];
    select(first.id);
  } catch (error) {
    elements.summary.textContent = "개념 데이터를 불러오지 못했습니다.";
    elements.graph.replaceChildren(textNode("p", `페이지 데이터를 확인해 주세요: ${error.message}`, "graph-error"));
  }
}

start();
