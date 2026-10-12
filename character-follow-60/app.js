/* Character follows the pointer around a clockwise 360-degree head turn.

   This 60-frame set is sampled evenly by angle, so each frame is 6 degrees.
   Frame 01 looks left, 16 up, 31 right, 46 down, and 60 is just before left
   again. The pointer angle is mapped directly to a fractional frame position
   and two adjacent frames are cross-faded for smooth motion. */

(function () {
  "use strict";

  var FRAME_COUNT = 60;
  var DEG_PER_FRAME = 360 / FRAME_COUNT;
  var FOLLOW = 0.18;

  var stage = document.getElementById("stage");
  var canvas = document.getElementById("char");
  var hint = document.getElementById("hint");
  var ctx = canvas.getContext("2d");
  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  var frames = [];
  var loaded = 0;
  var targetTheta = 0;
  var theta = 0;

  function pad(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  for (var i = 0; i < FRAME_COUNT; i++) {
    var img = new Image();
    img.decoding = "async";
    img.onload = function () {
      loaded += 1;
      if (loaded >= FRAME_COUNT) {
        hint.classList.add("is-hidden");
        draw();
      }
    };
    img.src = "assets/frames/" + pad(i + 1) + ".png";
    frames.push(img);
  }

  function angleToFrame(thetaDeg) {
    var a = ((thetaDeg % 360) + 360) % 360;
    return a / DEG_PER_FRAME;
  }

  function resize() {
    var rect = stage.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width * dpr));
    var h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
  }

  function draw() {
    if (loaded < FRAME_COUNT) return;

    var f = angleToFrame(theta);
    var whole = Math.floor(f) % FRAME_COUNT;
    var frac = f - Math.floor(f);
    var next = (whole + 1) % FRAME_COUNT;

    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (frames[whole].complete) {
      ctx.drawImage(frames[whole], 0, 0, canvas.width, canvas.height);
    }
    if (frac > 0.005 && frames[next].complete) {
      ctx.globalAlpha = frac;
      ctx.drawImage(frames[next], 0, 0, canvas.width, canvas.height);
    }
    ctx.globalAlpha = 1;
  }

  function setFromPointer(clientX, clientY) {
    var rect = stage.getBoundingClientRect();
    var dx = clientX - (rect.left + rect.width / 2);
    var dy = clientY - (rect.top + rect.height / 2);
    var atanDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    targetTheta = (((atanDeg - 180) % 360) + 360) % 360;
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
    draw();
  });

  function tick() {
    window.requestAnimationFrame(tick);

    var diff = ((targetTheta - theta + 540) % 360) - 180;
    theta = (theta + diff * FOLLOW + 360) % 360;

    draw();
  }

  resize();
  tick();
})();
