const STORAGE_KEY = "local-review-projects";

const state = {
  projects: [],
  activePath: null,
  selectedFile: null
};

const projectListEl = document.getElementById("project-list");
const filesListEl = document.getElementById("files-list");
const diffViewerEl = document.getElementById("diff-viewer");
const projectTitleEl = document.getElementById("project-title");
const projectMetaEl = document.getElementById("project-meta");
const projectSwitcherBtn = document.getElementById("project-switcher-btn");
const worktreeMenuEl = document.getElementById("worktree-menu");
const refreshBtn = document.getElementById("refresh-btn");
const commitBtn = document.getElementById("commit-btn");
const pullBtn = document.getElementById("pull-btn");
const pushBtn = document.getElementById("push-btn");
const prBtn = document.getElementById("pr-btn");
const openProjectForm = document.getElementById("open-project-form");
const projectPathInput = document.getElementById("project-path");
const projectSuggestionsEl = document.getElementById("project-suggestions");
const toast = document.getElementById("toast");

const menuBtn = document.getElementById("menu-btn");
const closeSidebarBtn = document.getElementById("close-sidebar-btn");
const sidebarOverlay = document.getElementById("sidebar-overlay");
const backToFilesBtn = document.getElementById("back-to-files-btn");
const filesCountEl = document.getElementById("files-count");
const diffFileNameEl = document.getElementById("diff-file-name");
const addAllBtn = document.getElementById("add-all-btn");
const incomingPillEl = document.getElementById("incoming-pill");
const outgoingSectionEl = document.getElementById("outgoing-section");
const outgoingToggleBtn = document.getElementById("outgoing-toggle-btn");
const outgoingCountEl = document.getElementById("outgoing-count");
const outgoingListEl = document.getElementById("outgoing-list");
const refreshOutgoingBtn = document.getElementById("refresh-outgoing-btn");
const prSectionEl = document.getElementById("pr-section");
const prToggleBtn = document.getElementById("pr-toggle-btn");
const prCountEl = document.getElementById("pr-count");
const prListEl = document.getElementById("pr-list");
const refreshPrsBtn = document.getElementById("refresh-prs-btn");

const suggestionState = {
  visible: false,
  selectedIndex: -1
};

const searchState = {
  filesystemMatches: [],
  loading: false,
  requestToken: 0,
  debounceId: null
};

const actionState = {
  staging: false,
  committing: false,
  pulling: false,
  pushing: false,
  creatingPr: false
};

const worktreeState = {
  visible: false,
  loading: false,
  switching: false,
  removing: false,
  removingPath: null,
  items: []
};

const prState = {
  loading: false,
  items: [],
  error: null,
  expanded: false
};

const outgoingState = {
  loading: false,
  items: [],
  error: null,
  expanded: false
};

const swipeConfig = {
  trigger: 84,
  maxOffset: 120,
  deadZone: 10
};

function isFileStaged(file) {
  if (typeof file.staged === "boolean") return file.staged;
  const xy = String(file.xy || "  ");
  return xy[0] !== " " && xy[0] !== "?";
}

function isFileUnstaged(file) {
  if (typeof file.unstaged === "boolean") return file.unstaged;
  const xy = String(file.xy || "  ");
  return xy[1] !== " ";
}

function getProjectStageStats(project) {
  if (!project || !project.changedFiles) return { stagedCount: 0, unstagedCount: 0 };
  let stagedCount = 0;
  let unstagedCount = 0;

  for (const file of project.changedFiles) {
    if (isFileStaged(file)) stagedCount += 1;
    if (isFileUnstaged(file) || file.xy === "??") unstagedCount += 1;
  }

  return { stagedCount, unstagedCount };
}

function setActionButtonsState() {
  const project = getActiveProject();
  const isGitProject = Boolean(project && project.isGit);
  const { stagedCount, unstagedCount } = getProjectStageStats(project);
  const behindCount = Number(project?.remote?.behind || 0);
  const aheadCount = Number(project?.remote?.ahead || 0);
  const hasUpstream = Boolean(project?.remote?.hasUpstream);
  const busy =
    actionState.staging ||
    actionState.committing ||
    actionState.pulling ||
    actionState.pushing ||
    actionState.creatingPr;

  refreshBtn.disabled = !project || busy;
  commitBtn.disabled = !isGitProject || stagedCount === 0 || busy;
  pullBtn.disabled = !isGitProject || behindCount < 1 || busy;
  pushBtn.disabled = !isGitProject || (hasUpstream && aheadCount < 1) || busy;
  prBtn.disabled = !isGitProject || busy;
  addAllBtn.disabled = !isGitProject || unstagedCount === 0 || busy;
}

function clamp(number, min, max) {
  return Math.min(max, Math.max(min, number));
}

function setSwipeOffset(element, offset) {
  element.style.setProperty("--swipe-offset", `${offset}px`);
  const hasOffset = Math.abs(offset) > 0;
  element.classList.toggle("swipe-revealed", hasOffset);
  element.classList.toggle("swipe-stage-active", offset > swipeConfig.deadZone);
  element.classList.toggle("swipe-unstage-active", offset < -swipeConfig.deadZone);
}

function resetSwipeOffset(element) {
  element.classList.remove("swipe-dragging");
  setSwipeOffset(element, 0);
}

