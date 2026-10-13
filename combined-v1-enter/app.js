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
  var enter = document.getElementById("enter");
  var menu = document.getElementById("menu");
  var transition = document.getElementById("transition");
  var transitionVideo = document.getElementById("transition-video");
  var portfolio = document.getElementById("portfolio");
  var photographyBtn = document.querySelector(".menu__btn--photography");

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
  var textStopped = false;

  enter.addEventListener("click", function () {
    enter.classList.add("is-faded");
    textEl.classList.add("is-faded");
    textStopped = true;
    window.setTimeout(function () {
      menu.classList.add("is-visible");
    }, 800);
  });

  /* 摄影展转场
     1) 鼠标移到 photography 时只做「预取」（下载进缓存，不运行），不消耗开场动画。
     2) 点击后播放过渡视频，视频自带声音（点击属于用户操作，浏览器允许播放）。
     3) 视频放完后末帧停在黑屏，此时才真正加载摄影展（它的开场 2.5 秒倒计时从这里才算起）。
     4) 摄影展加载完成，把黑屏淡出，露出「黑 → Viper WANG 淡入」的开场。
     因为两头都是纯黑，中间的加载时间完全看不出来。 */
  var PORTFOLIO_SRC = "photo/index.html";
  var prefetched = false;
  var transitionStarted = false;
  var portfolioRequested = false;

  function prefetchPortfolio() {
    if (prefetched) return;
    prefetched = true;
    var link = document.createElement("link");
    link.rel = "prefetch";
    link.href = PORTFOLIO_SRC;
    document.head.appendChild(link);
  }

  function revealPortfolio() {
    portfolio.classList.add("is-visible");
    transition.classList.remove("is-playing");
  }

  function requestPortfolio() {
    if (portfolioRequested) return;
    portfolioRequested = true;
    portfolio.setAttribute("src", PORTFOLIO_SRC);
    window.setTimeout(revealPortfolio, 4000);
  }

  portfolio.addEventListener("load", function () {
    if (portfolioRequested) revealPortfolio();
  });

  transitionVideo.addEventListener("ended", requestPortfolio);
  transitionVideo.addEventListener("error", function () {
    revealPortfolio();
    requestPortfolio();
  });

  photographyBtn.addEventListener("pointerenter", prefetchPortfolio);
  photographyBtn.addEventListener("click", function () {
    if (transitionStarted) return;
    transitionStarted = true;
    prefetchPortfolio();
    transition.classList.add("is-playing");
    var playing = transitionVideo.play();
    if (playing && typeof playing.catch === "function") {
      playing.catch(function () {
        revealPortfolio();
        requestPortfolio();
      });
    }
  });

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
    if (loaded < total || textStopped) return;
    var frame = Math.floor((now - textStart) / TEXT_FRAME_MS) % TEXT_COUNT;
    if (frame !== lastTextFrame) {
      textRenderer(frame);
      lastTextFrame = frame;
    }
  }

  window.requestAnimationFrame(textTick);
})();
