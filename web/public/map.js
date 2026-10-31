'use strict';

/**
 * 3D 立体校园地图（diorama 风格）。
 *
 * 结构：透视容器 .map-scene > 倾斜地面 .map-plane（rotateX）> 地形 SVG + 区域立牌。
 * 立牌用 rotateX(-tilt) 反向转正，像立在地面上的广告牌；选中时上浮 + 高亮 + 光柱。
 *
 * NTJ.renderCampusMap(container, regions, { onSelect }) → { update(regions, selectedId) }
 * 已知区域使用下方官方图参考坐标（viewBox 760×460），其余使用 region.map。
 */

(function initMap() {
  const NS = 'http://www.w3.org/2000/svg';
  const VIEW_W = 760;
  const VIEW_H = 460;

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

  // 依据交大校园管理办公室发布的闵行校区二维地图重绘。
  // 采用北向上的艺术化平面；坐标独立于旧活动种子，已有数据无需迁移。
  const CAMPUS_POINTS = {
    siyuan_gate: { x: 94, y: 426 },
    siyuan_lake: { x: 112, y: 302 },
    kaixuan_gate: { x: 590, y: 426 },
    diancao: { x: 586, y: 208 },
    hanze_lake: { x: 318, y: 214 },
    admin_building: { x: 590, y: 366 }
  };
  const mapPoint = region => CAMPUS_POINTS[region.id] || region.map;

  function buildGround(root) {
    const defs = svgEl('defs', {}, root);
    defs.innerHTML = `
      <linearGradient id="ntj-terrain" x2="0" y2="1">
        <stop stop-color="#263d44"/><stop offset="1" stop-color="#172b39"/>
      </linearGradient>
      <linearGradient id="ntj-lake" x2="0" y2="1">
        <stop stop-color="#65c9cf"/><stop offset="1" stop-color="#277a9a"/>
      </linearGradient>
      <pattern id="ntj-grid" width="20" height="20" patternUnits="userSpaceOnUse">
        <path d="M20 0H0V20" fill="none" stroke="#aedbe0" stroke-opacity=".045"/>
      </pattern>`;
    const outline = 'M26 24 L618 24 L724 65 L735 409 L714 432 L24 432 Z';
    // 外露的岩层与上沿，让校园成为悬空沙盘。
    svgEl('path', { d: outline, transform: 'translate(0 16)', fill: '#0c1729', stroke: '#526987', 'stroke-width': 2 }, root);
    svgEl('path', { d: outline, transform: 'translate(0 8)', fill: '#23354d', stroke: '#405b70' }, root);
    svgEl('path', { d: outline, fill: 'url(#ntj-terrain)', stroke: '#8eb6b4', 'stroke-width': 1.5 }, root);
    svgEl('path', { d: outline, fill: 'url(#ntj-grid)' }, root);
    // 西区 / 东区、北部运动区、东区中轴草坪。
    for (const [x,y,w,h] of [[38,280,55,115],[445,38,120,75],[568,168,132,135],[566,386,142,31],[670,66,46,53],[39,40,48,58]]) {
      svgEl('rect', {x,y,width:w,height:h,rx:8,fill:'#315345','fill-opacity':.8,stroke:'#527967','stroke-width':.6}, root);
    }
    // 主要水系：淡水河贯穿南北，思源湖在西区，涵泽湖在中部。
    svgEl('path', {d:'M442 28 Q427 73 445 114 T443 206 Q440 261 454 291 T459 359 L461 426',fill:'none',stroke:'#438fa3','stroke-width':9},root);
    svgEl('path', {d:'M32 270 Q172 274 236 268 T439 274 M455 345 Q568 351 730 366',fill:'none',stroke:'#397f96','stroke-width':5},root);
    const lakes = [
      'M83 270 Q106 254 124 272 L140 280 Q134 299 142 312 L129 335 Q104 345 91 323 L82 310 Q70 290 83 270Z',
      'M300 188 Q317 185 330 194 L335 208 L352 211 L352 234 Q333 247 306 238 L300 218Z',
      'M353 121 Q377 112 391 133 L400 141 L389 158 L365 161 L349 148Z',
      'M569 271 Q587 253 620 262 L639 276 Q615 305 586 298Z'
    ];
    for (const d of lakes) svgEl('path',{d,fill:'url(#ntj-lake)',stroke:'#a2e4db','stroke-width':1.1},root);
    // 东西向骨干道、南北向道路及沪金高速（校园的真实分隔）。
    const roads = ['M30 120 H719','M30 259 H728','M30 406 L728 419','M102 28 V426','M258 28 V426','M577 28 V426','M700 70 V423','M30 361 L426 352','M472 120 L714 345'];
    for (const d of roads) svgEl('path',{d,fill:'none',stroke:'#71908c','stroke-width':4,'stroke-opacity':.65},root);
    svgEl('path',{d:'M236 27 L239 426',fill:'none',stroke:'#101e30','stroke-width':13},root);
    svgEl('path',{d:'M236 27 L239 426',fill:'none',stroke:'#78909e','stroke-width':1.2,'stroke-dasharray':'7 5'},root);
    // 按官方图的建筑分区布置体块；省略小建筑，不虚构楼宇名称。
    const blocks = [
      [118,46,44,12],[174,46,33,12],[118,72,44,13],[174,72,33,13],[118,94,30,12],[176,94,30,12],
      [40,141,38,22],[111,139,42,18],[172,141,40,22],[111,173,35,17],[173,180,37,18],[40,210,36,22],
      [160,283,49,20],[158,319,49,17],[154,365,53,21],[104,366,35,21],
      [279,45,41,24],[341,44,42,20],[278,82,38,20],[339,83,44,18],
      [280,145,39,15],[284,169,35,12],[359,185,49,22],[369,223,39,15],
      [280,283,36,22],[333,282,33,16],[380,284,40,28],[280,324,36,23],[331,322,35,18],[380,327,40,27],
      [280,370,36,18],[333,372,32,17],[380,376,39,23],
      [478,47,39,18],[592,43,43,22],[591,81,41,18],[481,144,43,25],[534,144,30,22],
      [646,146,41,17],[649,190,40,18],[478,281,33,32],[478,329,36,21],
      [539,330,27,20],[577,341,49,24],[646,335,39,18],[645,380,43,17]
    ];
    for (const [x,y,w,h] of blocks) {
      svgEl('path',{d:`M${x} ${y+h}l4 5h${w}l-4 -5Z`,fill:'#304458',stroke:'#82959e','stroke-width':.4},root);
      svgEl('path',{d:`M${x+w} ${y}l4 5v${h}l-4 -5Z`,fill:'#3c5364'},root);
      svgEl('rect',{x,y,width:w,height:h,rx:2,fill:'#647888',stroke:'#a0b5b9','stroke-width':.6},root);
      svgEl('path',{d:`M${x+4} ${y+4}H${x+w-4}`,stroke:'#c1d7d3','stroke-opacity':.4,'stroke-width':2},root);
    }
    // 沿主路的树冠，为夜色沙盘补充自然体积。
    for (let i = 0; i < 22; i += 1) {
      const x = 42 + i * 30;
      for (const y of [130, 397]) {
        if (x > 224 && x < 262) continue;
        svgEl('ellipse',{cx:x+2,cy:y+3,rx:5,ry:3,fill:'#0b1e28'},root);
        svgEl('circle',{cx:x,cy:y-1,r:4,fill:i%3 ? '#477969' : '#bd9870',stroke:'#91b39a','stroke-width':.4},root);
      }
    }
    // 西南运动场。
    svgEl('rect',{x:42,y:305,width:43,height:64,rx:18,fill:'#735d70',stroke:'#ab91a0','stroke-width':2},root);
    svgEl('rect',{x:50,y:313,width:27,height:48,rx:10,fill:'#365f52',stroke:'#8bb2a0','stroke-width':1},root);
    for (const [x,y,label] of [[183,395,'西区'],[537,106,'东区'],[250,106,'S4'],[580,449,'东川路']]) {
      svgEl('text',{x,y,fill:'#b3d0cf','font-size':11,'letter-spacing':3,'text-anchor':'middle'},root).textContent=label;
    }
    svgEl('path',{d:'M714 48V22 M709 29L714 20L719 29',fill:'none',stroke:'#e9cf91','stroke-width':1.4},root);
    svgEl('text',{x:714,y:14,fill:'#e9cf91','font-size':10,'text-anchor':'middle'},root).textContent='N';
  }

  /* ---------- 区域立牌（直立 billboard） ---------- */

  function buildMarker(layer, region) {
    const marker = document.createElement('div');
    marker.className = 'map-marker';
    marker.dataset.region = region.id;
    marker.style.left = `${(mapPoint(region).x / VIEW_W) * 100}%`;
    marker.style.top = `${(mapPoint(region).y / VIEW_H) * 100}%`;

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
    const particles = document.createElement('div');
    particles.className = 'map-dust';
    particles.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 18; i += 1) {
      const dot = document.createElement('i');
      dot.style.cssText = `--x:${(i * 37 + 11) % 100}%;--y:${(i * 23 + 17) % 100}%;--delay:${-i * 1.3}s;--duration:${9 + i % 7}s`;
      particles.appendChild(dot);
    }
    scene.appendChild(particles);
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
      const points = sorted.map((region) => `${mapPoint(region).x},${mapPoint(region).y}`).join(' ');
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

        refs.float.setAttribute('aria-pressed', String(isSelected));
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
