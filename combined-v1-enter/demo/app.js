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
      linkText: "打开仪表盘网页",
      note: "60 秒完整演示 · 仪表盘网址待补"
    },
    {
      id: "site",
      no: "02",
      name: "个人网站",
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

  function renderMedia(demo) {
    mediaEl.innerHTML = "";
    if (demo.video) {
      var video = document.createElement("video");
      video.src = demo.video;
      video.autoplay = true;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.controls = true;
      mediaEl.appendChild(video);
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
  back.href = fromResume ? "../resume/index.html" : "../index.html?menu=1";
  back.target = "_top";
  back.title = fromResume ? "返回简历" : "返回菜单";
  back.textContent = "\u2190";
  document.body.appendChild(back);
})();
