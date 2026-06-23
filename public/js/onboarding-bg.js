(function () {
  'use strict';

  if (document.getElementById('onboarding-bg-stage')) return;

  var stage = document.createElement('div');
  stage.id = 'onboarding-bg-stage';
  stage.setAttribute('aria-hidden', 'true');
  stage.innerHTML = [
    '<canvas id="onboarding-bg-canvas"></canvas>',
    '<div class="onboarding-bg-vignette"></div>',
    '<div class="onboarding-bg-grid"></div>'
  ].join('');
  document.body.insertBefore(stage, document.body.firstChild);

  var style = document.createElement('style');
  style.textContent = `
    body.onboarding-bg-ready {
      position: relative;
      isolation: isolate;
      background: #1a1b26;
    }

    #onboarding-bg-stage {
      position: fixed;
      inset: 0;
      z-index: -1;
      pointer-events: none;
      overflow: hidden;
      background:
        radial-gradient(1200px 800px at 18% 15%, rgba(111, 66, 193, 0.10), transparent 55%),
        radial-gradient(900px 700px at 80% 22%, rgba(79, 140, 255, 0.07), transparent 52%),
        linear-gradient(180deg, #1a1b26 0%, #161823 100%);
    }

    #onboarding-bg-canvas {
      display: block;
      width: 100%;
      height: 100%;
    }

    .onboarding-bg-vignette {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(75% 65% at 50% 42%, transparent 0%, transparent 46%, rgba(0, 0, 0, 0.20) 100%),
        linear-gradient(180deg, rgba(26, 27, 38, 0.06), rgba(26, 27, 38, 0.22));
    }

    .onboarding-bg-grid {
      position: absolute;
      inset: 0;
      opacity: 0.035;
      background-image:
        linear-gradient(rgba(255,255,255,0.45) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.35) 1px, transparent 1px);
      background-size: 22px 22px;
      mix-blend-mode: soft-light;
    }
  `;
  document.head.appendChild(style);
  document.body.classList.add('onboarding-bg-ready');

  var canvas = stage.querySelector('canvas');
  if (!canvas || !canvas.getContext) return;

  var ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  var reducedMotionQuery = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  var reducedMotion = Boolean(reducedMotionQuery && reducedMotionQuery.matches);
  var dpr = 1;
  var w = 0;
  var h = 0;
  var raf = 0;
  var running = false;
  var t = 0;
  var nodes = [];

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function makeNode(initial) {
    return {
      x: initial ? rand(0, w) : rand(-60, w + 60),
      y: initial ? rand(0, h) : rand(-60, h + 60),
      vx: rand(-0.055, 0.055),
      vy: rand(-0.045, 0.045),
      radius: rand(1.1, 2.7),
      phase: rand(0, Math.PI * 2),
      hue: Math.random() > 0.62 ? 265 : 216
    };
  }

  function buildNodes() {
    var area = Math.max(1, w * h);
    var count = clamp(Math.round(area / 42000), 18, 32);
    nodes = Array.from({ length: count }, function () { return makeNode(true); });
  }

  function resize() {
    var rect = stage.getBoundingClientRect();
    w = Math.max(1, Math.floor(rect.width));
    h = Math.max(1, Math.floor(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildNodes();
    draw();
  }

  function wrap(n) {
    if (n.x < -80) n.x = w + 80;
    if (n.x > w + 80) n.x = -80;
    if (n.y < -80) n.y = h + 80;
    if (n.y > h + 80) n.y = -80;
  }

  function update(dt) {
    var delta = dt * 0.001;
    nodes.forEach(function (n) {
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      n.x += Math.sin(t * 0.00011 + n.phase) * delta * 8;
      n.y += Math.cos(t * 0.00009 + n.phase * 0.9) * delta * 6;
      wrap(n);
    });
  }

  function drawBackdrop() {
    var g1 = ctx.createRadialGradient(w * 0.18, h * 0.16, 0, w * 0.18, h * 0.16, Math.max(w, h) * 0.9);
    g1.addColorStop(0, 'rgba(111, 66, 193, 0.10)');
    g1.addColorStop(0.4, 'rgba(111, 66, 193, 0.04)');
    g1.addColorStop(1, 'rgba(111, 66, 193, 0)');

    var g2 = ctx.createRadialGradient(w * 0.81, h * 0.24, 0, w * 0.81, h * 0.24, Math.max(w, h) * 0.8);
    g2.addColorStop(0, 'rgba(79, 140, 255, 0.08)');
    g2.addColorStop(0.45, 'rgba(79, 140, 255, 0.03)');
    g2.addColorStop(1, 'rgba(79, 140, 255, 0)');

    var g3 = ctx.createRadialGradient(w * 0.5, h * 0.82, 0, w * 0.5, h * 0.82, Math.max(w, h) * 0.7);
    g3.addColorStop(0, 'rgba(99, 214, 255, 0.05)');
    g3.addColorStop(0.5, 'rgba(99, 214, 255, 0.02)');
    g3.addColorStop(1, 'rgba(99, 214, 255, 0)');

    ctx.fillStyle = '#1a1b26';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = g3;
    ctx.fillRect(0, 0, w, h);
  }

  function drawLinks() {
    for (var i = 0; i < nodes.length; i++) {
      var a = nodes[i];
      for (var j = i + 1; j < nodes.length; j++) {
        var b = nodes[j];
        var dx = a.x - b.x;
        var dy = a.y - b.y;
        var dist = Math.hypot(dx, dy);
        if (dist > 165) continue;

        var alpha = clamp(0.14 - dist / 165 * 0.12, 0.05, 0.14);
        var pulse = 0.5 + 0.5 * Math.sin(t * 0.00022 + (a.phase + b.phase));
        var lineAlpha = alpha * (0.7 + pulse * 0.35);

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = 'hsla(' + Math.round((a.hue + b.hue) / 2) + ', 95%, 72%, ' + lineAlpha + ')';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  function drawNodes() {
    nodes.forEach(function (n) {
      var pulse = 0.5 + 0.5 * Math.sin(t * 0.0011 + n.phase);
      var glowAlpha = clamp(0.06 + pulse * 0.05, 0.05, 0.12);
      var fillAlpha = clamp(0.08 + pulse * 0.04, 0.05, 0.13);

      var grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, 18);
      grad.addColorStop(0, 'hsla(' + n.hue + ', 100%, 72%, ' + glowAlpha + ')');
      grad.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 18, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'hsla(' + n.hue + ', 100%, 82%, ' + fillAlpha + ')';
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function draw() {
    drawBackdrop();
    drawLinks();
    drawNodes();
  }

  function frame(now) {
    if (!running) return;
    var dt = Math.min(34, now - t || 16.67);
    t = now;
    update(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (reducedMotion) {
      drawBackdrop();
      drawLinks();
      drawNodes();
      return;
    }
    running = true;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  }, { passive: true });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop();
    else start();
  });

  if (reducedMotionQuery && typeof reducedMotionQuery.addEventListener === 'function') {
    reducedMotionQuery.addEventListener('change', function (e) {
      reducedMotion = e.matches;
      if (reducedMotion) {
        stop();
        drawBackdrop();
        drawLinks();
        drawNodes();
      } else {
        start();
      }
    });
  }

  resize();
  start();
})();
