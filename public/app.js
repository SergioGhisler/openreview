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
const refreshBtn = document.getElementById("refresh-btn");
const openProjectForm = document.getElementById("open-project-form");
const projectPathInput = document.getElementById("project-path");
const toast = document.getElementById("toast");

const menuBtn = document.getElementById("menu-btn");
const closeSidebarBtn = document.getElementById("close-sidebar-btn");
const sidebarOverlay = document.getElementById("sidebar-overlay");
const backToFilesBtn = document.getElementById("back-to-files-btn");
const filesCountEl = document.getElementById("files-count");
const diffFileNameEl = document.getElementById("diff-file-name");

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
      return `
        <button class="project-item ${isActive ? "active" : ""}" data-path="${project.path}">
          <strong>${project.name}</strong>
          <small>${project.path}</small>
          <small>${project.isGit ? `${dirtyCount} changed file(s)` : "Not a git repository"}</small>
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
}

function renderProjectDetails() {
  const project = getActiveProject();

  if (!project) {
    projectTitleEl.textContent = "No project";
    projectMetaEl.textContent = "Open a project to start";
    filesListEl.className = "files-list empty";
    filesListEl.textContent = "No data yet.";
    diffViewerEl.textContent = "Pick a file to inspect its diff.";
    refreshBtn.disabled = true;
    filesCountEl.textContent = "0";
    diffFileNameEl.textContent = "Select a file";
    document.body.classList.remove("viewing-diff");
    return;
  }

  refreshBtn.disabled = false;
  projectTitleEl.textContent = `${project.name}${project.isGit && project.branch ? ` (${project.branch})` : ""}`;
  projectMetaEl.textContent = project.path;
  filesCountEl.textContent = project.changedFiles ? project.changedFiles.length : "0";

  let statusText = "Select a file";
  if (state.selectedFile) {
    statusText = state.selectedFile;
  }
  diffFileNameEl.textContent = statusText;

  if (!project.isGit) {
    filesListEl.className = "files-list empty";
    filesListEl.textContent = "This folder is not a git repository.";
    diffViewerEl.textContent = "No diff available.";
    return;
  }

  if (!project.changedFiles.length) {
    filesListEl.className = "files-list empty";
    filesListEl.textContent = "Working tree is clean.";
    diffViewerEl.textContent = "No local changes found.";
    return;
  }

  filesListEl.className = "files-list";
  filesListEl.innerHTML = project.changedFiles
    .map((item) => {
      const isActive = state.selectedFile === item.file;
      const statusClass = `status-${item.status[0].toLowerCase()}`; // A, M, D etc -> status-a
      return `
        <button class="file-item ${isActive ? "active" : ""}" data-file="${item.file}">
          <span class="path">${item.file}</span>
          <span class="status ${statusClass}">${item.status}</span>
        </button>
      `;
    })
    .join("");

  document.querySelectorAll(".file-item").forEach((button) => {
    button.addEventListener("click", async () => {
      const file = button.dataset.file;
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
    diffViewerEl.textContent = "Loading diff...";

    const params = new URLSearchParams({ path: project.path, file });
    const response = await fetch(`/api/projects/diff?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not load diff.");

    diffViewerEl.textContent = payload.diff;
  } catch (error) {
    showToast(error.message, true);
    diffViewerEl.textContent = "Could not load diff.";
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
      diffViewerEl.textContent = "Pick a file to inspect its diff.";
    }

    renderProjects();
    renderProjectDetails();
  } catch (error) {
    showToast(error.message, true);
  }
}

function selectProject(projectPath) {
  state.activePath = projectPath;
  state.selectedFile = null;
  diffViewerEl.textContent = "Pick a file to inspect its diff.";
  document.body.classList.remove("show-sidebar");
  document.body.classList.remove("viewing-diff");
  renderProjects();
  renderProjectDetails();
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
  await openProject(projectPathInput.value);
});

refreshBtn.addEventListener("click", async () => {
  await refreshActiveProject();
});

function init() {
  loadProjects();
  renderProjects();

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
