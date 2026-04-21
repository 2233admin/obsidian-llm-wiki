/* LLM Wiki Bridge -- landing.js
 * Zero dependencies. Handles:
 *   1. EN / zh language toggle with localStorage persistence
 *   2. Copy-to-clipboard for install snippets and hero CTA
 *   3. Smooth scroll for in-page anchors
 *   4. Lazy-load the intro <video> when the section scrolls into view
 */

(() => {
  "use strict";

  const LANG_KEY = "llm-wiki-bridge-lang";
  const DEFAULT_LANG = "en";
  const VALID_LANGS = new Set(["en", "zh"]);

  const root = document.documentElement;

  /* ---------- Language toggle ---------- */

  function applyLang(lang) {
    if (!VALID_LANGS.has(lang)) lang = DEFAULT_LANG;
    root.dataset.lang = lang;
    root.lang = lang === "zh" ? "zh-CN" : "en";
    document.querySelectorAll(".lang-toggle button").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.setLang === lang));
    });
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch (_) {
      /* localStorage may be unavailable in private mode; ignore */
    }
  }

  function initLangToggle() {
    let stored = null;
    try {
      stored = localStorage.getItem(LANG_KEY);
    } catch (_) {
      /* ignore */
    }

    if (!stored) {
      const navLang = (navigator.language || "").toLowerCase();
      stored = navLang.startsWith("zh") ? "zh" : "en";
    }

    applyLang(stored);

    document.querySelectorAll(".lang-toggle button").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyLang(btn.dataset.setLang);
      });
    });
  }

  /* ---------- Copy-to-clipboard ---------- */

  async function writeClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    // Legacy fallback. Create a hidden textarea, select, execCommand.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "absolute";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } finally {
      document.body.removeChild(ta);
    }
  }

  function initCopyButtons() {
    document.querySelectorAll(".copy-block").forEach((block) => {
      const btn = block.querySelector(".copy-btn");
      const text = block.dataset.copy;
      if (!btn || !text) return;

      btn.addEventListener("click", async () => {
        try {
          await writeClipboard(text);
          btn.dataset.state = "copied";
          const originals = Array.from(btn.querySelectorAll("span")).map((s) => s.textContent);
          btn.querySelectorAll("span").forEach((s, i) => {
            s.textContent = s.classList.contains("zh") ? "已复制" : "Copied";
          });
          setTimeout(() => {
            delete btn.dataset.state;
            btn.querySelectorAll("span").forEach((s, i) => {
              s.textContent = originals[i];
            });
          }, 1600);
        } catch (err) {
          console.error("clipboard write failed", err);
          btn.dataset.state = "error";
        }
      });
    });
  }

  /* ---------- Smooth scroll ---------- */

  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
      link.addEventListener("click", (event) => {
        const href = link.getAttribute("href");
        if (!href || href === "#") return;
        const target = document.querySelector(href);
        if (!target) return;
        event.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        // Update URL hash without jumping.
        history.replaceState(null, "", href);
      });
    });
  }

  /* ---------- Lazy-load intro video ---------- */

  function initLazyVideo() {
    const video = document.querySelector("#video video");
    if (!video || !("IntersectionObserver" in window)) return;

    // We set preload=none in HTML so nothing fetches until needed.
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          // Trigger preload by flipping attribute.
          video.setAttribute("preload", "metadata");
          observer.disconnect();
        });
      },
      { rootMargin: "200px 0px" }
    );
    observer.observe(video);
  }

  /* ---------- Boot ---------- */

  function boot() {
    initLangToggle();
    initCopyButtons();
    initSmoothScroll();
    initLazyVideo();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
