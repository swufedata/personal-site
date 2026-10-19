const stageImages = [...document.querySelectorAll(".stage-image")];
const chapters = [...document.querySelectorAll(".chapter")];
const stageIndex = document.querySelector("#stage-index");
const stageTitle = document.querySelector("#stage-title");
const progressFill = document.querySelector("#stage-progress-fill");
const chapterLinks = [...document.querySelectorAll(".logic-strip a")];
const content = window.CASE_CONTENT;

let activeIndex = 0;

function setCopy(key, value) {
  if (!value) {
    return;
  }

  document.querySelectorAll(`[data-copy="${key}"]`).forEach((element) => {
    element.textContent = value;
  });
}

function applyContent() {
  if (!content) {
    return;
  }

  setCopy("heroTitle", content.heroTitle);
  setCopy("heroIntro", content.heroIntro);

  content.chapters.forEach((chapter, index) => {
    const number = index + 1;
    setCopy(`chapter${number}Title`, chapter.title);
    setCopy(`chapter${number}Lead`, chapter.lead);
    setCopy(`chapter${number}Body`, chapter.body);
    setCopy(`chapter${number}Bridge`, chapter.bridge);
  });

  setCopy("outcomeTitle", content.outcome?.title);
  setCopy("outcomeBody", content.outcome?.body);
  setCopy("outcomeSummary", content.outcome?.summary);
}

function setActiveChapter(index) {
  if (index === activeIndex && stageImages[index]?.classList.contains("is-active")) {
    return;
  }

  activeIndex = index;

  stageImages.forEach((image, imageIndex) => {
    image.classList.toggle("is-active", imageIndex === index);
  });

  chapters.forEach((chapter, chapterIndex) => {
    chapter.classList.toggle("is-current", chapterIndex === index);
  });

  if (stageIndex) {
    stageIndex.textContent = String(index + 1).padStart(2, "0");
  }

  if (stageTitle) {
    stageTitle.textContent =
      content?.chapters?.[index]?.title ||
      chapters[index]?.dataset.stageLabel ||
      "";
  }

  if (progressFill) {
    progressFill.style.width = `${((index + 1) / chapters.length) * 100}%`;
  }

  chapterLinks.forEach((link, linkIndex) => {
    if (linkIndex === index) {
      link.setAttribute("aria-current", "step");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

applyContent();

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

      if (!visible.length) {
        return;
      }

      const index = chapters.indexOf(visible[0].target);
      if (index >= 0) {
        setActiveChapter(index);
      }
    },
    {
      rootMargin: "-24% 0px -48% 0px",
      threshold: [0.15, 0.35, 0.55, 0.75],
    }
  );

  chapters.forEach((chapter) => observer.observe(chapter));
} else {
  const updateFromScroll = () => {
    const viewportAnchor = window.innerHeight * 0.42;
    let closestIndex = 0;
    let closestDistance = Infinity;

    chapters.forEach((chapter, index) => {
      const rect = chapter.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - viewportAnchor);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    setActiveChapter(closestIndex);
  };

  window.addEventListener("scroll", updateFromScroll, { passive: true });
  updateFromScroll();
}

setActiveChapter(0);
