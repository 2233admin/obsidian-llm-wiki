/**
 * llm-wiki HTML Enhancement Script
 * Provides: Prism highlighting, Mermaid diagrams, code copy, collapsible blocks, tabs
 */

(function () {
  "use strict";

  // ============================================================
  // Initialize CDN Libraries
  // ============================================================
  function initLibraries() {
    // Prism.js: Add language classes to code blocks before highlighting
    if (typeof Prism !== "undefined") {
      document.querySelectorAll("pre code").forEach(function (block) {
        // Check if already has a language class
        if (!block.className.includes("language-")) {
          // Try to detect language from class (e.g., "sourceCode python")
          var match = block.className.match(/sourceCode\s+(\w+)/);
          if (match) {
            block.className = "language-" + match[1];
          }
        }
        block.parentElement.classList.add("line-numbers");
      });
      Prism.highlightAll();
    }

    // Mermaid.js diagrams (via CDN)
    if (typeof mermaid !== "undefined") {
      mermaid.initialize({
        startOnLoad: true,
        theme: "default",
        securityLevel: "loose",
        fontFamily: "inherit",
      });
    }

    // Mark page as ready
    document.body.classList.add("wiki-ready");
  }

  // ============================================================
  // Copy Code Button
  // ============================================================
  function initCopyButtons() {
    document.querySelectorAll("pre").forEach(function (pre) {
      if (pre.querySelector(".copy-btn")) return;

      var code = pre.querySelector("code");
      if (!code) return;

      var btn = document.createElement("button");
      btn.className = "copy-btn";
      btn.setAttribute("aria-label", "Copy code");
      btn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      btn.addEventListener("click", function () {
        var text = code.textContent || code.innerText;
        navigator.clipboard.writeText(text).then(
          function () {
            btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
            setTimeout(function () {
              btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
            }, 2000);
          },
          function () {
            btn.textContent = "Failed";
          }
        );
      });

      pre.classList.add("code-block");
      pre.appendChild(btn);
    });
  }

  // ============================================================
  // Collapsible Callout Blocks
  // ============================================================
  function initCollapsibleCallouts() {
    document.querySelectorAll(".callout").forEach(function (callout) {
      var type = "";
      if (callout.classList.contains("callout-note")) type = "Note";
      else if (callout.classList.contains("callout-tip")) type = "Tip";
      else if (callout.classList.contains("callout-warning"))
        type = "Warning";
      else if (callout.classList.contains("callout-info")) type = "Info";
      else if (callout.classList.contains("callout-example"))
        type = "Example";

      // Check if already converted
      if (callout.querySelector("details")) return;

      var details = document.createElement("details");
      details.className = callout.className;

      var summary = document.createElement("summary");
      summary.innerHTML =
        '<span class="callout-icon">' +
        getCalloutIcon(type) +
        "</span> " +
        "<strong>" +
        type +
        "</strong>";

      // Move callout content into details
      var content = document.createElement("div");
      content.className = "callout-content";
      while (callout.firstChild) {
        content.appendChild(callout.firstChild);
      }

      details.appendChild(summary);
      details.appendChild(content);
      callout.parentNode.replaceChild(details, callout);
    });
  }

  function getCalloutIcon(type) {
    var icons = {
      Note: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
      Tip: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"></path><line x1="9" y1="21" x2="15" y2="21"></line><line x1="10" y1="24" x2="14" y2="24"></line></svg>',
      Warning:
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
      Info: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
      Example:
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>',
    };
    return icons[type] || icons["Note"];
  }

  // ============================================================
  // Tab Panels
  // ============================================================
  function initTabs() {
    document.querySelectorAll(".tab-set").forEach(function (tabSet) {
      if (tabSet.querySelector(".tab-nav")) return; // Already initialized

      var tabs = tabSet.querySelectorAll(".tab");
      if (tabs.length === 0) return;

      var nav = document.createElement("div");
      nav.className = "tab-nav";
      nav.setAttribute("role", "tablist");

      tabs.forEach(function (tab, i) {
        var btn = document.createElement("button");
        btn.textContent = tab.getAttribute("data-label") || "Tab " + (i + 1);
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-selected", i === 0 ? "true" : "false");
        btn.setAttribute("aria-controls", "tabpanel-" + i);
        btn.className = i === 0 ? "active" : "";
        btn.addEventListener("click", function () {
          nav.querySelectorAll("button").forEach(function (b) {
            b.classList.remove("active");
            b.setAttribute("aria-selected", "false");
          });
          tabs.forEach(function (t) {
            t.style.display = "none";
          });
          btn.classList.add("active");
          btn.setAttribute("aria-selected", "true");
          tab.style.display = "block";
        });
        nav.appendChild(btn);

        tab.id = "tabpanel-" + i;
        tab.setAttribute("role", "tabpanel");
        if (i > 0) tab.style.display = "none";
      });

      tabSet.insertBefore(nav, tabSet.firstChild);
    });
  }

  // ============================================================
  // Scroll Spy for TOC
  // ============================================================
  function initScrollSpy() {
    var tocLinks = document.querySelectorAll(".toc a");
    if (tocLinks.length === 0) return;

    var headings = [];
    tocLinks.forEach(function (link) {
      var id = link.getAttribute("href");
      if (id && id.startsWith("#")) {
        var el = document.getElementById(id.substring(1));
        if (el) headings.push(el);
      }
    });

    if (headings.length === 0) return;

    function updateActive() {
      var scrollY = window.scrollY;
      var current = headings[0];

      headings.forEach(function (h) {
        if (h.offsetTop <= scrollY + 100) {
          current = h;
        }
      });

      tocLinks.forEach(function (link) {
        link.classList.remove("active");
        if (link.getAttribute("href") === "#" + current.id) {
          link.classList.add("active");
        }
      });
    }

    window.addEventListener("scroll", updateActive, { passive: true });
    updateActive();
  }

  // ============================================================
  // Smooth Scroll for Anchor Links
  // ============================================================
  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(function (link) {
      link.addEventListener("click", function (e) {
        var target = document.querySelector(link.getAttribute("href"));
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });
  }

  // ============================================================
  // Keyboard Navigation for Slides
  // ============================================================
  function initSlideNav() {
    var slides = document.querySelectorAll("section.slide");
    if (slides.length === 0) return;

    var current = 0;
    var counter = document.querySelector(".slide-counter");

    function showSlide(idx) {
      if (idx < 0) idx = 0;
      if (idx >= slides.length) idx = slides.length - 1;
      current = idx;
      slides.forEach(function (s, i) {
        s.style.display = i === current ? "block" : "none";
      });
      if (counter) counter.textContent = (current + 1) + " / " + slides.length;
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        showSlide(current + 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        showSlide(current - 1);
      }
    });

    showSlide(0);
  }

  // ============================================================
  // Dark Mode Toggle
  // ============================================================
  function initDarkMode() {
    var toggle = document.querySelector(".dark-mode-toggle");
    if (!toggle) return;

    // Check system preference
    var prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    var isDark =
      localStorage.getItem("dark-mode") === "true" ||
      (localStorage.getItem("dark-mode") === null && prefersDark);

    function updateDark() {
      document.body.classList.toggle("dark-mode", isDark);
      toggle.textContent = isDark ? "Light Mode" : "Dark Mode";
      localStorage.setItem("dark-mode", isDark);
    }

    toggle.addEventListener("click", function () {
      isDark = !isDark;
      updateDark();
    });

    updateDark();
  }

  // ============================================================
  // Initialize All
  // ============================================================
  function init() {
    // Initialize CDN libraries first
    initLibraries();

    // Then enhance UI
    initCopyButtons();
    initCollapsibleCallouts();
    initTabs();
    initScrollSpy();
    initSmoothScroll();
    initSlideNav();
    initDarkMode();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
