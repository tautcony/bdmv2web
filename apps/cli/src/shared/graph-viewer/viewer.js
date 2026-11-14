(function () {
  "use strict";
  var payload = JSON.parse(document.getElementById("payload").textContent);
  var SVGNS = "http://www.w3.org/2000/svg";
  var state = { view: null, transform: { x: 0, y: 0, k: 1 }, showUnreachable: false, programId: null, search: "", layoutMode: "layered", currentModel: null, currentEntryId: null, currentOptions: {} };
  var navStack = [];
  function pushNav() {
    navStack.push({ view: state.view, programId: state.programId });
    if (navStack.length > 64) navStack.shift();
    document.getElementById("btn-back").disabled = false;
  }
  function goBack() {
    var previous = navStack.pop();
    if (!previous) return;
    if (previous.view === "program") showProgram(previous.programId, false);
    else if (previous.view === "overview") showOverview(false);
    if (!navStack.length) document.getElementById("btn-back").disabled = true;
  }
  var viewport = document.getElementById("viewport");
  var edgesLayer = document.getElementById("edges-layer");
  var nodesLayer = document.getElementById("nodes-layer");
  var svg = document.getElementById("canvas");
  var detail = document.getElementById("detail");

  function el(tag, attrs, parent) {
    var node = document.createElementNS(SVGNS, tag);
    for (var key in attrs) node.setAttribute(key, attrs[key]);
    if (parent) parent.appendChild(node);
    return node;
  }
  function h(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function programById(id) {
    for (var i = 0; i < payload.programs.length; i++) if (payload.programs[i].id === id) return payload.programs[i];
    return null;
  }
  function escapeHtml(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---------- stats / sidebar ----------
  function renderStats() {
    var stats = document.getElementById("stats");
    var counts = payload.counts;
    var chips = [
      ["entries", counts.entries], ["MovieObjects", counts.movieObjects], ["buttons", counts.buttonPrograms],
      ["blocks", counts.blocks], ["playlists", counts.playlists],
    ];
    stats.innerHTML = chips.map(function (pair) {
      return "<span class='chip'>" + pair[0] + " <b>" + pair[1] + "</b></span>";
    }).join("");
    if (counts.unresolvedEdges) stats.innerHTML += "<span class='chip warn'>unresolved <b>" + counts.unresolvedEdges + "</b></span>";
    var closure = document.getElementById("closure-chip");
    if (payload.mediaClosure) {
      var mc = payload.mediaClosure;
      closure.innerHTML = "<span class='" + (mc.complete ? "chip" : "chip warn") + "'>media closure <b>" +
        (mc.complete ? "complete" : mc.unknownCount + " unknown") + "</b></span>";
    }
  }

  function renderSidebar() {
    var query = state.search.toLowerCase();
    function match(text) { return !query || text.toLowerCase().indexOf(query) !== -1; }
    var mobjList = document.getElementById("list-mobj");
    mobjList.innerHTML = "";
    payload.programs.forEach(function (program) {
      if (program.kind !== "movie-object") return;
      if (!match(program.label + " mobj " + program.id)) return;
      var item = h("button", "item" + (state.programId === program.id && state.view === "program" ? " selected" : ""));
      item.innerHTML = "<b>" + escapeHtml(program.label) + "</b><span class='sub'>" + program.instructionCount + " cmds · " + program.blocks.length + " blocks</span>";
      item.addEventListener("click", function () { showProgram(program.id); });
      mobjList.appendChild(item);
    });
    var buttonList = document.getElementById("list-buttons");
    buttonList.innerHTML = "";
    var byStream = {};
    payload.programs.forEach(function (program) {
      if (program.kind !== "button-program") return;
      if (!match(program.label + " btn " + program.id + " " + (program.streamClipId || ""))) return;
      var stream = program.streamClipId || "unknown";
      (byStream[stream] = byStream[stream] || []).push(program);
    });
    Object.keys(byStream).sort().forEach(function (stream) {
      var details = h("details", "stream");
      details.innerHTML = "<summary>" + escapeHtml(stream) + " · " + byStream[stream].length + "</summary>";
      byStream[stream].forEach(function (program) {
        var item = h("button", "item" + (state.programId === program.id && state.view === "program" ? " selected" : ""));
        item.innerHTML = "<b>" + escapeHtml(program.label) + "</b><span class='sub'>" + program.instructionCount + " cmds</span>";
        item.addEventListener("click", function () { showProgram(program.id); });
        details.appendChild(item);
      });
      buttonList.appendChild(details);
    });
    var playlistList = document.getElementById("list-playlists");
    playlistList.innerHTML = "";
    payload.playlists.forEach(function (playlist) {
      if (!match("pl " + playlist.id)) return;
      var item = h("button", "item");
      item.innerHTML = "<b>PL " + escapeHtml(playlist.id) + "</b><span class='sub'>" + playlist.itemCount + " items" + (playlist.routes.length ? " · " + playlist.routes.length + " routes" : "") + "</span>";
      item.addEventListener("click", function () { showPlaylist(playlist.id); });
      playlistList.appendChild(item);
    });
    var unknownList = document.getElementById("list-unknown");
    unknownList.innerHTML = "";
    var unknowns = payload.mediaClosure ? payload.mediaClosure.unknown : [];
    if (!payload.mediaClosure) {
      unknownList.appendChild(h("div", "meta-row muted", "closure not computed"));
    } else if (!unknowns.length) {
      unknownList.appendChild(h("div", "meta-row muted", "none — closure is complete"));
    } else {
      var item = h("button", "item");
      item.innerHTML = "<b>Unknown</b><span class='sub'>" + unknowns.length + " entries · click for table</span>";
      item.addEventListener("click", function () { showUnknownTable(unknowns); });
      unknownList.appendChild(item);
    }
  }

  // ---------- graph model ----------
  function programModel(program) {
    var nodes = {};
    var edges = [];
    var seen = {};
    program.blocks.forEach(function (block) {
      nodes[block.id] = { id: block.id, type: "block", label: blockLabel(block), lines: [block.id + " · " + pcRange(block), block.summary], block: block };
    });
    program.edges.forEach(function (edge) {
      if (edge.kind === "sequence" && edge.condition === null && edge.toBlock === edge.fromBlock) return;
      var key = [edge.fromBlock, edge.toBlock || "", edge.toPlaylist || "", edge.toObject || "", edge.kind, edge.condition || ""].join(">");
      if (seen[key]) return;
      seen[key] = true;
      var target, type;
      if (edge.toBlock) { target = edge.toBlock; type = "block"; }
      else if (edge.toPlaylist) {
        target = edge.toPlaylist;
        type = "playlist";
        if (!nodes[target]) nodes[target] = { id: target, type: "playlist", label: "PL " + target.slice(9), lines: ["PL " + target.slice(9), "playlist"] };
      } else if (edge.toObject) {
        target = edge.toObject;
        type = "object";
        var other = programById(Number(target.slice(7)));
        var label = other ? other.label : target;
        if (!nodes[target]) nodes[target] = { id: target, type: "object", label: label, lines: [label, other ? "click to open" : "missing program"], programId: Number(target.slice(7)) };
      } else { target = "unknown"; type = "unknown"; if (!nodes[target]) nodes[target] = { id: target, type: "unknown", label: "unknown", lines: ["dynamic target", "unknown"] }; }
      edges.push({ from: edge.fromBlock, to: target, kind: edge.kind, condition: edge.condition, unresolved: !edge.toBlock && !edge.toPlaylist && !edge.toObject, fromPc: edge.fromPc });
    });
    // Buttons that call or jump into this MovieObject enter at its first command;
    // their nodes make the inbound menu logic traversable from the MO view.
    var roots = program.entryBlock !== null ? [program.entryBlock] : [];
    if (program.kind === "movie-object" && program.entryBlock !== null) {
      var targetId = "object:" + program.id;
      payload.programs.forEach(function (caller) {
        if (caller.kind !== "button-program") return;
        if (!caller.edges.some(function (edge) { return edge.toObject === targetId; })) return;
        var inboundId = "inbound:" + caller.id;
        nodes[inboundId] = { id: inboundId, type: "button", label: caller.label, lines: ["◀ " + caller.label, "entry · " + (caller.streamClipId || "button")], programId: caller.id };
        edges.push({ from: inboundId, to: program.entryBlock, kind: "call", condition: null, unresolved: false, fromPc: 0 });
        roots.push(inboundId);
      });
    }
    return { nodes: nodes, edges: edges, roots: roots };
  }
  function blockLabel(block) { return block.id + " · " + pcRange(block); }
  function pcRange(block) { return block.commandCount === 1 ? "PC " + block.startPc : "PC " + block.startPc + "–" + (block.startPc + block.commandCount - 1); }

  var OVERVIEW_MAX_BUTTONS = 40;
  function overviewModel() {
    var nodes = {};
    var edges = [];
    var seen = {};
    var buttons = payload.programs.filter(function (program) { return program.kind === "button-program"; });
    var collapsed = buttons.length > OVERVIEW_MAX_BUTTONS;
    var streamOf = function (programId) {
      var program = programById(programId);
      return program && program.streamClipId ? "stream:" + program.streamClipId : null;
    };
    payload.entries.forEach(function (entry) {
      var id = "entry:" + entry.id;
      nodes[id] = { id: id, type: "entry", label: entry.kind + " · " + entry.id, lines: [entry.kind + " · " + entry.id, entry.objectType === "HDMV" ? "HDMV " + entry.target : entry.objectType] };
      if (entry.objectType === "HDMV" && entry.target !== null && programById(entry.target)) {
        edges.push({ from: id, to: "object:" + entry.target, kind: "entry", condition: null, unresolved: false, fromPc: 0 });
      }
    });
    payload.programs.forEach(function (program) {
      var id = "object:" + program.id;
      if (program.kind === "button-program" && collapsed) {
        var streamId = streamOf(program.id);
        if (streamId && !nodes[streamId]) {
          var members = buttons.filter(function (item) { return streamOf(item.id) === streamId; });
          nodes[streamId] = { id: streamId, type: "button", label: "Buttons " + streamId.slice(7), lines: ["Buttons · " + streamId.slice(7), members.length + " programs"] };
        }
        return;
      }
      if (!nodes[id]) nodes[id] = { id: id, type: program.kind === "movie-object" ? "mobj" : "button", label: program.label, lines: [program.label, program.instructionCount + " cmds"] };
      var edgeSource = program.kind === "button-program" ? streamOf(program.id) || id : id;
      program.edges.forEach(function (edge) {
        if (edge.kind === "sequence") return;
        var key = [edgeSource, edge.toPlaylist || "", edge.toObject || "", edge.kind].join(">");
        if (seen[key]) return;
        seen[key] = true;
        if (edge.toPlaylist) {
          var plId = edge.toPlaylist;
          if (!nodes[plId]) {
            var pl = playlistById(plId.slice(9));
            nodes[plId] = { id: plId, type: "playlist", label: "PL " + plId.slice(9), lines: ["PL " + plId.slice(9), pl ? pl.itemCount + " items" : "playlist"] };
          }
          edges.push({ from: edgeSource, to: plId, kind: "play", condition: null, unresolved: false, fromPc: edge.fromPc });
        } else if (edge.toObject && programById(Number(edge.toObject.slice(7)))) {
          edges.push({ from: edgeSource, to: edge.toObject, kind: edge.kind, condition: null, unresolved: false, fromPc: edge.fromPc });
        } else if (!edge.toPlaylist && !edge.toObject && edge.kind !== "sequence" && edge.kind !== "conditional") {
          if (!nodes.unknown) nodes.unknown = { id: "unknown", type: "unknown", label: "unknown", lines: ["dynamic / unresolved", ""] };
          edges.push({ from: edgeSource, to: "unknown", kind: edge.kind, condition: null, unresolved: true, fromPc: edge.fromPc });
        }
      });
    });
    payload.playlists.forEach(function (playlist) {
      var id = "playlist:" + playlist.id;
      if (!nodes[id]) nodes[id] = { id: id, type: "playlist", label: "PL " + playlist.id, lines: ["PL " + playlist.id, playlist.itemCount + " items"] };
    });
    return { nodes: nodes, edges: edges };
  }
  function playlistById(id) {
    for (var i = 0; i < payload.playlists.length; i++) if (payload.playlists[i].id === id) return payload.playlists[i];
    return null;
  }

  // ---------- layout ----------
  function layout(model, entryId) {
    var ids = Object.keys(model.nodes);
    var outgoing = {}, incoming = {};
    ids.forEach(function (id) { outgoing[id] = []; incoming[id] = []; });
    var forward = model.edges.filter(function (edge) { return model.nodes[edge.to] && model.nodes[edge.from]; });
    forward.forEach(function (edge) { outgoing[edge.from].push(edge.to); incoming[edge.to].push(edge.from); });

    // Remove DFS back edges so the remainder is a DAG, then longest-path
    // levels in topological order — linear even for thousand-block programs.
    var color = {}, stackMembers = {}, backEdges = {};
    var dfsStack = [];
    function dfs(id) {
      color[id] = 1; stackMembers[id] = true; dfsStack.push(id);
      outgoing[id].forEach(function (to) {
        if (!model.nodes[to]) return;
        if (color[to] === undefined) dfs(to);
        else if (stackMembers[to]) backEdges[id + ">" + to] = true;
      });
      stackMembers[id] = false; dfsStack.pop();
      color[id] = 2;
    }
    ids.forEach(function (id) { if (color[id] === undefined) dfs(id); });

    var indegree = {};
    ids.forEach(function (id) { indegree[id] = 0; });
    forward.forEach(function (edge) { if (!backEdges[edge.from + ">" + edge.to]) indegree[edge.to]++; });
    var ready = ids.filter(function (id) { return indegree[id] === 0; });
    var topo = [];
    while (ready.length) {
      var id = ready.pop();
      topo.push(id);
      outgoing[id].forEach(function (to) {
        if (backEdges[id + ">" + to]) return;
        indegree[to]--;
        if (indegree[to] === 0) ready.push(to);
      });
    }
    var level = {};
    var entry = entryId && model.nodes[entryId] ? entryId : null;
    if (entry) level[entry] = 0;
    // Auxilliary sources (menu buttons entering a MovieObject) are roots too:
    // they land in the top band and flow down into the entry block.
    var extraRoots = (model.roots || []).filter(function (id) { return model.nodes[id] && id !== entry; });
    extraRoots.forEach(function (id) { level[id] = 0; });
    topo.forEach(function (id) {
      if (level[id] === undefined) level[id] = 0;
      outgoing[id].forEach(function (to) {
        if (backEdges[id + ">" + to]) return;
        if (level[to] === undefined || level[to] < level[id] + 1) level[to] = level[id] + 1;
      });
    });
    var reachable = {};
    var reachStack = entry ? [entry].concat(extraRoots) : ids.filter(function (id) { return indegree[id] === 0; });
    reachStack.forEach(function (id) { reachable[id] = true; });
    while (reachStack.length) {
      var id = reachStack.pop();
      outgoing[id].forEach(function (to) { if (!reachable[to]) { reachable[to] = true; reachStack.push(to); } });
    }
    var maxLevel = 0;
    ids.forEach(function (id) { if (level[id] > maxLevel) maxLevel = level[id]; });
    ids.forEach(function (id) { if (!reachable[id]) level[id] = maxLevel + 1; });

    var byLevel = {};
    ids.forEach(function (id) { (byLevel[level[id]] = byLevel[level[id]] || []).push(id); });
    for (var sweep = 0; sweep < 3; sweep++) {
      Object.keys(byLevel).map(Number).sort(function (a, b) { return a - b; }).forEach(function (l) {
        byLevel[l].sort(function (a, b) { return bary(a, l, incoming, byLevel) - bary(b, l, incoming, byLevel); });
      });
      Object.keys(byLevel).map(Number).sort(function (a, b) { return b - a; }).forEach(function (l) {
        byLevel[l].sort(function (a, b) { return bary(a, l, outgoing, byLevel) - bary(b, l, outgoing, byLevel); });
      });
    }
    Object.keys(model.nodes).forEach(function (id) {
      var node = model.nodes[id];
      var longest = 12;
      node.lines.forEach(function (line) { if (line.length > longest) longest = line.length; });
      node.w = Math.min(Math.max(longest * 6.6 + 26, 96), 300);
      node.h = 22 + node.lines.length * 15;
    });
    var GAP_X = 34, GAP_Y = 74, COL_GAP = 96, ROW_WIDTH_CAP = 1900;
    var orderedLevels = Object.keys(byLevel).map(Number).sort(function (a, b) { return a - b; });
    // Chunk over-wide levels into multiple visual rows (a level holding every
    // inbound button of a MovieObject can be thousands of pixels wide).
    var rows = [];
    orderedLevels.forEach(function (l) {
      var width = -GAP_X;
      byLevel[l].forEach(function (id) { width += model.nodes[id].w + GAP_X; });
      var list = byLevel[l];
      var chunks = Math.max(1, Math.ceil(width / ROW_WIDTH_CAP));
      if (chunks === 1) { rows.push(list); return; }
      var per = Math.ceil(list.length / chunks);
      for (var i = 0; i < list.length; i += per) rows.push(list.slice(i, i + per));
    });
    var rowHeights = [], rowWidths = [];
    rows.forEach(function (list) {
      var height = 0, width = -GAP_X;
      list.forEach(function (id) {
        if (model.nodes[id].h > height) height = model.nodes[id].h;
        width += model.nodes[id].w + GAP_X;
      });
      rowHeights.push(height); rowWidths.push(width);
    });
    var totalH = rowHeights.reduce(function (sum, h) { return sum + h + GAP_Y; }, 0);
    var maxRowW = Math.max.apply(null, rowWidths);
    // Long thin graphs wrap into columns so the drawing fills the viewport
    // instead of running off as a single vertical stripe. Column count solves
    // for a ~0.6 height/width aspect against the widest (chunked) row.
    var rowsPerColumn = rows.length;
    if (rows.length > 14 && totalH > maxRowW * 1.5) {
      var avgRowUnit = totalH / rows.length;
      var columns = Math.ceil(Math.sqrt((0.6 * rows.length * avgRowUnit) / Math.max(maxRowW, 220)));
      rowsPerColumn = Math.max(4, Math.ceil(rows.length / Math.min(columns, rows.length)));
    }
    var colWidth = {};
    rows.forEach(function (list, index) {
      var c = Math.floor(index / rowsPerColumn);
      if (rowWidths[index] > (colWidth[c] || 0)) colWidth[c] = rowWidths[index];
    });
    var colX = {}, cursorX = 0;
    Object.keys(colWidth).map(Number).sort(function (a, b) { return a - b; }).forEach(function (c) {
      colX[c] = cursorX; cursorX += colWidth[c] + COL_GAP;
    });
    var rowY = {}, colBottom = {};
    rows.forEach(function (list, index) {
      var c = Math.floor(index / rowsPerColumn);
      rowY[index] = colBottom[c] === undefined ? 26 : colBottom[c];
      colBottom[c] = rowY[index] + rowHeights[index] + GAP_Y;
    });
    rows.forEach(function (list, index) {
      var c = Math.floor(index / rowsPerColumn);
      var x = colX[c] + (colWidth[c] - rowWidths[index]) / 2;
      list.forEach(function (id) {
        model.nodes[id].x = x; model.nodes[id].y = rowY[index]; model.nodes[id].col = c;
        x += model.nodes[id].w + GAP_X;
      });
    });
    model.width = cursorX - COL_GAP;
    model.height = Math.max.apply(null, [200].concat(Object.keys(colBottom).map(function (c) { return colBottom[c]; })));
        model.backward = backEdges;
    return model;
  }
  function bary(id, level, adjacency, byLevel) {
    var sum = 0, count = 0;
    (adjacency[id] || []).forEach(function (other) {
      var list = byLevel[level - 1] || byLevel[level + 1] || [];
      var index = list.indexOf(other);
      if (index !== -1) { sum += index; count++; }
    });
    return count ? sum / count : 1e6 + (byLevel[level] || []).indexOf(id);
  }

  // ---------- rendering ----------
  var EDGE_COLORS = { sequence: "#5a6a92", conditional: "#d9a13c", jump: "#4da3ff", call: "#9d7bff", play: "#2fd98a", resume: "#ff9a4d", entry: "#a78bfa", unknown: "#ff9a4d" };
  var NODE_STYLES = {
    block: { fill: "#10233c", stroke: "#4da3ff" },
    playlist: { fill: "#0c2b1c", stroke: "#2fd98a" },
    object: { fill: "#201a3d", stroke: "#9d7bff" },
    mobj: { fill: "#10233c", stroke: "#4da3ff" },
    button: { fill: "#241a06", stroke: "#fbbf24" },
    entry: { fill: "#20103c", stroke: "#a78bfa" },
    unknown: { fill: "#3a1c0a", stroke: "#ff9a4d", dash: true },
  };
  function renderModel(model, options) {
    edgesLayer.innerHTML = "";
    nodesLayer.innerHTML = "";
    var edgeById = {};
    model.edges.forEach(function (edge) {
      var from = model.nodes[edge.from], to = model.nodes[edge.to];
      if (!from || !to) return;
      var isBack = model.backward[edge.from + ">" + edge.to];
      var color = isBack ? "#ff5d5d" : edge.unresolved ? "#ff9a4d" : (EDGE_COLORS[edge.kind] || "#5a6a92");
      var sx, sy, tx, ty, d, labelMid = null;
      if (isBack) {
        sx = from.x + from.w; sy = from.y + from.h / 2; tx = to.x + to.w; ty = to.y + to.h / 2;
        var lift = Math.max(90, Math.abs(sy - ty) * 0.25 + 90);
        d = "M " + sx + " " + sy + " C " + (sx + lift) + " " + sy + ", " + (tx + lift) + " " + ty + ", " + tx + " " + ty;
      } else if (from.col !== undefined && to.col !== undefined && from.col !== to.col) {
        // Column connector: leave the source on its side and arrive over the target.
        sx = from.x + from.w; sy = from.y + from.h / 2; tx = to.x + to.w / 2; ty = to.y;
        d = "M " + sx + " " + sy + " C " + (sx + 56) + " " + sy + ", " + tx + " " + (ty - 56) + ", " + tx + " " + ty;
        labelMid = [(sx + tx) / 2, (sy + ty) / 2 - 4];
      } else {
        sx = from.x + from.w / 2; sy = from.y + from.h; tx = to.x + to.w / 2; ty = to.y;
        if (ty < sy) { sx = from.x + from.w / 2; sy = from.y; tx = to.x + to.w / 2; ty = to.y + to.h; }
        var bend = Math.max(24, Math.min(90, Math.abs(ty - sy) * 0.42));
        d = "M " + sx + " " + sy + " C " + sx + " " + (sy + bend) + ", " + tx + " " + (ty - bend) + ", " + tx + " " + ty;
        labelMid = [(sx + tx) / 2, (sy + ty) / 2 - 4];
      }
      var path = el("path", {
        d: d, fill: "none", stroke: color, "stroke-width": isBack ? 2.2 : 1.6, "marker-end": "url(#arrow)", opacity: 0.9,
      }, edgesLayer);
      edge._el = path;
      if (edge.unresolved) path.setAttribute("stroke-dasharray", "6 4");
      edgeById[path] = edge;
      var kindLabel = state.layoutMode === "force" ? null : isBack ? null : edge.kind === "conditional" ? (edge.condition && edge.condition.indexOf("false") !== -1 ? "F" : "T") : (edge.kind === "sequence" ? null : edge.kind);
      if (kindLabel && labelMid) {
        var text = el("text", { x: labelMid[0], y: labelMid[1], "text-anchor": "middle", fill: color, "font-size": 10.5, "paint-order": "stroke", stroke: "#0b1020", "stroke-width": 3 }, edgesLayer);
        text.textContent = kindLabel;
      }
      path.addEventListener("click", function (event) {
        event.stopPropagation();
        if (suppressClick) return;
        showEdgeDetail(edgeById[path], model);
      });
    });
    Object.keys(model.nodes).forEach(function (id) {
      var node = model.nodes[id];
      var style = NODE_STYLES[node.type] || NODE_STYLES.block;
      var dim = options && options.dimUnreachable && node.type === "block" && (programById(state.programId) || { unreachableBlocks: [] }).unreachableBlocks.indexOf(id) !== -1;
      var g = el("g", { transform: "translate(" + node.x + "," + node.y + ")", cursor: "pointer", opacity: dim ? 0.42 : 1 }, nodesLayer);
      node._el = g;
      var rect = el("rect", {
        x: 0, y: 0, width: node.w, height: node.h, rx: 9, ry: 9, fill: style.fill, stroke: style.stroke, "stroke-width": node.id === options.entryId ? 2.4 : 1.5,
      }, g);
      if (style.dash) rect.setAttribute("stroke-dasharray", "6 4");
      node.lines.forEach(function (line, index) {
        var text = el("text", { x: node.w / 2, y: 30 + index * 15, "text-anchor": "middle", fill: index === 0 ? "#e7eeff" : "#9fb0d8", "font-size": index === 0 ? 12 : 11, "font-family": index === 0 ? "ui-sans-serif, system-ui, sans-serif" : "ui-monospace, Menlo, monospace" }, g);
        text.textContent = line;
      });
      var title = el("title", {}, g);
      title.textContent = node.lines.join("\n") + (node.type === "block" ? "\nclick for disassembly" : "");
      if (state.layoutMode === "force") {
        g.addEventListener("pointerdown", function (event) {
          event.stopPropagation();
          suppressClick = false;
          // simState exists by event time (startForceSimulation runs after render).
          var simNode = simState ? simState.simNodes.find(function (s) { return s.ref === node; }) : null;
          if (!simNode) return;
          var rect = svg.getBoundingClientRect();
          var pointerX = (event.clientX - rect.left - state.transform.x) / state.transform.k;
          var pointerY = (event.clientY - rect.top - state.transform.y) / state.transform.k;
          dragNodeState = {
            simNode: simNode, model: model,
            ox: simNode.x - pointerX, oy: simNode.y - pointerY,
            px: event.clientX, py: event.clientY, moved: false,
          };
          simState.sim.alphaTarget(0.25).restart();
        });
      }
      g.addEventListener("click", function (event) {
        event.stopPropagation();
        if (suppressClick) return;
        nodeClick(node, model);
      });
    });
    applyTransform();
  }
  function nodeClick(node, model) {
    if (node.type === "block") showBlockDetail(node, node.programId);
    else if (node.type === "playlist") showPlaylist(node.id.slice(9));
    else if (node.type === "mobj" || node.type === "object" || node.type === "button") {
      var program = programById(node.programId !== undefined ? node.programId : Number(node.id.slice(7)));
      if (program) showProgram(program.id);
      else showGenericDetail(node.label, model);
    } else showGenericDetail(node.label, model);
  }

  // ---------- views ----------
  function showProgram(id, push) {
    if (push === undefined) push = true;
    var program = programById(id);
    if (!program) return;
    if (push && state.view) pushNav();
    state.view = "program"; state.programId = id;
    setButtons();
    renderSidebar();
    state.currentModel = programModel(program);
    state.currentEntryId = program.entryBlock;
    state.currentOptions = { entryId: program.entryBlock, dimUnreachable: true };
    applyCurrentLayout();
    document.getElementById("detail").classList.add("hidden");
    setHint(program.label + " · " + program.instructionCount + " commands in " + program.blocks.length + " blocks · " + (program.unreachableBlocks.length) + " unreachable · click program nodes to jump");
  }
  function showOverview(push) {
    if (push === undefined) push = true;
    if (push && state.view) pushNav();
    state.view = "overview"; state.programId = null;
    setButtons();
    renderSidebar();
    state.currentModel = overviewModel();
    state.currentEntryId = null;
    state.currentOptions = {};
    applyCurrentLayout();
    document.getElementById("detail").classList.add("hidden");
    setHint("overview · click a program to open its flowchart");
  }
  function showPlaylist(id) {
    var playlist = playlistById(id);
    if (!playlist) return;
    var body = document.getElementById("detail-body");
    document.getElementById("detail-title").textContent = "PL " + playlist.id;
    body.innerHTML = "";
    var items = h("div", "");
    items.appendChild(h("div", "muted", "PlayItems · " + playlist.items.length));
    playlist.items.forEach(function (item) {
      var row = h("div", "meta-row");
      row.innerHTML = "<span class='tag play'>clip " + escapeHtml(item.clipId) + "</span>" + escapeHtml(item.streamPath) +
        "<span class='muted'>  in " + item.inTime90k + " · out " + item.outTime90k + " (90 kHz)</span>";
      items.appendChild(row);
    });
    body.appendChild(items);
    var routes = h("div", "");
    routes.appendChild(h("div", "muted", "Reachable via · " + playlist.routes.length + " route" + (playlist.routes.length === 1 ? "" : "s")));
    playlist.routes.slice(0, 40).forEach(function (route) {
      var row = h("div", "route-row");
      var via = route.origin === "button-program" ? "button " + route.buttonProgramId : (route.entryId || "entry");
      row.innerHTML = "<span class='tag " + (route.origin === "button-program" ? "btn" : "entry") + "'>" + escapeHtml(route.origin) + "</span>" + escapeHtml(via);
      routes.appendChild(row);
    });
    if (playlist.routes.length > 40) routes.appendChild(h("div", "meta-row muted", "… " + (playlist.routes.length - 40) + " more"));
    body.appendChild(routes);
    var producers = h("div", "");
    producers.appendChild(h("div", "muted", "Played by"));
    payload.programs.forEach(function (program) {
      var plays = program.edges.some(function (edge) { return edge.toPlaylist === "playlist:" + playlist.id; });
      if (!plays) return;
      var row = h("div", "route-row");
      row.innerHTML = "<span class='tag " + (program.kind === "button-program" ? "btn" : "mobj") + "'>" + escapeHtml(program.label) + "</span>";
      producers.appendChild(row);
    });
    body.appendChild(producers);
    detail.classList.remove("hidden");
  }
  function showBlockDetail(node, programId) {
    var block = node.block;
    document.getElementById("detail-title").textContent = (node.programLabel ? node.programLabel + " · " : "") + block.id + " · " + pcRange(block);
    var body = document.getElementById("detail-body");
    body.innerHTML = "";
    block.commands.forEach(function (command) {
      var row = h("div", "cmd" + (command.status !== "known" ? " bad" : ""));
      row.innerHTML = "<span class='pc'>" + command.pc + "</span><span>" + escapeHtml(command.text) + "</span>" + (command.status !== "known" ? "<span class='st'>" + command.status + "</span>" : "");
      body.appendChild(row);
    });
    if (programId !== undefined) {
      var owner = programById(programId);
      if (owner) {
        var open = h("button", "", "Open " + owner.label + " view");
        open.style.marginTop = "10px";
        open.addEventListener("click", function () { showProgram(owner.id); });
        body.appendChild(open);
      }
    }
    detail.classList.remove("hidden");
  }
  function showEdgeDetail(edge, model) {
    document.getElementById("detail-title").textContent = "edge · " + edge.kind;
    var body = document.getElementById("detail-body");
    body.innerHTML = "";
    var from = model.nodes[edge.from], to = model.nodes[edge.to];
    var row = h("div", "meta-row");
    row.innerHTML = "<span class='tag mobj'>" + escapeHtml(from ? from.label : edge.from) + "</span> → <span class='tag " +
      (to && to.type === "playlist" ? "play" : to && to.type === "object" ? "mobj" : "") + "'>" + escapeHtml(to ? to.label : "unknown") + "</span>";
    body.appendChild(row);
    if (edge.condition) body.appendChild(h("div", "meta-row muted", "condition · " + edge.condition));
    if (edge.unresolved) body.appendChild(h("div", "meta-row muted", "statically unresolved — resolved at VM runtime"));
  }
  function showUnknownTable(unknowns) {
    document.getElementById("detail-title").textContent = "Unknown · " + unknowns.length;
    var body = document.getElementById("detail-body");
    body.innerHTML = "";
    var table = h("table", "unknown-table");
    var thead = h("thead");
    var headRow = h("tr");
    ["#", "code", "message", "source"].forEach(function (label) { headRow.appendChild(h("th", null, label)); });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = h("tbody");
    unknowns.forEach(function (entry, index) {
      var row = h("tr");
      var source = entry.source ? entry.source.path + " @" + entry.source.offset : "—";
      row.innerHTML = "<td>" + (index + 1) + "</td><td class='code'>" + escapeHtml(entry.code) + "</td><td>" + escapeHtml(entry.message) + "</td><td class='src'>" + escapeHtml(source) + "</td>";
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    body.appendChild(table);
    detail.classList.remove("hidden");
  }

  function showGenericDetail(title, model) {
    document.getElementById("detail-title").textContent = title;
    var body = document.getElementById("detail-body");
    body.innerHTML = "";
    body.appendChild(h("div", "meta-row muted", "No detail for this node in this view."));
    detail.classList.remove("hidden");
  }

  // ---------- pan / zoom ----------
  function applyTransform() {
    viewport.setAttribute("transform", "translate(" + state.transform.x + "," + state.transform.y + ") scale(" + state.transform.k + ")");
  }
  // ---------- layout modes ----------
  var simState = null; // { model, sim, simNodes }
  var dragNodeState = null;
  function stopForceSimulation() {
    if (!simState) return;
    simState.sim.on("tick", null).stop();
    simState = null;
  }
  function applyCurrentLayout() {
    stopForceSimulation();
    setButtons();
    var model = state.currentModel;
    if (!model) return;
    layout(model, state.currentEntryId);
    // The layered result doubles as the force-layout anchor skeleton, so the
    // elastic simulation keeps the wrapped, screen-filling global shape.
    Object.keys(model.nodes).forEach(function (id) {
      model.nodes[id].ax = model.nodes[id].x + model.nodes[id].w / 2;
      model.nodes[id].ay = model.nodes[id].y + model.nodes[id].h / 2;
    });
    renderModel(model, state.currentOptions || {});
    if (state.layoutMode === "force") startForceSimulation(model);
    else fitModel(model);
  }
  function startForceSimulation(model) {
    stopForceSimulation();
    var simNodes = Object.keys(model.nodes).map(function (id) {
      var node = model.nodes[id];
      // d3 treats node x/y as particle centers; the model keeps top-left corners.
      return { ref: node, id: id, w: node.w, h: node.h, x: node.x + node.w / 2, y: node.y + node.h / 2, ax: node.ax, ay: node.ay };
    });
    if (!simNodes.length) return;
    if (simNodes.length > 2600) { setHint("force layout skipped · " + simNodes.length + " nodes exceeds the simulation budget"); return; }
    var simEdges = model.edges
      .filter(function (edge) { return model.nodes[edge.from] && model.nodes[edge.to]; })
      .map(function (edge) { return { source: edge.from, target: edge.to, kind: edge.kind, ref: edge }; });
    var sim = d3.forceSimulation(simNodes)
      .force("link", d3.forceLink(simEdges).id(function (d) { return d.id; })
        .distance(function (e) { return e.kind === "play" ? 240 : 170; })
        .strength(0.35))
      .force("charge", d3.forceManyBody().strength(-380))
      .force("collide", d3.forceCollide().radius(function (d) { return Math.max(d.w, d.h) / 2 + 8; }).iterations(2))
      .alpha(0.45)
      .alphaDecay(0.05)
      .on("tick", function () {
        simNodes.forEach(function (s) { s.ref.x = s.x - s.w / 2; s.ref.y = s.y - s.h / 2; });
        updateForceDom(model);
      });
    sim.alphaTarget(0); // cool down and stop after settling
    simState = { model: model, sim: sim, simNodes: simNodes };
  }
  function updateForceDom(model) {
    Object.keys(model.nodes).forEach(function (id) {
      var node = model.nodes[id];
      if (node._el) node._el.setAttribute("transform", "translate(" + node.x + "," + node.y + ")");
    });
    model.edges.forEach(function (edge) {
      if (!edge._el) return;
      var from = model.nodes[edge.from], to = model.nodes[edge.to];
      if (!from || !to) return;
      edge._el.setAttribute("d", forceEdgeD(from, to, ((edge.from.length + edge.to.length) % 2) ? 1 : -1));
    });
  }
  function rectBoundaryPoint(cx, cy, w, h, ux, uy, pad) {
    var rx = w / 2 + pad, ry = h / 2 + pad;
    var sx = ux !== 0 ? rx / Math.abs(ux) : Infinity;
    var sy = uy !== 0 ? ry / Math.abs(uy) : Infinity;
    var s = Math.min(sx, sy);
    return { x: cx + ux * s, y: cy + uy * s };
  }
  function forceEdgeD(from, to, bowSign) {
    var fcx = from.x + from.w / 2, fcy = from.y + from.h / 2;
    var tcx = to.x + to.w / 2, tcy = to.y + to.h / 2;
    var dx = tcx - fcx, dy = tcy - fcy;
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / dist, uy = dy / dist;
    var start = rectBoundaryPoint(fcx, fcy, from.w, from.h, ux, uy, 4);
    var end = rectBoundaryPoint(tcx, tcy, to.w, to.h, -ux, -uy, 8);
    // gentle bow so parallel connections stay distinguishable
    var seg = Math.sqrt((end.x - start.x) * (end.x - start.x) + (end.y - start.y) * (end.y - start.y)) || 1;
    var bow = Math.min(30, seg * 0.12) * bowSign;
    var cx = (start.x + end.x) / 2 - uy * bow;
    var cy = (start.y + end.y) / 2 + ux * bow;
    return "M " + start.x + " " + start.y + " Q " + cx + " " + cy + ", " + end.x + " " + end.y;
  }
  function fitToNodes(nodes) {
    if (!nodes.length) return;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(function (node) {
      if (node.x < minX) minX = node.x;
      if (node.y < minY) minY = node.y;
      if (node.x + node.w > maxX) maxX = node.x + node.w;
      if (node.y + node.h > maxY) maxY = node.y + node.h;
    });
    fitRect(minX, minY, maxX - minX, maxY - minY);
  }
  function fitRect(x, y, w, h) {
    var wrap = document.getElementById("canvas-wrap");
    var k = Math.min(wrap.clientWidth / (w + 60), wrap.clientHeight / (h + 60), 1.15);
    k = Math.max(k, 0.04);
    state.transform.k = k;
    // Content center maps to the viewport center.
    state.transform.x = wrap.clientWidth / 2 - (x + w / 2) * k;
    state.transform.y = wrap.clientHeight / 2 - (y + h / 2) * k;
    applyTransform();
  }
  function fitModel(model) {
    fitToNodes(Object.keys(model.nodes).map(function (id) { return model.nodes[id]; }));
  }
  svg.addEventListener("wheel", function (event) {
    event.preventDefault();
    var rect = svg.getBoundingClientRect();
    var px = event.clientX - rect.left, py = event.clientY - rect.top;
    var factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    var k2 = Math.min(Math.max(state.transform.k * factor, 0.03), 3);
    state.transform.x = px - (px - state.transform.x) * (k2 / state.transform.k);
    state.transform.y = py - (py - state.transform.y) * (k2 / state.transform.k);
    state.transform.k = k2;
    applyTransform();
  }, { passive: false });
  var panState = null;
  var suppressClick = false;
  // Panning runs on window-level move/up without pointer capture: capturing
  // retargets the synthesized click to the <svg> root, which would swallow
  // every node and edge click.
  svg.addEventListener("pointerdown", function (event) {
    suppressClick = false;
    if (dragNodeState) return;
    panState = { x: event.clientX, y: event.clientY, tx: state.transform.x, ty: state.transform.y, moved: false };
  });
  window.addEventListener("pointermove", function (event) {
    if (dragNodeState) {
      var rect = svg.getBoundingClientRect();
      var s = dragNodeState.simNode;
      s.fx = (event.clientX - rect.left - state.transform.x) / state.transform.k + dragNodeState.ox;
      s.fy = (event.clientY - rect.top - state.transform.y) / state.transform.k + dragNodeState.oy;
      if (!dragNodeState.moved && Math.abs(event.clientX - dragNodeState.px) + Math.abs(event.clientY - dragNodeState.py) > 3) {
        dragNodeState.moved = true;
        suppressClick = true;
      }
      s.x = s.fx; s.y = s.fy;
      s.ref.x = s.x - s.w / 2; s.ref.y = s.y - s.h / 2;
      updateForceDom(dragNodeState.model);
      return;
    }
    if (!panState) return;
    var dx = event.clientX - panState.x, dy = event.clientY - panState.y;
    if (!panState.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    panState.moved = true;
    svg.classList.add("panning");
    state.transform.x = panState.tx + dx;
    state.transform.y = panState.ty + dy;
    applyTransform();
  });
  function endPan() {
    if (panState && panState.moved) suppressClick = true; // a drag must not end as a click
    panState = null;
    svg.classList.remove("panning");
  }
  window.addEventListener("pointerup", function () {
    if (dragNodeState) {
      // release the node and let it re-equilibrate elastically
      dragNodeState.simNode.fx = null;
      dragNodeState.simNode.fy = null;
      if (simState) simState.sim.alphaTarget(0);
      dragNodeState = null;
      return;
    }
    endPan();
  });

  // ---------- chrome ----------
  function setButtons() {
    document.getElementById("btn-overview").classList.toggle("active", state.view === "overview");
    document.getElementById("btn-layout-layered").classList.toggle("active", state.layoutMode === "layered");
    document.getElementById("btn-layout-force").classList.toggle("active", state.layoutMode === "force");
    document.getElementById("btn-back").disabled = navStack.length === 0;
  }
  function setHint(text) { document.getElementById("hint").textContent = text; }
  document.getElementById("btn-overview").addEventListener("click", function () { showOverview(); });
  document.getElementById("btn-layout-layered").addEventListener("click", function () {
    if (state.layoutMode === "layered") return;
    state.layoutMode = "layered";
    applyCurrentLayout();
  });
  document.getElementById("btn-layout-force").addEventListener("click", function () {
    if (state.layoutMode === "force") return;
    state.layoutMode = "force";
    applyCurrentLayout();
  });
  document.getElementById("btn-back").addEventListener("click", goBack);
  document.getElementById("btn-fit").addEventListener("click", function () {
    var bbox = nodesLayer.getBBox();
    if (!bbox.width || !bbox.height) return;
    fitRect(bbox.x, bbox.y, bbox.width, bbox.height);
  });
  document.getElementById("btn-legend").addEventListener("click", function () {
    var legend = document.getElementById("legend");
    legend.style.display = legend.style.display === "none" ? "" : "none";
  });
  document.getElementById("detail-close").addEventListener("click", function () { detail.classList.add("hidden"); });
  document.addEventListener("keydown", function (event) { if (event.key === "Escape") detail.classList.add("hidden"); });
  document.getElementById("search").addEventListener("input", function (event) {
    state.search = event.target.value.trim();
    renderSidebar();
  });
  svg.addEventListener("click", function () {
    if (suppressClick) { suppressClick = false; return; }
    detail.classList.add("hidden");
  });

  renderStats();
  renderSidebar();
  var first = payload.programs.find(function (program) { return program.kind === "movie-object"; }) || payload.programs[0];
  if (first) showProgram(first.id); else showOverview();
})();