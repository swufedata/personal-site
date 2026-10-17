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
  var target = document.getElementById("target");
  var photographyBtn = document.querySelector(".menu__btn--photography");
  var demoBtn = document.querySelector(".menu__btn--demo");
  var resumeBtn = document.querySelector(".menu__btn--resume");

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

  if (new URLSearchParams(window.location.search).has("menu")) {
    enter.classList.add("is-faded");
    textEl.classList.add("is-faded");
    textStopped = true;
    menu.classList.add("is-visible");
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, "", window.location.href.replace(/[?#].*$/, ""));
    }
  }

  /* 作品页转场：photography / demo / resume 共用同一套「转场视频 + 内嵌网页」。
     1) 鼠标移到按钮上时只做「预取」（下载进缓存，不运行），不提前消耗目标页自身的开场。
     2) 点击后全屏播放该按钮对应的转场视频；视频自带声音时也会照常播放
        （点击属于用户操作，浏览器允许出声）。
     3) 视频播完，把最后一帧停在屏幕上不动；此时才真正加载目标网页
        （它自己的开场动画从现在才开始算，所以能看到完整开场）。
     4) 目标网页加载好后，先让它「瞬间」变不透明（把菜单页彻底盖住），
        再让视频淡出。摄影展是「黑→黑」，demo 是「纸白→纸白」，resume 是
        「放大后的纸面 → 简历页」，三者的淡出时长与垫底色由下面的配置决定。 */
  var TRANSITIONS = {
    photography: {
      videoId: "video-photography",
      page: "photo/index.html",
      backdrop: "#000000",
      fade: 500
    },
    demo: {
      videoId: "video-demo",
      page: "demo/index.html",
      backdrop: "#f7f1e7",
      fade: 500
    },
    resume: {
      videoId: "video-resume",
      page: "resume/index.html",
      backdrop: "#f2f4ef",
      fade: 900
    }
  };
  var prefetched = {};
  var transitionStarted = false;
  var targetSrc = "";
  var targetRequested = false;
  var targetRevealed = false;

  function prefetchPage(href) {
    if (prefetched[href]) return;
    prefetched[href] = true;
    var link = document.createElement("link");
    link.rel = "prefetch";
    link.href = href;
    document.head.appendChild(link);
  }

  function revealTarget() {
    if (targetRevealed) return;
    targetRevealed = true;
    target.classList.add("is-visible");
    window.requestAnimationFrame(function () {
      transition.classList.remove("is-playing");
    });
  }

  function requestTarget() {
    if (targetRequested) return;
    targetRequested = true;
    target.setAttribute("src", targetSrc);
    window.setTimeout(revealTarget, 4000);
  }

  target.addEventListener("load", function () {
    if (targetRequested) revealTarget();
  });

  function startTransition(key) {
    if (transitionStarted) return;
    var spec = TRANSITIONS[key];
    if (!spec) return;
    transitionStarted = true;
    targetSrc = spec.page;
    prefetchPage(spec.page);

    var videos = transition.querySelectorAll(".transition__video");
    var active = null;
    Array.prototype.forEach.call(videos, function (video) {
      var on = video.id === spec.videoId;
      video.classList.toggle("is-active", on);
      if (on) active = video;
    });
    if (!active) return;

    active.addEventListener("ended", requestTarget, { once: true });
    active.addEventListener("error", requestTarget, { once: true });

    transition.style.background = spec.backdrop;
    transition.style.transitionDuration = spec.fade + "ms";
    transition.classList.add("is-playing");
    var playing = active.play();
    if (playing && typeof playing.catch === "function") {
      playing.catch(requestTarget);
    }
  }

  [
    [resumeBtn, "resume"],
    [demoBtn, "demo"],
    [photographyBtn, "photography"]
  ].forEach(function (pair) {
    var btn = pair[0];
    var key = pair[1];
    if (!btn) return;
    btn.addEventListener("pointerenter", function () {
      prefetchPage(TRANSITIONS[key].page);
    });
    btn.addEventListener("click", function () {
      startTransition(key);
    });
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
