const STORAGE_KEY = "local-review-projects";

const state = {
  projects: [],
  activePath: null,
  selectedFile: null
};

const projectListEl = document.getElementById("project-list");
const sidebarEl = document.getElementById("sidebar");
const mainContentEl = document.querySelector(".main-content");
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
const changeProjectIconBtn = document.getElementById("change-project-icon-btn");
const projectIconInput = document.getElementById("project-icon-input");
const addSavedProjectBtn = document.getElementById("add-saved-project-btn");

const menuBtn = document.getElementById("menu-btn");
const closeSidebarBtn = document.getElementById("close-sidebar-btn");
const sidebarOverlay = document.getElementById("sidebar-overlay");
const backToFilesBtn = document.getElementById("back-to-files-btn");
const filesCountEl = document.getElementById("files-count");
const diffFileNameEl = document.getElementById("diff-file-name");
const addAllBtn = document.getElementById("add-all-btn");
const incomingPillEl = document.getElementById("incoming-pill");
const pullRefreshIndicatorEl = document.getElementById("pull-refresh-indicator");
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
const runSectionEl = document.getElementById("run-section");
const runToggleBtn = document.getElementById("run-toggle-btn");
const runCountEl = document.getElementById("run-count");
const runListEl = document.getElementById("run-list");
const addRunWorktreeBtn = document.getElementById("add-run-worktree-btn");
const addRunDefaultBtn = document.getElementById("add-run-default-btn");
const refreshRunsBtn = document.getElementById("refresh-runs-btn");
const runProfileModalEl = document.getElementById("run-profile-modal");
const runProfileNameInput = document.getElementById("run-profile-name");
const runProfileCommandsInput = document.getElementById("run-profile-commands");
const runProfileCancelBtn = document.getElementById("run-profile-cancel-btn");
const runProfileSaveBtn = document.getElementById("run-profile-save-btn");
const runLogModalEl = document.getElementById("run-log-modal");
const runLogModalTitleEl = document.getElementById("run-log-modal-title");
const runLogModalContentEl = document.getElementById("run-log-modal-content");
const runLogCloseBtn = document.getElementById("run-log-close-btn");
const commitDraftModalEl = document.getElementById("commit-draft-modal");
const commitDraftStatusEl = document.getElementById("commit-draft-status");
const commitDraftSummaryEl = document.getElementById("commit-draft-summary");
const commitDraftMessageInput = document.getElementById("commit-draft-message");
const commitDraftCancelBtn = document.getElementById("commit-draft-cancel-btn");
const commitDraftRefreshBtn = document.getElementById("commit-draft-refresh-btn");
const commitDraftCommitBtn = document.getElementById("commit-draft-commit-btn");

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
  creatingPr: false,
  generatingCommitDraft: false
};

