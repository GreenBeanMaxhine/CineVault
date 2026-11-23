(function(){
  function applyCineVaultA11y(root) {
    root = root || document;
    var staticMap = {
      themeToggleBtn: "Toggle light and dark theme",
      closeModalBtn: "Close modal",
      closePlayerBtn: "Close video player"
    };
    Object.keys(staticMap).forEach(function(id) {
      var el = document.getElementById(id);
      if (el && !el.getAttribute("aria-label")) el.setAttribute("aria-label", staticMap[id]);
    });
    root.querySelectorAll(".btn-circle-icon, .cv-play-btn, .cv-check-btn, .row-paddle").forEach(function(btn) {
      if (btn.getAttribute("aria-label")) return;
      var card = btn.closest("[data-title]") || btn.closest(".nf-card");
      var title = card ? (card.getAttribute("data-title") || (card.querySelector(".nf-title, h3, h4") || {}).textContent || "").trim() : "";
      if (btn.classList.contains("cv-play-btn")) {
        btn.setAttribute("aria-label", title ? "Play " + title : "Play title");
      } else if (btn.classList.contains("cv-check-btn")) {
        btn.setAttribute("aria-label", title ? "Toggle watched status for " + title : "Toggle watched status");
      } else if (btn.classList.contains("row-paddle")) {
        var isPrev = btn.classList.contains("prev") || (btn.textContent || "").indexOf("‹") !== -1;
        btn.setAttribute("aria-label", isPrev ? "Previous titles" : "Next titles");
      } else if (btn.getAttribute("title")) {
        btn.setAttribute("aria-label", btn.getAttribute("title"));
      }
    });
  }
  window.addEventListener("DOMContentLoaded", function() {
    applyCineVaultA11y(document);
    var obs = new MutationObserver(function(muts) {
      muts.forEach(function(m) {
        m.addedNodes.forEach(function(n) {
          if (n && n.nodeType === 1) applyCineVaultA11y(n);
        });
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });
  });
})();
