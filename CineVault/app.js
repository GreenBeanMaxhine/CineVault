

function dehydrateMovie(m){
  var x = {};
  if(m.status && m.status !== 'unwatched') x.status = m.status;
  if(m.poster) x.poster = m.poster;
  if(m.notes) x.notes = m.notes;
  if(m.description) x.description = m.description;
  var t = [m.id, m.title, m.year ?? null, m.type || 'movie', m.genre || 'Uncategorized', m.driveUrl || ''];
  if(Object.keys(x).length) t.push(x);
  return t;
}

    const POSTER_CACHE_KEY = "cinevault_posters_v3";
    const LEGACY_POSTER_CACHE_KEY = "cinevault_wiki_posters_v2";
    const STATE_CACHE_KEY = "cinevault_user_state_v1";
    const CUSTOM_ITEMS_KEY = "cinevault_custom_items_v1";
    const DELETED_IDS_KEY = "cinevault_deleted_ids_v1";
    const LINK_HEALTH_KEY = "cinevault_link_health_v1";
    const TMDB_API_KEY_STORAGE = "cinevault_tmdb_api_key_v1";
    // Preconfigured by the owner. This browser-side key is visible in the HTML source.
    const TMDB_API_KEY_DEFAULT = "67232d7d06412062c7f4c2c051dab43d";

    let tmdbApiKey = "";
    let posterCache = {};
    let userState = {};
    let customItems = [];
    let deletedIds = [];
    let linkHealth = {};

    try {
      const legacyPosters = JSON.parse(localStorage.getItem(LEGACY_POSTER_CACHE_KEY) || "{}");
      const currentPosters = JSON.parse(localStorage.getItem(POSTER_CACHE_KEY) || "{}");
      posterCache = { ...legacyPosters, ...currentPosters };
      userState = JSON.parse(localStorage.getItem(STATE_CACHE_KEY) || "{}");
      customItems = JSON.parse(localStorage.getItem(CUSTOM_ITEMS_KEY) || "[]");
      // Clear the existing TV-show catalog while keeping the Shows tab and add-show workflow.
      const movieOnlyCustomItems = customItems.filter((item) => item.type !== "show");
      if (movieOnlyCustomItems.length !== customItems.length) {
        customItems = movieOnlyCustomItems;
        localStorage.setItem(CUSTOM_ITEMS_KEY, JSON.stringify(customItems));
      }
      deletedIds = JSON.parse(localStorage.getItem(DELETED_IDS_KEY) || "[]");
      linkHealth = JSON.parse(localStorage.getItem(LINK_HEALTH_KEY) || "{}");
      tmdbApiKey = localStorage.getItem(TMDB_API_KEY_STORAGE) || TMDB_API_KEY_DEFAULT;
      if (tmdbApiKey && !localStorage.getItem(TMDB_API_KEY_STORAGE)) {
        localStorage.setItem(TMDB_API_KEY_STORAGE, tmdbApiKey);
      }
    } catch (e) {}

    // Owner-supplied poster artwork for titles whose automatic poster lookup failed.
    const POSTER_OVERRIDES = {
      "drv-385": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSBGAgwq6drI0FyImcYEbCnLVIgphuu_c9mxTJrUIvj_g\u0026s=10", // Evil Bong 1
      "drv-439": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRg35HLMZaRH17riWQEigYupKh8UAWpdBszVEu5-BUY8A\u0026s=10", // Pokémon Camp Pikachu
      "drv-600": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTQ6FUvzyS5do4iy9ytFG3yJl9uoLiudgcTTY3_Q9Gtbw\u0026s=10", // Legend of the Northwest
      "drv-741": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRQnVr6RCGQ_bUGANHK5oEpvPMymZK5pGrbzY3zhDlkEA\u0026s=10", // Clownado
      "drv-946": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRsDTgNtcykkDFAShVMVb_K7y40u1npB2sG1NoaWEAA9Q\u0026s=10" // Hustler Dreams
    };

    const deletedSet = new Set(deletedIds);

    let library = [...RAW_MOVIES.filter((item) => item.type !== "show"), ...customItems]
      .filter((item) => !deletedSet.has(item.id))
      .map((item) => {
        const saved = userState[item.id] || {};
        return {
          ...item,
          driveUrl: saved.customDriveUrl || item.driveUrl,
          status: saved.status || item.status || "unwatched",
          poster: saved.customPoster || POSTER_OVERRIDES[item.id] || posterCache[item.id] || item.poster || "",
          description: saved.customDescription !== undefined ? saved.customDescription : (item.description || "")
        };
      });

    let selectedGenre = "All";
    let viewMode = "rows"; // "rows" | "grid" | "list"
    let activeNavTab = "home";
    let heroLocked = false; // becomes true once the user picks a featured title themselves
    let featuredSeenIds = new Set(); // prevents repeats until the current library cycle is exhausted
    let spotlightItem = pickFeatured();
    let activePlayerItemId = null;
    let pendingDeleteMode = null;
    let pendingDeleteId = null;
    let lastDeletedBatch = null;
    let toastTimer = null;
    let isScanningLinks = false;

    // Scroll Listener for iOS Translucent Sticky Navigation Bar
    window.addEventListener("scroll", () => {
      const header = document.getElementById("mainHeader");
      if (window.scrollY > 24) {
        header.classList.add("scrolled");
      } else {
        header.classList.remove("scrolled");
      }
    }, { passive: true });

    // Close Tools Menu when clicking outside
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".dropdown-wrap")) {
        closeToolsMenu();
      }
    });

    function toggleToolsMenu(e) {
      e.stopPropagation();
      document.getElementById("toolsDropdown").classList.toggle("open");
    }

    function closeToolsMenu() {
      document.getElementById("toolsDropdown").classList.remove("open");
    }

    function savePosterCache() {
      try { localStorage.setItem(POSTER_CACHE_KEY, JSON.stringify(posterCache)); } catch (e) {}
    }

    function configureTmdbApiKey() {
      const current = tmdbApiKey ? "A TMDB API key is currently saved in this browser.\n\n" : "";
      const entered = window.prompt(
        current + "Enter your TMDB API Key (v3). Leave blank to remove it.\n\nYou can request a developer API key from your TMDB account settings.",
        ""
      );
      if (entered === null) return;
      tmdbApiKey = entered.trim();
      try {
        if (tmdbApiKey) localStorage.setItem(TMDB_API_KEY_STORAGE, tmdbApiKey);
        else localStorage.removeItem(TMDB_API_KEY_STORAGE);
      } catch (e) {
        showToast("Could not save the TMDB key in this browser.");
        return;
      }
      showToast(tmdbApiKey ? "TMDB API key saved. Fetch Missing Posters to begin." : "TMDB API key removed.");
    }

    function posterIdentity(url) {
      if (!url) return "";
      try {
        const parsed = new URL(url, window.location.href);
        const host = parsed.hostname.toLowerCase();
        const path = parsed.pathname.replace(/\/t\/p\/(?:w\d+|original)\//i, "/t/p/*/");
        // Google encrypted thumbnails all use the same /images path; their query
        // string contains the unique image token, so retain it for deduplication.
        if (host === "encrypted-tbn0.gstatic.com" || host.endsWith(".gstatic.com")) {
          return host + path.toLowerCase() + "?" + parsed.searchParams.toString();
        }
        return host + path.toLowerCase();
      } catch (e) {
        return String(url).toLowerCase();
      }
    }

    function isPosterAlreadyUsed(url, excludeId) {
      const identity = posterIdentity(url);
      if (!identity) return false;
      return library.some((entry) => entry.id !== excludeId && entry.poster && posterIdentity(entry.poster) === identity);
    }

    function saveUserState() {
      try { localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(userState)); } catch (e) {}
    }

    function saveCustomItems() {
      try { localStorage.setItem(CUSTOM_ITEMS_KEY, JSON.stringify(customItems)); } catch (e) {}
    }

    function saveDeletedIds() {
      try { localStorage.setItem(DELETED_IDS_KEY, JSON.stringify(Array.from(deletedSet))); } catch (e) {}
    }

    function saveLinkHealth() {
      try { localStorage.setItem(LINK_HEALTH_KEY, JSON.stringify(linkHealth)); } catch (e) {}
    }

    function showToast(message, allowUndo = false) {
      const toast = document.getElementById("toast");
      document.getElementById("toastText").textContent = message;
      document.getElementById("toastUndoBtn").style.display = allowUndo ? "inline-flex" : "none";
      toast.classList.add("show");
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.classList.remove("show");
      }, 6500);
    }

    function normalizeDriveUrl(input) {
      const val = input.trim();
      if (!val.startsWith("http://") && !val.startsWith("https://")) {
        return `https://drive.google.com/file/d/${val}/view`;
      }
      return val;
    }

    function extractDriveInfo(driveUrl) {
      let resourceKey = "";
      try {
        const urlObj = new URL(driveUrl);
        resourceKey = urlObj.searchParams.get("resourcekey") || "";
      } catch (e) {}

      const fileMatch = driveUrl.match(/\/file\/(?:u\/\d+\/)?d\/([^/?#]+)/);
      if (fileMatch) {
        return { kind: "file", id: fileMatch[1], resourceKey };
      }

      const folderMatch = driveUrl.match(/\/folders\/([^/?#]+)/);
      if (folderMatch) {
        return { kind: "folder", id: folderMatch[1], resourceKey };
      }

      return { kind: "unknown", id: "", resourceKey };
    }

    function getEmbedPlayerUrl(driveUrl) {
      const info = extractDriveInfo(driveUrl);
      if (info.kind === "file") {
        return `https://drive.google.com/file/d/${info.id}/preview${info.resourceKey ? `?resourcekey=${encodeURIComponent(info.resourceKey)}` : ""}`;
      }
      if (info.kind === "folder") {
        return `https://drive.google.com/embeddedfolderview?id=${info.id}${info.resourceKey ? `&resourcekey=${encodeURIComponent(info.resourceKey)}` : ""}#list`;
      }
      return driveUrl;
    }

    // --- Navigation Tabs & View Mode Switcher ---
    function setActiveTabUI(tabName) {
      activeNavTab = tabName;
      document.body.classList.toggle("search-mode", tabName === "search");
      document.querySelectorAll(".nav-tab").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.tab === tabName);
      });

      const headingEl = document.getElementById("iosPageHeading");
      const subEl = document.getElementById("iosPageSubheading");
      const map = {
        home: ["CineVault", "Personal Cloud Cinema & Series Vault"],
        movies: ["Movies", "Feature Films in Your Vault"],
        shows: ["Shows & Specials", "TV Series, Miniseries & Complete Folders"],
        watchlist: ["Watchlist", "Currently Watching & Queued Titles"],
        all: ["Library", "Complete A–Z Catalog & Inspector"],
        search: ["Search", "Find anything in your personal vault"]
      };
      const pair = map[tabName] || map.home;
      const searchPanel = document.getElementById("searchPagePanel");
      if (searchPanel) searchPanel.classList.toggle("active", tabName === "search");
      if (headingEl) headingEl.textContent = pair[0];
      if (subEl) subEl.textContent = pair[1];
    }

    function switchNavTab(tabName) {
      setActiveTabUI(tabName);
      document.getElementById("searchInput").value = "";
      document.getElementById("searchClearBtn").classList.remove("visible");
      document.getElementById("searchPagePanel")?.classList.remove("has-query");
      selectedGenre = "All";
      document.getElementById("qualityFilter").value = "all";
      document.getElementById("posterFilter").value = "all";
      document.getElementById("sortSelect").value = "default";

      if (tabName === "home") {
        document.getElementById("typeFilter").value = "all";
        document.getElementById("statusFilter").value = "all";
        setViewMode("rows");
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (tabName === "movies") {
        document.getElementById("typeFilter").value = "movie";
        document.getElementById("statusFilter").value = "all";
        setViewMode("grid");
      } else if (tabName === "shows") {
        document.getElementById("typeFilter").value = "show";
        document.getElementById("statusFilter").value = "all";
        setViewMode("grid");
      } else if (tabName === "watchlist") {
        document.getElementById("typeFilter").value = "all";
        document.getElementById("statusFilter").value = "watching";
        setViewMode("grid");
      } else if (tabName === "all" || tabName === "search") {
        document.getElementById("typeFilter").value = "all";
        document.getElementById("statusFilter").value = "all";
        setViewMode("grid");
        if (tabName === "search") setTimeout(() => document.getElementById("searchInput")?.focus(), 80);
      }
      renderGenres();
      renderCatalog();
    }

    function setViewMode(mode) {
      viewMode = mode;
      document.getElementById("viewRowsBtn").classList.toggle("active", mode === "rows");
      document.getElementById("viewGridBtn").classList.toggle("active", mode === "grid");
      const listBtn = document.getElementById("viewListBtn");
      if (listBtn) listBtn.classList.toggle("active", mode === "list");
      renderCatalog();
    }

    function hasActiveFilters() {
      const q = document.getElementById("searchInput").value.trim();
      const typeVal = document.getElementById("typeFilter").value;
      const statusVal = document.getElementById("statusFilter").value;
      const qualityVal = document.getElementById("qualityFilter").value;
      const posterVal = document.getElementById("posterFilter").value;
      const sortVal = document.getElementById("sortSelect").value;
      return Boolean(q || selectedGenre !== "All" || typeVal !== "all" || statusVal !== "all" || qualityVal !== "all" || posterVal !== "all" || sortVal !== "default");
    }

    function handleSearchInput() {
      const input = document.getElementById("searchInput");
      const clearBtn = document.getElementById("searchClearBtn");
      const hasQuery = input.value.trim().length > 0;
      clearBtn.classList.toggle("visible", hasQuery);
      document.getElementById("searchPagePanel")?.classList.toggle("has-query", hasQuery);
      if (hasQuery && viewMode === "rows") {
        viewMode = "grid";
        document.getElementById("viewRowsBtn").classList.remove("active");
        document.getElementById("viewGridBtn").classList.add("active");
        const listBtn = document.getElementById("viewListBtn");
        if (listBtn) listBtn.classList.remove("active");
      }
      renderCatalog();
    }

    function clearSearchInput() {
      document.getElementById("searchInput").value = "";
      document.getElementById("searchClearBtn").classList.remove("visible");
      document.getElementById("searchPagePanel")?.classList.remove("has-query");
      if (!hasActiveFilters() && activeNavTab === "home") {
        setViewMode("rows");
      } else {
        renderCatalog();
      }
    }

    function onFilterControlChange() {
      if (hasActiveFilters() && viewMode === "rows") {
        viewMode = "grid";
        document.getElementById("viewRowsBtn").classList.remove("active");
        document.getElementById("viewGridBtn").classList.add("active");
        const listBtn = document.getElementById("viewListBtn");
        if (listBtn) listBtn.classList.remove("active");
      }
      renderCatalog();
    }

    // --- Automated Google Drive Link Scanner ---
    function probeDriveFileThumbnail(driveUrl) {
      const info = extractDriveInfo(driveUrl);
      if (info.kind === "folder") return Promise.resolve("folder");
      if (info.kind !== "file" || !info.id) return Promise.resolve("flagged");

      return new Promise((resolve) => {
        const img = new Image();
        let settled = false;

        const finish = (status) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          img.onload = null;
          img.onerror = null;
          resolve(status);
        };

        const timer = setTimeout(() => finish("flagged"), 9000);

        img.onload = () => {
          if (img.naturalWidth > 0) {
            finish("ok");
          } else {
            finish("flagged");
          }
        };

        img.onerror = () => finish("flagged");

        const rk = info.resourceKey ? `&resourcekey=${encodeURIComponent(info.resourceKey)}` : "";
        img.src = `https://drive.google.com/thumbnail?id=${encodeURIComponent(info.id)}&sz=w320${rk}`;
      });
    }

    async function scanAllDriveLinks() {
      if (isScanningLinks || !library.length) return;
      isScanningLinks = true;

      const scanBtn = document.getElementById("scanLinksBtn");
      const statusDot = document.getElementById("statusDot");
      const statusText = document.getElementById("statusText");

      scanBtn.disabled = true;
      statusDot.classList.remove("done");

      let checked = 0;
      const total = library.length;
      const batchSize = 8;

      for (let i = 0; i < total; i += batchSize) {
        const batch = library.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (item) => {
            const result = await probeDriveFileThumbnail(item.driveUrl);
            linkHealth[item.id] = result;
            checked++;
            statusText.textContent = `Scanning ${checked}/${total}...`;
          })
        );
        saveLinkHealth();
        updateFlaggedUI();
        renderCatalog();
      }

      isScanningLinks = false;
      scanBtn.disabled = false;
      const flaggedCount = getFlaggedItems().length;
      statusDot.classList.toggle("error", flaggedCount > 0);
      statusDot.classList.toggle("done", flaggedCount === 0);
      statusText.textContent =
        flaggedCount > 0
          ? `${flaggedCount} broken link${flaggedCount === 1 ? "" : "s"}`
          : `All ${total} links verified`;

      if (flaggedCount > 0) {
        showToast(`Found ${flaggedCount} dead or restricted Drive link${flaggedCount === 1 ? "" : "s"}.`);
      } else {
        showToast("All Drive file links passed the check!");
      }
    }

    function getFlaggedItems() {
      return library.filter((m) => linkHealth[m.id] === "flagged");
    }

    function updateFlaggedUI() {
      const flagged = getFlaggedItems();
      const count = flagged.length;
      const banner = document.getElementById("scanBanner");
      const filterOpt = document.getElementById("flaggedFilterOption");

      if (filterOpt) {
        filterOpt.textContent = `⚠ Flagged Links (${count})`;
      }

      if (count > 0) {
        banner.classList.add("show");
        document.getElementById("scanBannerMsg").textContent =
          `${count} title${count === 1 ? "" : "s"} failed the Drive check (deleted on Drive or restricted).`;
        document.getElementById("bulkRemoveFlaggedBtn").textContent = `Remove All Flagged (${count})`;
      } else {
        banner.classList.remove("show");
      }
    }

    function filterToFlagged() {
      document.getElementById("statusFilter").value = "flagged";
      setViewMode("grid");
    }

    function clearLinkFlags() {
      linkHealth = {};
      saveLinkHealth();
      if (document.getElementById("statusFilter").value === "flagged") {
        document.getElementById("statusFilter").value = "all";
      }
      updateFlaggedUI();
      renderCatalog();
      showToast("Cleared all link flags.");
    }

    // --- Add Movie / Show Workflow ---
    function openAddModal() {
      document.getElementById("addForm").reset();
      document.getElementById("addYear").value = new Date().getFullYear();
      document.getElementById("addBackdrop").classList.add("open");
      setTimeout(() => document.getElementById("addTitle").focus(), 40);
    }

    function closeAddModal() {
      document.getElementById("addBackdrop").classList.remove("open");
    }

    function closeAddOnBackdrop(e) {
      if (e.target.id === "addBackdrop") closeAddModal();
    }

    function generateNextId() {
      let maxNum = 974;
      for (const item of [...RAW_MOVIES, ...customItems]) {
        const m = String(item.id).match(/^drv-(\d+)$/);
        if (m) {
          const num = parseInt(m[1], 10);
          if (num > maxNum) maxNum = num;
        }
      }
      return `drv-${String(maxNum + 1).padStart(3, "0")}`;
    }

    async function handleAddSubmit(e) {
      e.preventDefault();
      const title = document.getElementById("addTitle").value.trim();
      const type = document.getElementById("addType").value;
      const year = parseInt(document.getElementById("addYear").value, 10) || new Date().getFullYear();
      const genre = document.getElementById("addGenre").value;
      const quality = document.getElementById("addQuality").value;
      const driveUrl = normalizeDriveUrl(document.getElementById("addDriveUrl").value);
      const status = document.getElementById("addStatus").value;
      const notes = document.getElementById("addNotes").value.trim();
      const description = document.getElementById("addDescription").value.trim();
      const customPoster = document.getElementById("addPoster").value.trim();

      if (!title || !driveUrl) return;

      const newItem = {
        id: generateNextId(),
        title,
        type,
        year,
        genre,
        quality,
        status,
        driveUrl,
        poster: customPoster,
        notes,
        description,
        addedAt: Date.now()
      };

      customItems.push(newItem);
      saveCustomItems();

      if (customPoster) {
        userState[newItem.id] = { ...(userState[newItem.id] || {}), status, customPoster };
        saveUserState();
      } else if (status !== "unwatched") {
        userState[newItem.id] = { ...(userState[newItem.id] || {}), status };
        saveUserState();
      }

      library.unshift({ ...newItem });
      if (!spotlightItem) spotlightItem = library[0];

      closeAddModal();
      renderGenres();
      renderSpotlight();
      renderCatalog();
      showToast(`Added "${title}" to your vault!`);

      if (!customPoster) {
        const wikiUrl = await fetchBestPoster(newItem);
        if (wikiUrl) {
          const target = library.find((x) => x.id === newItem.id);
          if (target) target.poster = wikiUrl;
          const customRecord = customItems.find((x) => x.id === newItem.id);
          if (customRecord) customRecord.poster = wikiUrl;
          posterCache[newItem.id] = wikiUrl;
          savePosterCache();
          saveCustomItems();
          renderCatalog();
          if (spotlightItem && spotlightItem.id === newItem.id) renderSpotlight();
        }
      }
    }

    // --- Delete Single or Bulk Flagged Workflow ---
    function promptDelete(id, event) {
      if (event) event.stopPropagation();
      const item = library.find((m) => m.id === id);
      if (!item) return;

      pendingDeleteMode = "single";
      pendingDeleteId = id;
      document.getElementById("deleteModalTitle").textContent = "Delete Title?";
      document.getElementById("deleteConfirmText").textContent =
        `Remove "${item.title}" (${item.year}) from your CineVault library?`;
      document.getElementById("confirmDeleteBtn").textContent = "Delete";
      document.getElementById("deleteBackdrop").classList.add("open");
    }

    function promptBulkRemoveFlagged() {
      const flagged = getFlaggedItems();
      if (!flagged.length) return;

      pendingDeleteMode = "bulk-flagged";
      pendingDeleteId = null;
      document.getElementById("deleteModalTitle").textContent = `Remove ${flagged.length} Flagged Titles?`;
      document.getElementById("deleteConfirmText").textContent =
        `This will remove all ${flagged.length} titles that failed the Google Drive link check. You can tap Undo right afterward if needed.`;
      document.getElementById("confirmDeleteBtn").textContent = `Remove All (${flagged.length})`;
      document.getElementById("deleteBackdrop").classList.add("open");
    }

    function closeDeleteModal() {
      document.getElementById("deleteBackdrop").classList.remove("open");
      pendingDeleteMode = null;
      pendingDeleteId = null;
    }

    function closeDeleteOnBackdrop(e) {
      if (e.target.id === "deleteBackdrop") closeDeleteModal();
    }

    function removeIdsFromVault(idsToRemove) {
      const idSet = new Set(idsToRemove);
      const removedRecords = [];

      for (let i = library.length - 1; i >= 0; i--) {
        const item = library[i];
        if (idSet.has(item.id)) {
          const wasCustom = customItems.some((c) => c.id === item.id);
          removedRecords.unshift({
            item: { ...item },
            index: i,
            wasCustom,
            prevHealth: linkHealth[item.id]
          });
          library.splice(i, 1);
          delete linkHealth[item.id];

          if (wasCustom) {
            customItems = customItems.filter((c) => c.id !== item.id);
          } else {
            deletedSet.add(item.id);
          }
        }
      }

      saveCustomItems();
      saveDeletedIds();
      saveLinkHealth();
      return removedRecords;
    }

    function executeDelete() {
      if (pendingDeleteMode === "single" && pendingDeleteId) {
        const id = pendingDeleteId;
        const records = removeIdsFromVault([id]);
        closeDeleteModal();
        closeModal();
        if (activePlayerItemId === id) closePlayer();

        if (records.length) {
          lastDeletedBatch = records;
          if (spotlightItem && spotlightItem.id === id) {
            spotlightItem = library.length ? library[Math.floor(Math.random() * library.length)] : null;
          }
          updateFlaggedUI();
          renderGenres();
          renderSpotlight();
          renderCatalog();
          showToast(`Deleted "${records[0].item.title}"`, true);
        }
        return;
      }

      if (pendingDeleteMode === "bulk-flagged") {
        const flaggedIds = getFlaggedItems().map((m) => m.id);
        const records = removeIdsFromVault(flaggedIds);
        closeDeleteModal();
        closeModal();
        if (activePlayerItemId && flaggedIds.includes(activePlayerItemId)) closePlayer();

        if (document.getElementById("statusFilter").value === "flagged") {
          document.getElementById("statusFilter").value = "all";
        }

        if (records.length) {
          lastDeletedBatch = records;
          if (spotlightItem && flaggedIds.includes(spotlightItem.id)) {
            spotlightItem = library.length ? library[Math.floor(Math.random() * library.length)] : null;
          }
          updateFlaggedUI();
          renderGenres();
          renderSpotlight();
          renderCatalog();
          showToast(`Removed ${records.length} flagged title${records.length === 1 ? "" : "s"}`, true);
        }
      }
    }

    function undoLastDelete() {
      if (!lastDeletedBatch || !lastDeletedBatch.length) return;

      for (const rec of lastDeletedBatch) {
        if (rec.wasCustom) {
          customItems.push(rec.item);
        } else {
          deletedSet.delete(rec.item.id);
        }
        if (rec.prevHealth) {
          linkHealth[rec.item.id] = rec.prevHealth;
        }
        const insertAt = Math.min(rec.index, library.length);
        library.splice(insertAt, 0, rec.item);
      }

      saveCustomItems();
      saveDeletedIds();
      saveLinkHealth();

      if (!spotlightItem && library.length) spotlightItem = library[0];

      const restoredCount = lastDeletedBatch.length;
      const singleName = restoredCount === 1 ? lastDeletedBatch[0].item.title : `${restoredCount} titles`;
      lastDeletedBatch = null;

      document.getElementById("toast").classList.remove("show");
      updateFlaggedUI();
      renderGenres();
      renderSpotlight();
      renderCatalog();
      showToast(`Restored ${singleName}`);
    }

    // --- Quick Toggle Watched on Card Hover ---
    function quickToggleWatched(id, event) {
      if (event) event.stopPropagation();
      const m = library.find((item) => item.id === id);
      if (!m) return;
      const nextStatus = m.status === "watched" ? "unwatched" : "watched";
      m.status = nextStatus;
      userState[id] = { ...(userState[id] || {}), status: nextStatus };
      if (nextStatus === "watched") { delete userState[id].progress; delete userState[id].lastPlayed; }
      saveUserState();
      renderCatalog();
      if (spotlightItem && spotlightItem.id === id) renderSpotlight();
      showToast(`${m.title}: marked ${nextStatus}`);
    }

    // --- In-Site Cinema Player ---
    function watchInSite(id) {
      const m = library.find((item) => item.id === id);
      if (!m) return;

      closeModal();
      activePlayerItemId = id;
      markPlayed(id);
      document.getElementById("playerEditBar").classList.remove("open");

      if (m.status === "unwatched") {
        m.status = "watching";
        userState[id] = { ...(userState[id] || {}), status: "watching" };
        saveUserState();
        renderCatalog();
      }

      const posterEl = document.getElementById("playerPoster");
      if (m.poster) {
        posterEl.src = m.poster;
        posterEl.style.display = "block";
      } else {
        posterEl.style.display = "none";
      }

      document.getElementById("playerTitle").textContent = m.title;
      document.getElementById("playerSub").textContent = `${m.year} • ${m.genre} • ${m.quality}${m.notes ? ` • ${m.notes}` : ""}`;
      document.getElementById("playerStatusSelect").value = m.status;
      document.getElementById("playerDriveInput").value = m.driveUrl;
      document.getElementById("playerFallbackLink").href = m.driveUrl;
      document.getElementById("playerIframe").src = getEmbedPlayerUrl(m.driveUrl);
      document.getElementById("playerBackdrop").classList.add("open");
    }

    function togglePlayerEditBar() {
      const bar = document.getElementById("playerEditBar");
      bar.classList.toggle("open");
      if (bar.classList.contains("open")) {
        const input = document.getElementById("playerDriveInput");
        input.focus();
        input.select();
      }
    }

    async function savePlayerDriveUrl() {
      if (!activePlayerItemId) return;
      const rawVal = document.getElementById("playerDriveInput").value;
      if (!rawVal.trim()) return;
      const newUrl = normalizeDriveUrl(rawVal);
      await updateItemDriveUrl(activePlayerItemId, newUrl);
      document.getElementById("playerFallbackLink").href = newUrl;
      document.getElementById("playerIframe").src = getEmbedPlayerUrl(newUrl);
      document.getElementById("playerEditBar").classList.remove("open");
      showToast("Updated Drive link & reloaded player!");
    }

    function deleteActivePlayerItem() {
      if (!activePlayerItemId) return;
      promptDelete(activePlayerItemId);
    }

    function closePlayer() {
      document.getElementById("playerBackdrop").classList.remove("open");
      document.getElementById("playerEditBar").classList.remove("open");
      document.getElementById("playerIframe").src = "";
      activePlayerItemId = null;
      if (viewMode === "rows") renderCatalog();
    }

    function closePlayerOnBackdrop(e) {
      if (e.target.id === "playerBackdrop") closePlayer();
    }

    function togglePlayerExpand() {
      document.getElementById("playerShell").classList.toggle("expanded");
    }

    function updateStatusFromPlayer(newStatus) {
      if (!activePlayerItemId) return;
      const m = library.find((item) => item.id === activePlayerItemId);
      if (!m) return;
      m.status = newStatus;
      userState[activePlayerItemId] = { ...(userState[activePlayerItemId] || {}), status: newStatus };
      if (newStatus === "watched") { delete userState[activePlayerItemId].progress; delete userState[activePlayerItemId].lastPlayed; }
      saveUserState();
      renderCatalog();
    }

    async function updateItemDriveUrl(id, newUrl) {
      const m = library.find((item) => item.id === id);
      if (!m) return;
      m.driveUrl = newUrl;
      userState[id] = { ...(userState[id] || {}), customDriveUrl: newUrl };
      saveUserState();

      const customRec = customItems.find((c) => c.id === id);
      if (customRec) {
        customRec.driveUrl = newUrl;
        saveCustomItems();
      }

      const probe = await probeDriveFileThumbnail(newUrl);
      linkHealth[id] = probe;
      saveLinkHealth();
      updateFlaggedUI();
      renderCatalog();
      if (spotlightItem && spotlightItem.id === id) renderSpotlight();
    }

    // --- Automated Multi-Source Poster Engine (iTunes + TVMaze + Wikipedia) ---
    let isHydratingPosters = false;

    function cleanTitleForSearch(rawTitle) {
      let t = String(rawTitle || "").trim();
      t = t.replace(/\bVampieres\b/gi, "Vampires");
      t = t.replace(/\bShippuuden\b/gi, "Shippuden");
      t = t.replace(/([a-zA-Z0-9]{2,})\.(?=[a-zA-Z0-9])/g, "$1 ");
      t = t.replace(/\s*\((?:Complete Series Folder|Seasons?\s*[\d-]+(?:\s*Folder)?|US DVD|UK DVD|DVD|BluRay|1080p|720p|540p|4K|HD)\)?\s*$/i, "");
      t = t.replace(/\s+(?:540p|720p|1080p|2160p|4K|DVDRip|BluRay|WEB-DL)\s*$/i, "");
      t = t.replace(/\s+-\s+(?:Horror|Comedy|Action|Drama|Sci-Fi|Thriller|Animation|Documentary)\s*$/i, "");
      t = t.replace(/\s*\(\d{4}\)\s*$/, "");
      return t.replace(/\s+/g, " ").trim();
    }

    function getSearchTitleVariants(rawTitle) {
      const cleaned = cleanTitleForSearch(rawTitle);
      const variants = [cleaned];

      const noPartOne = cleaned.replace(/\s+(?:1|Part\s*1|Part\s*I)$/i, "").trim();
      if (noPartOne && noPartOne !== cleaned) variants.push(noPartOne);

      if (/^Mission Impossible\b/i.test(cleaned)) {
        variants.push(cleaned.replace(/^Mission Impossible\b/i, "Mission: Impossible"));
      }

      const baseOnly = cleaned.split(/\s*(?::|\s-\s)\s*/)[0].trim();
      if (baseOnly && baseOnly.length >= 4 && !variants.includes(baseOnly)) {
        variants.push(baseOnly);
      }

      return Array.from(new Set(variants));
    }

    function normalizeCompareStr(str) {
      return String(str || "")
        .toLowerCase()
        .replace(/&/g, "and")
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    function scoreTitleMatch(candidateTitle, candidateYear, targetTitle, targetYear) {
      const normCand = normalizeCompareStr(cleanTitleForSearch(candidateTitle));
      const normTarg = normalizeCompareStr(targetTitle);
      if (!normCand || !normTarg) return 0;

      let titleScore = 0;
      if (normCand === normTarg) {
        titleScore = 100;
      } else if (normCand.startsWith(normTarg + " ") || normTarg.startsWith(normCand + " ")) {
        titleScore = 78;
      } else {
        const candTokens = new Set(normCand.split(" "));
        const targTokens = normTarg.split(" ");
        const overlap = targTokens.filter((tok) => candTokens.has(tok)).length;
        const ratio = overlap / Math.max(targTokens.length, candTokens.size);
        titleScore = Math.round(ratio * 75);
      }

      if (titleScore < 55) return 0;

      let yearBonus = 0;
      if (candidateYear && targetYear) {
        const diff = Math.abs(candidateYear - targetYear);
        if (diff === 0) yearBonus = 30;
        else if (diff === 1) yearBonus = 20;
        else if (diff <= 3) yearBonus = 5;
        else yearBonus = -25;
      }

      return titleScore + yearBonus;
    }

    async function fetchJsonWithTimeout(url, timeoutMs = 8000) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) return null;
        return await res.json();
      } catch (e) {
        return null;
      } finally {
        clearTimeout(timer);
      }
    }

    // Known catalog naming differences for titles that commonly fail exact matching.
    // Each entry is a verified-style search alias; alternate years are explicit so
    // the matcher does not broadly accept unrelated releases.
    const TMDB_TITLE_ALIASES = {
      "godzilla": [{ title: "The Return of Godzilla", year: 1984 }, { title: "Godzilla 1985", year: 1985 }],
      "michael jackson live in munich history world tour": [{ title: "Michael Jackson Live in Munich", year: 1997 }],
      "pokemon pikachus vacation": [{ title: "Pokémon Pikachu's Vacation", year: 1998 }, { title: "Pikachu's Vacation", year: 1998 }],
      "pokemon pikachus winter vacation": [{ title: "Pikachu's Winter Vacation", year: 1999 }, { title: "Pikachu's Winter Vacation 2", year: 1999 }],
      "halloween 6 the curse of michael myers": [{ title: "Halloween The Curse of Michael Myers", year: 1995 }],
      "pokemon pikachu the movie 2001": [{ title: "Pikachu the Movie", year: 2001 }, { title: "Pikachu and Pichu", year: 2000 }],
      "tom and jerry paws for a holiday": [{ title: "Tom and Jerry Paws for a Holiday", year: 2003 }],
      "the mystery of britannic": [{ title: "The Mystery of the Britannic", year: 2018 }, { title: "Mystery of Britannic", year: 2018 }],
      "mickey and minnie 10 classic shorts": [{ title: "Mickey Mouse 10 Classic Shorts", year: 2023 }, { title: "Mickey and Minnie 10 Classic Shorts", year: 2023 }],
      "unsinkable titanic untold": [{ title: "Unsinkable Titanic Untold", year: 2024 }, { title: "Unsinkable The Titanic Untold", year: 2024 }],
      "sonic the hedgehog the movie ova": [{ title: "Sonic the Hedgehog The Movie", year: 1996 }],
      "digimon revenge of diaboromon": [{ title: "Digimon Adventure 02 Diablomon Strikes Back", year: 2001 }, { title: "Revenge of Diaboromon", year: 2001 }],
      "digimon tamers 1 battle of adventurers": [{ title: "Digimon Tamers Battle of Adventurers", year: 2001 }],
      "digimon tamers 2 runaway locomon": [{ title: "Digimon Tamers Runaway Locomon", year: 2002 }],
      "evil bong 1": [{ title: "Evil Bong", year: 2006 }, { title: "Evil Bong", year: 2008 }],
      "pokemon camp pikachu": [{ title: "Camp Pikachu", year: 2002 }],
      "pokemon mewtwo returns": [{ title: "Pokémon Mewtwo Returns", year: 2000 }],
      "pokemon pikachu the movie 2001": [{ title: "Pikachu the Movie", year: 2001 }, { title: "Pikachu's PikaBoo", year: 2001 }],
      "pokemon gotta dance": [{ title: "Gotta Dance", year: 2003 }, { title: "Pokémon Gotta Dance", year: 2003 }],
      "the cheetah girls 1": [{ title: "The Cheetah Girls", year: 2003 }],
      "the sandlot 3 heading home": [{ title: "The Sandlot: Heading Home", year: 2007 }],
      "final destination 1": [{ title: "Final Destination", year: 2000 }],
      "digimon tamers movie 1 battle of adventurers eng": [{ title: "Digimon Tamers Battle of Adventurers", year: 2001 }],
      "digimon tamers movie 2 runaway locomon eng": [{ title: "Digimon Tamers Runaway Locomon", year: 2002 }],
      "family guy presents its a trap": [{ title: "It's a Trap!", year: 2010 }, { title: "Family Guy Presents It's a Trap", year: 2011 }],
      "naruto shippuden movie 5 blood prison": [{ title: "Naruto Shippuden the Movie Blood Prison", year: 2011 }],
      "pokemon meloettas moonlight serenade": [{ title: "Meloetta's Moonlight Serenade", year: 2012 }],
      "curious george a halloween boofest": [{ title: "Curious George: A Halloween Boo Fest", year: 2013 }],
      "curious george curious george swings into spring": [{ title: "Curious George Swings Into Spring", year: 2013 }],
      "freebirds": [{ title: "Free Birds", year: 2013 }, { title: "Free Birds", year: 2014 }],
      "terrifier 1": [{ title: "Terrifier", year: 2016 }],
      "my hero academia movie 1 two heroes english dub": [{ title: "My Hero Academia The Movie Two Heroes", year: 2018 }, { title: "My Hero Academia Two Heroes", year: 2018 }],
      "digimon last evolution kizuna": [{ title: "Digimon Adventure Last Evolution Kizuna", year: 2020 }],
      "pokemon the movie secrets of the jungle": [{ title: "Pokémon the Movie Secrets of the Jungle", year: 2020 }, { title: "Pokémon the Movie Secrets of the Jungle", year: 2021 }],
      "five nights at freddys movie": [{ title: "Five Nights at Freddy's", year: 2023 }],
      "ballerina a john wick movie": [{ title: "From the World of John Wick Ballerina", year: 2025 }, { title: "Ballerina", year: 2025 }],
      "evil bong a thon": [{ title: "Evil Bong-a-Thon", year: 2025 }],
      "the calendar killer": [{ title: "The Calendar Killer", year: 2025 }, { title: "Das Kalenderblatt", year: 2025 }],
      "scooby doo chill out scooby doo": [{ title: "Chill Out, Scooby-Doo!", year: 2007 }, { title: "Chill Out Scooby Doo", year: 2007 }],
      "legend of the northwest": [{ title: "Legend of the Northwest", year: 2013 }, { title: "The Legend of the Northwest", year: 2013 }],
      "drain the titanic": [{ title: "Drain the Titanic", year: 2015 }, { title: "Drain the Titanic", year: 2016 }],
      "clownado": [{ title: "Clownado", year: 2019 }],
      "evil bong 888 infinity": [{ title: "Evil Bong 888: Infinity", year: 2022 }, { title: "Evil Bong 888 Infinity", year: 2022 }],
      "ouija shark 2": [{ title: "Ouija Shark 2", year: 2022 }],
      "hustler dreams": [{ title: "Hustler Dreams", year: 2025 }, { title: "Hustler's Dreams", year: 2025 }],
      "michael jackson live in munich history world tour": [{ title: "Michael Jackson: Live in Munich", year: 1997 }, { title: "Michael Jackson Live in Munich", year: 1997 }, { title: "Michael Jackson: HIStory World Tour", year: 1997 }],
      "pokemon pikachus vacation": [{ title: "Pokémon: Pikachu's Vacation", year: 1998 }, { title: "Pikachu's Vacation", year: 1998 }, { title: "Pikachu's Vacation", year: 1999 }],
      "pokemon pikachus winter vacation": [{ title: "Pokémon: Pikachu's Winter Vacation", year: 1999 }, { title: "Pikachu's Winter Vacation", year: 1999 }],
      "digimon revenge of diaboromon": [{ title: "Digimon Adventure 02: Diablomon Strikes Back", year: 2001 }, { title: "Digimon Revenge of Diaboromon", year: 2001 }],
      "evil bong 1": [{ title: "Evil Bong", year: 2006 }, { title: "Evil Bong", year: 2008 }],
      "pokemon camp pikachu": [{ title: "Camp Pikachu", year: 2002 }, { title: "Pokémon: Camp Pikachu", year: 2002 }],
      "pokemon mewtwo returns": [{ title: "Pokémon: Mewtwo Returns", year: 2000 }, { title: "Mewtwo Returns", year: 2000 }],
      "tom and jerry paws for a holiday": [{ title: "Tom and Jerry: Paws for a Holiday", year: 2003 }, { title: "Paws for a Holiday", year: 2003 }],
      "digimon tamers movie 1 battle of adventurers eng": [{ title: "Digimon Tamers: Battle of Adventurers", year: 2001 }],
      "digimon tamers movie 2 runaway locomoon eng": [{ title: "Digimon Tamers: Runaway Locomon", year: 2002 }],
      "family guy presents its a trap": [{ title: "Family Guy Presents: It's a Trap!", year: 2010 }, { title: "It's a Trap!", year: 2010 }, { title: "Family Guy Presents It's a Trap", year: 2011 }],
      "terrifier 1": [{ title: "Terrifier", year: 2016 }],
      "pokemon the movie secrets of the jungle": [{ title: "Pokémon the Movie: Secrets of the Jungle", year: 2020 }, { title: "Pokémon the Movie: Secrets of the Jungle", year: 2021 }],
      "mickey and minnie 10 classic shorts": [{ title: "Mickey & Minnie: 10 Classic Shorts", year: 2023 }, { title: "Mickey Mouse: 10 Classic Shorts", year: 2023 }],
      "the mystery of britannic": [{ title: "The Mystery of the Britannic", year: 2018 }, { title: "Mystery of Britannic", year: 2018 }]
    };

    // Additional catalog-specific spellings for the final hard-to-match titles.
    // These are search terms, not permission to accept unrelated results.
    Object.assign(TMDB_TITLE_ALIASES, {
      "michael jackson live in munich history world tour": [
        ...(TMDB_TITLE_ALIASES["michael jackson live in munich history world tour"] || []),
        { title: "Michael Jackson Live in Munich HIStory World Tour", year: 1997 },
        { title: "Michael Jackson HIStory World Tour Munich", year: 1997 }
      ],
      "pokemon pikachus vacation": [
        ...(TMDB_TITLE_ALIASES["pokemon pikachus vacation"] || []),
        { title: "Pikachu's Vacation", year: 1998 },
        { title: "Pikachu's Vacation short film", year: 1998 }
      ],
      "digimon revenge of diaboromon": [
        ...(TMDB_TITLE_ALIASES["digimon revenge of diaboromon"] || []),
        { title: "Digimon Adventure 02 Diaboromon Strikes Back", year: 2001 },
        { title: "Diaboromon Strikes Back", year: 2001 }
      ],
      "evil bong 1": [
        ...(TMDB_TITLE_ALIASES["evil bong 1"] || []),
        { title: "Evil Bong", year: 2006 }
      ],
      "pokemon camp pikachu": [
        ...(TMDB_TITLE_ALIASES["pokemon camp pikachu"] || []),
        { title: "Camp Pikachu", year: 2002 },
        { title: "Pikachu's PikaBoo Camp Pikachu", year: 2002 }
      ],
      "scooby doo chill out scooby doo": [
        ...(TMDB_TITLE_ALIASES["scooby doo chill out scooby doo"] || []),
        { title: "Chill Out Scooby-Doo", year: 2007 }
      ],
      "digimon tamers movie 1 battle of adventurers eng": [
        ...(TMDB_TITLE_ALIASES["digimon tamers movie 1 battle of adventurers eng"] || []),
        { title: "Digimon Tamers The Battle of Adventurers", year: 2001 },
        { title: "Digimon Tamers Battle of Adventurers", year: 2001 }
      ],
      "digimon tamers movie 2 runaway locomoon eng": [
        ...(TMDB_TITLE_ALIASES["digimon tamers movie 2 runaway locomoon eng"] || []),
        { title: "Digimon Tamers The Runaway Locomon", year: 2002 },
        { title: "Digimon Tamers Runaway Locomon", year: 2002 }
      ],
      "legend of the northwest": [
        ...(TMDB_TITLE_ALIASES["legend of the northwest"] || []),
        { title: "The Legend of the Northwest", year: 2013 }
      ],
      "terrifier 1": [
        ...(TMDB_TITLE_ALIASES["terrifier 1"] || []),
        { title: "Terrifier", year: 2016 }
      ],
      "clownado": [
        ...(TMDB_TITLE_ALIASES["clownado"] || []),
        { title: "Clownado", year: 2019 }
      ],
      "evil bong 888 infinity": [
        ...(TMDB_TITLE_ALIASES["evil bong 888 infinity"] || []),
        { title: "Evil Bong 888 Infinity", year: 2022 }
      ],
      "mickey and minnie 10 classic shorts": [
        ...(TMDB_TITLE_ALIASES["mickey and minnie 10 classic shorts"] || []),
        { title: "Mickey and Minnie Ten Classic Shorts", year: 2023 },
        { title: "Mickey Mouse Ten Classic Shorts", year: 2023 }
      ],
      "hustler dreams": [
        ...(TMDB_TITLE_ALIASES["hustler dreams"] || []),
        { title: "Hustler's Dreams", year: 2025 },
        { title: "Hustler Dreams", year: 2025 }
      ]
    });

    // Extra aliases for the last unresolved catalog entries. These include
    // official English titles and known release-year variations; matching still
    // requires a strong title match and an available poster image.
    Object.assign(TMDB_TITLE_ALIASES, {
      "digimon revenge of diaboromon": [
        ...(TMDB_TITLE_ALIASES["digimon revenge of diaboromon"] || []),
        { title: "Digimon Adventure 02: Revenge of Diaboromon", year: 2001 },
        { title: "Digimon Adventure 02 Revenge of Diaboromon", year: 2001 },
        { title: "Revenge of Diaboromon", year: 2001 },
        { title: "Digimon Adventure 02: Diablomon Strikes Back", year: 2001 }
      ],
      "evil bong 1": [
        ...(TMDB_TITLE_ALIASES["evil bong 1"] || []),
        { title: "Evil Bong", year: 2006 },
        { title: "Evil Bong", year: 2008 }
      ],
      "pokemon camp pikachu": [
        ...(TMDB_TITLE_ALIASES["pokemon camp pikachu"] || []),
        { title: "Pokémon Camp Pikachu", year: 2002 },
        { title: "Camp Pikachu", year: 2002 },
        { title: "Pikachu's Camp Pikachu", year: 2002 }
      ],
      "digimon tamers movie 1 battle of adventurers eng": [
        ...(TMDB_TITLE_ALIASES["digimon tamers movie 1 battle of adventurers eng"] || []),
        { title: "Digimon Tamers: Battle of Adventurers", year: 2001 },
        { title: "Digimon Tamers: The Adventurers' Battle", year: 2001 },
        { title: "The Adventurers' Battle", year: 2001 }
      ],
      "digimon tamers movie 2 runaway locomon eng": [
        ...(TMDB_TITLE_ALIASES["digimon tamers movie 2 runaway locomon eng"] || []),
        { title: "Digimon Tamers: Runaway Locomon", year: 2002 },
        { title: "Digimon Tamers: Runaway Digimon Express", year: 2002 },
        { title: "Runaway Locomon", year: 2002 }
      ],
      "legend of the northwest": [
        ...(TMDB_TITLE_ALIASES["legend of the northwest"] || []),
        { title: "The Legend of the Northwest", year: 2013 },
        { title: "Legend of the Northwest", year: 2013 }
      ],
      "clownado": [
        ...(TMDB_TITLE_ALIASES["clownado"] || []),
        { title: "Clownado", year: 2018 },
        { title: "Clownado", year: 2019 }
      ],
      "mickey and minnie 10 classic shorts": [
        ...(TMDB_TITLE_ALIASES["mickey and minnie 10 classic shorts"] || []),
        { title: "Mickey & Minnie: 10 Classic Shorts - Volume 1", year: 2023 },
        { title: "Mickey and Minnie 10 Classic Shorts Volume 1", year: 2023 },
        { title: "Mickey & Minnie: 10 Classic Shorts", year: 2023 }
      ],
      "hustler dreams": [
        ...(TMDB_TITLE_ALIASES["hustler dreams"] || []),
        { title: "Hustler Dreams", year: 2024 },
        { title: "Hustler Dreams", year: 2025 },
        { title: "Hustler's Dreams", year: 2025 }
      ]
    });

    // Correct spelling variant for the Locomon catalog entry (the earlier
    // alias key contained an extra 'o', so it could never be selected).
    TMDB_TITLE_ALIASES["digimon tamers movie 2 runaway locomon eng"] = [
      ...(TMDB_TITLE_ALIASES["digimon tamers movie 2 runaway locomon eng"] || []),
      { title: "Digimon Tamers: Runaway Locomon", year: 2002 }
    ];

    function tmdbTitleSimilarity(a, b) {
      const left = normalizeCompareStr(cleanTitleForSearch(a));
      const right = normalizeCompareStr(cleanTitleForSearch(b));
      if (!left || !right) return 0;
      if (left === right) return 1;
      if (left.startsWith(right + " ") || right.startsWith(left + " ")) return 0.9;
      const aTokens = [...new Set(left.split(" ").filter(Boolean))];
      const bTokens = [...new Set(right.split(" ").filter(Boolean))];
      const bSet = new Set(bTokens);
      const overlap = aTokens.filter((token) => bSet.has(token)).length;
      return overlap / Math.max(aTokens.length, bTokens.length);
    }

    function getTmdbSearchCandidates(item, variants) {
      const key = normalizeCompareStr(cleanTitleForSearch(item.title));
      const targetYear = parseInt(item.year, 10) || null;
      const candidates = [];
      for (const title of variants.slice(0, 4)) candidates.push({ title, year: targetYear });
      for (const alias of (TMDB_TITLE_ALIASES[key] || [])) candidates.push(alias);
      const seen = new Set();
      const explicit = candidates.filter((candidate) => {
        const id = `${normalizeCompareStr(candidate.title)}|${candidate.year || ""}`;
        if (!candidate.title || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      // Search both with and without a year: catalog years for concert films and shorts
      // are sometimes broadcast/home-video dates rather than the database release date.
      const yearless = explicit.map((candidate) => ({ title: candidate.title, year: null, yearFallback: true }));
      return [...explicit, ...yearless].slice(0, 64);
    }

    async function fetchTmdbPoster(item, variants) {
      if (!tmdbApiKey) return "";

      const isShow = item.type === "show";
      const endpoint = isShow ? "tv" : "movie";
      const candidates = getTmdbSearchCandidates(item, variants);
      if (!candidates.length) return "";

      for (const candidate of candidates) {
        const params = new URLSearchParams({
          api_key: tmdbApiKey,
          query: candidate.title,
          include_adult: "false",
          language: "en-US",
          page: "1"
        });
        if (candidate.year) params.set(isShow ? "first_air_date_year" : "year", String(candidate.year));

        const data = await fetchJsonWithTimeout(`https://api.themoviedb.org/3/search/${endpoint}?${params.toString()}`, 9000);
        const results = Array.isArray(data?.results) ? data.results : [];

        for (const result of results) {
          const resultTitle = isShow
            ? (result.name || result.original_name || "")
            : (result.title || result.original_title || "");
          if (!resultTitle || !result.poster_path) continue;

          // Permit minor subtitle/romanization differences, but require a strong title
          // overlap. This avoids accepting a merely related franchise entry.
          const similarity = tmdbTitleSimilarity(resultTitle, candidate.title);
          if (similarity < 0.80) continue;

          const dateValue = isShow ? result.first_air_date : result.release_date;
          const resultYear = dateValue ? parseInt(String(dateValue).slice(0, 4), 10) : null;
          if (candidate.year && resultYear !== candidate.year) continue;
          if (candidate.yearFallback && item.year && resultYear && Math.abs(resultYear - (parseInt(item.year, 10) || resultYear)) > 2) continue;

          const posterUrl = `https://image.tmdb.org/t/p/w500${result.poster_path}`;
          if (!isPosterAlreadyUsed(posterUrl, item.id)) return posterUrl;
        }
      }
      return "";
    }

    async function fetchItunesPoster(item, variants) {
      const isShow = item.type === "show";
      const mediaParam = isShow ? "media=tvShow&entity=tvSeason" : "media=movie&entity=movie";

      for (const queryTitle of variants.slice(0, 2)) {
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(queryTitle)}&${mediaParam}&country=US&limit=8`;
        const data = await fetchJsonWithTimeout(url, 7500);
        const results = data?.results || [];
        if (!results.length) continue;

        let bestUrl = "";
        let bestScore = 0;

        for (const r of results) {
          const rTitle = isShow ? (r.collectionName || r.artistName || "") : (r.trackName || r.collectionName || "");
          const rYear = r.releaseDate ? parseInt(String(r.releaseDate).slice(0, 4), 10) : null;
          const art = r.artworkUrl100 || r.artworkUrl60 || "";
          if (!art) continue;

          const exactTitleMatch = normalizeCompareStr(cleanTitleForSearch(rTitle)) === normalizeCompareStr(cleanTitleForSearch(item.title));
          const targetYear = parseInt(item.year, 10) || null;
          if (!exactTitleMatch || (targetYear && rYear !== targetYear)) continue;
          const score = scoreTitleMatch(rTitle, rYear, item.title, item.year);
          if (score > bestScore) {
            bestScore = score;
            bestUrl = art.replace(/\/\d+x\d+bb\./, "/600x900bb.");
          }
        }

        if (bestUrl) return bestUrl;
      }
      return "";
    }

    async function fetchTvMazePoster(item, variants) {
      for (const queryTitle of variants.slice(0, 2)) {
        const url = `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(queryTitle)}`;
        const results = await fetchJsonWithTimeout(url, 7500);
        if (!Array.isArray(results) || !results.length) continue;

        let bestUrl = "";
        let bestScore = 0;

        for (const entry of results) {
          const show = entry?.show;
          if (!show?.image) continue;
          const imgUrl = show.image.original || show.image.medium || "";
          if (!imgUrl) continue;
          const rYear = show.premiered ? parseInt(String(show.premiered).slice(0, 4), 10) : null;
          const exactTitleMatch = normalizeCompareStr(cleanTitleForSearch(show.name || "")) === normalizeCompareStr(cleanTitleForSearch(item.title));
          const targetYear = parseInt(item.year, 10) || null;
          if (!exactTitleMatch || (targetYear && rYear !== targetYear)) continue;
          const score = scoreTitleMatch(show.name || "", rYear, item.title, item.year);
          if (score > bestScore) {
            bestScore = score;
            bestUrl = imgUrl;
          }
        }

        if (bestUrl) return bestUrl;
      }
      return "";
    }

    function isFilmOrTvPage(page) {
      const titleLower = (page.title || "").toLowerCase();
      if (
        titleLower.startsWith("list of ") ||
        titleLower.includes(" in film") ||
        titleLower.includes("(soundtrack)") ||
        titleLower.includes("(video game)") ||
        titleLower.includes("discography")
      ) {
        return false;
      }

      if (
        titleLower.endsWith("film)") ||
        titleLower.endsWith("miniseries)") ||
        titleLower.endsWith("tv series)") ||
        titleLower.endsWith("television series)")
      ) {
        return true;
      }

      const cats = (page.categories || []).map((c) => c.title.toLowerCase());
      return cats.some(
        (c) =>
          c.includes("film") ||
          c.includes("television") ||
          c.includes("miniseries") ||
          c.includes("animated") ||
          c.includes("spongebob") ||
          c.includes("family guy") ||
          c.includes("movie")
      );
    }

    function getWikipediaTitleCandidates(item, cleanTitle) {
      const isMiniseries = (item.notes || "").toLowerCase().includes("miniseries");

      if (item.type === "show") {
        return [
          `${cleanTitle} (TV series)`,
          `${cleanTitle} (American TV series)`,
          `${cleanTitle}`,
          `${cleanTitle} (film)`
        ];
      }

      if (isMiniseries) {
        return [
          `${cleanTitle} (miniseries)`,
          `${cleanTitle} (${item.year} film)`,
          `${cleanTitle} (film)`,
          `${cleanTitle}`
        ];
      }

      return [
        `${cleanTitle} (${item.year} American film)`,
        `${cleanTitle} (${item.year} film)`,
        `${cleanTitle} (film)`,
        `${cleanTitle}`
      ];
    }

    async function fetchWikipediaPoster(item, variants) {
      const cleanTitle = variants[0] || cleanTitleForSearch(item.title);
      const candidates = getWikipediaTitleCandidates(item, cleanTitle);
      const titlesParam = candidates.join("|");

      const exactEndpoint =
        `https://en.wikipedia.org/w/api.php?action=query` +
        `&titles=${encodeURIComponent(titlesParam)}` +
        `&redirects=1` +
        `&prop=pageimages|categories` +
        `&clshow=!hidden` +
        `&cllimit=max` +
        `&piprop=thumbnail` +
        `&pithumbsize=500` +
        `&pilicense=any` +
        `&format=json&origin=*`;

      const data = await fetchJsonWithTimeout(exactEndpoint, 8000);
      if (data?.query) {
        const query = data.query;
        const pages = Object.values(query.pages || {});

        const normMap = {};
        for (const n of query.normalized || []) normMap[n.from] = n.to;
        const redirMap = {};
        for (const r of query.redirects || []) redirMap[r.from] = r.to;

        const resolveName = (name) => {
          let cur = normMap[name] || name;
          const seen = new Set();
          while (redirMap[cur] && !seen.has(cur)) {
            seen.add(cur);
            cur = redirMap[cur];
          }
          return cur;
        };

        for (const candidate of candidates) {
          const finalTitle = resolveName(candidate);
          const matchedPage = pages.find(
            (p) => !p.missing && p.title === finalTitle && p.thumbnail?.source && isFilmOrTvPage(p)
          );
          if (matchedPage) {
            return matchedPage.thumbnail.source;
          }
        }
      }

      const searchTerm =
        item.type === "show"
          ? `intitle:"${cleanTitle}" television series`
          : `intitle:"${cleanTitle}" ${item.year} film`;

      const searchEndpoint =
        `https://en.wikipedia.org/w/api.php?action=query` +
        `&generator=search` +
        `&gsrsearch=${encodeURIComponent(searchTerm)}` +
        `&gsrlimit=5` +
        `&prop=pageimages|categories` +
        `&clshow=!hidden` +
        `&cllimit=max` +
        `&piprop=thumbnail` +
        `&pithumbsize=500` +
        `&pilicense=any` +
        `&format=json&origin=*`;

      const sData = await fetchJsonWithTimeout(searchEndpoint, 8000);
      if (sData?.query?.pages) {
        const pages = Object.values(sData.query.pages).sort((a, b) => a.index - b.index);
        for (const page of pages) {
          if (page.thumbnail?.source && isFilmOrTvPage(page)) {
            return page.thumbnail.source;
          }
        }
      }

      return "";
    }

    async function fetchBestPoster(item) {
      const variants = getSearchTitleVariants(item.title);
      const isMiniseries = (item.notes || "").toLowerCase().includes("miniseries");

      // TMDB is the preferred source because it has dedicated movie and TV artwork records.
      const tmdbUrl = await fetchTmdbPoster(item, variants);
      if (tmdbUrl && !isPosterAlreadyUsed(tmdbUrl, item.id)) return tmdbUrl;

      // Keep the existing providers as fallbacks for titles TMDB cannot confidently match.
      if (item.type === "show" || isMiniseries) {
        const tvMazeUrl = await fetchTvMazePoster(item, variants);
        if (tvMazeUrl && !isPosterAlreadyUsed(tvMazeUrl, item.id)) return tvMazeUrl;

        const itunesTvUrl = await fetchItunesPoster(item, variants);
        if (itunesTvUrl && !isPosterAlreadyUsed(itunesTvUrl, item.id)) return itunesTvUrl;

        const wikiTvUrl = await fetchWikipediaPoster(item, variants);
        if (wikiTvUrl && !isPosterAlreadyUsed(wikiTvUrl, item.id)) return wikiTvUrl;
        return "";
      }

      const itunesMovieUrl = await fetchItunesPoster(item, variants);
      if (itunesMovieUrl && !isPosterAlreadyUsed(itunesMovieUrl, item.id)) return itunesMovieUrl;

      const wikiMovieUrl = await fetchWikipediaPoster(item, variants);
      if (wikiMovieUrl && !isPosterAlreadyUsed(wikiMovieUrl, item.id)) return wikiMovieUrl;
      return "";
    }

    const DESCRIPTION_CACHE_KEY = "cinevault_descriptions_v1";
    let descriptionCache = {};
    try { descriptionCache = JSON.parse(localStorage.getItem(DESCRIPTION_CACHE_KEY) || "{}"); } catch (e) { descriptionCache = {}; }

    async function fetchTmdbDescription(item) {
      if (!tmdbApiKey) return "";
      const params = new URLSearchParams({
        api_key: tmdbApiKey,
        query: cleanTitleForSearch(item.title),
        include_adult: "false",
        language: "en-US",
        page: "1"
      });
      if (item.year) params.set("year", String(item.year));
      const data = await fetchJsonWithTimeout(`https://api.themoviedb.org/3/search/movie?${params.toString()}`, 9000);
      if (!data) return null;
      const results = Array.isArray(data?.results) ? data.results : [];
      const targetYear = parseInt(item.year, 10) || null;
      const best = results
        .map((result) => {
          const title = result.title || result.original_title || "";
          const date = result.release_date || "";
          const year = date ? parseInt(date.slice(0, 4), 10) : null;
          const similarity = tmdbTitleSimilarity(title, item.title);
          const yearOkay = !targetYear || !year || Math.abs(year - targetYear) <= 2;
          return { result, similarity, yearOkay, year };
        })
        .filter((match) => match.result.overview && match.similarity >= 0.82 && match.yearOkay)
        .sort((a, b) => (b.similarity - a.similarity) || (targetYear ? Math.abs((a.year || targetYear) - targetYear) - Math.abs((b.year || targetYear) - targetYear) : 0));
      return best[0]?.result?.overview?.trim() || "";
    }

    async function hydrateMissingDescriptions() {
      const pending = library.filter((item) => item.type !== "show" && !item.description && !Object.prototype.hasOwnProperty.call(descriptionCache, item.id));
      if (!pending.length) return;
      let completed = 0;
      const batchSize = 4;
      for (let i = 0; i < pending.length; i += batchSize) {
        const batch = pending.slice(i, i + batchSize);
        await Promise.all(batch.map(async (item) => {
          const description = await fetchTmdbDescription(item);
          if (description) {
            item.description = description;
            descriptionCache[item.id] = description;
            const customRec = customItems.find((entry) => entry.id === item.id);
            if (customRec) customRec.description = description;
            const saved = userState[item.id] || {};
            if (!saved.customDescription) {
              userState[item.id] = { ...saved, customDescription: description };
            }
          } else if (description === "") {
            // Cache confirmed no-match results; transient network/API failures return null and retry later.
            descriptionCache[item.id] = "";
          }
          completed++;
        }));
        try {
          localStorage.setItem(DESCRIPTION_CACHE_KEY, JSON.stringify(descriptionCache));
          localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(userState));
          saveCustomItems();
        } catch (e) {}
        if (completed % 20 === 0 || completed === pending.length) {
          renderCatalog();
          if (spotlightItem) renderSpotlight();
        }
      }
      const filled = pending.filter((item) => Boolean(item.description)).length;
      if (filled) showToast(`Added descriptions to ${filled} movie${filled === 1 ? "" : "s"}.`);
    }

    async function hydrateAllPosters(forceRefresh = false) {
      if (isHydratingPosters) {
        showToast("Poster sync is already running...");
        return;
      }

      const statusDot = document.getElementById("statusDot");
      const statusText = document.getElementById("statusText");
      statusDot.classList.remove("done", "error");

      if (forceRefresh) {
        posterCache = {};
        savePosterCache();
        library.forEach((m) => {
          if (!userState[m.id]?.customPoster) {
            m.poster = "";
          }
        });
        renderCatalog();
        renderSpotlight();
      }

      // Keep the first occurrence of an artwork file and re-fetch later duplicates.
      const seenPosterIdentities = new Set();
      let removedDuplicatePoster = false;
      for (const item of library) {
        if (!item.poster) continue;
        const identity = posterIdentity(item.poster);
        if (!identity) continue;
        if (seenPosterIdentities.has(identity) && !userState[item.id]?.customPoster && !POSTER_OVERRIDES[item.id]) {
          item.poster = "";
          delete posterCache[item.id];
          removedDuplicatePoster = true;
        } else {
          seenPosterIdentities.add(identity);
        }
      }
      if (removedDuplicatePoster) savePosterCache();

      const alreadyReady = library.filter((m) => Boolean(m.poster)).length;
      if (alreadyReady === library.length) {
        statusDot.classList.add("done");
        statusText.textContent = `${library.length}/${library.length} Posters Ready`;
        updatePosterStatsUI();
        return;
      }

      isHydratingPosters = true;
      const pending = library.filter((m) => !m.poster);
      let processed = 0;
      const batchSize = 4;

      statusText.textContent = `Syncing ${alreadyReady}/${library.length}...`;

      try {
        for (let i = 0; i < pending.length; i += batchSize) {
          const batch = pending.slice(i, i + batchSize);
          await Promise.all(
            batch.map(async (item) => {
              const url = await fetchBestPoster(item);
              if (url && !isPosterAlreadyUsed(url, item.id)) {
                item.poster = url;
                posterCache[item.id] = url;
                updateCardPosterDOM(item.id, url);
                if (spotlightItem && spotlightItem.id === item.id) {
                  renderSpotlight();
                } else if (!heroLocked && spotlightItem && !spotlightItem.poster && item.description) {
                  spotlightItem = item;
                  renderSpotlight();
                }
              }
              processed++;
              const readyNow = library.filter((m) => Boolean(m.poster)).length;
              statusText.textContent = `Artwork ${readyNow}/${library.length}`;
            })
          );
          savePosterCache();
          updatePosterStatsUI();
          await new Promise((r) => setTimeout(r, 180));
        }
      } finally {
        isHydratingPosters = false;
      }

      const matchedCount = library.filter((m) => Boolean(m.poster)).length;
      const unmatchedCount = library.length - matchedCount;
      statusDot.classList.toggle("error", unmatchedCount > 0);
      statusDot.classList.toggle("done", unmatchedCount === 0);
      statusText.textContent = unmatchedCount
        ? `${matchedCount}/${library.length} Posters Ready • ${unmatchedCount} need matching`
        : `${matchedCount}/${library.length} Posters Ready`;
      updatePosterStatsUI();
      showToast(unmatchedCount
        ? `Poster sync complete: ${matchedCount} matched; ${unmatchedCount} still need a reliable match.`
        : `Poster sync complete: all ${matchedCount} titles have artwork!`);
    }

    function retryMissingPosters() {
      hydrateAllPosters(false);
    }

    function refreshAllPosters() {
      hydrateAllPosters(true);
    }

    function updateCardPosterDOM(id, url) {
      document.querySelectorAll(`[data-poster-img="${id}"]`).forEach((img) => {
        img.src = url;
        img.style.display = "block";
      });
      document.querySelectorAll(`[data-poster-fb="${id}"]`).forEach((fb) => {
        fb.style.display = "none";
      });
      document.querySelectorAll(`[data-no-poster-badge="${id}"]`).forEach((b) => {
        b.style.display = "none";
      });
    }

    function updatePosterStatsUI() {
      const withPoster = library.filter((m) => Boolean(m.poster)).length;
      const missingPoster = library.length - withPoster;
      const hasOpt = document.getElementById("hasPosterOption");
      const missOpt = document.getElementById("missingPosterOption");
      if (hasOpt) hasOpt.textContent = `✓ Has Poster (${withPoster})`;
      if (missOpt) missOpt.textContent = `⚠ Missing Poster (${missingPoster})`;
    }

    function filterToMissingPosters() {
      document.getElementById("posterFilter").value = "missing-poster";
      setViewMode("grid");
    }

    function renderGenres() {
      const genres = ["All", ...Array.from(new Set(library.map((m) => m.genre))).sort()];
      if (!genres.includes(selectedGenre)) selectedGenre = "All";
      const bar = document.getElementById("genreBar");
      bar.innerHTML = genres
        .map(
          (g) =>
            `<button class="genre-chip ${g === selectedGenre ? "active" : ""}" onclick="setGenre('${g}')">${g}</button>`
        )
        .join("");
    }

    function setGenre(genre) {
      selectedGenre = genre;
      renderGenres();
      if (genre !== "All") {
        setViewMode("grid");
      } else if (!hasActiveFilters() && activeNavTab === "home") {
        setViewMode("rows");
      } else {
        renderCatalog();
      }
    }

    // --- Featured Title Selection (always drawn from the real library) ---
    function pickFeatured(excludeId) {
      const tiers = [
        library.filter((m) => m.poster && m.description && m.status !== "watched" && linkHealth[m.id] !== "flagged"),
        library.filter((m) => m.poster && m.status !== "watched"),
        library.filter((m) => m.poster),
        library
      ];
      // Use the best available tier, but cycle through every eligible title before repeating.
      for (const tier of tiers) {
        let candidates = tier.filter((m) => m.id !== excludeId && !featuredSeenIds.has(m.id));
        if (!candidates.length) continue;
        const chosen = candidates[Math.floor(Math.random() * candidates.length)];
        featuredSeenIds.add(chosen.id);
        return chosen;
      }
      // All eligible titles have appeared. Start a fresh cycle, keeping the current title excluded.
      featuredSeenIds.clear();
      for (const tier of tiers) {
        const candidates = tier.filter((m) => m.id !== excludeId);
        if (candidates.length) {
          const chosen = candidates[Math.floor(Math.random() * candidates.length)];
          featuredSeenIds.add(chosen.id);
          return chosen;
        }
      }
      return library[0] || null;
    }

    let heroSwapTimer = null;
    let heroAutoShuffleTimer = null;

    function startFeaturedAutoShuffle() {
      if (heroAutoShuffleTimer) clearInterval(heroAutoShuffleTimer);
      // Rotate automatically every 45 seconds; manual Discover Another still works immediately.
      heroAutoShuffleTimer = setInterval(() => {
        if (document.hidden || !library.length) return;
        const playerOpen = document.getElementById("playerBackdrop")?.classList.contains("open");
        const modalOpen = document.getElementById("modalBackdrop")?.classList.contains("open");
        if (playerOpen || modalOpen) return;
        shuffleSpotlight();
      }, 45000);
    }

    function shuffleSpotlight() {
      if (!library.length) return;
      heroLocked = true;
      const el = document.getElementById("spotlight");

      // Rotate the featured title without changing the current page, tab, filters, or scroll position.
      if (viewMode !== "rows" || activeNavTab !== "home") {
        spotlightItem = pickFeatured(spotlightItem && spotlightItem.id);
        renderSpotlight();
        return;
      }

      clearTimeout(heroSwapTimer);
      el.classList.add("is-leaving");
      heroSwapTimer = setTimeout(() => {
        spotlightItem = pickFeatured(spotlightItem && spotlightItem.id);
        renderSpotlight();
        el.classList.remove("is-leaving");
      }, 240);
    }

    function renderSpotlight() {
      const el = document.getElementById("spotlight");
      if (!spotlightItem) {
        el.style.display = "none";
        el.innerHTML = "";
        return;
      }
      el.style.display = "";

      const m = spotlightItem;
      const isFlagged = linkHealth[m.id] === "flagged";
      const hasPoster = Boolean(m.poster);
      const safePosterCss = hasPoster ? m.poster.replace(/'/g, "%27").replace(/"/g, "%22") : "";
      const isNewHero = el.dataset.heroId !== m.id;

      const metaBits = [
        `<span>${escapeHtml(String(m.year))}</span>`,
        m.genre ? `<span class="cv-sep">•</span><span>${escapeHtml(m.genre)}</span>` : "",
        m.quality ? `<span class="cv-chip">${escapeHtml(m.quality)}</span>` : "",
        `<span class="cv-sep">•</span><span>${m.type === "show" ? "Series & Specials" : "Feature Film"}</span>`,
        m.notes ? `<span class="cv-sep">•</span><span>${escapeHtml(m.notes)}</span>` : ""
      ].join("");

      el.innerHTML = `
        <div class="cv-hero-bg ${hasPoster ? "" : "no-art"}" ${hasPoster ? `style="background-image: url('${safePosterCss}')"` : ""}></div>
        ${hasPoster ? `<img class="cv-hero-poster" src="${escapeHtml(m.poster)}" alt="" draggable="false" onerror="this.style.display='none'" />` : ""}
        <div class="cv-hero-shade-left"></div>
        <div class="cv-hero-shade-top"></div>
        <div class="cv-hero-shade-bottom"></div>

        <div class="cv-hero-content">
          <div class="cv-hero-eyebrow">
            <span>Featured in Your Vault</span>
            ${isFlagged ? `<span class="cv-hero-flag">⚠ Flagged Link</span>` : ""}
          </div>
          <h2 class="cv-hero-title">${escapeHtml(m.title)}</h2>
          <div class="cv-hero-meta">${metaBits}</div>
          ${m.description ? `<p class="cv-hero-desc">${escapeHtml(m.description)}</p>` : ""}
          <div class="cv-hero-actions">
            <button class="cv-btn cv-btn-play" onclick="watchInSite('${m.id}')">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11-6.86a1 1 0 0 0 0-1.7l-11-6.86A1 1 0 0 0 8 5.14z"/></svg>
              ${m.status === "watching" ? "Resume" : "Play"}
            </button>
            <button class="cv-btn cv-btn-glass" onclick="openModal('${m.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><line x1="12" y1="11" x2="12" y2="16.5"/><circle cx="12" cy="7.7" r="0.7" fill="currentColor" stroke="none"/></svg>
              More Info
            </button>
            <button class="cv-btn cv-btn-glass cv-btn-discover" onclick="shuffleSpotlight()" title="Discover another featured title" aria-label="Discover another featured title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
              <span class="label">Discover Another</span>
            </button>
          </div>
        </div>
      `;

      // Only choreograph the entrance when the featured title actually changes
      // (not when artwork simply finishes loading for the same title).
      el.classList.remove("is-entering");
      if (isNewHero) {
        void el.offsetWidth;
        el.classList.add("is-entering");
      }
      el.dataset.heroId = m.id;
    }

    // --- Viewing helpers (only real data is ever surfaced) ---
    function getProgressPct(m) {
      const saved = userState[m.id] && userState[m.id].progress;
      const raw = saved !== undefined && saved !== null && saved !== "" ? saved : m.progress;
      if (raw === undefined || raw === null || raw === "") return null;
      const n = Number(raw);
      if (!isFinite(n) || n <= 0) return null;
      const pct = n <= 1 ? n * 100 : n;
      if (pct >= 100) return null;
      return Math.round(pct);
    }

    function getLastPlayed(id) {
      const t = userState[id] && userState[id].lastPlayed;
      return typeof t === "number" && isFinite(t) ? t : 0;
    }

    function markPlayed(id) {
      userState[id] = { ...(userState[id] || {}), lastPlayed: Date.now() };
      saveUserState();
    }

    function markContinueFinished(id) {
      const item = library.find((entry) => entry.id === id);
      if (!item) return;
      item.status = "watched";
      const saved = { ...(userState[id] || {}), status: "watched" };
      delete saved.progress;
      delete saved.lastPlayed;
      userState[id] = saved;
      saveUserState();
      renderCatalog();
      showToast(`${item.title} marked as finished`);
    }

    function clearContinueWatching(id) {
      const item = library.find((entry) => entry.id === id);
      if (!item) return;
      item.status = "unwatched";
      const saved = { ...(userState[id] || {}) };
      saved.status = "unwatched";
      delete saved.progress;
      delete saved.lastPlayed;
      userState[id] = saved;
      saveUserState();
      renderCatalog();
      showToast(`Removed ${item.title} from Continue Watching`);
    }

    function timeAgo(ts) {
      const secs = Math.max(0, (Date.now() - ts) / 1000);
      const mins = Math.floor(secs / 60);
      if (mins < 2) return "just now";
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      const days = Math.floor(hrs / 24);
      if (days === 1) return "yesterday";
      if (days < 14) return `${days}d ago`;
      const weeks = Math.floor(days / 7);
      if (weeks < 9) return `${weeks}w ago`;
      return new Date(ts).toLocaleDateString(undefined, { month: "short", year: "numeric" });
    }

    function idNumber(id) {
      const m = String(id).match(/(\d+)$/);
      return m ? parseInt(m[1], 10) : 0;
    }

    // Stable per-session random rank so "Ready for Your Next Watch" feels fresh on each visit
    const sessionShuffleRank = new Map();
    function sessionRank(id) {
      if (!sessionShuffleRank.has(id)) sessionShuffleRank.set(id, Math.random());
      return sessionShuffleRank.get(id);
    }

    const ICON_PLAY = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11-6.86a1 1 0 0 0 0-1.7l-11-6.86A1 1 0 0 0 8 5.14z"/></svg>`;
    const ICON_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

    // --- Shared Card Renderer (used in Shelves & Full Grid) ---
    function buildPosterCardHtml(m, opts = {}) {
      const hasPoster = Boolean(m.poster);
      const isFlagged = linkHealth[m.id] === "flagged";
      const isWatched = m.status === "watched";
      const pct = opts.variant === "resume" ? getProgressPct(m) : null;
      const caption = opts.caption !== undefined ? opts.caption : `${m.year} • ${m.genre}`;
      const safeTitle = escapeHtml(m.title);
      const resumeClearButton = opts.variant === "resume"
        ? `<div class="cv-resume-actions"><button class="cv-resume-clear" onclick="event.stopPropagation(); markContinueFinished('${m.id}')" aria-label="Mark ${safeTitle} as finished">Mark finished</button><button class="cv-resume-clear" onclick="event.stopPropagation(); clearContinueWatching('${m.id}')" aria-label="Remove ${safeTitle} from Continue Watching">Remove</button></div>`
        : "";

      return `
        <article class="nf-card cv-card ${opts.variant ? `cv-card--${opts.variant}` : ""} ${isFlagged ? "is-flagged" : ""}">
          <div class="poster-wrap" role="button" tabindex="0" onclick="openModal('${m.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openModal('${m.id}')}" title="${safeTitle}" aria-label="${safeTitle} — details">
            <img
              data-poster-img="${m.id}"
              src="${escapeHtml(m.poster)}"
              alt="${safeTitle}"
              loading="lazy"
              draggable="false"
              style="display:${hasPoster ? "block" : "none"}"
              onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';"
            />
            <div class="poster-fallback" data-poster-fb="${m.id}" style="display:${hasPoster ? "none" : "flex"}">
              <span>${safeTitle}</span>
              <small>${m.year} • ${escapeHtml(m.genre)}</small>
            </div>

            ${isWatched ? `<span class="cv-badge-watched" title="Watched">${ICON_CHECK}</span>` : ""}
            ${isFlagged ? `<div class="cv-badge-flag">⚠ Broken Link</div>` : ""}
            ${pct !== null ? `<div class="cv-progress" title="${pct}% watched"><i style="width:${pct}%"></i></div>` : ""}

            <div class="cv-card-overlay">
              <button class="cv-play-btn" onclick="event.stopPropagation(); watchInSite('${m.id}')" aria-label="${m.status === "watching" ? "Resume" : "Play"} ${safeTitle}" title="${m.status === "watching" ? "Resume" : "Play"}">${ICON_PLAY}</button>
              <button class="cv-check-btn ${isWatched ? "is-on" : ""}" onclick="quickToggleWatched('${m.id}', event)" aria-label="${isWatched ? "Mark unwatched" : "Mark watched"}" title="${isWatched ? "Mark Unwatched" : "Mark Watched"}">${ICON_CHECK}</button>
              <div class="cv-overlay-title">${safeTitle}</div>
              <div class="cv-overlay-sub">${m.year} • ${escapeHtml(m.genre)}${m.quality ? ` • ${escapeHtml(m.quality)}` : ""}</div>
            </div>
          </div>
          <div class="cv-card-caption">
            <div class="cv-card-title" onclick="openModal('${m.id}')" title="${safeTitle}">${safeTitle}</div>
            <div class="cv-card-sub">${caption ? escapeHtml(caption) : "&nbsp;"}</div>
            ${resumeClearButton}
          </div>
        </article>
      `;
    }

    function scrollSwimlane(rowId, direction) {
      const track = document.getElementById(rowId);
      if (!track) return;
      const distance = Math.max(420, track.clientWidth * 0.82);
      track.scrollBy({ left: direction * distance, behavior: "smooth" });
    }

    // Prefer titles that already have artwork, then newest release first
    function byArtworkThenYear(a, b) {
      const pa = a.poster ? 1 : 0;
      const pb = b.poster ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return (b.year || 0) - (a.year || 0);
    }

    const FRANCHISE_KEYWORDS = [
      "john wick", "transformers", "twilight", "despicable me", "minions",
      "shrek", "spongebob", "ocean's", "fear street", "back to the future",
      "ant-man", "spider-man", "mummy", "ghostbusters", "halloween", "deadpool", "toy story", "hobbit"
    ];
    const GENERIC_NOTES = /^(tv special|full drive series folder|chapter|season|miniseries|tv miniseries|ova|anime|\d{4} miniseries)/i;

    const TOP10_RATING_CACHE_KEY = "cinevault_tmdb_top10_ratings_v1";
    const TOP10_RATING_CACHE_TTL = 12 * 60 * 60 * 1000;
    let top10RatingCache = {};
    try { top10RatingCache = JSON.parse(localStorage.getItem(TOP10_RATING_CACHE_KEY) || "{}"); } catch (e) {}
    let top10HydrationPromise = null;

    function getRatedTop10Items() {
      const ranked = library
        .filter((m) => m.type !== "show" && linkHealth[m.id] !== "flagged")
        .map((m) => ({ item: m, rating: top10RatingCache[m.id] }))
        .filter((entry) => entry.rating && Number(entry.rating.vote_average) >= 6.5 && Number(entry.rating.vote_count) >= 100)
        .sort((a, b) => Number(b.rating.vote_average) - Number(a.rating.vote_average)
          || Number(b.rating.vote_count) - Number(a.rating.vote_count)
          || String(a.item.title).localeCompare(String(b.item.title)))
        .slice(0, 10)
        .map((entry) => entry.item);
      return ranked;
    }

    function top10TitleMatch(candidate, item) {
      const candidateTitle = candidate.title || candidate.original_title || "";
      const candidateYear = candidate.release_date ? parseInt(candidate.release_date.slice(0, 4), 10) : null;
      const itemYear = parseInt(item.year, 10) || null;
      const yearOkay = !candidateYear || !itemYear || Math.abs(candidateYear - itemYear) <= 2;
      return yearOkay && tmdbTitleSimilarity(candidateTitle, item.title) >= 0.86;
    }

    async function hydrateTop10Ratings() {
      if (top10HydrationPromise) return top10HydrationPromise;
      top10HydrationPromise = (async () => {
        if (!tmdbApiKey) return;
        const now = Date.now();
        const cachedAt = Number(top10RatingCache._updatedAt || 0);
        if (cachedAt && now - cachedAt < TOP10_RATING_CACHE_TTL && getRatedTop10Items().length >= Math.min(10, library.filter((m) => m.type !== "show").length)) return;

        const movies = library.filter((m) => m.type !== "show" && linkHealth[m.id] !== "flagged");
        const matched = new Set();
        const collectPages = async (minimumVotes, pageCount) => {
          for (let page = 1; page <= pageCount; page++) {
            const params = new URLSearchParams({
              api_key: tmdbApiKey,
              language: "en-US",
              sort_by: "vote_average.desc",
              include_adult: "false",
              include_video: "false",
              "vote_count.gte": String(minimumVotes),
              page: String(page)
            });
            const data = await fetchJsonWithTimeout(`https://api.themoviedb.org/3/discover/movie?${params.toString()}`, 10000);
            if (!data || !Array.isArray(data.results)) break;
            for (const candidate of data.results) {
              if (Number(candidate.vote_average) < 6.5 || Number(candidate.vote_count) < minimumVotes) continue;
              for (const item of movies) {
                if (matched.has(item.id) || !top10TitleMatch(candidate, item)) continue;
                top10RatingCache[item.id] = {
                  vote_average: Number(candidate.vote_average),
                  vote_count: Number(candidate.vote_count),
                  tmdb_id: candidate.id,
                  matched_title: candidate.title || candidate.original_title || ""
                };
                matched.add(item.id);
              }
            }
            // Stop early once the vault has enough well-supported candidates.
            if (getRatedTop10Items().length >= 10) break;
          }
        };

        // First pass uses a substantial vote-count floor; second pass broadens coverage
        // without allowing tiny-sample ratings to dominate the shelf.
        await collectPages(300, 10);
        if (getRatedTop10Items().length < 10) await collectPages(100, 10);
        top10RatingCache._updatedAt = Date.now();
        try { localStorage.setItem(TOP10_RATING_CACHE_KEY, JSON.stringify(top10RatingCache)); } catch (e) {}
        if (viewMode === "rows") renderCatalog();
      })().finally(() => { top10HydrationPromise = null; });
      return top10HydrationPromise;
    }

    function buildCuratedSwimlanes() {
      const lanes = [];

      // 1. Continue Watching — started but not finished, most recently played first
      const watchingList = library
        .filter((m) => m.status === "watching")
        .sort((a, b) => getLastPlayed(b.id) - getLastPlayed(a.id));
      if (watchingList.length) {
        lanes.push({
          id: "lane-continue",
          title: "Continue Watching",
          subtitle: "Pick up right where you left off",
          variant: "resume",
          items: watchingList,
          limit: 24,
          caption: (m) => {
            const pct = getProgressPct(m);
            const played = getLastPlayed(m.id);
            if (pct !== null) return `Resume • ${pct}% watched`;
            return played ? `Resume • ${timeAgo(played)}` : "Resume • In progress";
          },
          onExplore: () => {
            document.getElementById("statusFilter").value = "watching";
            setViewMode("grid");
          }
        });
      }

      // 2. My List — titles the user has explicitly saved for later.
      const myListItems = library
        .filter((m) => Boolean(userState[m.id]?.watchlist))
        .sort((a, b) => (userState[b.id]?.watchlistAt || 0) - (userState[a.id]?.watchlistAt || 0));
      if (myListItems.length) {
        lanes.push({
          id: "lane-my-list",
          title: "My List",
          subtitle: "Saved for a future movie night",
          items: myListItems,
          limit: 30
        });
      }

      // 3. Ready for Your Next Watch — unwatched titles, artwork first, shuffled per visit
      const heroId = spotlightItem ? spotlightItem.id : null;
      const unwatched = library
        .filter((m) => m.status === "unwatched" && m.id !== heroId)
        .sort((a, b) => {
          const pa = a.poster ? 1 : 0;
          const pb = b.poster ? 1 : 0;
          if (pa !== pb) return pb - pa;
          return sessionRank(a.id) - sessionRank(b.id);
        });
      if (unwatched.length) {
        lanes.push({
          id: "lane-next",
          title: "Ready for Your Next Watch",
          subtitle: "Unwatched picks waiting in your vault",
          items: unwatched,
          limit: 24,
          onExplore: () => {
            document.getElementById("statusFilter").value = "unwatched";
            setViewMode("grid");
          }
        });
      }

      // 4. Top 10 in Your Vault — only titles matched to genuinely well-rated TMDB movies.
      const top10Items = getRatedTop10Items();
      if (top10Items.length) {
        lanes.push({
          id: "lane-top10",
          title: "Top 10 in Your Vault",
          subtitle: "Your highest-rated movies, ranked by TMDB rating",
          ranked: true,
          items: top10Items
        });
      }

      // 5. Recently Added — newest first (added date when known, otherwise vault order)
      const recentlyAdded = [...library].sort((a, b) => {
        const ta = a.addedAt || 0;
        const tb = b.addedAt || 0;
        if (ta !== tb) return tb - ta;
        return idNumber(b.id) - idNumber(a.id);
      });
      if (recentlyAdded.length) {
        lanes.push({
          id: "lane-recent",
          title: "Recently Added",
          subtitle: "The newest arrivals in your vault",
          items: recentlyAdded,
          limit: 24
        });
      }

      // 5. Genre collections
      const genreShelf = (id, title, subtitle, genres, exploreGenre) => {
        const items = library.filter((m) => genres.includes(m.genre)).sort(byArtworkThenYear);
        if (!items.length) return;
        lanes.push({ id, title, subtitle, items, limit: 30, onExplore: () => setGenre(exploreGenre) });
      };

      genreShelf("lane-action", "Action & Adventure", "Big stakes, bigger set pieces", ["Action", "Adventure"], "Action");
      genreShelf("lane-scifi", "Science Fiction & Fantasy", "Other worlds, impossible ideas", ["Sci-Fi", "Fantasy"], "Sci-Fi");
      genreShelf("lane-animation", "Animation", "Animated favorites for every age", ["Animation"], "Animation");
      genreShelf("lane-horror", "Horror & Thriller", "Best watched with the lights down", ["Horror", "Thriller"], "Horror");
      genreShelf("lane-comedy-drama", "Comedy & Drama", "Laughs, heart and everything between", ["Comedy", "Drama", "Romance", "Documentary"], "Comedy");

      // 6. Popular Franchises — keyword matches plus any collection with 2+ titles
      const notesCount = {};
      library.forEach((m) => {
        const n = (m.notes || "").trim();
        if (n) notesCount[n] = (notesCount[n] || 0) + 1;
      });
      const franchiseKey = (m) => {
        const hay = `${m.title} ${m.notes || ""}`.toLowerCase();
        const kw = FRANCHISE_KEYWORDS.find((k) => hay.includes(k));
        if (kw) return kw;
        const n = (m.notes || "").trim();
        if (n && notesCount[n] >= 2 && !GENERIC_NOTES.test(n)) return n.toLowerCase();
        return null;
      };
      const franchiseItems = library
        .map((m) => ({ m, key: franchiseKey(m) }))
        .filter((x) => x.key)
        .sort((a, b) => (a.key === b.key ? (a.m.year || 0) - (b.m.year || 0) : a.key.localeCompare(b.key)))
        .map((x) => x.m);
      if (franchiseItems.length) {
        lanes.push({
          id: "lane-franchises",
          title: "Popular Franchises",
          subtitle: "Sagas and series made for a marathon",
          items: franchiseItems,
          limit: 36
        });
      }

      // 7. TV Shows
      const showItems = library.filter((m) => m.type === "show").sort(byArtworkThenYear);
      if (showItems.length) {
        lanes.push({
          id: "lane-shows",
          title: "TV Shows",
          subtitle: "Series, miniseries and specials",
          items: showItems,
          limit: 30,
          onExplore: () => {
            document.getElementById("typeFilter").value = "show";
            setViewMode("grid");
          }
        });
      }

      return lanes;
    }

    function updateShelfEdges(track) {
      const carousel = track.closest(".row-carousel");
      if (!carousel) return;
      const max = track.scrollWidth - track.clientWidth - 2;
      carousel.classList.toggle("at-start", track.scrollLeft <= 2);
      carousel.classList.toggle("at-end", track.scrollLeft >= max);
    }

    let shelfResizeBound = false;

    function renderSwimlanes() {
      const container = document.getElementById("swimlanesContainer");
      const lanes = buildCuratedSwimlanes();

      if (!lanes.length) {
        container.innerHTML = `<div style="text-align:center; padding:48px 16px; color:var(--text-secondary);">Your vault is empty. Tap <strong>+ Add</strong> to add your first movie or show.</div>`;
        return;
      }

      // Keep each shelf's horizontal position across re-renders
      const savedScroll = {};
      container.querySelectorAll(".row-track").forEach((t) => { savedScroll[t.id] = t.scrollLeft; });

      container.innerHTML = lanes
        .map((lane, idx) => {
          const visibleLaneItems = lane.items.slice(0, lane.limit || 30);
          const cardsHtml = visibleLaneItems
            .map((item, i) => {
              const card = buildPosterCardHtml(item, {
                variant: lane.variant,
                caption: lane.caption ? lane.caption(item) : undefined
              });
              if (!lane.ranked) return card;
              return `
                <div class="top10-item">
                  <svg class="top10-rank-svg" viewBox="0 0 110 175" aria-hidden="true">
                    <text x="${i === 9 ? "-6" : "8"}" y="152">${i + 1}</text>
                  </svg>
                  ${card}
                </div>
              `;
            })
            .join("");

          return `
            <section class="swimlane cv-lane ${lane.variant ? `cv-lane--${lane.variant}` : ""}" style="--i:${idx}" data-lane="${lane.id}">
              <div class="swimlane-header">
                <div class="cv-shelf-titles">
                  <h3 class="swimlane-title">${escapeHtml(lane.title)}</h3>
                  ${lane.subtitle ? `<p class="cv-shelf-sub">${escapeHtml(lane.subtitle)}</p>` : ""}
                </div>
                ${lane.onExplore ? `<button class="swimlane-explore" data-explore-lane="${lane.id}">See All ›</button>` : ""}
              </div>
              <div class="row-carousel at-start">
                <button class="row-paddle prev" onclick="scrollSwimlane('${lane.id}', -1)" aria-label="Scroll Left">‹</button>
                <div class="row-track" id="${lane.id}">
                  ${cardsHtml}
                </div>
                <button class="row-paddle next" onclick="scrollSwimlane('${lane.id}', 1)" aria-label="Scroll Right">›</button>
              </div>
            </section>
          `;
        })
        .join("");

      lanes.forEach((lane) => {
        if (lane.onExplore) {
          const btn = container.querySelector(`[data-explore-lane="${lane.id}"]`);
          if (btn) btn.onclick = lane.onExplore;
        }
      });

      container.querySelectorAll(".row-track").forEach((track) => {
        if (savedScroll[track.id]) track.scrollLeft = savedScroll[track.id];
        track.addEventListener("scroll", () => updateShelfEdges(track), { passive: true });
        updateShelfEdges(track);
      });

      if (!shelfResizeBound) {
        shelfResizeBound = true;
        let resizeTimer = null;
        window.addEventListener("resize", () => {
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
            document.querySelectorAll("#swimlanesContainer .row-track").forEach(updateShelfEdges);
          }, 120);
        });
      }
    }

    function getFilteredMovies() {
      const q = document.getElementById("searchInput").value.trim().toLowerCase();
      const typeVal = document.getElementById("typeFilter").value;
      const statusVal = document.getElementById("statusFilter").value;
      const qualityVal = document.getElementById("qualityFilter").value;
      const posterVal = document.getElementById("posterFilter").value;
      const sortVal = document.getElementById("sortSelect").value;

      let list = library.filter((m) => {
        if (selectedGenre !== "All" && m.genre !== selectedGenre) return false;
        if (typeVal !== "all" && m.type !== typeVal) return false;
        if (statusVal === "flagged") {
          if (linkHealth[m.id] !== "flagged") return false;
        } else if (statusVal !== "all" && m.status !== statusVal) {
          return false;
        }
        if (qualityVal !== "all" && m.quality !== qualityVal) return false;
        if (posterVal === "has-poster" && !m.poster) return false;
        if (posterVal === "missing-poster" && m.poster) return false;
        if (q) {
          const haystack = `${m.title} ${m.description || ""} ${m.year} ${m.genre} ${m.notes} ${m.id}`.toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      });

      if (sortVal === "title-asc") {
        list.sort((a, b) => a.title.localeCompare(b.title));
      } else if (sortVal === "title-desc") {
        list.sort((a, b) => b.title.localeCompare(a.title));
      } else if (sortVal === "year-desc") {
        list.sort((a, b) => b.year - a.year);
      } else if (sortVal === "year-asc") {
        list.sort((a, b) => a.year - b.year);
      }

      return list;
    }

    function renderGrid() {
      const filtered = getFilteredMovies();
      const grid = document.getElementById("movieGrid");
      document.getElementById("resultCount").textContent = `Showing ${filtered.length} of ${library.length} titles`;

      if (!filtered.length) {
        const emptyMessage = activeNavTab === "shows"
          ? `Your Shows tab is ready. Add TV shows here whenever you're ready.`
          : `No matching movies found. Try resetting filters or tap <strong>+ Add</strong>.`;
        grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:56px 16px; color:var(--text-secondary);">${emptyMessage}</div>`;
        return;
      }

      grid.innerHTML = filtered.map((m) => buildPosterCardHtml(m)).join("");
    }

    function renderList() {
      const filtered = getFilteredMovies();
      const listEl = document.getElementById("movieList");
      document.getElementById("resultCount").textContent = `Showing ${filtered.length} of ${library.length} titles`;

      if (!filtered.length) {
        listEl.innerHTML = `<div style="text-align:center; padding:48px 16px; color:var(--text-secondary);">No matching movies or shows found.</div>`;
        return;
      }

      listEl.innerHTML = filtered
        .map((m) => {
          const isWatched = m.status === "watched";
          const isFlagged = linkHealth[m.id] === "flagged";
          return `
            <div class="ios-list-row">
              ${
                m.poster
                  ? `<img class="ios-list-thumb" src="${m.poster}" alt="${escapeHtml(m.title)}" loading="lazy" onclick="watchInSite('${m.id}')" onerror="this.style.display='none'" />`
                  : `<div class="ios-list-thumb-fb" onclick="watchInSite('${m.id}')">${m.year}</div>`
              }
              <div class="ios-list-main" onclick="openModal('${m.id}')">
                <div class="ios-list-title">${escapeHtml(m.title)}</div>
                <div class="ios-list-meta">
                  <span>${m.year}</span>
                  <span>•</span>
                  <span>${m.genre}</span>
                  <span>•</span>
                  <span>${m.quality}</span>
                  ${m.notes ? `<span>• ${escapeHtml(m.notes)}</span>` : ""}
                  ${isFlagged ? `<span style="color:var(--ios-red); font-weight:700;">• ⚠ Broken Link</span>` : ""}
                </div>
              </div>
              <div class="ios-list-actions">
                <button class="btn ${isWatched ? "btn-ios-tinted" : ""}" style="padding:6px 11px; font-size:0.78rem;" onclick="quickToggleWatched('${m.id}', event)" title="Toggle Watched">
                  ${isWatched ? "✓ Watched" : "Watch"}
                </button>
                <button class="btn btn-ios-blue" style="padding:6px 13px; font-size:0.78rem;" onclick="watchInSite('${m.id}')">▶ Play</button>
                <button class="btn btn-circle-icon" style="width:30px; height:30px; font-size:0.82rem;" onclick="openModal('${m.id}')" title="Inspector">ⓘ</button>
              </div>
            </div>
          `;
        })
        .join("");
    }

    function renderCatalog() {
      updatePosterStatsUI();
      document.body.classList.toggle("home-mode", viewMode === "rows");
      document.getElementById("allTypesOption").textContent = `All Types (${library.length})`;
      const watchedTotal = library.filter((m) => m.status === "watched").length;
      document.getElementById("watchedCount").textContent = `${watchedTotal} watched`;

      const swimlanesEl = document.getElementById("swimlanesContainer");
      const gridEl = document.getElementById("movieGrid");
      const listEl = document.getElementById("movieList");

      if (viewMode === "rows") {
        swimlanesEl.style.display = "flex";
        gridEl.style.display = "none";
        if (listEl) listEl.style.display = "none";
        document.getElementById("resultCount").textContent = `${library.length} titles in vault`;
        renderSwimlanes();
      } else if (viewMode === "list") {
        swimlanesEl.style.display = "none";
        gridEl.style.display = "none";
        if (listEl) listEl.style.display = "block";
        renderList();
      } else {
        swimlanesEl.style.display = "none";
        gridEl.style.display = "grid";
        if (listEl) listEl.style.display = "none";
        renderGrid();
      }

      const resetBtn = document.getElementById("resetFiltersBtn");
      if (resetBtn) {
        resetBtn.style.display = hasActiveFilters() ? "inline-flex" : "none";
      }
      const kbdHint = document.getElementById("searchKbdHint");
      const searchVal = document.getElementById("searchInput").value.trim();
      if (kbdHint) {
        kbdHint.style.display = searchVal.length > 0 ? "none" : "inline-flex";
      }
    }

    function toggleWatchlist(id) {
      const item = library.find((entry) => entry.id === id);
      if (!item) return;
      const saved = { ...(userState[id] || {}) };
      const adding = !saved.watchlist;
      if (adding) {
        saved.watchlist = true;
        saved.watchlistAt = Date.now();
      } else {
        delete saved.watchlist;
        delete saved.watchlistAt;
      }
      userState[id] = saved;
      saveUserState();
      showToast(adding ? `Added ${item.title} to My List` : `Removed ${item.title} from My List`);
      if (viewMode === "rows") renderCatalog();
      const button = document.getElementById(`watchlistBtn-${id}`);
      if (button) {
        button.textContent = adding ? "✓ In My List" : "+ My List";
        button.classList.toggle("is-saved", adding);
      }
    }

    function openModal(id) {
      const m = library.find((item) => item.id === id);
      if (!m) return;
      const backdrop = document.getElementById("modalBackdrop");
      const content = document.getElementById("modalContent");

      content.innerHTML = `
        <div class="clean-detail">
          <button class="close-btn clean-detail-close" onclick="closeModal()" aria-label="Close">&times;</button>
          <div class="clean-detail-art">
            ${
              m.poster
                ? `<img class="modal-poster" src="${m.poster}" alt="${escapeHtml(m.title)}" />`
                : `<div class="poster-fallback" style="position:relative; aspect-ratio:2/3; border-radius:16px;"><span>${escapeHtml(m.title)}</span><small>${m.year}</small></div>`
            }
          </div>
          <div class="clean-detail-info">
            <div class="clean-detail-kicker">${m.type === "show" ? "TV / SPECIAL" : "MOVIE"}</div>
            <h2 class="clean-detail-title">${escapeHtml(m.title)}</h2>
            <div class="clean-detail-meta">
              <span>${m.year}</span>
              <span>${escapeHtml(m.genre || "Uncategorized")}</span>
              ${m.quality ? `<span>${escapeHtml(m.quality)}</span>` : ""}
              ${top10RatingCache[m.id]?.vote_average ? `<span class="clean-rating">★ ${Number(top10RatingCache[m.id].vote_average).toFixed(1)} TMDB</span>` : ""}
              ${m.status === "watched" ? `<span class="clean-watched">✓ Watched</span>` : ""}
            </div>
            ${m.description ? `<p class="clean-detail-desc">${escapeHtml(m.description)}</p>` : ""}
            <div class="clean-detail-actions">
              <button class="btn btn-ios-blue clean-play-btn" onclick="watchInSite('${m.id}')">▶ &nbsp;${m.status === "watching" ? "Resume" : "Play"}</button>
              <button class="btn clean-watchlist-btn ${userState[m.id]?.watchlist ? "is-saved" : ""}" id="watchlistBtn-${m.id}" onclick="toggleWatchlist('${m.id}')">${userState[m.id]?.watchlist ? "✓ In My List" : "+ My List"}</button>
              <button class="btn clean-more-btn" onclick="toggleMovieOptions('${m.id}')">More options</button>
            </div>
            <div class="clean-detail-options" id="movieOptions-${m.id}">
              <div class="field-group">
                <label>Watch Status</label>
                <div class="status-buttons">
                  ${["unwatched", "watching", "watched"].map((st) => `
                    <button class="status-opt ${m.status === st ? "active" : ""}" onclick="updateStatus('${m.id}', '${st}')">
                      ${st.charAt(0).toUpperCase() + st.slice(1)}
                    </button>
                  `).join("")}
                </div>
              </div>
              <div class="field-group">
                <label>Synopsis / Notes</label>
                <textarea id="customDescriptionInput" rows="2" placeholder="Add a short synopsis..." onchange="updateCustomDescription('${m.id}', this.value)">${escapeHtml(m.description || "")}</textarea>
              </div>
              <div class="field-group">
                <label>Google Drive URL</label>
                <input type="text" id="modalDriveUrlInput" value="${escapeHtml(m.driveUrl)}" placeholder="Google Drive video URL" onchange="handleModalDriveChange('${m.id}', this.value)" />
              </div>
              <div class="field-group">
                <label>Poster Artwork URL</label>
                <input type="text" id="customPosterInput" value="${escapeHtml(m.poster)}" placeholder="https://..." onchange="updateCustomPoster('${m.id}', this.value)" />
              </div>
              <div class="clean-option-actions">
                <button class="btn" onclick="refreshSinglePoster('${m.id}')">↻ Re-fetch Poster</button>
                <button class="btn" onclick="recheckSingleLink('${m.id}')">Test Link</button>
                <button class="btn btn-danger" onclick="promptDelete('${m.id}', event)">Delete Title</button>
              </div>
            </div>
          </div>
        </div>
      `;
      backdrop.classList.add("open");
    }

    function toggleMovieOptions(id) {
      const options = document.getElementById(`movieOptions-${id}`);
      const button = document.querySelector(`#movieOptions-${id}`)?.previousElementSibling?.querySelector(".clean-more-btn");
      if (!options) return;
      const isOpen = options.classList.toggle("open");
      if (button) button.textContent = isOpen ? "Hide options" : "More options";
    }

    async function handleModalDriveChange(id, rawVal) {
      if (!rawVal.trim()) return;
      const normalized = normalizeDriveUrl(rawVal);
      await updateItemDriveUrl(id, normalized);
      openModal(id);
      showToast("Saved updated Google Drive URL.");
    }

    async function recheckSingleLink(id) {
      const m = library.find((item) => item.id === id);
      if (!m) return;
      const result = await probeDriveFileThumbnail(m.driveUrl);
      linkHealth[id] = result;
      saveLinkHealth();
      updateFlaggedUI();
      renderCatalog();
      openModal(id);
      showToast(result === "flagged" ? "Link check failed (dead or restricted)." : "Link check passed!");
    }

    function closeModal() {
      document.getElementById("modalBackdrop").classList.remove("open");
    }

    function closeModalOnBackdrop(e) {
      if (e.target.id === "modalBackdrop") closeModal();
    }

    function updateStatus(id, newStatus) {
      const m = library.find((item) => item.id === id);
      if (!m) return;
      m.status = newStatus;
      userState[id] = { ...(userState[id] || {}), status: newStatus };
      if (newStatus === "watched") { delete userState[id].progress; delete userState[id].lastPlayed; }
      saveUserState();
      renderCatalog();
      openModal(id);
    }

    function updateCustomDescription(id, newDesc) {
      const m = library.find((item) => item.id === id);
      if (!m) return;
      const trimmed = newDesc.trim();
      m.description = trimmed;
      userState[id] = { ...(userState[id] || {}), customDescription: trimmed };
      saveUserState();

      const customRec = customItems.find((c) => c.id === id);
      if (customRec) {
        customRec.description = trimmed;
        saveCustomItems();
      }

      renderCatalog();
      if (spotlightItem && spotlightItem.id === id) renderSpotlight();
      showToast("Saved updated synopsis.");
    }

    function updateCustomPoster(id, newUrl) {
      const m = library.find((item) => item.id === id);
      if (!m) return;
      const trimmed = newUrl.trim();
      m.poster = trimmed;
      userState[id] = { ...(userState[id] || {}), customPoster: trimmed };
      saveUserState();
      renderCatalog();
      if (spotlightItem && spotlightItem.id === id) renderSpotlight();
      openModal(id);
    }

    async function refreshSinglePoster(id) {
      const m = library.find((item) => item.id === id);
      if (!m) return;
      const url = await fetchBestPoster(m);
      if (url) {
        m.poster = url;
        posterCache[id] = url;
        if (userState[id]) delete userState[id].customPoster;
        savePosterCache();
        saveUserState();
        renderCatalog();
        if (spotlightItem && spotlightItem.id === id) renderSpotlight();
        openModal(id);
      }
    }

    function exportUpdatedJson() {
      const blob = new Blob([JSON.stringify(library.map(dehydrateMovie))], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "cinevault_movies.json";
      a.click();
    }

    async function exportSelfContainedHtml() {
      const bakedMovies = library.map((m) => ({
        id: m.id,
        title: m.title,
        type: m.type,
        year: m.year,
        genre: m.genre,
        quality: m.quality,
        status: m.status,
        driveUrl: m.driveUrl,
        poster: m.poster || "",
        notes: m.notes || "",
        description: m.description || "",
        ...(m.addedAt ? { addedAt: m.addedAt } : {})
      }));

      try {
        // Fetch the modular source files so the downloaded copy remains genuinely self-contained.
        const [cssText, appText, featuresText] = await Promise.all([
          fetch(new URL("styles.css", document.baseURI)).then((r) => { if (!r.ok) throw new Error("styles.css"); return r.text(); }),
          fetch(new URL("app.js", document.baseURI)).then((r) => { if (!r.ok) throw new Error("app.js"); return r.text(); }),
          fetch(new URL("features.js", document.baseURI)).then((r) => { if (!r.ok) throw new Error("features.js"); return r.text(); })
        ]);

        const clone = document.documentElement.cloneNode(true);
        ["spotlight", "swimlanesContainer", "movieGrid", "movieList", "genreBar", "modalContent"].forEach((elId) => {
          const el = clone.querySelector("#" + elId);
          if (el) el.innerHTML = "";
        });
        clone.querySelectorAll(".open").forEach((el) => el.classList.remove("open"));
        const dot = clone.querySelector("#statusDot");
        if (dot) dot.classList.remove("done");
        const st = clone.querySelector("#statusText");
        if (st) st.textContent = "Syncing posters...";

        clone.querySelectorAll('link[rel="stylesheet"][href="styles.css"]').forEach((el) => el.remove());
        clone.querySelectorAll("script[src]").forEach((el) => el.remove());
        const style = document.createElement("style");
        style.textContent = cssText;
        clone.querySelector("head").appendChild(style);

        const serialized = JSON.stringify(bakedMovies, null, 2).replace(/<\/script/gi, "<\\/script");
        const embeddedData = "const RAW_MOVIES = " + serialized + ";";
        const safeScripts = [embeddedData, appText, featuresText].map((code) => {
          const script = document.createElement("script");
          script.textContent = code.replace(/<\/script/gi, "<\\/script");
          return script;
        });
        safeScripts.forEach((script) => clone.querySelector("body").appendChild(script));

        const docHtml = "<!DOCTYPE html>\n" + clone.outerHTML;
        const blob = new Blob([docHtml], { type: "text/html;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "cinevault-self-contained.html";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);

        const posterCount = bakedMovies.filter((m) => Boolean(m.poster)).length;
        showToast(`Saved self-contained HTML with ${posterCount}/${bakedMovies.length} posters baked in!`);
      } catch (error) {
        console.error("Self-contained export failed:", error);
        showToast("For self-contained export, open CineVault through its website (not file://).");
      }
    }

    function handleImportJson(event) {
      const file = event.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target.result);
          const importedList = Array.isArray(parsed) ? parsed : parsed.movies;
          if (!Array.isArray(importedList) || !importedList.length) {
            showToast("Invalid JSON format.");
            return;
          }

          const existingIds = new Set(library.map((m) => m.id));
          let addedCount = 0;

          for (const item of importedList) {
            if (!item.title || !item.driveUrl) continue;
            const id = item.id || generateNextId();
            if (existingIds.has(id)) continue;
            existingIds.add(id);

            const cleanItem = {
              id,
              title: String(item.title),
              type: item.type === "show" ? "show" : "movie",
              year: parseInt(item.year, 10) || 2024,
              genre: String(item.genre || "Action"),
              quality: String(item.quality || "HD"),
              status: ["unwatched", "watching", "watched"].includes(item.status) ? item.status : "unwatched",
              driveUrl: normalizeDriveUrl(String(item.driveUrl)),
              poster: String(item.poster || ""),
              notes: String(item.notes || ""),
              description: String(item.description || "")
            };

            customItems.push(cleanItem);
            library.push(cleanItem);
            addedCount++;
          }

          saveCustomItems();
          renderGenres();
          renderSpotlight();
          renderCatalog();
          showToast(`Imported ${addedCount} new title${addedCount === 1 ? "" : "s"}!`);
        } catch (err) {
          showToast("Could not parse JSON file.");
        }
        event.target.value = "";
      };
      reader.readAsText(file);
    }

    function escapeHtml(str) {
      return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") {
        e.preventDefault();
        document.getElementById("searchInput").focus();
      } else if (e.key === "Escape") {
        closeToolsMenu();
        if (document.getElementById("deleteBackdrop").classList.contains("open")) {
          closeDeleteModal();
        } else if (document.getElementById("addBackdrop").classList.contains("open")) {
          closeAddModal();
        } else if (document.getElementById("playerBackdrop").classList.contains("open")) {
          closePlayer();
        } else if (document.getElementById("modalBackdrop").classList.contains("open")) {
          closeModal();
        }
      }
    });

    // --- iOS Appearance (Dark / Light) & Filter Reset Helpers ---
    const THEME_CACHE_KEY = "cinevault_ios_theme_v1";

    function applyTheme(theme) {
      const isLight = theme === "light";
      document.body.classList.toggle("light-theme", isLight);
      const btn = document.getElementById("themeToggleBtn");
      if (btn) {
        btn.textContent = isLight ? "☾" : "☀︎";
        btn.title = isLight ? "Switch to iOS Dark Mode" : "Switch to iOS Light Mode";
      }
      try { localStorage.setItem(THEME_CACHE_KEY, theme); } catch (e) {}
    }

    function toggleTheme() {
      const isCurrentlyLight = document.body.classList.contains("light-theme");
      applyTheme(isCurrentlyLight ? "dark" : "light");
    }

    function toggleCompactContainer() {
      document.body.classList.toggle("compact-stage");
      const isCompact = document.body.classList.contains("compact-stage");
      showToast(isCompact ? "Reading Width: Compact" : "Reading Width: Full");
    }

    function resetAllFilters() {
      document.getElementById("searchInput").value = "";
      document.getElementById("searchClearBtn").classList.remove("visible");
      selectedGenre = "All";
      document.getElementById("typeFilter").value = "all";
      document.getElementById("statusFilter").value = "all";
      document.getElementById("qualityFilter").value = "all";
      document.getElementById("posterFilter").value = "all";
      document.getElementById("sortSelect").value = "default";
      setActiveTabUI("home");
      renderGenres();
      setViewMode("rows");
      showToast("All filters reset");
    }

    try {
      const savedTheme = localStorage.getItem(THEME_CACHE_KEY) || localStorage.getItem("cinevault_apple_theme_v1");
      if (savedTheme === "light" || savedTheme === "dark") {
        applyTheme(savedTheme);
      }
    } catch (e) {}

    // Initialize CineVault iOS Edition
    setTimeout(() => document.body.classList.remove("cv-booting"), 1800);
    updateFlaggedUI();
    renderGenres();
    renderSpotlight();
    renderCatalog();
    startFeaturedAutoShuffle();
    hydrateTop10Ratings();
    hydrateAllPosters(false);
    hydrateMissingDescriptions();
  