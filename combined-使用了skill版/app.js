/* Combined page built with the oil-motion runtime.

   Character: frame-scrub via createFrameAnimator + createCssSpriteRenderer.
   Text:      autonomous loop driven by wall-clock time.
   Both layers use one sprite atlas each and only update background-position,
   so a stopped pointer settles on a single clean frame. */

(function () {
  "use strict";

  var CHAR_COLS = 6;
  var CHAR_ROWS = 10;
  var CHAR_COUNT = 60;
  var TEXT_COLS = 5;
  var TEXT_ROWS = 6;
  var TEXT_COUNT = 30;
  var TEXT_LOOP_MS = 3783;
  var TEXT_FRAME_MS = TEXT_LOOP_MS / TEXT_COUNT;

  var charEl = document.getElementById("char");
  var textEl = document.getElementById("text");
  var hint = document.getElementById("hint");

  var charRenderer = oilMotion.createCssSpriteRenderer(
    charEl,
    CHAR_COLS,
    CHAR_ROWS
  );
  var textRenderer = oilMotion.createCssSpriteRenderer(
    textEl,
    TEXT_COLS,
    TEXT_ROWS
  );

  var charAnimator = oilMotion.createFrameAnimator({
    frameCount: CHAR_COUNT,
    circular: true,
    smoothTime: 0.11,
    render: charRenderer
  });

  var loaded = 0;
  var total = 2;
  function preload(url) {
    var img = new Image();
    img.decoding = "async";
    img.onload = function () {
      loaded += 1;
      if (loaded >= total) {
        textStart = performance.now();
        hint.classList.add("is-hidden");
      }
    };
    img.src = url;
  }
  preload("final/char-atlas.webp");
  preload("final/text-atlas.webp");

  var textStart = 0;
  var lastTextFrame = -1;

  function setFromPointer(clientX, clientY) {
    var rect = charEl.getBoundingClientRect();
    var dx = clientX - (rect.left + rect.width / 2);
    var dy = clientY - (rect.top + rect.height / 2);
    charAnimator.setDirection(dx, dy, Math.PI);
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

  function textTick(now) {
    window.requestAnimationFrame(textTick);
    if (loaded < total) return;
    var frame = Math.floor((now - textStart) / TEXT_FRAME_MS) % TEXT_COUNT;
    if (frame !== lastTextFrame) {
      textRenderer(frame);
      lastTextFrame = frame;
    }
  }

  window.requestAnimationFrame(textTick);
})();
