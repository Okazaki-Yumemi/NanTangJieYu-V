'use strict';

/**
 * 交大校园风格 SVG 地图（简化示意图，后续可整体替换为正式美术）。
 *
 * NTJ.renderCampusMap(container, regions, { onSelect }) → { update(regions, selectedId) }
 * 区域坐标来自 shared/seeds/regions.json 的 map.x / map.y（viewBox 380×560）。
 */

(function initMap() {
  const NS = 'http://www.w3.org/2000/svg';
  const VIEW_W = 380;
  const VIEW_H = 560;

  function svgEl(tag, attrs = {}, parent) {
    const el = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, value);
    }
    if (parent) {
      parent.appendChild(el);
    }
    return el;
  }

  function buildBaseLayer(root) {
    const defs = svgEl('defs', {}, root);
    defs.innerHTML = `
      <radialGradient id="ntj-map-paper" cx="50%" cy="42%" r="75%">
        <stop offset="0%" stop-color="#fbf9f2"/>
        <stop offset="100%" stop-color="#f1ecdf"/>
      </radialGradient>
      <filter id="ntj-node-shadow" x="-60%" y="-60%" width="220%" height="220%">
        <feDropShadow dx="0" dy="1.5" stdDeviation="1.6" flood-color="#5b5442" flood-opacity="0.35"/>
      </filter>
    `;

    // 校园边界（纸面底）
    svgEl('rect', {
      x: 14, y: 22, width: VIEW_W - 28, height: VIEW_H - 44, rx: 26,
      fill: 'url(#ntj-map-paper)', stroke: '#cfc7b4', 'stroke-width': 1.6
    }, root);

    // 环校道路
    svgEl('rect', {
      x: 40, y: 48, width: VIEW_W - 80, height: VIEW_H - 96, rx: 20,
      fill: 'none', stroke: '#e4ddcc', 'stroke-width': 10
    }, root);
    svgEl('rect', {
      x: 40, y: 48, width: VIEW_W - 80, height: VIEW_H - 96, rx: 20,
      fill: 'none', stroke: '#fffdf6', 'stroke-width': 6
    }, root);

    // 主干路（南门 → 北侧）与东西向道路
    svgEl('path', {
      d: 'M 186 516 L 186 48 Q 186 30 204 30',
      fill: 'none', stroke: '#e9e3d3', 'stroke-width': 8, 'stroke-linecap': 'round'
    }, root);
    svgEl('path', {
      d: 'M 52 300 L 328 300',
      fill: 'none', stroke: '#e9e3d3', 'stroke-width': 7, 'stroke-linecap': 'round'
    }, root);
    svgEl('path', {
      d: 'M 60 430 L 300 430',
      fill: 'none', stroke: '#eee8d8', 'stroke-width': 5, 'stroke-linecap': 'round'
    }, root);

    // 思源湖（西南）
    svgEl('path', {
      d: 'M 74 402 q 22 -16 46 -8 q 26 8 22 30 q -4 24 -30 26 q -30 2 -42 -16 q -8 -18 4 -32 z',
      fill: '#bcd9ea', stroke: '#93bfd8', 'stroke-width': 1.4, opacity: 0.85
    }, root);
    // 涵泽湖（中西部）
    svgEl('path', {
      d: 'M 72 226 q 18 -12 38 -6 q 20 6 16 24 q -4 18 -24 20 q -24 2 -32 -12 q -6 -14 2 -26 z',
      fill: '#bcd9ea', stroke: '#93bfd8', 'stroke-width': 1.4, opacity: 0.85
    }, root);

    // 电草草坪（中东部）
    svgEl('rect', {
      x: 228, y: 262, width: 96, height: 78, rx: 16,
      fill: '#cfe6c2', stroke: '#a8cd96', 'stroke-width': 1.4, opacity: 0.9
    }, root);
    svgEl('path', {
      d: 'M 244 330 l 6 -10 l 6 10 m 14 -14 l 6 -10 l 6 10 m 14 -12 l 6 -10 l 6 10',
      stroke: '#9dc28a', 'stroke-width': 1.6, fill: 'none', 'stroke-linecap': 'round'
    }, root);

    // 校舍群组（中性色块，不含具体指称）
    const blocks = [
      { x: 226, y: 96, w: 44, h: 30, r: 6 },
      { x: 288, y: 150, w: 52, h: 36, r: 6 },
      { x: 84, y: 316, w: 40, h: 30, r: 6 },
      { x: 136, y: 340, w: 54, h: 34, r: 6 },
      { x: 214, y: 380, w: 46, h: 30, r: 6 },
      { x: 64, y: 130, w: 42, h: 32, r: 6 },
      { x: 226, y: 470, w: 56, h: 34, r: 6 }
    ];
    for (const block of blocks) {
      svgEl('rect', {
        x: block.x, y: block.y, width: block.w, height: block.h, rx: block.r,
        fill: '#e6e0d0', stroke: '#d3cbb7', 'stroke-width': 1
      }, root);
      svgEl('rect', {
        x: block.x + block.w * 0.18, y: block.y + block.h * 0.2,
        width: block.w * 0.28, height: block.h * 0.6, rx: 2,
        fill: '#d9d2bf'
      }, root);
      svgEl('rect', {
        x: block.x + block.w * 0.54, y: block.y + block.h * 0.2,
        width: block.w * 0.28, height: block.h * 0.6, rx: 2,
        fill: '#d9d2bf'
      }, root);
    }

    // 指北针与图例标题
    const compass = svgEl('g', { transform: 'translate(340, 44)' }, root);
    svgEl('circle', { r: 11, fill: '#fffdf6', stroke: '#cfc7b4' }, compass);
    svgEl('path', { d: 'M 0 -7 L 3.4 4 L 0 1.6 L -3.4 4 Z', fill: '#b3822f' }, compass);
    svgEl('text', {
      x: 0, y: -14, 'text-anchor': 'middle', 'font-size': 9, fill: '#8f8871'
    }, compass).textContent = 'N';
  }

  function buildRouteLayer(root) {
    return svgEl('path', {
      class: 'map-route',
      fill: 'none',
      stroke: '#c9a13e',
      'stroke-width': 2,
      'stroke-dasharray': '6 7',
      'stroke-linecap': 'round',
      opacity: 0.75
    }, root);
  }

  function buildRegionNode(root, region) {
    const group = svgEl('g', {
      class: 'map-node',
      'data-region-id': region.id,
      transform: `translate(${region.map.x}, ${region.map.y})`
    }, root);

    svgEl('circle', { class: 'node-pulse', r: 20 }, group);
    svgEl('circle', { class: 'node-hit', r: 30, fill: 'transparent' }, group);
    svgEl('circle', { class: 'node-body', r: 19, filter: 'url(#ntj-node-shadow)' }, group);
    svgEl('circle', {
      class: 'node-progress-ring', r: 23, fill: 'none', 'stroke-width': 3.4,
      'stroke-linecap': 'round', transform: 'rotate(-90)'
    }, group);
    svgEl('text', {
      class: 'node-order', y: -30, 'text-anchor': 'middle', 'font-size': 11
    }, group).textContent = `⬡${region.order}`;
    const glyph = svgEl('text', {
      class: 'node-glyph', y: 6.5, 'text-anchor': 'middle', 'font-size': 16
    }, group);
    glyph.textContent = region.season_label || '?';
    const label = svgEl('text', {
      class: 'node-label', y: 40, 'text-anchor': 'middle', 'font-size': 12
    }, group);
    label.textContent = region.name;
    svgEl('text', {
      class: 'node-status-label', y: 54, 'text-anchor': 'middle', 'font-size': 9.5
    }, group);

    return group;
  }

  function renderCampusMap(container, regions, options = {}) {
    container.classList.add('campus-map-wrap');
    container.innerHTML = '';
    const svg = svgEl('svg', {
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
      class: 'campus-map',
      role: 'img',
      'aria-label': '校园异变地图'
    }, container);

    buildBaseLayer(svg);
    const route = buildRouteLayer(svg);
    const nodeLayer = svgEl('g', { class: 'map-node-layer' }, svg);
    const nodeRefs = new Map();

    for (const region of regions) {
      const group = buildRegionNode(nodeLayer, region);
      group.addEventListener('click', () => {
        if (options.onSelect) {
          options.onSelect(region.id);
        }
      });
      nodeRefs.set(region.id, {
        group,
        pulse: group.querySelector('.node-pulse'),
        body: group.querySelector('.node-body'),
        ring: group.querySelector('.node-progress-ring'),
        glyph: group.querySelector('.node-glyph'),
        order: group.querySelector('.node-order'),
        label: group.querySelector('.node-label'),
        statusLabel: group.querySelector('.node-status-label')
      });
    }

    function update(nextRegions, selectedId) {
      const sorted = [...nextRegions].sort((a, b) => a.order - b.order);
      const points = sorted.map((region) => `${region.map.x},${region.map.y}`).join(' ');
      route.setAttribute('points', points);
      route.setAttribute('d', `M ${points.split(' ').join(' L ')}`);

      for (const region of nextRegions) {
        const refs = nodeRefs.get(region.id);
        if (!refs) {
          continue;
        }
        const season = NTJ.SEASON_STYLES[region.season] || { color: '#888', soft: '#eee' };
        const status = region.closed ? 'closed' : region.status;
        const isSelected = region.id === selectedId;

        refs.group.setAttribute('class', [
          'map-node',
          `is-${status}`,
          isSelected ? 'is-selected' : ''
        ].filter(Boolean).join(' '));
        refs.body.setAttribute('fill', season.soft);
        refs.body.setAttribute('stroke', season.color);
        refs.pulse.setAttribute('stroke', season.color);
        refs.ring.setAttribute('stroke', season.color);
        refs.glyph.setAttribute('fill', season.color);
        refs.order.setAttribute('fill', season.color);
        refs.label.textContent = region.name;
        refs.statusLabel.textContent = region.closed
          ? '临时关闭'
          : (NTJ.REGION_STATUS_LABELS[region.status] || '');

        const progress = Math.max(0, Math.min(1, Number(region.anomaly_progress) || 0));
        const circumference = 2 * Math.PI * 23;
        if (region.status === 'cleared') {
          refs.ring.setAttribute('stroke-dasharray', `${circumference} 0`);
          refs.glyph.textContent = '✓';
        } else {
          refs.ring.setAttribute(
            'stroke-dasharray',
            `${(circumference * progress).toFixed(1)} ${circumference.toFixed(1)}`
          );
          refs.glyph.textContent = region.season_label || '?';
        }
        refs.ring.setAttribute('stroke-dashoffset', circumference / 4);
      }
    }

    update(regions, options.selectedId);
    return { update };
  }

  window.NTJ = window.NTJ || {};
  window.NTJ.renderCampusMap = renderCampusMap;
})();
