// viewer.js — cytoscape graph renderer, no bundler, CDN-only deps
(function () {
  'use strict';

  // ── CDN imports via ES module script trick ────────────────────────
  var CYTOSCAPE_CDN = 'https://unpkg.com/cytoscape@3.28.1/dist/cytoscape.min.js';
  var COSEB_CDN     = 'https://unpkg.com/cytoscape-cose-bilkent@4.1.0/cytoscape-cose-bilkent.js';

  var style, coseBilkent;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function loadDeps() {
    await loadScript(CYTOSCAPE_CDN);
    await loadScript(COSEB_CDN);
    style      = window.cytoscape.stylesheet;
    coseBilkent = window.cytoscape;
  }

  // ── Graph style ─────────────────────────────────────────────────
  function buildStyle() {
    return [
      {
        selector: 'node',
        style: {
          'label': 'data(label)',
          'font-size': 9,
          'text-valign': 'bottom',
          'text-margin-y': 4,
          'text-outline-color': '#1a1a2e',
          'text-outline-width': 1.5,
          'background-color': '#4fc3f7',
          'color': '#e0e0e0',
          'border-width': 1,
          'border-color': '#81d4fa',
          'height': 16,
          'width': 16
        }
      },
      {
        selector: 'node[kind = "tag"]',
        style: {
          'background-color': '#a78bfa',
          'border-color': '#c4b5fd',
          'shape': 'round-rectangle',
          'height': 10,
          'width': 10,
          'font-size': 8
        }
      },
      {
        selector: 'node:selected',
        style: {
          'border-width': 2,
          'border-color': '#e94560',
          'background-color': '#e94560'
        }
      },
      {
        selector: 'edge',
        style: {
          'width': 1,
          'line-color': '#4fc3f7',
          'opacity': 0.6,
          'curve-style': 'bezier'
        }
      },
      {
        selector: 'edge[kind = "tag"]',
        style: {
          'line-color': '#a78bfa',
          'opacity': 0.4
        }
      },
      {
        selector: 'edge[resolved = "false"]',
        style: {
          'line-style': 'dashed',
          'line-color': '#ef9a9a',
          'opacity': 0.8
        }
      }
    ];
  }

  // ── Cytoscape options ────────────────────────────────────────────
  function coseBilkentOptions(eles) {
    return {
      name: 'cose-bilkent',
      idealEdgeLength: 80,
      nodeRepulsion: 3000,
      edgeElasticity: 0.1,
      nestingFactor: 0.1,
      gravity: 0.15,
      numIter: 500,
      animate: 'end',
      randomize: false,
      nodeDimensionsIncludeLabels: true,
      fit: true,
      padding: 40,
      // batching on so it doesn't block the UI thread
      batching: true,
      nodeSeparation: 60
    };
  }

  // ── Graph data -> cy elements ────────────────────────────────────
  function buildElements(graphData) {
    var nodes = graphData.nodes || [];
    var edges = graphData.edges || [];
    var eles  = [];

    nodes.forEach(function (n) {
      var isTag = n.id && n.id.startsWith('tag:');
      eles.push({
        data: {
          id:    n.id,
          label: isTag ? n.id.replace('tag:', '#') : (n.title || n.id),
          kind:  isTag ? 'tag' : 'concept'
        }
      });
    });

    edges.forEach(function (e) {
      // Only add if src and dst are defined and different
      if (e.src && e.dst && e.src !== e.dst) {
        eles.push({
          data: {
            id:      e.src + '-->' + e.dst,
            source:  e.src,
            target:  e.dst,
            kind:    e.kind || 'wikilink',
            resolved: e.resolved !== false ? 'true' : 'false'
          }
        });
      }
    });

    return eles;
  }

  // ── Compute and update stats bar ─────────────────────────────────
  function updateStats(graphData) {
    var stats  = graphData.stats  || {};
    var edges  = graphData.edges  || [];
    var wikilinkCount = 0;
    var tagCount      = 0;
    var unresolvedCount = 0;

    edges.forEach(function (e) {
      if (e.kind === 'tag')          tagCount++;
      else if (e.resolved === false) unresolvedCount++;
      else                           wikilinkCount++;
    });

    var el = document.getElementById('stats');
    if (!el) return;

    el.innerHTML =
      '<span>nodes: <b>' + (stats.nodes  || graphData.nodes  && graphData.nodes.length  || 0) + '</b></span>' +
      '<span>edges: <b>' + (stats.edges  || edges.length || 0) + '</b></span>' +
      '<span class="wikilink">wikilink: <b>' + wikilinkCount + '</b></span>' +
      '<span class="tag">tag: <b>' + tagCount + '</b></span>' +
      '<span class="unresolved">unresolved: <b>' + unresolvedCount + '</b></span>';
  }

  // ── Load graph into cytoscape ────────────────────────────────────
  var cy = null;

  async function renderGraph(graphData) {
    if (!graphData || !graphData.nodes) {
      showError('Invalid graph JSON: missing nodes array');
      return;
    }

    var elements = buildElements(graphData);
    updateStats(graphData);

    if (cy) {
      cy.destroy();
      cy = null;
    }

    cy = coseBilkent({
      container: document.getElementById('cy-container'),
      elements: elements,
      style: buildStyle(),
      layout: { name: 'preset' }  // start hidden, then animate
    });

    // Run cose-bilkent layout
    var layout = cy.layout(coseBilkentOptions(elements));
    layout.run();

    document.getElementById('load-btn').disabled = false;
  }

  function showError(msg) {
    var el = document.getElementById('error-msg');
    if (el) { el.textContent = 'Error: ' + msg; el.style.display = 'block'; }
  }

  function clearError() {
    var el = document.getElementById('error-msg');
    if (el) el.style.display = 'none';
  }

  // ── Bootstrap ───────────────────────────────────────────────────
  async function init() {
    var loadBtn  = document.getElementById('load-btn');
    var jsonInput = document.getElementById('graph-json');

    loadBtn.disabled = true;
    loadBtn.textContent = 'Loading cytoscape...';

    try {
      await loadDeps();
      loadBtn.disabled = false;
      loadBtn.textContent = 'Load Graph';
    } catch (err) {
      showError('Failed to load cytoscape from CDN: ' + err.message);
      loadBtn.textContent = 'CDN error';
      return;
    }

    loadBtn.addEventListener('click', function () {
      clearError();
      var raw = jsonInput.value.trim();
      if (!raw) {
        showError('Paste a graph.json first');
        return;
      }
      try {
        var data = JSON.parse(raw);
        renderGraph(data);
      } catch (e) {
        showError('Invalid JSON: ' + e.message);
      }
    });

    // Load sample graph on startup
    fetch('sample-graph.json')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        jsonInput.value = JSON.stringify(data, null, 2);
        return renderGraph(data);
      })
      .catch(function () {
        // No sample-graph.json — that's fine, user can paste
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