const commitDraftState = {
  open: false,
  summary: [],
  message: "",
  error: null,
  files: []
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

const runState = {
  loadingProfiles: false,
  loadingStatus: false,
  expanded: false,
  projectKey: null,
  defaultGroups: [],
  worktreeGroups: [],
  effectiveGroups: [],
  runsByGroupId: {},
  logCursorByGroupId: {},
  latestLogByGroupId: {},
  logLinesByGroupId: {},
  activeLogGroupId: null,
  pendingCreateScope: null,
  pollId: null
};

const swipeConfig = {
  trigger: 84,
  maxOffset: 120,
  deadZone: 10
};

const pullRefreshState = {
  tracking: false,
  refreshing: false,
  startY: 0,
  distance: 0,
  sourceEl: null,
  trigger: 72,
  maxDistance: 108
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
    actionState.creatingPr ||
    actionState.generatingCommitDraft;

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

function isMobileLayout() {
  return window.matchMedia("(max-width: 980px)").matches;
}

function lockBodyScroll() {
  if (!isMobileLayout() || document.body.classList.contains("sidebar-scroll-locked")) return;
  const scrollY = window.scrollY || window.pageYOffset || 0;
  document.body.dataset.scrollY = String(scrollY);
  document.body.style.position = "fixed";
  document.body.style.top = `-${scrollY}px`;
  document.body.style.left = "0";
  document.body.style.right = "0";
  document.body.style.width = "100%";
  document.body.classList.add("sidebar-scroll-locked");
}

function unlockBodyScroll() {
  if (!document.body.classList.contains("sidebar-scroll-locked")) return;
  const savedY = Number(document.body.dataset.scrollY || 0);
  document.body.classList.remove("sidebar-scroll-locked");
  delete document.body.dataset.scrollY;
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.right = "";
  document.body.style.width = "";
  window.scrollTo(0, savedY);
}

function openSidebar() {
  document.body.classList.add("show-sidebar");
  lockBodyScroll();
}

function closeSidebar() {
  document.body.classList.remove("show-sidebar");
  closeProjectPicker();
  unlockBodyScroll();
}

function getActivePullSource(target) {
  if (document.body.classList.contains("show-sidebar")) return null;

  const filesPanelContent = document.querySelector("#files-panel .panel-content");
  const diffPanelContent = document.querySelector("#diff-panel .diff-content");
  const inDiffView = document.body.classList.contains("viewing-diff");

  if (inDiffView) {
    if (!diffPanelContent || !target.closest("#diff-panel")) return null;
    return diffPanelContent;
  }

  if (!filesPanelContent || !target.closest("#files-panel")) return null;
  return filesPanelContent;
}

function renderPullRefreshIndicator() {
  if (!pullRefreshIndicatorEl) return;
  const distance = pullRefreshState.distance;
  const visible = pullRefreshState.tracking || pullRefreshState.refreshing;

  pullRefreshIndicatorEl.classList.toggle("visible", visible);
  pullRefreshIndicatorEl.classList.toggle("tracking", pullRefreshState.tracking);
  pullRefreshIndicatorEl.classList.toggle("ready", distance >= pullRefreshState.trigger && !pullRefreshState.refreshing);
  pullRefreshIndicatorEl.classList.toggle("refreshing", pullRefreshState.refreshing);
  mainContentEl?.classList.toggle("pull-refresh-tracking", pullRefreshState.tracking);
  mainContentEl?.classList.toggle("pull-refresh-active", visible);
}

function setPullRefreshDistance(distance) {
  if (!mainContentEl) return;
  mainContentEl.style.setProperty("--pull-refresh-distance", `${distance}px`);
}

function resetPullRefreshState() {
  pullRefreshState.tracking = false;
  pullRefreshState.startY = 0;
  pullRefreshState.distance = 0;
  pullRefreshState.sourceEl = null;
  setPullRefreshDistance(0);
  renderPullRefreshIndicator();
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

function setRunPanelExpanded(expanded) {
  runState.expanded = expanded;
  runSectionEl?.classList.toggle("expanded", expanded);
  runSectionEl?.classList.toggle("collapsed", !expanded);
  runToggleBtn?.setAttribute("aria-expanded", expanded ? "true" : "false");
}

function toggleRunPanel() {
  setRunPanelExpanded(!runState.expanded);
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

function getRunSourceLabel(groupId) {
  void groupId;
  return "shared";
}

function decodeDataId(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function hasExpandedRunLogs() {
  return Boolean(runState.activeLogGroupId);
}

function renderRunProfiles() {
  const project = getActiveProject();
  const isGitProject = Boolean(project && project.isGit);
  const groupCount = runState.effectiveGroups.length;
  runCountEl.textContent = String(groupCount);

  const busy = runState.loadingProfiles || runState.loadingStatus;
  refreshRunsBtn.disabled = !isGitProject || busy;
  addRunWorktreeBtn.disabled = !isGitProject || busy;
  addRunDefaultBtn.disabled = !isGitProject || busy;

  if (!isGitProject) {
    runListEl.className = "run-list empty";
    runListEl.textContent = "Select a git project to configure and run profiles.";
    return;
  }

  if (runState.loadingProfiles) {
    runListEl.className = "run-list empty";
    runListEl.textContent = "Loading run profiles...";
    return;
  }

  if (!groupCount) {
    runListEl.className = "run-list empty";
    runListEl.textContent = "No run profiles yet. Add one for this worktree or as repository default.";
    return;
  }

  runListEl.className = "run-list";
  runListEl.innerHTML = runState.effectiveGroups
    .map((group, index) => {
      const encodedGroupId = encodeURIComponent(group.id || "");
      const run = runState.runsByGroupId[group.id] || null;
      const running = Boolean(run && run.status === "running");
      const commands = (group.commands || []).map((item) => item.command).join("\n");
      const source = getRunSourceLabel(group.id);
      const latestLog = runState.latestLogByGroupId[group.id] || "";
      return `
        <div class="run-item">
          <div class="run-item-top">
            <span class="run-item-title">${escapeHtml(group.name || "Run profile")}</span>
            <span class="run-status-pill ${running ? "running" : ""}">${running ? "running" : "stopped"}</span>
          </div>
          <div class="run-item-top">
            <span class="run-source-pill">${source}</span>
          </div>
          <div class="run-commands">${escapeHtml(commands || "")}</div>
          ${latestLog ? `<div class="run-commands">${escapeHtml(latestLog)}</div>` : ""}
          <div class="run-item-actions">
            <button type="button" data-run-start="${encodedGroupId}" ${running ? "disabled" : ""}>Start</button>
            <button type="button" data-run-stop="${encodedGroupId}" ${running ? "" : "disabled"}>Stop</button>
            <button type="button" data-run-logs="${encodedGroupId}">Logs</button>
            <button type="button" data-run-delete="${index}">Delete</button>
          </div>
        </div>
      `;
    })
    .join("");
}

async function loadRunProfilesForActiveProject() {
  const project = getActiveProject();
  if (!project || !project.isGit) {
    runState.projectKey = null;
    runState.defaultGroups = [];
    runState.worktreeGroups = [];
    runState.effectiveGroups = [];
    runState.runsByGroupId = {};
    runState.latestLogByGroupId = {};
    runState.logCursorByGroupId = {};
    runState.logLinesByGroupId = {};
    closeRunLogModal();
    renderRunProfiles();
    return;
  }

  runState.loadingProfiles = true;
  renderRunProfiles();

  try {
    const params = new URLSearchParams({ path: project.path });
    const response = await fetch(`/api/projects/run-profiles?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load run profiles.");

    runState.projectKey = payload.projectKey || null;
    runState.defaultGroups = payload.defaultGroups || [];
    runState.worktreeGroups = payload.worktreeGroups || [];
    runState.effectiveGroups = payload.effectiveGroups || [];
  } catch (error) {
    runState.projectKey = null;
    runState.defaultGroups = [];
    runState.worktreeGroups = [];
    runState.effectiveGroups = [];
    closeRunLogModal();
    showToast(error.message, true);
  } finally {
    runState.loadingProfiles = false;
    renderRunProfiles();
  }
}

async function saveRunProfilesForActiveProject(nextDefaultGroups, nextWorktreeGroups) {
  const project = getActiveProject();
  if (!project || !project.isGit) return;

  const response = await fetch("/api/projects/run-profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: project.path,
      defaultGroups: nextDefaultGroups,
      worktreeGroups: nextWorktreeGroups
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Could not save run profiles.");

  runState.projectKey = payload.projectKey || null;
  runState.defaultGroups = payload.defaultGroups || [];
  runState.worktreeGroups = payload.worktreeGroups || [];
  runState.effectiveGroups = payload.effectiveGroups || [];
}

function openRunProfileModal(scope) {
  runState.pendingCreateScope = scope;
  if (runProfileNameInput) runProfileNameInput.value = "web";
  if (runProfileCommandsInput) runProfileCommandsInput.value = "npm start";
  runProfileModalEl?.classList.remove("hidden");
  runProfileModalEl?.setAttribute("aria-hidden", "false");
  runProfileNameInput?.focus();
  runProfileNameInput?.select();
}

function closeRunProfileModal() {
  runState.pendingCreateScope = null;
  runProfileModalEl?.classList.add("hidden");
  runProfileModalEl?.setAttribute("aria-hidden", "true");
}

function renderRunLogModal() {
  const groupId = runState.activeLogGroupId;
  if (!groupId || !runLogModalContentEl) return;

  const group = runState.effectiveGroups.find((item) => item.id === groupId);
  const title = group ? `${group.name} logs` : "Run Logs";
  if (runLogModalTitleEl) {
    runLogModalTitleEl.textContent = title;
  }

  const logLines = runState.logLinesByGroupId[groupId] || [];
  const text = logLines.length ? logLines.slice(-220).join("\n") : "No logs yet.";
  const nearBottom =
    runLogModalContentEl.scrollTop + runLogModalContentEl.clientHeight >= runLogModalContentEl.scrollHeight - 12;
  runLogModalContentEl.textContent = text;
  if (nearBottom || runLogModalContentEl.scrollTop === 0) {
    runLogModalContentEl.scrollTop = runLogModalContentEl.scrollHeight;
  }
}

async function openRunLogModal(groupId) {
  if (!groupId) return;
  runState.activeLogGroupId = groupId;
  runLogModalEl?.classList.remove("hidden");
  runLogModalEl?.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  await loadRunLogsForGroup(groupId);
  renderRunLogModal();
}

function closeRunLogModal() {
  runState.activeLogGroupId = null;
  runLogModalEl?.classList.add("hidden");
  runLogModalEl?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function renderCommitDraftModal() {
  if (!commitDraftModalEl) return;

  const loading = actionState.generatingCommitDraft;
  const hasError = Boolean(commitDraftState.error);
  const hasSummary = commitDraftState.summary.length > 0;
  const hasFiles = commitDraftState.files.length > 0;

  if (commitDraftStatusEl) {
    if (loading) {
      commitDraftStatusEl.textContent = "Generating summary with OpenCode...";
      commitDraftStatusEl.className = "commit-draft-status";
    } else if (hasError) {
      commitDraftStatusEl.textContent = commitDraftState.error;
      commitDraftStatusEl.className = "commit-draft-status error";
    } else if (hasFiles) {
      commitDraftStatusEl.textContent = `Analyzed ${commitDraftState.files.length} staged file${commitDraftState.files.length === 1 ? "" : "s"}.`;
      commitDraftStatusEl.className = "commit-draft-status";
    } else {
      commitDraftStatusEl.textContent = "";
      commitDraftStatusEl.className = "commit-draft-status";
    }
  }

  if (commitDraftSummaryEl) {
    if (hasSummary) {
      commitDraftSummaryEl.innerHTML = commitDraftState.summary
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join("");
      commitDraftSummaryEl.classList.remove("empty");
    } else {
      commitDraftSummaryEl.innerHTML = "<li>No summary generated yet.</li>";
      commitDraftSummaryEl.classList.add("empty");
    }
  }

  if (commitDraftMessageInput && commitDraftState.message !== commitDraftMessageInput.value) {
    commitDraftMessageInput.value = commitDraftState.message;
  }

  if (commitDraftRefreshBtn) {
    commitDraftRefreshBtn.disabled = loading;
  }

  if (commitDraftCommitBtn) {
    const cleanMessage = String(commitDraftMessageInput?.value || "").trim();
    commitDraftCommitBtn.disabled = loading || !cleanMessage || actionState.committing;
  }
}

function openCommitDraftModal() {
  commitDraftState.open = true;
  commitDraftModalEl?.classList.remove("hidden");
  commitDraftModalEl?.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  renderCommitDraftModal();
}

function closeCommitDraftModal() {
  commitDraftState.open = false;
  commitDraftModalEl?.classList.add("hidden");
  commitDraftModalEl?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

async function generateCommitDraftForActiveProject() {
  const project = getActiveProject();
  if (!project || !project.isGit || actionState.generatingCommitDraft) return;

  actionState.generatingCommitDraft = true;
  commitDraftState.error = null;
  setActionButtonsState();
  renderCommitDraftModal();

  try {
    const response = await fetch("/api/projects/commit-assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: project.path })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not generate commit draft.");

    commitDraftState.summary = Array.isArray(payload.summary) ? payload.summary : [];
    commitDraftState.message = String(payload.message || "").trim();
    commitDraftState.files = Array.isArray(payload.files) ? payload.files : [];
    commitDraftState.error = null;
  } catch (error) {
    commitDraftState.summary = [];
    commitDraftState.files = [];
    commitDraftState.error = error.message || "Could not generate commit draft.";
  } finally {
    actionState.generatingCommitDraft = false;
    setActionButtonsState();
    renderCommitDraftModal();
    if (commitDraftState.open) {
      commitDraftMessageInput?.focus();
      commitDraftMessageInput?.select();
    }
  }
}

async function openCommitDraftForActiveProject() {
  const project = getActiveProject();
  if (!project || !project.isGit || actionState.committing || actionState.pulling || actionState.pushing) return;

  const { stagedCount } = getProjectStageStats(project);
  if (stagedCount < 1) {
    showToast("Stage files before committing.", true);
    return;
  }

  commitDraftState.summary = [];
  commitDraftState.message = "";
  commitDraftState.error = null;
  commitDraftState.files = [];

  openCommitDraftModal();
  await generateCommitDraftForActiveProject();
}

let runLogTouchStartY = 0;

function bindRunLogTouchGuards() {
  runLogModalEl?.addEventListener(
    "touchmove",
    (event) => {
      if (runLogModalEl.classList.contains("hidden")) return;
      if (!runLogModalContentEl?.contains(event.target)) {
        event.preventDefault();
      }
    },
    { passive: false }
  );

  runLogModalContentEl?.addEventListener(
    "touchstart",
    (event) => {
      runLogTouchStartY = event.touches[0]?.clientY || 0;
    },
    { passive: true }
  );

  runLogModalContentEl?.addEventListener(
    "touchmove",
    (event) => {
      if (!runLogModalContentEl) return;
      const currentY = event.touches[0]?.clientY || 0;
      const deltaY = currentY - runLogTouchStartY;
      const atTop = runLogModalContentEl.scrollTop <= 0;
      const atBottom =
        runLogModalContentEl.scrollTop + runLogModalContentEl.clientHeight >= runLogModalContentEl.scrollHeight - 1;

      if ((atTop && deltaY > 0) || (atBottom && deltaY < 0)) {
        event.preventDefault();
      }
    },
    { passive: false }
  );
}

function buildRunProfileFromModal() {
  const name = String(runProfileNameInput?.value || "").trim();
  if (!name) {
    throw new Error("Profile name is required.");
  }

  const commandsRaw = String(runProfileCommandsInput?.value || "");
  const commands = commandsRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((command, index) => ({
      id: `${name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "cmd"}-${index + 1}`,
      label: `cmd-${index + 1}`,
      command
    }));

  if (!commands.length) {
    throw new Error("Add at least one command.");
  }

  return {
    id: `${name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "group"}-${Date.now().toString(36)}`,
    name,
    commands
  };
}

async function addRunProfile(scope, profile) {
  const project = getActiveProject();
  if (!project || !project.isGit) return;
  if (!profile) return;

  try {
    const defaultGroups = [...runState.defaultGroups];
    const worktreeGroups = [...runState.worktreeGroups];
    defaultGroups.push(profile);
    await saveRunProfilesForActiveProject(defaultGroups, worktreeGroups);
    showToast(`Saved ${profile.name}`);
    renderRunProfiles();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function deleteRunProfileAtIndex(index) {
  const group = runState.effectiveGroups[index];
  if (!group) return;

  const source = getRunSourceLabel(group.id);
  const confirmed = window.confirm(`Delete run profile "${group.name}" from ${source}?`);
  if (!confirmed) return;

  try {
    const defaultGroups = [...runState.defaultGroups];
    const worktreeGroups = [...runState.worktreeGroups];
    if (source === "worktree") {
      const next = worktreeGroups.filter((item) => item.id !== group.id);
      await saveRunProfilesForActiveProject(defaultGroups, next);
    } else {
      const next = defaultGroups.filter((item) => item.id !== group.id);
      await saveRunProfilesForActiveProject(next, worktreeGroups);
    }
    showToast(`Deleted ${group.name}`);
    renderRunProfiles();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadRunStatusesForActiveProject(options = {}) {
  const shouldRender = options.render !== false;
  const project = getActiveProject();
  if (!project || !project.isGit) {
    runState.runsByGroupId = {};
    if (shouldRender) renderRunProfiles();
    return;
  }

  runState.loadingStatus = true;
  try {
    const params = new URLSearchParams({ path: project.path });
    const response = await fetch(`/api/projects/run/status?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load run status.");

    runState.runsByGroupId = {};
    (payload.runs || []).forEach((run) => {
      runState.runsByGroupId[run.groupId] = run;
    });
  } catch (error) {
    runState.runsByGroupId = {};
  } finally {
    runState.loadingStatus = false;
    if (shouldRender) renderRunProfiles();
  }
}

async function loadRunLogsForGroup(groupId) {
  const project = getActiveProject();
  if (!project || !project.isGit || !groupId) return;

  try {
    const since = Number(runState.logCursorByGroupId[groupId] || 0);
    const params = new URLSearchParams({
      path: project.path,
      groupId,
      since: String(since)
    });
    const response = await fetch(`/api/projects/run/logs?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load run logs.");

    runState.logCursorByGroupId[groupId] = Number(payload.nextSince || since);
    const lines = (payload.logs || []).map((item) => item.line).filter(Boolean);
    if (lines.length) {
      const existing = runState.logLinesByGroupId[groupId] || [];
      const merged = existing.concat(lines);
      runState.logLinesByGroupId[groupId] = merged.slice(-220);
      runState.latestLogByGroupId[groupId] = lines[lines.length - 1];
      if (runState.activeLogGroupId === groupId) renderRunLogModal();
    }
  } catch {
    // ignore log polling errors
  }
}

async function startRunProfile(groupId) {
  const project = getActiveProject();
  if (!project || !project.isGit || !groupId) return;

  try {
    runState.logCursorByGroupId[groupId] = 0;
    runState.latestLogByGroupId[groupId] = "";
    runState.logLinesByGroupId[groupId] = [];
    if (runState.activeLogGroupId === groupId) {
      renderRunLogModal();
    }

    const response = await fetch("/api/projects/run/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: project.path, groupId })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not start run profile.");

    runState.runsByGroupId[groupId] = payload.run;
    showToast(`Started ${payload.run.groupName}`);
    await loadRunStatusesForActiveProject();
    await loadRunLogsForGroup(groupId);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function stopRunProfile(groupId) {
  const project = getActiveProject();
  if (!project || !project.isGit || !groupId) return;

  try {
    const response = await fetch("/api/projects/run/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: project.path, groupId })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not stop run profile.");

    if (payload.run) {
      runState.runsByGroupId[groupId] = payload.run;
    }
    showToast("Stopped run profile");
    await loadRunStatusesForActiveProject();
    await loadRunLogsForGroup(groupId);
  } catch (error) {
    showToast(error.message, true);
  }
}

function ensureRunPolling() {
  if (runState.pollId) {
    clearInterval(runState.pollId);
    runState.pollId = null;
  }

  runState.pollId = setInterval(async () => {
    const project = getActiveProject();
    if (!project || !project.isGit) return;

    const logsExpanded = hasExpandedRunLogs();
    await loadRunStatusesForActiveProject({ render: !logsExpanded });
    const runningGroupIds = Object.values(runState.runsByGroupId)
      .filter((run) => run && run.status === "running")
      .map((run) => run.groupId);

    for (const groupId of runningGroupIds) {
      await loadRunLogsForGroup(groupId);
    }
    if (!logsExpanded) {
      renderRunProfiles();
    }
  }, 2200);
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
    return (
      getRecentProjectPath(project).toLowerCase().includes(term) ||
      getRecentProjectName(project).toLowerCase().includes(term)
    );
  });
}

function getProjectSuggestions(query) {
  const deduped = new Map();

  getFilteredProjects(query).forEach((project) => {
    const recentPath = getRecentProjectPath(project);
    deduped.set(recentPath, {
      name: getRecentProjectName(project),
      path: recentPath,
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

function openProjectPicker() {
  sidebarEl?.classList.add("show-project-picker");
  projectPathInput.focus();
  showProjectSuggestions();
}

function closeProjectPicker() {
  sidebarEl?.classList.remove("show-project-picker");
  closeProjectSuggestions();
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
      const sourceLabel = project.source === "recent" ? "Saved" : "Git";
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.projects));
  } catch {
    showToast("Could not persist saved projects locally.", true);
  }
}

function loadProjects() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state.projects = raw ? JSON.parse(raw) : [];
    const deduped = [];
    let changed = false;
    for (const project of state.projects) {
      const recentPath = project?.repoRoot || project?.recentPath || project?.path;
      if (project.recentPath !== recentPath) changed = true;
      project.recentPath = recentPath;
      const existing = deduped.find((item) => isSameRepository(item, project));
      if (existing) {
        changed = true;
        Object.assign(existing, project);
        existing.recentPath = existing.recentPath || recentPath;
      } else {
        deduped.push(project);
      }
    }
    state.projects = deduped;
    if (changed) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.projects));
    }
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

function isSameRepository(project, candidate) {
  if (!project || !candidate) return false;
  if (project.repoId && candidate.repoId) {
    return project.repoId === candidate.repoId;
  }
  return project.path === candidate.path;
}

function getRecentProjectPath(project) {
  if (!project) return "";
  return project.recentPath || project.repoRoot || project.path;
}

function getRecentProjectName(project) {
  if (!project) return "";
  return project.repoName || project.name;
}

function getProjectInitial(project) {
  const title = getRecentProjectName(project).trim();
  if (!title) return "?";
  return title[0].toUpperCase();
}

function getProjectIconStyle(projectPath) {
  const value = String(projectPath || "");
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  const hue = (hash * 137.508) % 360;
  const saturation = 62 + (hash % 14);
  const lightness = 58 + ((hash >> 3) % 10);
  const background = `hsla(${hue.toFixed(1)}, ${saturation}%, ${lightness}%, 0.2)`;
  const border = `hsla(${hue.toFixed(1)}, ${Math.min(92, saturation + 8)}%, ${Math.min(82, lightness + 8)}%, 0.42)`;
  const text = `hsl(${hue.toFixed(1)}, ${Math.min(96, saturation + 10)}%, ${Math.min(88, lightness + 18)}%)`;

  return `--project-icon-bg:${background};--project-icon-border:${border};--project-icon-fg:${text};`;
}

function renderProjects() {
  if (!state.projects.length) {
    projectListEl.innerHTML = '<p class="saved-projects-empty">No saved projects.</p>';
    return;
  }

  projectListEl.innerHTML = state.projects
    .map((project) => {
      const isActive = project.path === state.activePath;
      const dirtyCount = Array.isArray(project.changedFiles) ? project.changedFiles.length : 0;
      const title = getRecentProjectName(project);
      const initial = getProjectInitial(project);
      const iconMarkup = project.iconDataUrl
        ? `<img class="project-icon-image" src="${escapeHtml(project.iconDataUrl)}" alt="${escapeHtml(title)} icon" loading="lazy" />`
        : `<span class="project-icon-initial">${escapeHtml(initial)}</span>`;
      return `
        <button
          class="project-item project-icon-item ${isActive ? "active" : ""}"
          data-path="${project.path}"
          title="${escapeHtml(title)}"
          aria-label="Open saved project ${escapeHtml(title)}"
        >
          <span class="project-icon-shell" style="${getProjectIconStyle(project.path)}">
            ${iconMarkup}
          </span>
          <span class="project-folder-name">${escapeHtml(title)}</span>
          ${dirtyCount > 0 ? `<span class="project-change-badge">${dirtyCount}</span>` : ""}
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
    runState.defaultGroups = [];
    runState.worktreeGroups = [];
    runState.effectiveGroups = [];
    runState.runsByGroupId = {};
    runState.logCursorByGroupId = {};
    runState.latestLogByGroupId = {};
    runState.logLinesByGroupId = {};
    closeRunLogModal();
    runSectionEl?.classList.add("hidden");
    outgoingState.items = [];
    outgoingState.error = null;
    outgoingSectionEl?.classList.add("hidden");
    renderRunProfiles();
    renderOutgoingList();
    renderPrList();
    if (changeProjectIconBtn) changeProjectIconBtn.disabled = true;
    return;
  }

  setActionButtonsState();
  if (changeProjectIconBtn) changeProjectIconBtn.disabled = false;
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
  runSectionEl?.classList.remove("hidden");
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
    runSectionEl?.classList.add("hidden");
    outgoingSectionEl?.classList.add("hidden");
    closeRunLogModal();
    renderRunProfiles();
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

    state.projects = state.projects.map((p) => {
      if (p.path !== payload.path) return p;
      payload.iconDataUrl = p.iconDataUrl || payload.iconDataUrl || null;
      return payload;
    });
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

async function refreshAllActiveProjectData() {
  await refreshActiveProject();
  await Promise.all([
    loadRunProfilesForActiveProject(),
    loadRunStatusesForActiveProject(),
    loadOutgoingCommitsForActiveProject(),
    loadOpenPrsForActiveProject()
  ]);
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

    state.projects = state.projects.map((p) => {
      if (p.path !== payload.path) return p;
      payload.snapshot.iconDataUrl = p.iconDataUrl || payload.snapshot.iconDataUrl || null;
      return payload.snapshot;
    });
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

    state.projects = state.projects.map((p) => {
      if (p.path !== payload.path) return p;
      payload.snapshot.iconDataUrl = p.iconDataUrl || payload.snapshot.iconDataUrl || null;
      return payload.snapshot;
    });
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

    state.projects = state.projects.map((p) => {
      if (p.path !== payload.path) return p;
      payload.snapshot.iconDataUrl = p.iconDataUrl || payload.snapshot.iconDataUrl || null;
      return payload.snapshot;
    });
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

async function commitActiveProject(messageInput) {
  const project = getActiveProject();
  if (!project || !project.isGit || actionState.committing || actionState.pulling || actionState.pushing) return;

  const cleanMessage = String(messageInput || "").trim();
  if (!cleanMessage) {
    showToast("Commit message is required.", true);
    return;
  }

  actionState.committing = true;
  setActionButtonsState();
  renderCommitDraftModal();

  try {
    const response = await fetch("/api/projects/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: project.path, message: cleanMessage })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not commit changes.");

    state.projects = state.projects.map((p) => {
      if (p.path !== payload.path) return p;
      payload.snapshot.iconDataUrl = p.iconDataUrl || payload.snapshot.iconDataUrl || null;
      return payload.snapshot;
    });
    saveProjects();
    state.selectedFile = null;
    setDiffMessage("Pick a file to inspect its diff.");
    renderProjects();
    renderProjectDetails();
    closeCommitDraftModal();
    showToast(`Committed ${payload.hash}`);
    void loadOutgoingCommitsForActiveProject();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    actionState.committing = false;
    setActionButtonsState();
    renderCommitDraftModal();
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

    state.projects = state.projects.map((p) => {
      if (p.path !== payload.path) return p;
      payload.snapshot.iconDataUrl = p.iconDataUrl || payload.snapshot.iconDataUrl || null;
      return payload.snapshot;
    });
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

    state.projects = state.projects.map((p) => {
      if (p.path !== payload.path) return p;
      payload.snapshot.iconDataUrl = p.iconDataUrl || payload.snapshot.iconDataUrl || null;
      return payload.snapshot;
    });
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
  closeSidebar();
  document.body.classList.remove("viewing-diff");
  renderProjects();
  renderProjectDetails();
  void refreshActiveProject();
  void loadRunProfilesForActiveProject();
  void loadRunStatusesForActiveProject();
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

    const existing = state.projects.find((project) => isSameRepository(project, payload));
    const recentPath = payload.repoRoot || payload.path;
    if (existing) {
      const existingRecentPath = getRecentProjectPath(existing) || recentPath;
      const existingIcon = existing.iconDataUrl || null;
      Object.assign(existing, payload);
      existing.recentPath = existingRecentPath;
      existing.iconDataUrl = existingIcon;
    } else {
      payload.recentPath = recentPath;
      payload.iconDataUrl = null;
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
  closeProjectPicker();
});

function setActiveProjectIcon(file) {
  const activeProject = getActiveProject();
  if (!activeProject || !file) return;
  if (!file.type.startsWith("image/")) {
    showToast("Please pick an image file.", true);
    return;
  }

  if (file.size > 1024 * 1024) {
    showToast("Image is too large. Keep it under 1MB.", true);
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = typeof reader.result === "string" ? reader.result : "";
    if (!dataUrl) {
      showToast("Could not read image.", true);
      return;
    }

    activeProject.iconDataUrl = dataUrl;
    saveProjects();
    renderProjects();
    showToast("Project icon updated.");
  };
  reader.onerror = () => {
    showToast("Could not read image.", true);
  };
  reader.readAsDataURL(file);
}

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

changeProjectIconBtn?.addEventListener("click", () => {
  if (!getActiveProject()) return;
  projectIconInput?.click();
});

projectIconInput?.addEventListener("change", (event) => {
  const input = event.target;
  const file = input?.files?.[0];
  if (file) {
    setActiveProjectIcon(file);
  }
  input.value = "";
});

addSavedProjectBtn?.addEventListener("click", () => {
  openProjectPicker();
});

refreshBtn.addEventListener("click", async () => {
  await refreshAllActiveProjectData();
});

commitBtn.addEventListener("click", async () => {
  await openCommitDraftForActiveProject();
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

refreshRunsBtn?.addEventListener("click", async () => {
  await loadRunProfilesForActiveProject();
  await loadRunStatusesForActiveProject();
});

runToggleBtn?.addEventListener("click", () => {
  toggleRunPanel();
});

addRunWorktreeBtn?.addEventListener("click", async () => {
  openRunProfileModal("default");
});

addRunDefaultBtn?.addEventListener("click", async () => {
  openRunProfileModal("default");
});

runProfileCancelBtn?.addEventListener("click", () => {
  closeRunProfileModal();
});

runProfileSaveBtn?.addEventListener("click", async () => {
  try {
    const scope = runState.pendingCreateScope || "worktree";
    const profile = buildRunProfileFromModal();
    await addRunProfile(scope, profile);
    closeRunProfileModal();
  } catch (error) {
    showToast(error.message || "Could not save run profile.", true);
  }
});

runProfileCommandsInput?.addEventListener("keydown", async (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    runProfileSaveBtn?.click();
  }
});

runProfileModalEl?.addEventListener("click", (event) => {
  if (event.target === runProfileModalEl) {
    closeRunProfileModal();
  }
});

runLogCloseBtn?.addEventListener("click", () => {
  closeRunLogModal();
});

runLogModalEl?.addEventListener("click", (event) => {
  if (event.target === runLogModalEl) {
    closeRunLogModal();
  }
});

commitDraftCancelBtn?.addEventListener("click", () => {
  closeCommitDraftModal();
});

commitDraftRefreshBtn?.addEventListener("click", async () => {
  await generateCommitDraftForActiveProject();
});

commitDraftMessageInput?.addEventListener("input", () => {
  commitDraftState.message = String(commitDraftMessageInput.value || "");
  renderCommitDraftModal();
});

commitDraftMessageInput?.addEventListener("keydown", async (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    commitDraftCommitBtn?.click();
  }
});

commitDraftCommitBtn?.addEventListener("click", async () => {
  await commitActiveProject(commitDraftMessageInput?.value || "");
});

commitDraftModalEl?.addEventListener("click", (event) => {
  if (event.target === commitDraftModalEl) {
    closeCommitDraftModal();
  }
});

runListEl?.addEventListener("click", async (event) => {
  const startButton = event.target.closest("button[data-run-start]");
  if (startButton) {
    await startRunProfile(decodeDataId(startButton.dataset.runStart));
    return;
  }

  const stopButton = event.target.closest("button[data-run-stop]");
  if (stopButton) {
    await stopRunProfile(decodeDataId(stopButton.dataset.runStop));
    return;
  }

  const logsButton = event.target.closest("button[data-run-logs]");
  if (logsButton) {
    await openRunLogModal(decodeDataId(logsButton.dataset.runLogs));
    return;
  }

  const deleteButton = event.target.closest("button[data-run-delete]");
  if (deleteButton) {
    const index = Number(deleteButton.dataset.runDelete);
    await deleteRunProfileAtIndex(index);
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

function bindPullToRefresh() {
  document.addEventListener(
    "touchstart",
    (event) => {
      if (!isMobileLayout() || pullRefreshState.refreshing) return;
      const sourceEl = getActivePullSource(event.target);
      if (!sourceEl || sourceEl.scrollTop > 0) return;

      pullRefreshState.tracking = true;
      pullRefreshState.startY = event.touches[0]?.clientY || 0;
      pullRefreshState.distance = 0;
      pullRefreshState.sourceEl = sourceEl;
      renderPullRefreshIndicator();
    },
    { passive: true }
  );

  document.addEventListener(
    "touchmove",
    (event) => {
      if (!pullRefreshState.tracking || pullRefreshState.refreshing) return;
      if (!pullRefreshState.sourceEl) return;
      if (pullRefreshState.sourceEl.scrollTop > 0) {
        resetPullRefreshState();
        return;
      }

      const currentY = event.touches[0]?.clientY || 0;
      const delta = currentY - pullRefreshState.startY;

      if (delta <= 0) {
        pullRefreshState.distance = 0;
        setPullRefreshDistance(0);
        renderPullRefreshIndicator();
        return;
      }

      pullRefreshState.distance = Math.min(pullRefreshState.maxDistance, delta * 0.52);
      setPullRefreshDistance(pullRefreshState.distance);
      renderPullRefreshIndicator();
      event.preventDefault();
    },
    { passive: false }
  );

  document.addEventListener(
    "touchend",
    async () => {
      if (!pullRefreshState.tracking) return;
      const shouldRefresh = pullRefreshState.distance >= pullRefreshState.trigger;
      resetPullRefreshState();

      if (!shouldRefresh || pullRefreshState.refreshing) return;

      pullRefreshState.refreshing = true;
      setPullRefreshDistance(Math.max(42, pullRefreshState.trigger * 0.72));
      renderPullRefreshIndicator();

      try {
        await refreshAllActiveProjectData();
      } finally {
        pullRefreshState.refreshing = false;
        setPullRefreshDistance(0);
        renderPullRefreshIndicator();
      }
    },
    { passive: true }
  );

  document.addEventListener(
    "touchcancel",
    () => {
      if (!pullRefreshState.tracking) return;
      resetPullRefreshState();
    },
    { passive: true }
  );
}

function init() {
  loadProjects();
  renderProjects();
  setActionButtonsState();
  setOutgoingPanelExpanded(false);
  setPrPanelExpanded(false);
  setRunPanelExpanded(false);
  renderRunProfiles();
  renderOutgoingList();
  renderPrList();

  if (state.projects.length) {
    selectProject(state.projects[0].path);
  } else {
    renderProjectDetails();
  }

  bindPullToRefresh();
  bindRunLogTouchGuards();
  ensureRunPolling();
}

// Mobile and layout interactivity bindings
menuBtn?.addEventListener("click", () => {
  openSidebar();
});

closeSidebarBtn?.addEventListener("click", () => {
  closeSidebar();
});

sidebarOverlay?.addEventListener("click", () => {
  closeSidebar();
});

backToFilesBtn?.addEventListener("click", () => {
  document.body.classList.remove("viewing-diff");
  state.selectedFile = null;
  renderProjectDetails();
});

init();
