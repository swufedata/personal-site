/* Combined welcome page.

   Layers, bottom to top: background image, character (60 transparent frames,
   pointer-driven), text animation (30 transparent frames, autonomous loop).
   The character set is sampled evenly by angle, so the pointer angle maps
   directly to a frame; adjacent frames are cross-faded for smooth motion. */

(function () {
  "use strict";

  var CHAR_COUNT = 60;
  var TEXT_COUNT = 30;
  var CHAR_DEG = 360 / CHAR_COUNT;
  var FOLLOW = 0.18;
  var TEXT_LOOP_MS = 3783;
  var TEXT_FRAME_MS = TEXT_LOOP_MS / TEXT_COUNT;

  var stage = document.getElementById("stage");
  var char = document.getElementById("char");
  var text = document.getElementById("text");
  var hint = document.getElementById("hint");

  var charCtx = char.getContext("2d");
  var textCtx = text.getContext("2d");
  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  var charFrames = [];
  var textFrames = [];
  var charLoaded = 0;
  var textLoaded = 0;
  var targetTheta = 0;
  var theta = 0;
  var textStart = 0;
  var lastPointerAt = -Infinity;

  function pad(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  function loadFrameList(count, folder, list) {
    for (var i = 0; i < count; i++) {
      var img = new Image();
      img.decoding = "async";
      img.onload = function () {
        if (folder === "char") charLoaded += 1;
        else textLoaded += 1;
        if (charLoaded >= CHAR_COUNT && textLoaded >= TEXT_COUNT) {
          textStart = performance.now();
          hint.classList.add("is-hidden");
        }
      };
      img.src = "assets/" + folder + "/" + pad(i + 1) + ".png";
      list.push(img);
    }
  }

  loadFrameList(CHAR_COUNT, "char", charFrames);
  loadFrameList(TEXT_COUNT, "text", textFrames);

  function normalizeAngle(deg) {
    return ((deg % 360) + 360) % 360;
  }

  function angleToFrame(thetaDeg) {
    return normalizeAngle(thetaDeg) / CHAR_DEG;
  }

  function resize() {
    var c = char.getBoundingClientRect();
    var cw = Math.max(1, Math.round(c.width * dpr));
    var ch = Math.max(1, Math.round(c.height * dpr));
    if (char.width !== cw || char.height !== ch) {
      char.width = cw;
      char.height = ch;
    }

    var t = text.getBoundingClientRect();
    var tw = Math.max(1, Math.round(t.width * dpr));
    var th = Math.max(1, Math.round(t.height * dpr));
    if (text.width !== tw || text.height !== th) {
      text.width = tw;
      text.height = th;
    }

    charCtx.imageSmoothingEnabled = true;
    charCtx.imageSmoothingQuality = "high";
    textCtx.imageSmoothingEnabled = true;
    textCtx.imageSmoothingQuality = "high";
  }

  function drawChar(crossfade) {
    if (charLoaded < CHAR_COUNT) return;

    var f = angleToFrame(theta);
    var whole;
    var frac;
    var next;
    if (crossfade) {
      whole = Math.floor(f) % CHAR_COUNT;
      frac = f - Math.floor(f);
      next = (whole + 1) % CHAR_COUNT;
    } else {
      whole = ((Math.round(f) % CHAR_COUNT) + CHAR_COUNT) % CHAR_COUNT;
      frac = 0;
      next = whole;
    }

    charCtx.globalAlpha = 1;
    charCtx.clearRect(0, 0, char.width, char.height);
    if (charFrames[whole].complete) {
      charCtx.drawImage(charFrames[whole], 0, 0, char.width, char.height);
    }
    if (frac > 0.005 && charFrames[next].complete) {
      charCtx.globalAlpha = frac;
      charCtx.drawImage(charFrames[next], 0, 0, char.width, char.height);
    }
    charCtx.globalAlpha = 1;
  }

  function drawText() {
    if (textLoaded < TEXT_COUNT) return;

    var idx = Math.floor((performance.now() - textStart) / TEXT_FRAME_MS) % TEXT_COUNT;
    textCtx.globalAlpha = 1;
    textCtx.clearRect(0, 0, text.width, text.height);
    if (textFrames[idx].complete) {
      textCtx.drawImage(textFrames[idx], 0, 0, text.width, text.height);
    }
  }

  function setFromPointer(clientX, clientY) {
    var rect = char.getBoundingClientRect();
    var dx = clientX - (rect.left + rect.width / 2);
    var dy = clientY - (rect.top + rect.height / 2);
    var atanDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    targetTheta = normalizeAngle(atanDeg - 180);
    lastPointerAt = performance.now();
  }

  window.addEventListener(
    "pointermove",
    function (event) {
      setFromPointer(event.clientX, event.clientY);
    },
    { passive: true }
  );

  window.addEventListener(
    "pointerdown",
    function (event) {
      setFromPointer(event.clientX, event.clientY);
    },
    { passive: true }
  );

  window.addEventListener("resize", function () {
    resize();
  });

  function tick(now) {
    window.requestAnimationFrame(tick);

    var idle = now - lastPointerAt > 180;
    if (idle) {
      var snapped = Math.round(angleToFrame(targetTheta));
      theta = (((snapped % CHAR_COUNT) + CHAR_COUNT) % CHAR_COUNT) * CHAR_DEG;
    } else {
      var diff = ((targetTheta - theta + 540) % 360) - 180;
      theta = (theta + diff * FOLLOW + 360) % 360;
    }

    drawChar(!idle);
    drawText();
  }

  resize();
  tick();
})();
