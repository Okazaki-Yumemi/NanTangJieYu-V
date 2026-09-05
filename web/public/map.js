'use strict';

/**
 * 3D 立体校园地图（diorama 风格）。
 *
 * 结构：透视容器 .map-scene > 倾斜地面 .map-plane（rotateX）> 地形 SVG + 区域立牌。
 * 立牌用 rotateX(-tilt) 反向转正，像立在地面上的广告牌；选中时上浮 + 高亮 + 光柱。
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

  /* ---------- 地面地形（跟随地面一起倾斜） ---------- */

  function buildGround(root) {
    const defs = svgEl('defs', {}, root);
    defs.innerHTML = `
      <radialGradient id="ntj-ground-base" cx="50%" cy="34%" r="82%">
        <stop offset="0%" stop-color="#1a2136"/>
        <stop offset="58%" stop-color="#131828"/>
        <stop offset="100%" stop-color="#0c0f1a"/>
      </radialGradient>
      <linearGradient id="ntj-lake" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1d3d5c"/>
        <stop offset="100%" stop-color="#122a44"/>
      </linearGradient>
      <linearGradient id="ntj-wall" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1a2136"/>
        <stop offset="100%" stop-color="#10141f"/>
      </linearGradient>
      <pattern id="ntj-grid" width="34" height="34" patternUnits="userSpaceOnUse">
        <path d="M 34 0 L 0 0 0 34" fill="none" stroke="rgba(255,255,255,0.045)" stroke-width="1"/>
      </pattern>
    `;

    // 底板
    svgEl('rect', {
      x: 5, y: 5, width: VIEW_W - 10, height: VIEW_H - 10, rx: 26,
      fill: 'url(#ntj-ground-base)', stroke: 'rgba(255,255,255,0.16)', 'stroke-width': 1.5
    }, root);
    svgEl('rect', {
      x: 5, y: 5, width: VIEW_W - 10, height: VIEW_H - 10, rx: 26,
      fill: 'url(#ntj-grid)'
    }, root);

    // 环校道路
    svgEl('rect', {
      x: 40, y: 48, width: VIEW_W - 80, height: VIEW_H - 96, rx: 20,
      fill: 'none', stroke: '#232c42', 'stroke-width': 11
    }, root);
    svgEl('rect', {
      x: 40, y: 48, width: VIEW_W - 80, height: VIEW_H - 96, rx: 20,
      fill: 'none', stroke: '#2e3a56', 'stroke-width': 5.5
    }, root);
    svgEl('rect', {
      x: 40, y: 48, width: VIEW_W - 80, height: VIEW_H - 96, rx: 20,
      fill: 'none', stroke: 'rgba(255,255,255,0.22)', 'stroke-width': 1.1, 'stroke-dasharray': '7 9'
    }, root);

    // 主干路
    const roads = [
      { d: 'M 186 516 L 186 48 Q 186 30 204 30', w: 9 },
      { d: 'M 52 300 L 328 300', w: 8 },
      { d: 'M 60 430 L 300 430', w: 6 },
      { d: 'M 104 248 L 186 300', w: 4.5 },
      { d: 'M 272 302 L 306 480', w: 4.5 },
      { d: 'M 158 128 L 112 248', w: 4.5 }
    ];
    for (const road of roads) {
      svgEl('path', {
        d: road.d, fill: 'none', stroke: '#27304a',
        'stroke-width': road.w, 'stroke-linecap': 'round'
      }, root);
      svgEl('path', {
        d: road.d, fill: 'none', stroke: 'rgba(255,255,255,0.16)', 'stroke-width': 1,
        'stroke-dasharray': '5 8', 'stroke-linecap': 'round'
      }, root);
    }

    // 思源湖（西南）
    svgEl('path', {
      d: 'M 74 402 q 22 -16 46 -8 q 26 8 22 30 q -4 24 -30 26 q -30 2 -42 -16 q -8 -18 4 -32 z',
      fill: 'url(#ntj-lake)', stroke: '#3d6f9e', 'stroke-width': 1.4
    }, root);
    svgEl('ellipse', { class: 'lake-shimmer', cx: 100, cy: 424, rx: 14, ry: 4, fill: 'rgba(160,215,255,0.35)' }, root);
    // 涵泽湖（中西部）
    svgEl('path', {
      d: 'M 72 226 q 18 -12 38 -6 q 20 6 16 24 q -4 18 -24 20 q -24 2 -32 -12 q -6 -14 2 -26 z',
      fill: 'url(#ntj-lake)', stroke: '#3d6f9e', 'stroke-width': 1.4
    }, root);
    svgEl('ellipse', { class: 'lake-shimmer lake-shimmer-late', cx: 94, cy: 240, rx: 10, ry: 3, fill: 'rgba(160,215,255,0.3)' }, root);

    // 电草草坪（中东部）
    svgEl('rect', {
      x: 228, y: 262, width: 96, height: 78, rx: 16,
      fill: '#13291d', stroke: '#31684a', 'stroke-width': 1.3
    }, root);
    svgEl('path', {
      d: 'M 244 330 l 6 -10 l 6 10 m 14 -14 l 6 -10 l 6 10 m 14 -12 l 6 -10 l 6 10',
      stroke: '#3f7a58', 'stroke-width': 1.6, fill: 'none', 'stroke-linecap': 'round'
    }, root);

    // 小树林点缀
    const trees = [[70, 180], [84, 168], [320, 220], [332, 232], [64, 470], [78, 458], [300, 128], [314, 140], [228, 210]];
    for (const [tx, ty] of trees) {
      svgEl('circle', { cx: tx, cy: ty, r: 5.5, fill: '#16301f', stroke: '#2c5a3c', 'stroke-width': 1 }, root);
      svgEl('circle', { cx: tx - 1.4, cy: ty - 1.6, r: 2.1, fill: 'rgba(110,190,130,0.4)' }, root);
    }

    // 校舍（2.5D：南墙面 + 顶面）
    const blocks = [
      { x: 226, y: 96, w: 44, h: 30 },
      { x: 288, y: 150, w: 52, h: 36 },
      { x: 84, y: 316, w: 40, h: 30 },
      { x: 136, y: 340, w: 54, h: 34 },
      { x: 214, y: 380, w: 46, h: 30 },
      { x: 64, y: 130, w: 42, h: 32 },
      { x: 226, y: 470, w: 56, h: 34 }
    ];
    for (const b of blocks) {
      const depth = 7;
      // 南墙（正面）
      svgEl('path', {
        d: `M ${b.x} ${b.y + b.h} L ${b.x + depth} ${b.y + b.h + depth} L ${b.x + b.w + depth} ${b.y + b.h + depth} L ${b.x + b.w} ${b.y + b.h} Z`,
        fill: 'url(#ntj-wall)'
      }, root);
      // 顶面
      svgEl('rect', {
        x: b.x, y: b.y, width: b.w, height: b.h, rx: 4,
        fill: '#242e4a', stroke: '#3d4a70', 'stroke-width': 1
      }, root);
      // 顶面窗带
      svgEl('rect', {
        x: b.x + 6, y: b.y + b.h * 0.32, width: b.w - 12, height: b.h * 0.2, rx: 1.6,
        fill: 'rgba(150,200,255,0.22)'
      }, root);
    }

    // 指北针（躺在地面上）
    const compass = svgEl('g', { transform: 'translate(342, 42)' }, root);
    svgEl('circle', { r: 12, fill: 'rgba(23,28,43,0.9)', stroke: 'rgba(255,255,255,0.24)' }, compass);
    svgEl('path', { d: 'M 0 -7.5 L 3.6 4.4 L 0 1.8 L -3.6 4.4 Z', fill: '#ffd166' }, compass);
    svgEl('text', {
      x: 0, y: -15.5, 'text-anchor': 'middle', 'font-size': 9, fill: '#8b91a7'
    }, compass).textContent = 'N';
  }

  /* ---------- 区域立牌（直立 billboard） ---------- */

  function buildMarker(layer, region) {
    const marker = document.createElement('div');
    marker.className = 'map-marker';
    marker.style.left = `${(region.map.x / VIEW_W) * 100}%`;
    marker.style.top = `${(region.map.y / VIEW_H) * 100}%`;

    // 地面元素（贴地）
    const disc = document.createElement('i');
    disc.className = 'marker-ground-disc';
    const ring = document.createElement('i');
    ring.className = 'marker-ground-ring';
    const shadow = document.createElement('i');
    shadow.className = 'marker-shadow';

    // 直立内容
    const float = document.createElement('button');
    float.type = 'button';
    float.className = 'marker-float';
    float.setAttribute('aria-label', region.name);

    const lev = document.createElement('span');
    lev.className = 'marker-lev';
    const beam = document.createElement('i');
    beam.className = 'marker-beam';
    const pin = document.createElement('span');
    pin.className = 'marker-pin';
    const progress = document.createElement('span');
    progress.className = 'marker-progress';
    const orb = document.createElement('span');
    orb.className = 'marker-orb';
    const glyph = document.createElement('span');
    glyph.className = 'marker-glyph';
    orb.appendChild(glyph);
    const order = document.createElement('span');
    order.className = 'marker-order';
    pin.appendChild(progress);
    pin.appendChild(orb);
    pin.appendChild(order);

    const label = document.createElement('span');
    label.className = 'marker-label';
    const statusLabel = document.createElement('span');
    statusLabel.className = 'marker-status';

    lev.appendChild(beam);
    lev.appendChild(pin);
    lev.appendChild(label);
    lev.appendChild(statusLabel);
    float.appendChild(lev);

    marker.appendChild(shadow);
    marker.appendChild(disc);
    marker.appendChild(ring);
    marker.appendChild(float);
    layer.appendChild(marker);

    float.addEventListener('click', (event) => {
      event.preventDefault();
      if (marker._onSelect) {
        marker._onSelect(region.id);
      }
    });

    marker._refs = { disc, ring, shadow, float, beam, progress, orb, glyph, order, label, statusLabel };
    order.textContent = `⬡${region.order}`;
    return marker;
  }

  /* ---------- 主入口 ---------- */

  function renderCampusMap(container, regions, options = {}) {
    container.classList.add('campus-map-wrap');
    container.innerHTML = '';

    const scene = document.createElement('div');
    scene.className = 'map-scene';
    const plane = document.createElement('div');
    plane.className = 'map-plane';
    scene.appendChild(plane);
    container.appendChild(scene);

    const ground = svgEl('svg', {
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
      class: 'map-ground',
      role: 'img',
      'aria-label': '校园异变地图'
    }, plane);
    buildGround(ground);

    // 调查路线（金色虚线，按顺序串联）
    const route = svgEl('path', {
      class: 'map-route',
      fill: 'none',
      stroke: '#c9a13e',
      'stroke-width': 2.2,
      'stroke-dasharray': '6 7',
      'stroke-linecap': 'round',
      opacity: 0.7
    }, ground);

    const markerLayer = document.createElement('div');
    markerLayer.className = 'map-marker-layer';
    plane.appendChild(markerLayer);

    const markerRefs = new Map();
    for (const region of regions) {
      const marker = buildMarker(markerLayer, region);
      marker._onSelect = options.onSelect || null;
      markerRefs.set(region.id, marker);
    }

    // 指针视差（仅精确指针 + 未开启减动效）；写入合并到 rAF，避免高频 pointermove 反复触发样式重算
    const fineMotion = window.matchMedia('(pointer: fine) and (prefers-reduced-motion: no-preference)');
    if (fineMotion.matches && options.onSelect !== undefined) {
      scene.classList.add('map-parallax');
      let parallaxRaf = 0;
      let parallaxX = 0;
      let parallaxY = 0;
      scene.addEventListener('pointermove', (event) => {
        const rect = scene.getBoundingClientRect();
        parallaxX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
        parallaxY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
        if (parallaxRaf) {
          return;
        }
        parallaxRaf = requestAnimationFrame(() => {
          parallaxRaf = 0;
          scene.style.setProperty('--par-x', parallaxX.toFixed(3));
          scene.style.setProperty('--par-y', parallaxY.toFixed(3));
        });
      });
      scene.addEventListener('pointerleave', () => {
        if (parallaxRaf) {
          cancelAnimationFrame(parallaxRaf);
          parallaxRaf = 0;
        }
        scene.style.setProperty('--par-x', '0');
        scene.style.setProperty('--par-y', '0');
      });
    }

    function update(nextRegions, selectedId) {
      const sorted = [...nextRegions].sort((a, b) => a.order - b.order);
      const points = sorted.map((region) => `${region.map.x},${region.map.y}`).join(' ');
      route.setAttribute('d', `M ${points.split(' ').join(' L ')}`);

      scene.classList.toggle('has-selection', Boolean(selectedId));

      for (const region of nextRegions) {
        const marker = markerRefs.get(region.id);
        if (!marker) {
          continue;
        }
        const refs = marker._refs;
        const season = NTJ.SEASON_STYLES[region.season] || { label: '?', color: '#8b91a7', soft: 'rgba(255,255,255,0.2)' };
        const status = region.closed ? 'closed' : region.status;
        const isSelected = region.id === selectedId;

        marker.setAttribute('class', [
          'map-marker',
          `is-${status}`,
          isSelected ? 'is-selected' : ''
        ].filter(Boolean).join(' '));
        marker.style.setProperty('--season-color', season.color);
        marker.style.setProperty('--season-soft', season.soft);

        refs.float.setAttribute('aria-label', `${region.name}（${region.closed ? '临时关闭' : (NTJ.REGION_STATUS_LABELS[region.status] || '')}）`);
        refs.glyph.textContent = region.status === 'cleared' ? '✓' : (region.season_label || '?');
        refs.label.textContent = region.name;
        refs.statusLabel.textContent = region.closed
          ? '临时关闭'
          : (NTJ.REGION_STATUS_LABELS[region.status] || '');

        const progress = Math.max(0, Math.min(1, Number(region.anomaly_progress) || 0));
        refs.progress.style.setProperty('--progress', region.status === 'cleared' ? '1' : progress.toFixed(3));
      }
    }

    update(regions, options.selectedId);
    return { update };
  }

  window.NTJ = window.NTJ || {};
  window.NTJ.renderCampusMap = renderCampusMap;
})();