function bindFileSwipe(fileElement, filePath, options) {
  const { canStage, canUnstage } = options;
  let pointerId = null;
  let startX = 0;
  let dragging = false;
  let offset = 0;

  fileElement.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    dragging = true;
    offset = 0;
    fileElement.classList.add("swipe-dragging");
    fileElement.setPointerCapture(pointerId);
  });

  fileElement.addEventListener("pointermove", (event) => {
    if (!dragging || pointerId !== event.pointerId) return;
    const delta = event.clientX - startX;

    if (delta > 0 && !canStage) {
      offset = clamp(delta * 0.25, 0, 26);
    } else if (delta < 0 && !canUnstage) {
      offset = clamp(delta * 0.25, -26, 0);
    } else {
      offset = clamp(delta, -swipeConfig.maxOffset, swipeConfig.maxOffset);
    }

    setSwipeOffset(fileElement, offset);
  });

  fileElement.addEventListener("pointerup", async (event) => {
    if (!dragging || pointerId !== event.pointerId) return;
    dragging = false;
    fileElement.releasePointerCapture(pointerId);
    pointerId = null;

    const shouldStage = offset >= swipeConfig.trigger && canStage;
    const shouldUnstage = offset <= -swipeConfig.trigger && canUnstage;
    const didSwipe = Math.abs(offset) > swipeConfig.deadZone;
    fileElement.dataset.suppressClick = didSwipe ? "true" : "false";

    if (shouldStage) {
      resetSwipeOffset(fileElement);
      await stageFile(filePath);
      return;
    }

    if (shouldUnstage) {
      resetSwipeOffset(fileElement);
      await unstageFile(filePath);
      return;
    }

    resetSwipeOffset(fileElement);
  });

  fileElement.addEventListener("pointercancel", () => {
    dragging = false;
    pointerId = null;
    fileElement.dataset.suppressClick = "false";
    resetSwipeOffset(fileElement);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setDiffMessage(msg) {
  diffViewerEl.innerHTML = `<span class="diff-line diff-context">${escapeHtml(msg)}</span>`;
}

function formatRelativeDate(isoValue) {
  if (!isoValue) return "";
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return "";

  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "updated now";
  if (minutes < 60) return `updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `updated ${days}d ago`;

  return `updated ${date.toLocaleDateString()}`;
}

function toGitHubAppUrl(webUrl) {
  try {
    const parsed = new URL(webUrl);
    if (!parsed.hostname.endsWith("github.com")) return null;
    return `github://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function openPrInBrowser(url) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function openPrPreferred(url) {
  const appUrl = toGitHubAppUrl(url);
  if (!appUrl) {
    openPrInBrowser(url);
    return;
  }

  let cancelled = false;
  let appSwitchDetected = false;
  let fallbackId = null;

  const cleanup = () => {
    document.removeEventListener("visibilitychange", cancelOnHidden);
    window.removeEventListener("pagehide", cancelOnHidden);
    window.removeEventListener("blur", cancelOnHidden);
  };

  const cancelFallback = () => {
    cancelled = true;
    if (fallbackId) {
      clearTimeout(fallbackId);
      fallbackId = null;
    }
    cleanup();
  };

  const cancelOnHidden = (event) => {
    if (event?.type === "blur" || event?.type === "pagehide") {
      appSwitchDetected = true;
      cancelFallback();
      return;
    }

    if (document.visibilityState === "visible") return;

    appSwitchDetected = true;
    cancelFallback();
  };

  fallbackId = setTimeout(() => {
    if (cancelled || appSwitchDetected) return;
    openPrInBrowser(url);
    cancelFallback();
  }, 1200);

  document.addEventListener("visibilitychange", cancelOnHidden);
  window.addEventListener("pagehide", cancelOnHidden);
  window.addEventListener("blur", cancelOnHidden);

  window.location.href = appUrl;
}

function setPrPanelExpanded(expanded) {
  prState.expanded = expanded;
  prSectionEl?.classList.toggle("expanded", expanded);
  prSectionEl?.classList.toggle("collapsed", !expanded);
  prToggleBtn?.setAttribute("aria-expanded", expanded ? "true" : "false");
}

function togglePrPanel() {
  setPrPanelExpanded(!prState.expanded);
}

function setOutgoingPanelExpanded(expanded) {
  outgoingState.expanded = expanded;
  outgoingSectionEl?.classList.toggle("expanded", expanded);
  outgoingSectionEl?.classList.toggle("collapsed", !expanded);
  outgoingToggleBtn?.setAttribute("aria-expanded", expanded ? "true" : "false");
}

function toggleOutgoingPanel() {
  setOutgoingPanelExpanded(!outgoingState.expanded);
}

function renderOutgoingList() {
  const project = getActiveProject();
  const isGitProject = Boolean(project && project.isGit);
  outgoingCountEl.textContent = String(outgoingState.items.length);

  refreshOutgoingBtn.disabled = !isGitProject || outgoingState.loading;

  if (!isGitProject) {
    outgoingListEl.className = "outgoing-list empty";
    outgoingListEl.textContent = "Select a git project to load outgoing commits.";
    return;
  }

  if (outgoingState.loading) {
    outgoingListEl.className = "outgoing-list empty";
    outgoingListEl.textContent = "Loading outgoing commits...";
    return;
  }

  if (outgoingState.error) {
    outgoingListEl.className = "outgoing-list empty";
    outgoingListEl.textContent = outgoingState.error;
    return;
  }

  if (!outgoingState.items.length) {
    outgoingListEl.className = "outgoing-list empty";
    outgoingListEl.textContent = "No outgoing commits for this project.";
    return;
  }

  outgoingListEl.className = "outgoing-list";
  outgoingListEl.innerHTML = outgoingState.items
    .map((item) => {
      const updated = formatRelativeDate(item.authoredAt);
      return `
        <div class="outgoing-item">
          <span class="outgoing-item-title">${escapeHtml(item.subject || "Untitled commit")}</span>
          <span class="outgoing-item-meta">${escapeHtml(item.shortHash || "")}${updated ? ` • ${escapeHtml(updated)}` : ""}</span>
        </div>
      `;
    })
    .join("");
}

async function loadOutgoingCommitsForActiveProject() {
  const project = getActiveProject();
  if (!project || !project.isGit) {
    outgoingState.items = [];
    outgoingState.error = null;
    renderOutgoingList();
    return;
  }

  outgoingState.loading = true;
  outgoingState.error = null;
  renderOutgoingList();

  try {
    const params = new URLSearchParams({ path: project.path });
    const response = await fetch(`/api/projects/outgoing-commits?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load outgoing commits.");

    outgoingState.items = payload.commits || [];
  } catch (error) {
    outgoingState.items = [];
    outgoingState.error = error.message;
  } finally {
    outgoingState.loading = false;
    renderOutgoingList();
  }
}

function renderPrList() {
  const project = getActiveProject();
  const isGitProject = Boolean(project && project.isGit);
  prCountEl.textContent = String(prState.items.length);
  if (prState.items.length > 0) {
    prSectionEl?.classList.remove("hidden");
  } else {
    prSectionEl?.classList.add("hidden");
  }

  refreshPrsBtn.disabled = !isGitProject || prState.loading;

  if (!isGitProject) {
    prListEl.className = "pr-list empty";
    prListEl.textContent = "Select a git project to load pull requests.";
    return;
  }

  if (prState.loading) {
    prListEl.className = "pr-list empty";
    prListEl.textContent = "Loading open pull requests...";
    return;
  }

  if (prState.error) {
    prListEl.className = "pr-list empty";
    prListEl.textContent = prState.error;
    return;
  }

  if (!prState.items.length) {
    prListEl.className = "pr-list empty";
    prListEl.textContent = "No open pull requests for this project.";
    return;
  }

  prListEl.className = "pr-list";
  prListEl.innerHTML = prState.items
    .map((item, index) => {
      const author = item.author && item.author.login ? `@${item.author.login}` : "unknown";
      const updated = formatRelativeDate(item.updatedAt);
      const branchMeta = `${item.headRefName || "?"} -> ${item.baseRefName || "?"}`;
      return `
        <div class="pr-item" data-pr-index="${index}" role="button" tabindex="0" aria-label="Open pull request ${escapeHtml(item.title || "Untitled")}">
          <div class="pr-item-top">
            <span class="pr-item-title">${escapeHtml(item.title || "Untitled")}</span>
            <span class="pr-item-number">#${escapeHtml(item.number || "")}</span>
          </div>
          <div class="pr-item-meta">${escapeHtml(branchMeta)}</div>
          <div class="pr-item-meta">${escapeHtml(author)} ${escapeHtml(updated)}</div>
        </div>
      `;
    })
    .join("");
}

async function loadOpenPrsForActiveProject() {
  const project = getActiveProject();
  if (!project || !project.isGit) {
    prState.items = [];
    prState.error = null;
    renderPrList();
    return;
  }

  prState.loading = true;
  prState.error = null;
  renderPrList();

  try {
    const params = new URLSearchParams({ path: project.path });
    const response = await fetch(`/api/projects/prs?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load pull requests.");

    prState.items = payload.prs || [];
  } catch (error) {
    prState.items = [];
    prState.error = error.message;
  } finally {
    prState.loading = false;
    renderPrList();
  }
}

function closeWorktreeMenu() {
  worktreeState.visible = false;
  worktreeMenuEl.classList.remove("visible");
  projectSwitcherBtn?.setAttribute("aria-expanded", "false");
}

function renderWorktreeMenu() {
  const project = getActiveProject();
  if (!project || !project.isGit || !worktreeState.visible) {
    worktreeMenuEl.innerHTML = "";
    closeWorktreeMenu();
    return;
  }

  if (worktreeState.loading) {
    worktreeMenuEl.innerHTML = '<div class="worktree-menu-empty">Loading worktrees...</div>';
    worktreeMenuEl.classList.add("visible");
    return;
  }

  if (!worktreeState.items.length) {
    worktreeMenuEl.innerHTML = '<div class="worktree-menu-empty">No worktrees found.</div>';
    worktreeMenuEl.classList.add("visible");
    return;
  }

  worktreeMenuEl.innerHTML = worktreeState.items
    .map((item, index) => {
      const removingThis = worktreeState.removing && worktreeState.removingPath === item.path;
      const protectedWorktree = item.current || item.branch === "main";
      return `
        <div class="worktree-item ${item.current ? "active" : ""}" role="option" aria-selected="${item.current ? "true" : "false"}">
          <button type="button" class="worktree-pick-btn" data-worktree-index="${index}">
            <strong>${escapeHtml(item.name)}</strong>
            <small>${escapeHtml(item.path)}</small>
            <span class="branch-pill">${escapeHtml(item.branch || "unknown")}</span>
          </button>
          ${
            protectedWorktree
              ? '<span class="worktree-protected-pill">Protected</span>'
              : `<button type="button" class="worktree-remove-btn" data-worktree-index="${index}" aria-label="Remove worktree ${escapeHtml(item.name)}" ${worktreeState.removing ? "disabled" : ""}>${
                  removingThis ? "Removing..." : "Remove"
                }</button>`
          }
        </div>
      `;
    })
    .join("");

  worktreeMenuEl.classList.add("visible");
}

async function loadWorktreesForActiveProject() {
  const project = getActiveProject();
  if (!project || !project.isGit) {
    worktreeState.items = [];
    return;
  }

  worktreeState.loading = true;
  renderWorktreeMenu();

  try {
    const params = new URLSearchParams({ path: project.path });
    const response = await fetch(`/api/projects/worktrees?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load worktrees.");
    worktreeState.items = payload.worktrees || [];
  } catch (error) {
    worktreeState.items = [];
    showToast(error.message, true);
  } finally {
    worktreeState.loading = false;
    renderWorktreeMenu();
  }
}

async function toggleWorktreeMenu() {
  const project = getActiveProject();
  if (!project || !project.isGit || worktreeState.switching || worktreeState.removing) return;

  if (worktreeState.visible) {
    closeWorktreeMenu();
    return;
  }

  worktreeState.visible = true;
  projectSwitcherBtn?.setAttribute("aria-expanded", "true");
  renderWorktreeMenu();
  await loadWorktreesForActiveProject();
}

async function switchToWorktree(index) {
  if (worktreeState.switching || worktreeState.removing) return;
  const picked = worktreeState.items[index];
  if (!picked || !picked.path) return;

  const existing = state.projects.find((project) => project.path === picked.path);
  worktreeState.switching = true;

  try {
    if (existing) {
      selectProject(picked.path);
      await refreshActiveProject();
    } else {
      await openProject(picked.path);
    }
    closeWorktreeMenu();
  } finally {
    worktreeState.switching = false;
  }
}

async function removeWorktree(index) {
  if (worktreeState.switching || worktreeState.removing) return;
  const picked = worktreeState.items[index];
  if (!picked || !picked.path || picked.current) return;
  if (picked.branch === "main") {
    showToast("Main worktree is protected and cannot be removed.", true);
    return;
  }

  const confirmed = window.confirm(
    `Remove worktree "${picked.name}"?\n\nBranch: ${picked.branch || "unknown"}\nPath: ${picked.path}\n\nThis permanently deletes the worktree directory from disk.`
  );
  if (!confirmed) return;

  const activeProjectPath = state.activePath;
  worktreeState.removing = true;
  worktreeState.removingPath = picked.path;
  renderWorktreeMenu();

  try {
    const response = await fetch("/api/projects/worktrees/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: activeProjectPath, worktreePath: picked.path })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not remove worktree.");

    worktreeState.items = payload.worktrees || [];
    state.projects = state.projects.filter((project) => project.path !== payload.removedPath);
    saveProjects();
    renderProjects();
    renderProjectDetails();
    showToast(`Removed ${picked.name}`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    worktreeState.removing = false;
    worktreeState.removingPath = null;
    renderWorktreeMenu();
  }
}

function getFilteredProjects(query) {
  const term = query.trim().toLowerCase();
  if (!term) return state.projects;

  return state.projects.filter((project) => {
    return project.path.toLowerCase().includes(term) || project.name.toLowerCase().includes(term);
  });
}

function getProjectSuggestions(query) {
  const deduped = new Map();

  getFilteredProjects(query).forEach((project) => {
    deduped.set(project.path, {
      name: project.name,
      path: project.path,
      source: "recent"
    });
  });

  searchState.filesystemMatches.forEach((project) => {
    if (!deduped.has(project.path)) {
      deduped.set(project.path, {
        name: project.name,
        path: project.path,
        source: "filesystem"
      });
    }
  });

  return Array.from(deduped.values());
}

async function fetchFilesystemMatches(query, token) {
  try {
    const params = new URLSearchParams({ query });
    const response = await fetch(`/api/projects/search?${params.toString()}`);
    const payload = await response.json();

    if (!response.ok || token !== searchState.requestToken) {
      return;
    }

    searchState.filesystemMatches = payload.matches || [];
  } catch {
    if (token === searchState.requestToken) {
      searchState.filesystemMatches = [];
    }
  } finally {
    if (token === searchState.requestToken) {
      searchState.loading = false;
      if (suggestionState.visible) {
        renderProjectSuggestions();
      }
    }
  }
}

function scheduleFilesystemSearch() {
  const query = projectPathInput.value.trim();
  const token = ++searchState.requestToken;

  if (searchState.debounceId) {
    clearTimeout(searchState.debounceId);
  }

  searchState.loading = true;
  renderProjectSuggestions();

  searchState.debounceId = setTimeout(async () => {
    await fetchFilesystemMatches(query, token);
  }, 140);
}

function closeProjectSuggestions() {
  suggestionState.visible = false;
  suggestionState.selectedIndex = -1;
  searchState.loading = false;
  searchState.requestToken += 1;
  if (searchState.debounceId) {
    clearTimeout(searchState.debounceId);
    searchState.debounceId = null;
  }
  projectSuggestionsEl.classList.remove("visible");
  projectSuggestionsEl.innerHTML = "";
}

function renderProjectSuggestions() {
  const matches = getProjectSuggestions(projectPathInput.value);

  if (!suggestionState.visible) {
    closeProjectSuggestions();
    return;
  }

  if (suggestionState.selectedIndex >= matches.length) {
    suggestionState.selectedIndex = matches.length - 1;
  }

  if (!matches.length && !searchState.loading) {
    projectSuggestionsEl.innerHTML = '<div class="project-suggestions-empty">No git projects found.</div>';
    projectSuggestionsEl.classList.add("visible");
    return;
  }

  const listMarkup = matches
    .map((project, index) => {
      const selectedClass = index === suggestionState.selectedIndex ? "selected" : "";
      const sourceLabel = project.source === "recent" ? "Recent" : "Git";
      return `
        <button
          type="button"
          class="project-suggestion-item ${selectedClass}"
          data-index="${index}"
          role="option"
          aria-selected="${index === suggestionState.selectedIndex ? "true" : "false"}"
        >
          <span class="project-suggestion-top">
            <strong>${escapeHtml(project.name)}</strong>
            <span class="suggestion-source">${sourceLabel}</span>
          </span>
          <small>${escapeHtml(project.path)}</small>
        </button>
      `;
    })
    .join("");

  const loadingMarkup = searchState.loading
    ? '<div class="project-suggestions-loading">Searching git projects...</div>'
    : "";

  projectSuggestionsEl.innerHTML = `${listMarkup}${loadingMarkup}`;

  projectSuggestionsEl.classList.add("visible");
}

function showProjectSuggestions() {
  suggestionState.visible = true;
  suggestionState.selectedIndex = -1;
  scheduleFilesystemSearch();
  renderProjectSuggestions();
}

async function chooseProjectSuggestion(index) {
  const matches = getProjectSuggestions(projectPathInput.value);
  const picked = matches[index];
  if (!picked) return;

  closeProjectSuggestions();
  await openProject(picked.path);
}

function saveProjects() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.projects));
}

function loadProjects() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state.projects = raw ? JSON.parse(raw) : [];
  } catch {
    state.projects = [];
  }
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.className = `toast visible${isError ? " error" : ""}`;
  setTimeout(() => {
    toast.className = "toast";
  }, 2000);
}

function getActiveProject() {
  return state.projects.find((project) => project.path === state.activePath) || null;
}

function renderProjects() {
  if (!state.projects.length) {
    projectListEl.innerHTML = "<p>No opened projects yet.</p>";
    return;
  }

  projectListEl.innerHTML = state.projects
    .map((project) => {
      const isActive = project.path === state.activePath;
      const dirtyCount = project.changedFiles.length;
      const incomingCount = Number(project.remote?.behind || 0);
      const incomingText = incomingCount > 0 ? ` • ↓ ${incomingCount}` : "";
      return `
        <button class="project-item ${isActive ? "active" : ""}" data-path="${project.path}">
          <strong>${project.name}</strong>
          <small>${project.path}</small>
          <small>${project.isGit ? `${dirtyCount} changed file(s)${incomingText}` : "Not a git repository"}</small>
        </button>
      `;
    })
    .join("");

  document.querySelectorAll(".project-item").forEach((button) => {
    button.addEventListener("click", () => {
      const path = button.dataset.path;
      selectProject(path);
    });
  });

  if (document.activeElement === projectPathInput && suggestionState.visible) {
    renderProjectSuggestions();
  }
}

function renderProjectDetails() {
  const project = getActiveProject();

  if (!project) {
    projectTitleEl.textContent = "No project";
    projectMetaEl.textContent = "Open a project to start";
    incomingPillEl.textContent = "";
    incomingPillEl.classList.add("hidden");
    projectSwitcherBtn.disabled = true;
    closeWorktreeMenu();
    filesListEl.className = "files-list empty";
    filesListEl.textContent = "No data yet.";
    setDiffMessage("Pick a file to inspect its diff.");
    setActionButtonsState();
    filesCountEl.textContent = "0";
    diffFileNameEl.textContent = "Select a file";
    document.body.classList.remove("viewing-diff");
    prState.items = [];
    prState.error = null;
    prSectionEl?.classList.add("hidden");
    outgoingState.items = [];
    outgoingState.error = null;
    outgoingSectionEl?.classList.add("hidden");
    renderOutgoingList();
    renderPrList();
    return;
  }

  setActionButtonsState();
  projectSwitcherBtn.disabled = !project.isGit;
  projectTitleEl.textContent = `${project.name}${project.isGit && project.branch ? ` (${project.branch})` : ""}`;
  projectMetaEl.textContent = project.path;
  const incomingCount = Number(project.remote?.behind || 0);
  const outgoingCount = Number(project.remote?.ahead || 0);
  if (project.isGit && incomingCount > 0) {
    incomingPillEl.textContent = `↓ ${incomingCount}`;
    incomingPillEl.classList.remove("hidden");
  } else {
    incomingPillEl.textContent = "";
    incomingPillEl.classList.add("hidden");
  }
  if (project.isGit && outgoingCount > 0) {
    outgoingSectionEl?.classList.remove("hidden");
  } else {
    outgoingSectionEl?.classList.add("hidden");
  }
  filesCountEl.textContent = project.changedFiles ? project.changedFiles.length : "0";

  let statusText = "Select a file";
  if (state.selectedFile) {
    statusText = state.selectedFile;
  }
  diffFileNameEl.textContent = statusText;

  if (!project.isGit) {
    filesListEl.className = "files-list empty";
    filesListEl.textContent = "This folder is not a git repository.";
    setDiffMessage("No diff available.");
    setActionButtonsState();
    prSectionEl?.classList.add("hidden");
    outgoingSectionEl?.classList.add("hidden");
    return;
  }

  if (!project.changedFiles.length) {
    filesListEl.className = "files-list empty";
    filesListEl.textContent = "Working tree is clean.";
    setDiffMessage("No local changes found.");
    setActionButtonsState();
    return;
  }

  filesListEl.className = "files-list";
  filesListEl.innerHTML = project.changedFiles
    .map((item, index) => {
      const isActive = state.selectedFile === item.file;
      const statusClass = `status-${item.status[0].toLowerCase()}`; // A, M, D etc -> status-a
      const staged = isFileStaged(item);
      const unstaged = isFileUnstaged(item) || item.xy === "??";
      const stageLabel = staged && unstaged ? "staged+unstaged" : staged ? "staged" : "unstaged";
      return `
        <div
          class="file-item ${isActive ? "active" : ""} ${staged ? "can-unstage" : ""} ${unstaged ? "can-stage" : ""}"
          data-file-index="${index}"
          role="button"
          tabindex="0"
        >
          <div class="file-item-swipe-bg" aria-hidden="true">
            <span class="swipe-hint swipe-hint-stage">Stage</span>
            <span class="swipe-hint swipe-hint-unstage">Unstage</span>
          </div>
          <div class="file-item-content">
            <span class="path">${item.file}</span>
            <span class="file-item-right">
              <span class="status ${statusClass}">${item.status}</span>
              <span class="stage-pill">${stageLabel}</span>
            </span>
          </div>
        </div>
      `;
    })
    .join("");

  document.querySelectorAll(".file-item").forEach((button) => {
    const index = Number(button.dataset.fileIndex);
    const item = getActiveProject()?.changedFiles?.[index];
    const canStage = Boolean(item && (isFileUnstaged(item) || item.xy === "??"));
    const canUnstage = Boolean(item && isFileStaged(item));

    if (item) {
      bindFileSwipe(button, item.file, { canStage, canUnstage });
    }

    button.addEventListener("click", async () => {
      if (button.dataset.suppressClick === "true") {
        button.dataset.suppressClick = "false";
        return;
      }
      const file = getActiveProject()?.changedFiles?.[index]?.file;
      if (!file) return;
      document.body.classList.add("viewing-diff");
      await openDiff(file);
    });

    button.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const index = Number(button.dataset.fileIndex);
      const file = getActiveProject()?.changedFiles?.[index]?.file;
      if (!file) return;
      document.body.classList.add("viewing-diff");
      await openDiff(file);
    });
  });
}

async function openDiff(file) {
  const project = getActiveProject();
  if (!project) return;

  try {
    state.selectedFile = file;
    renderProjectDetails();
    setDiffMessage("Loading diff...");

    const params = new URLSearchParams({ path: project.path, file });
    const response = await fetch(`/api/projects/diff?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load diff.");

    const lines = payload.diff.replace(/\r\n/g, '\n').split('\n');
    let htmlLines = [];
    for (const line of lines) {
      if (line.startsWith('+++') || line.startsWith('---')) {
        htmlLines.push(`<span class="diff-line diff-header-line">${escapeHtml(line)}</span>`);
      } else if (line.startsWith('+')) {
        htmlLines.push(`<span class="diff-line diff-added">${escapeHtml(line)}</span>`);
      } else if (line.startsWith('-')) {
        htmlLines.push(`<span class="diff-line diff-removed">${escapeHtml(line)}</span>`);
      } else if (line.startsWith('@@')) {
        htmlLines.push(`<span class="diff-line diff-chunk">${escapeHtml(line)}</span>`);
      } else {
        htmlLines.push(`<span class="diff-line diff-context">${escapeHtml(line)}</span>`);
      }
    }
    diffViewerEl.innerHTML = htmlLines.join('\n');
  } catch (error) {
    showToast(error.message, true);
    setDiffMessage("Could not load diff.");
  }
}

async function refreshActiveProject() {
  const project = getActiveProject();
  if (!project) return;

  try {
    const params = new URLSearchParams({ path: project.path });
    const response = await fetch(`/api/projects/changes?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not refresh project.");

    state.projects = state.projects.map((p) => (p.path === payload.path ? payload : p));
    saveProjects();

    if (state.selectedFile && !payload.changedFiles.some((f) => f.file === state.selectedFile)) {
      state.selectedFile = null;
      setDiffMessage("Pick a file to inspect its diff.");
    }

    renderProjects();
    renderProjectDetails();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function stageFile(file) {
  const project = getActiveProject();
  if (
    !project ||
    !project.isGit ||
    actionState.staging ||
    actionState.committing ||
    actionState.pulling ||
    actionState.pushing
  )
    return;
  if (!file) return;

  actionState.staging = true;
  setActionButtonsState();

  try {
    const response = await fetch("/api/projects/stage-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: project.path, file })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not stage file.");

    state.projects = state.projects.map((p) => (p.path === payload.path ? payload.snapshot : p));
    saveProjects();
    renderProjects();
    renderProjectDetails();
    showToast(`Added ${file}`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    actionState.staging = false;
    setActionButtonsState();
  }
}

async function unstageFile(file) {
  const project = getActiveProject();
  if (
    !project ||
    !project.isGit ||
    actionState.staging ||
    actionState.committing ||
    actionState.pulling ||
    actionState.pushing
  )
    return;
  if (!file) return;

  actionState.staging = true;
  setActionButtonsState();

  try {
    const response = await fetch("/api/projects/unstage-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: project.path, file })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not unstage file.");

    state.projects = state.projects.map((p) => (p.path === payload.path ? payload.snapshot : p));
    saveProjects();
    renderProjects();
    renderProjectDetails();
    showToast(`Unstaged ${file}`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    actionState.staging = false;
    setActionButtonsState();
  }
}

async function stageAllActiveProject() {
  const project = getActiveProject();
  if (
    !project ||
    !project.isGit ||
    actionState.staging ||
    actionState.committing ||
    actionState.pulling ||
    actionState.pushing
  )
    return;

  actionState.staging = true;
  setActionButtonsState();

  try {
    const response = await fetch("/api/projects/stage-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: project.path })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not stage changes.");

    state.projects = state.projects.map((p) => (p.path === payload.path ? payload.snapshot : p));
    saveProjects();
    renderProjects();
    renderProjectDetails();
    showToast("Added all files");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    actionState.staging = false;
    setActionButtonsState();
  }
}

async function commitActiveProject() {
  const project = getActiveProject();
  if (!project || !project.isGit || actionState.committing || actionState.pulling || actionState.pushing) return;

  const message = window.prompt("Commit message:");
  if (message === null) return;
  const cleanMessage = message.trim();
  if (!cleanMessage) {
    showToast("Commit message is required.", true);
    return;
  }

  actionState.committing = true;
  setActionButtonsState();

  try {
    const response = await fetch("/api/projects/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: project.path, message: cleanMessage })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not commit changes.");

    state.projects = state.projects.map((p) => (p.path === payload.path ? payload.snapshot : p));
    saveProjects();
    state.selectedFile = null;
    setDiffMessage("Pick a file to inspect its diff.");
    renderProjects();
    renderProjectDetails();
    showToast(`Committed ${payload.hash}`);
    void loadOutgoingCommitsForActiveProject();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    actionState.committing = false;
    setActionButtonsState();
  }
}

async function pushActiveProject() {
  const project = getActiveProject();
  if (
    !project ||
    !project.isGit ||
    actionState.committing ||
    actionState.pulling ||
    actionState.pushing ||
    actionState.creatingPr
  )
    return;
  const aheadCount = Number(project.remote?.ahead || 0);
  const hasUpstream = Boolean(project.remote?.hasUpstream);
  if (hasUpstream && aheadCount < 1) {
    showToast("Nothing to push.");
    return;
  }

  actionState.pushing = true;
  setActionButtonsState();

  try {
    const response = await fetch("/api/projects/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: project.path })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not push changes.");

    state.projects = state.projects.map((p) => (p.path === payload.path ? payload.snapshot : p));
    saveProjects();
    renderProjects();
    renderProjectDetails();
    showToast(`Pushed ${payload.branch}`);
    void loadOutgoingCommitsForActiveProject();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    actionState.pushing = false;
    setActionButtonsState();
  }
}

async function createPrForActiveProject() {
  const project = getActiveProject();
  if (
    !project ||
    !project.isGit ||
    actionState.committing ||
    actionState.pulling ||
    actionState.pushing ||
    actionState.creatingPr
  )
    return;

  const title = window.prompt("PR title:");
  if (title === null) return;

  const cleanTitle = title.trim();
  if (!cleanTitle) {
    showToast("PR title is required.", true);
    return;
  }

  const bodyInput = window.prompt("PR description (optional):", "");
  if (bodyInput === null) return;
  const body = bodyInput.trim();

  actionState.creatingPr = true;
  setActionButtonsState();

  try {
    const response = await fetch("/api/projects/pr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: project.path, title: cleanTitle, body })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not create pull request.");

    if (payload.url) {
      openPrPreferred(payload.url);
      showToast("PR created and opened.");
    } else {
      showToast("PR created.");
    }
    void loadOpenPrsForActiveProject();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    actionState.creatingPr = false;
    setActionButtonsState();
  }
}

async function pullActiveProject() {
  const project = getActiveProject();
  if (!project || !project.isGit || actionState.committing || actionState.pulling || actionState.pushing) return;
  const behindCount = Number(project.remote?.behind || 0);
  if (behindCount < 1) {
    showToast("Already up to date.");
    return;
  }

  actionState.pulling = true;
  setActionButtonsState();

  try {
    const response = await fetch("/api/projects/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: project.path })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not pull changes.");

    state.projects = state.projects.map((p) => (p.path === payload.path ? payload.snapshot : p));
    saveProjects();
    renderProjects();
    renderProjectDetails();
    showToast(`Pulled ${payload.branch}`);
    void loadOutgoingCommitsForActiveProject();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    actionState.pulling = false;
    setActionButtonsState();
  }
}

function selectProject(projectPath) {
  state.activePath = projectPath;
  state.selectedFile = null;
  closeWorktreeMenu();
  setDiffMessage("Pick a file to inspect its diff.");
  document.body.classList.remove("show-sidebar");
  document.body.classList.remove("viewing-diff");
  renderProjects();
  renderProjectDetails();
  void refreshActiveProject();
  void loadOutgoingCommitsForActiveProject();
  void loadOpenPrsForActiveProject();
}

async function openProject(projectPath) {
  const cleanPath = projectPath.trim();
  if (!cleanPath) return;

  try {
    const response = await fetch("/api/projects/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: cleanPath })
    });

    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not open project.");

    const existing = state.projects.find((project) => project.path === payload.path);
    if (existing) {
      Object.assign(existing, payload);
    } else {
      state.projects.unshift(payload);
    }

    saveProjects();
    selectProject(payload.path);
    projectPathInput.value = "";
    showToast(`Opened ${payload.name}`);
  } catch (error) {
    showToast(error.message, true);
  }
}

openProjectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  closeProjectSuggestions();
  await openProject(projectPathInput.value);
});

projectPathInput.addEventListener("focus", () => {
  showProjectSuggestions();
});

projectPathInput.addEventListener("input", () => {
  showProjectSuggestions();
});

projectPathInput.addEventListener("keydown", async (event) => {
  if (!suggestionState.visible) return;

  const matches = getProjectSuggestions(projectPathInput.value);
  if (!matches.length) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    suggestionState.selectedIndex = (suggestionState.selectedIndex + 1) % matches.length;
    renderProjectSuggestions();
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    suggestionState.selectedIndex =
      suggestionState.selectedIndex <= 0 ? matches.length - 1 : suggestionState.selectedIndex - 1;
    renderProjectSuggestions();
    return;
  }

  if (event.key === "Escape") {
    closeProjectSuggestions();
    return;
  }

  if (event.key === "Enter" && suggestionState.selectedIndex >= 0) {
    event.preventDefault();
    await chooseProjectSuggestion(suggestionState.selectedIndex);
  }
});

projectPathInput.addEventListener("blur", () => {
  setTimeout(() => {
    if (!projectSuggestionsEl.matches(":hover")) {
      closeProjectSuggestions();
    }
  }, 120);
});

projectSuggestionsEl.addEventListener("mousedown", (event) => {
  event.preventDefault();
});

projectSuggestionsEl.addEventListener("click", async (event) => {
  const button = event.target.closest(".project-suggestion-item");
  if (!button) return;

  const index = Number(button.dataset.index);
  await chooseProjectSuggestion(index);
});

refreshBtn.addEventListener("click", async () => {
  await refreshActiveProject();
  await loadOutgoingCommitsForActiveProject();
  await loadOpenPrsForActiveProject();
});

commitBtn.addEventListener("click", async () => {
  await commitActiveProject();
});

pushBtn.addEventListener("click", async () => {
  await pushActiveProject();
  await loadOpenPrsForActiveProject();
});

pullBtn.addEventListener("click", async () => {
  await pullActiveProject();
  await loadOpenPrsForActiveProject();
});

prBtn.addEventListener("click", async () => {
  await createPrForActiveProject();
});

refreshOutgoingBtn?.addEventListener("click", async () => {
  await loadOutgoingCommitsForActiveProject();
});

outgoingToggleBtn?.addEventListener("click", async () => {
  toggleOutgoingPanel();
  if (outgoingState.expanded && !outgoingState.loading && !outgoingState.items.length && !outgoingState.error) {
    await loadOutgoingCommitsForActiveProject();
  }
});

refreshPrsBtn?.addEventListener("click", async () => {
  await loadOpenPrsForActiveProject();
});

prToggleBtn?.addEventListener("click", async () => {
  togglePrPanel();
  if (prState.expanded && !prState.loading && !prState.items.length && !prState.error) {
    await loadOpenPrsForActiveProject();
  }
});

prListEl?.addEventListener("click", (event) => {
  const card = event.target.closest(".pr-item[data-pr-index]");
  if (!card) return;

  const index = Number(card.dataset.prIndex);
  const item = prState.items[index];
  if (!item || !item.url) return;

  openPrPreferred(item.url);
});

prListEl?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest(".pr-item[data-pr-index]");
  if (!card) return;

  event.preventDefault();
  const index = Number(card.dataset.prIndex);
  const item = prState.items[index];
  if (!item || !item.url) return;

  openPrPreferred(item.url);
});

addAllBtn.addEventListener("click", async () => {
  await stageAllActiveProject();
});

projectSwitcherBtn?.addEventListener("click", async () => {
  await toggleWorktreeMenu();
});

worktreeMenuEl?.addEventListener("click", async (event) => {
  const removeButton = event.target.closest(".worktree-remove-btn");
  if (removeButton) {
    const index = Number(removeButton.dataset.worktreeIndex);
    await removeWorktree(index);
    return;
  }

  const pickButton = event.target.closest(".worktree-pick-btn");
  if (!pickButton) return;
  const index = Number(pickButton.dataset.worktreeIndex);
  await switchToWorktree(index);
});

document.addEventListener("click", (event) => {
  if (!worktreeState.visible) return;
  if (projectSwitcherBtn?.contains(event.target) || worktreeMenuEl?.contains(event.target)) return;
  closeWorktreeMenu();
});

function init() {
  loadProjects();
  renderProjects();
  setActionButtonsState();
  setOutgoingPanelExpanded(false);
  setPrPanelExpanded(false);
  renderOutgoingList();
  renderPrList();

  if (state.projects.length) {
    selectProject(state.projects[0].path);
  } else {
    renderProjectDetails();
  }
}

// Mobile and layout interactivity bindings
menuBtn?.addEventListener("click", () => {
  document.body.classList.add("show-sidebar");
});

closeSidebarBtn?.addEventListener("click", () => {
  document.body.classList.remove("show-sidebar");
});

sidebarOverlay?.addEventListener("click", () => {
  document.body.classList.remove("show-sidebar");
});

backToFilesBtn?.addEventListener("click", () => {
  document.body.classList.remove("viewing-diff");
  state.selectedFile = null;
  renderProjectDetails();
});

init();
