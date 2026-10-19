(function () {
  "use strict";

  /* 每个 demo 一条数据：以后补上视频和链接即可，不用改结构。
     video 留空 -> 显示"演示视频占位"；
     link 留空  -> "打开网页"按钮置灰。 */
  var DEMOS = [
    {
      id: "ledger",
      no: "01",
      name: "微信一句话记账",
      url: "demo://微信一句话记账",
      title: "微信一句话记账",
      desc:
        "在微信里发一句话就能记账（如「午饭 35」），微信或手机浏览器随时看本月收支、分类占比和最近流水。",
      video: "assets/ledger-demo.mp4",
      link: "",
      linkText: "打开收支统计网页",
      note: "60 秒完整演示 · 收支统计网页涉及个人隐私与 API 使用，暂未公开"
    },
    {
      id: "site",
      no: "02",
      name: "个人网站（持续完善中）",
      url: "demo://个人网站",
      title: "个人网站",
      desc:
        "手绘背景 + 人物跟随鼠标转头 + 手绘文字动效，纯前端实现，可离线打开，电脑端体验更佳。",
      video: "assets/site-demo.mp4",
      link: "../../combined-v1-enter/index.html",
      linkText: "打开网站",
      note: ""
    },
    {
      id: "more",
      no: "03+",
      name: "更多 demo",
      url: "demo://更多 demo",
      title: "更多 demo",
      desc:
        "另外还有一些 demo，因涉及内部内容或尚未整理，暂不方便在线展示。",
      video: "",
      link: "",
      linkText: "打开网页",
      note: "暂不在线展示",
      empty: "更多 demo 暂不在线展示"
    }
  ];

  var tabsEl = document.getElementById("tabs");
  var urlEl = document.getElementById("browser-url");
  var mediaEl = document.getElementById("view-media");
  var titleEl = document.getElementById("view-title");
  var descEl = document.getElementById("view-desc");
  var linkEl = document.getElementById("view-link");
  var noteEl = document.getElementById("view-note");

  var activeId = DEMOS[0].id;
  var renderToken = 0;
  var currentObjectUrl = null;

  function buildTabs() {
    DEMOS.forEach(function (demo) {
      var btn = document.createElement("button");
      btn.className = "tab";
      btn.type = "button";
      btn.dataset.demo = demo.id;

      var no = document.createElement("span");
      no.className = "tab__no";
      no.textContent = demo.no;

      var name = document.createElement("span");
      name.className = "tab__name";
      name.textContent = demo.name;

      btn.appendChild(no);
      btn.appendChild(name);
      btn.addEventListener("click", function () {
        selectDemo(demo.id);
      });
      tabsEl.appendChild(btn);
    });
  }

  var ICON_PLAY =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  var ICON_PAUSE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
  var ICON_VOLUME =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  var ICON_MUTED =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  var ICON_FULLSCREEN =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h6v2H7v4H5V5zm8 0h6v6h-2V7h-4V5zM5 13h2v4h4v2H5v-6zm12 0h2v6h-6v-2h4v-4z"/></svg>';

  function formatTime(value) {
    if (!isFinite(value) || value < 0) return "0:00";
    var total = Math.floor(value);
    var minutes = Math.floor(total / 60);
    var seconds = total % 60;
    return minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
  }

  function renderMedia(demo) {
    var token = ++renderToken;
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }
    mediaEl.innerHTML = "";
    if (demo.video) {
      var video = document.createElement("video");
      video.autoplay = true;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.controls = false;
      mediaEl.appendChild(video);

      var controls = document.createElement("div");
      controls.className = "player-controls";
      controls.innerHTML =
        '<button class="player-btn player-btn--play" type="button" aria-label="暂停">' +
        ICON_PAUSE +
        "</button>" +
        '<span class="player-time player-time--current">0:00</span>' +
        '<input class="player-seek" type="range" min="0" max="1000" value="0" step="1" aria-label="播放进度">' +
        '<span class="player-time player-time--duration">0:00</span>' +
        '<button class="player-btn player-btn--mute" type="button" aria-label="静音">' +
        ICON_VOLUME +
        "</button>" +
        '<button class="player-btn player-btn--fullscreen" type="button" aria-label="全屏">' +
        ICON_FULLSCREEN +
        "</button>";
      mediaEl.appendChild(controls);

      var playBtn = controls.querySelector(".player-btn--play");
      var muteBtn = controls.querySelector(".player-btn--mute");
      var fullBtn = controls.querySelector(".player-btn--fullscreen");
      var seek = controls.querySelector(".player-seek");
      var currentEl = controls.querySelector(".player-time--current");
      var durationEl = controls.querySelector(".player-time--duration");
      var seeking = false;

      function syncPlayButton() {
        playBtn.innerHTML = video.paused ? ICON_PLAY : ICON_PAUSE;
        playBtn.setAttribute("aria-label", video.paused ? "播放" : "暂停");
      }

      function syncMuteButton() {
        muteBtn.innerHTML = video.muted ? ICON_MUTED : ICON_VOLUME;
        muteBtn.setAttribute("aria-label", video.muted ? "取消静音" : "静音");
      }

      function syncSeek() {
        if (!seeking && isFinite(video.duration) && video.duration > 0) {
          seek.value = String((video.currentTime / video.duration) * 1000);
        }
        currentEl.textContent = formatTime(video.currentTime);
      }

      function togglePlay() {
        if (video.paused) {
          video.play();
        } else {
          video.pause();
        }
      }

      function toggleFullscreen() {
        if (document.fullscreenElement) {
          document.exitFullscreen();
          return;
        }
        if (mediaEl.requestFullscreen) {
          mediaEl.requestFullscreen();
          return;
        }
        if (video.webkitEnterFullscreen) {
          video.webkitEnterFullscreen();
        }
      }

      function seekToPointer(event) {
        var rect = seek.getBoundingClientRect();
        if (!rect.width || !isFinite(video.duration)) return;
        var ratio = Math.min(
          1,
          Math.max(0, (event.clientX - rect.left) / rect.width)
        );
        seek.value = String(ratio * 1000);
        seeking = true;
        video.currentTime = ratio * video.duration;
        currentEl.textContent = formatTime(video.currentTime);
      }

      video.addEventListener("loadedmetadata", function () {
        durationEl.textContent = formatTime(video.duration);
        syncSeek();
      });
      video.addEventListener("timeupdate", syncSeek);
      video.addEventListener("play", syncPlayButton);
      video.addEventListener("pause", syncPlayButton);
      video.addEventListener("click", togglePlay);
      playBtn.addEventListener("click", togglePlay);
      muteBtn.addEventListener("click", function () {
        video.muted = !video.muted;
        syncMuteButton();
      });
      fullBtn.addEventListener("click", toggleFullscreen);
      seek.addEventListener("input", function () {
        seeking = true;
        if (isFinite(video.duration) && video.duration > 0) {
          video.currentTime =
            (Number(seek.value) / 1000) * video.duration;
        }
        currentEl.textContent = formatTime(video.currentTime);
      });
      seek.addEventListener("change", function () {
        seeking = false;
      });
      seek.addEventListener("pointerup", function () {
        seeking = false;
      });
      seek.addEventListener("pointercancel", function () {
        seeking = false;
      });
      seek.addEventListener("pointerdown", seekToPointer);

      syncPlayButton();
      syncMuteButton();

      var loading = document.createElement("div");
      loading.className = "player-loading";
      loading.textContent = "视频加载中…";
      mediaEl.appendChild(loading);

      function hideLoading() {
        if (loading.parentNode) {
          loading.parentNode.removeChild(loading);
        }
      }

      function playVideo() {
        var playing = video.play();
        if (playing && typeof playing.catch === "function") {
          playing.catch(function () {});
        }
      }

      video.addEventListener("loadedmetadata", hideLoading, { once: true });
      video.addEventListener("canplay", hideLoading, { once: true });
      video.addEventListener("error", hideLoading, { once: true });

      var isRemote =
        location.protocol === "http:" || location.protocol === "https:";

      if (!isRemote || !window.fetch) {
        /* file:// 或旧浏览器：直接播放，本地文件本身支持跳转。 */
        video.src = demo.video;
        playVideo();
      } else {
        /* Cloudflare 静态资源不支持 Range 请求，先完整取回再用 Blob 播放，
           这样进度条的点击/拖动才能真正跳转。 */
        fetch(demo.video, { cache: "force-cache" })
          .then(function (response) {
            if (!response.ok) {
              throw new Error("video fetch failed");
            }
            return response.blob();
          })
          .then(function (blob) {
            if (token !== renderToken) {
              return;
            }
            currentObjectUrl = URL.createObjectURL(blob);
            video.src = currentObjectUrl;
            playVideo();
          })
          .catch(function () {
            if (token !== renderToken) {
              return;
            }
            hideLoading();
            video.src = demo.video;
            playVideo();
          });
      }
      return;
    }
    var box = document.createElement("div");
    box.className = "media__placeholder";
    var play = document.createElement("span");
    play.className = "media__play";
    play.textContent = "\u25B6";
    var hint = document.createElement("span");
    hint.className = "media__hint";
    hint.textContent = demo.empty || "演示视频占位";
    box.appendChild(play);
    box.appendChild(hint);
    mediaEl.appendChild(box);
  }

  function selectDemo(id) {
    var demo = null;
    for (var i = 0; i < DEMOS.length; i++) {
      if (DEMOS[i].id === id) demo = DEMOS[i];
    }
    if (!demo) return;
    activeId = id;

    Array.prototype.forEach.call(tabsEl.children, function (btn) {
      btn.classList.toggle("is-active", btn.dataset.demo === id);
    });

    urlEl.textContent = demo.url;
    titleEl.textContent = demo.title;
    descEl.textContent = demo.desc;
    noteEl.textContent = demo.note || "";

    linkEl.textContent = demo.linkText;
    if (demo.link) {
      linkEl.setAttribute("href", demo.link);
      linkEl.classList.remove("is-disabled");
    } else {
      linkEl.setAttribute("href", "#");
      linkEl.classList.add("is-disabled");
    }

    renderMedia(demo);
  }

  buildTabs();
  selectDemo(activeId);

  var fromResume = new URLSearchParams(window.location.search).has("from");
  var back = document.createElement("a");
  back.className = "back-float";
  back.href = fromResume ? "../resume/index.html?v=3" : "../index.html?menu=1";
  back.target = "_top";
  back.title = fromResume ? "返回简历" : "返回菜单";
  back.textContent = "\u2190";
  document.body.appendChild(back);
})();
