/* Welcome page controller.

   The whole animation state is a single number: T, the time inside the source
   clip in seconds. Pointer, gyroscope, touch drag and the idle loop all just
   drive T, and the renderer samples whichever sprite sheet matches the current
   mode. Because both sheets are timed against the same clip, switching between
   "follow the pointer" and "play the loop" never pops.

   Frames are drawn two at a time with a cross-fade, so a 5fps sprite sheet
   still reads as smooth motion on a 60Hz display. */

(function () {
  "use strict";

  var M = JSON.parse(document.getElementById("hero-manifest").textContent);

  var stage = document.getElementById("stage");
  var canvas = document.getElementById("scene-canvas");
  var sceneWrap = document.getElementById("scene");
  var accents = document.getElementById("accents");
  var hud = document.getElementById("hud");
  var fillEl = document.getElementById("hud-fill");
  var pctEl = document.getElementById("hud-pct");

  var ctx = canvas.getContext("2d", { alpha: false });
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var MIN_LOAD_MS = reduced ? 1400 : 3000;
  var IDLE_AFTER_MS = 2000;
  var FOLLOW = 0.12;
  var SPAN = M.source.span;
  var ASSET_BASE = "assets/hero/";

  var useMobileSheet = window.matchMedia("(max-width: 760px)").matches;
  var sweep = useMobileSheet && M.sheets.mobile ? M.sheets.mobile : M.sheets.desktop;
  var loop = M.sheets.loop;

  // The manifest stores bare file names; resolve them against the asset folder.
  function sheetSrc(sheet) {
    return sheet.src || ASSET_BASE + sheet.file;
  }

  sweep.src = sheetSrc(sweep);
  loop.src = sheetSrc(loop);

  var imgSweep = null;
  var imgLoop = null;

  var T = loop.t0;
  var targetT = sweep.t0;
  var mode = "idle";
  var lastPointerAt = -Infinity;
  var targetPointer = { x: 0.5, y: 0.5 };
  var pointer = { x: 0.5, y: 0.5 };
  var touchActive = false;
  var dirty = true;
  var lastDrawIndex = -1;

  var realProgress = 0;
  var shownProgress = 0;
  var finished = false;
  var startedAt = performance.now();
  var lastTick = startedAt;

  // -------------------------------------------------------------- utilities

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function loadImage(src) {
    return new Promise(function (resolve) {
      if (!src) {
        resolve(null);
        return;
      }
      var img = new Image();
      img.decoding = "async";
      img.onload = function () {
        if (img.decode) {
          img.decode().then(
            function () { resolve(img); },
            function () { resolve(img); }
          );
        } else {
          resolve(img);
        }
      };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  // ----------------------------------------------------------------- canvas

  function resizeCanvas() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rect = stage.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width * dpr));
    var h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    dirty = true;
  }

  /* Fractional frame position inside a sheet for a given clip time. */
  function positionFor(sheet, time) {
    var span = sheet.t1 - sheet.t0 || 1;
    var p = (time - sheet.t0) / span;
    return clamp(p, 0, 1) * (sheet.frames - 1);
  }

  function drawCell(img, sheet, index, alpha) {
    var col = index % sheet.cols;
    var row = (index - col) / sheet.cols;
    ctx.globalAlpha = alpha;
    ctx.drawImage(
      img,
      col * sheet.frameWidth,
      row * sheet.frameHeight,
      sheet.frameWidth,
      sheet.frameHeight,
      0,
      0,
      canvas.width,
      canvas.height
    );
    ctx.globalAlpha = 1;
  }

  function draw(force) {
    var idle = mode === "idle";
    var sheet = idle ? loop : sweep;
    var img = idle ? imgLoop : imgSweep;
    if (!img) return;

    var pos = positionFor(sheet, T);
    var whole = Math.floor(pos);
    var frac = pos - whole;
    var key = whole * 1000 + Math.round(frac * 999);
    if (!force && key === lastDrawIndex) return;
    lastDrawIndex = key;

    var next = Math.min(whole + 1, sheet.frames - 1);
    drawCell(img, sheet, whole, 1);
    if (next !== whole && frac > 0.004) drawCell(img, sheet, next, frac);
  }

  // ---------------------------------------------------------------- progress

  function updateProgress(now) {
    if (finished) return;

    var timeGate = Math.min((now - startedAt) / MIN_LOAD_MS, 1);
    var allowed = Math.min(realProgress, timeGate);
    var eased = 1 - Math.pow(1 - allowed, 2.3);
    shownProgress += (eased - shownProgress) * 0.16;

    if (allowed >= 1 && realProgress >= 1 && shownProgress > 0.992) {
      shownProgress = 1;
    }

    fillEl.style.width = (shownProgress * 100).toFixed(2) + "%";
    pctEl.textContent = Math.min(99, Math.round(shownProgress * 100)) + "%";

    if (shownProgress >= 1 && realProgress >= 1) {
      finished = true;
      finish();
    }
  }

  function finish() {
    fillEl.style.width = "100%";
    pctEl.textContent = "100%";
    window.setTimeout(function () {
      document.body.classList.add("is-revealing");
      window.setTimeout(function () {
        hud.setAttribute("aria-hidden", "true");
      }, 900);
    }, 420);
  }

  function trackProgress(promise, weight) {
    var settle = function () { realProgress += weight; };
    promise.then(settle, settle);
  }

  function boot() {
    window.setTimeout(function () {
      hud.classList.add("is-visible");
    }, 90);

    var fonts =
      document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();

    trackProgress(
      loadImage(sweep.src).then(function (img) {
        imgSweep = img;
        resizeCanvas();
        draw(true);
      }),
      0.46
    );

    trackProgress(
      loadImage(loop.src).then(function (img) {
        imgLoop = img;
      }),
      0.34
    );

    trackProgress(fonts, 0.2);
  }

  // ----------------------------------------------------------------- input

  function setFromPointer(clientX, clientY) {
    var rect = stage.getBoundingClientRect();
    var px = clamp((clientX - rect.left) / rect.width, 0, 1);
    var py = clamp((clientY - rect.top) / rect.height, 0, 1);
    targetPointer.x = px;
    targetPointer.y = py;
    targetT = sweep.t0 + px * (sweep.t1 - sweep.t0);
    mode = "pointer";
    lastPointerAt = performance.now();
  }

  function onPointerMove(event) {
    if (event.pointerType === "touch" && !touchActive) return;
    setFromPointer(event.clientX, event.clientY);
  }

  function onPointerDown(event) {
    if (event.pointerType === "touch") touchActive = true;
    setFromPointer(event.clientX, event.clientY);
  }

  function onPointerUp() {
    touchActive = false;
  }

  function onOrientation(event) {
    if (touchActive || reduced) return;
    var gamma = event.gamma;
    if (gamma === null || gamma === undefined) return;
    var px = (clamp(gamma, -35, 35) / 35 + 1) / 2;
    targetPointer.x = px;
    targetT = sweep.t0 + px * (sweep.t1 - sweep.t0);
    mode = "pointer";
    lastPointerAt = performance.now();
  }

  function initOrientation() {
    if (reduced || !window.DeviceOrientationEvent) return;
    var request = window.DeviceOrientationEvent.requestPermission;
    if (typeof request === "function") {
      // iOS needs a user gesture before orientation events are handed over.
      var ask = function () {
        window.removeEventListener("pointerdown", ask);
        request.call(window.DeviceOrientationEvent)
          .then(function (result) {
            if (result === "granted") {
              window.addEventListener("deviceorientation", onOrientation, { passive: true });
            }
          })
          .catch(function () {});
      };
      window.addEventListener("pointerdown", ask, { passive: true });
    } else {
      window.addEventListener("deviceorientation", onOrientation, { passive: true });
    }
  }

  // ------------------------------------------------------------------ frame

  function frame(now) {
    window.requestAnimationFrame(frame);
    var dt = Math.min((now - lastTick) / 1000, 0.05);
    lastTick = now;

    updateProgress(now);

    if (mode === "pointer" && now - lastPointerAt > IDLE_AFTER_MS) {
      mode = "idle";
    }

    if (mode === "idle" && !reduced) {
      T += dt;
      if (T > loop.t1) T -= loop.t1 - loop.t0;
    } else {
      T += (targetT - T) * FOLLOW;
    }

    // Depth parallax: the artwork shifts a little, the accents shift more.
    if (!reduced) {
      pointer.x += (targetPointer.x - pointer.x) * 0.07;
      pointer.y += (targetPointer.y - pointer.y) * 0.07;
      var sx = (pointer.x - 0.5) * -9;
      var sy = (pointer.y - 0.5) * -6;
      sceneWrap.style.transform = "translate3d(" + sx.toFixed(2) + "px," + sy.toFixed(2) + "px,0)";
      accents.style.transform =
        "translate3d(" + (sx * -1.9).toFixed(2) + "px," + (sy * -1.9).toFixed(2) + "px,0)";
    }

    draw(dirty);
    dirty = false;
  }

  // ------------------------------------------------------------------- init

  resizeCanvas();
  boot();
  initOrientation();
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("pointerup", onPointerUp, { passive: true });
  window.addEventListener("pointercancel", onPointerUp, { passive: true });
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("orientationchange", resizeCanvas);
  window.requestAnimationFrame(frame);
})();
