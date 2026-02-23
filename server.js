const express = require("express");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const app = express();
const PORT = process.env.PORT || 5050;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function runCommand(command, args, options = {}) {
  const { cwd, okExitCodes = [0] } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (okExitCodes.includes(code)) {
        resolve({ stdout, stderr, code });
        return;
      }

      const error = new Error(stderr || `Command failed with exit code ${code}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

async function ensureDirectory(projectPath) {
  if (!projectPath || typeof projectPath !== "string") {
    const error = new Error("Path is required.");
    error.status = 400;
    throw error;
  }

  const resolvedPath = path.resolve(projectPath.trim());
  const stats = await fs.stat(resolvedPath).catch(() => null);

  if (!stats || !stats.isDirectory()) {
    const error = new Error("Path does not point to an existing directory.");
    error.status = 400;
    throw error;
  }

  return resolvedPath;
}

async function isGitRepository(projectPath) {
  try {
    const result = await runCommand("git", ["rev-parse", "--is-inside-work-tree"], { cwd: projectPath });
    return result.stdout.trim() === "true";
  } catch {
    return false;
  }
}

function parseStatusLine(line) {
  const xy = line.slice(0, 2);
  const raw = line.slice(3).trim();
  const file = raw.includes(" -> ") ? raw.split(" -> ")[1] : raw;

  let status = "modified";
  if (xy === "??") status = "untracked";
  else if (xy.includes("A")) status = "added";
  else if (xy.includes("D")) status = "deleted";
  else if (xy.includes("R")) status = "renamed";
  else if (xy.includes("C")) status = "copied";

  const staged = xy[0] !== " " && xy[0] !== "?";
  const unstaged = xy[1] !== " ";

  return { file, xy, status, staged, unstaged };
}

async function getProjectSnapshot(projectPath) {
  const name = path.basename(projectPath);
  const git = await isGitRepository(projectPath);

  if (!git) {
    return {
      name,
      path: projectPath,
      isGit: false,
      branch: null,
      changedFiles: []
    };
  }

  const [branchResult, statusResult] = await Promise.all([
    runCommand("git", ["branch", "--show-current"], { cwd: projectPath }).catch(() =>
      runCommand("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: projectPath }).catch(() => ({ stdout: "" }))
    ),
    runCommand("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: projectPath })
  ]);

  const lines = statusResult.stdout.split("\n").filter(Boolean);
  const changedFiles = lines.map(parseStatusLine);

  return {
    name,
    path: projectPath,
    isGit: true,
    branch: branchResult.stdout.trim() || "no-commit-branch",
    changedFiles
  };
}

async function ensureGitRepository(projectPath) {
  const git = await isGitRepository(projectPath);
  if (!git) {
    const error = new Error("Selected project is not a git repository.");
    error.status = 400;
    throw error;
  }
}

function expandUserPath(inputPath) {
  const trimmed = String(inputPath || "").trim();
  if (!trimmed) return "";
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

function splitSearchTarget(query) {
  const raw = String(query || "").trim();
  const expanded = expandUserPath(raw);
  const hasPathHint =
    raw.startsWith("~") || raw.startsWith(".") || raw.startsWith(path.sep) || raw.includes(path.sep);

  if (!raw) {
    return { baseDir: os.homedir(), needle: "", fuzzyNeedle: "" };
  }

  if (!hasPathHint) {
    return {
      baseDir: os.homedir(),
      needle: raw,
      fuzzyNeedle: raw.toLowerCase()
    };
  }

  const hasTrailingSlash = expanded.endsWith(path.sep);
  const resolved = path.resolve(expanded);

  if (hasTrailingSlash) {
    return { baseDir: resolved, needle: "", fuzzyNeedle: expanded.toLowerCase() };
  }

  return {
    baseDir: path.dirname(resolved),
    needle: path.basename(resolved),
    fuzzyNeedle: expanded.toLowerCase()
  };
}

function isSubsequence(needle, haystack) {
  if (!needle) return true;
  let j = 0;
  for (let i = 0; i < haystack.length && j < needle.length; i += 1) {
    if (haystack[i] === needle[j]) j += 1;
  }
  return j === needle.length;
}

function getMatchScore(name, fullPath, needleLower, fuzzyNeedleLower) {
  if (!needleLower && !fuzzyNeedleLower) return 1;

  const nameLower = name.toLowerCase();
  const pathLower = fullPath.toLowerCase();
  const fuzzyCompact = (fuzzyNeedleLower || "").replaceAll(path.sep, "");

  if (needleLower && nameLower === needleLower) return 500;
  if (needleLower && nameLower.startsWith(needleLower)) return 420;
  if (needleLower && nameLower.includes(needleLower)) return 340;
  if (fuzzyNeedleLower && pathLower.includes(fuzzyNeedleLower)) return 300;
  if (needleLower && isSubsequence(needleLower, nameLower)) return 220;
  if (fuzzyCompact && isSubsequence(fuzzyCompact, pathLower.replaceAll(path.sep, ""))) return 170;

  return 0;
}

async function searchDirectories(query) {
  const { baseDir, needle, fuzzyNeedle } = splitSearchTarget(query);
  const needleLower = needle.toLowerCase();
  const fuzzyNeedleLower = fuzzyNeedle.toLowerCase();
  const MAX_RESULTS = 20;
  const MAX_DEPTH = needleLower ? 5 : 4;
  const MAX_DIRS_VISITED = 2200;
  const skipNames = new Set([".git", "node_modules", ".next", "dist", "build", "target", "vendor"]);

  const matches = [];
  const seenPaths = new Set();
  const queue = [{ dir: baseDir, depth: 0 }];
  let cursor = 0;
  let visited = 0;

  while (cursor < queue.length && visited < MAX_DIRS_VISITED && matches.length < MAX_RESULTS * 5) {
    const current = queue[cursor++];
    const entries = await fs.readdir(current.dir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (skipNames.has(entry.name)) continue;
      if (entry.name.startsWith(".") && !needleLower.startsWith(".")) continue;

      const fullPath = path.join(current.dir, entry.name);
      if (seenPaths.has(fullPath)) continue;
      seenPaths.add(fullPath);
      visited += 1;

      const nameLower = entry.name.toLowerCase();
      const gitStats = await fs.stat(path.join(fullPath, ".git")).catch(() => null);
      const isGit = Boolean(gitStats && (gitStats.isDirectory() || gitStats.isFile()));
      const score = getMatchScore(entry.name, fullPath, needleLower, fuzzyNeedleLower);

      if (isGit && score > 0) {
        const startsWithNeedle = needleLower ? nameLower.startsWith(needleLower) : false;
        matches.push({
          name: entry.name,
          path: fullPath,
          startsWithNeedle,
          score,
          depth: current.depth + 1
        });
      }

      if (!isGit && current.depth < MAX_DEPTH) {
        queue.push({ dir: fullPath, depth: current.depth + 1 });
      }
    }
  }

  return matches
    .sort((a, b) => {
      if (a.startsWithNeedle !== b.startsWithNeedle) {
        return a.startsWithNeedle ? -1 : 1;
      }
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      if (a.depth !== b.depth) {
        return a.depth - b.depth;
      }
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    })
    .slice(0, MAX_RESULTS)
    .map((match) => ({
      name: match.name,
      path: match.path
    }));
}

app.post("/api/projects/open", async (req, res) => {
  try {
    const projectPath = await ensureDirectory(req.body?.path);
    const snapshot = await getProjectSnapshot(projectPath);
    res.json(snapshot);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Unexpected server error." });
  }
});

app.get("/api/projects/changes", async (req, res) => {
  try {
    const projectPath = await ensureDirectory(req.query.path);
    const snapshot = await getProjectSnapshot(projectPath);
    res.json(snapshot);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Unexpected server error." });
  }
});

app.get("/api/projects/diff", async (req, res) => {
  try {
    const projectPath = await ensureDirectory(req.query.path);
    const file = req.query.file;

    if (!file || typeof file !== "string") {
      res.status(400).json({ error: "File path is required." });
      return;
    }

    await ensureGitRepository(projectPath);

    const [unstaged, staged] = await Promise.all([
      runCommand("git", ["diff", "--", file], { cwd: projectPath }),
      runCommand("git", ["diff", "--cached", "--", file], { cwd: projectPath })
    ]);

    let diff = [unstaged.stdout, staged.stdout].filter(Boolean).join("\n").trim();

    if (!diff) {
      const fileAbsolutePath = path.join(projectPath, file);
      const untracked = await runCommand(
        "git",
        ["diff", "--no-index", "--", "/dev/null", fileAbsolutePath],
        { cwd: projectPath, okExitCodes: [0, 1] }
      );
      diff = untracked.stdout.trim();
    }

    res.json({ path: projectPath, file, diff: diff || "No diff output for this file." });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Unexpected server error." });
  }
});

app.post("/api/projects/commit", async (req, res) => {
  try {
    const projectPath = await ensureDirectory(req.body?.path);
    const message = String(req.body?.message || "").trim();

    if (!message) {
      res.status(400).json({ error: "Commit message is required." });
      return;
    }

    await ensureGitRepository(projectPath);

    const stagedFiles = await runCommand("git", ["diff", "--cached", "--name-only"], {
      cwd: projectPath
    });

    if (!stagedFiles.stdout.trim()) {
      res.status(400).json({ error: "No staged changes to commit." });
      return;
    }

    await runCommand("git", ["commit", "-m", message], { cwd: projectPath });
    const commitRef = await runCommand("git", ["rev-parse", "--short", "HEAD"], { cwd: projectPath });
    const snapshot = await getProjectSnapshot(projectPath);

    res.json({
      path: projectPath,
      hash: commitRef.stdout.trim(),
      snapshot
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Could not commit changes." });
  }
});

app.post("/api/projects/stage-all", async (req, res) => {
  try {
    const projectPath = await ensureDirectory(req.body?.path);
    await ensureGitRepository(projectPath);

    await runCommand("git", ["add", "-A"], { cwd: projectPath });
    const snapshot = await getProjectSnapshot(projectPath);

    res.json({ path: projectPath, snapshot });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Could not stage all changes." });
  }
});

app.post("/api/projects/stage-file", async (req, res) => {
  try {
    const projectPath = await ensureDirectory(req.body?.path);
    const file = String(req.body?.file || "").trim();

    if (!file) {
      res.status(400).json({ error: "File path is required." });
      return;
    }

    await ensureGitRepository(projectPath);

    await runCommand("git", ["add", "--", file], { cwd: projectPath });
    const snapshot = await getProjectSnapshot(projectPath);

    res.json({ path: projectPath, file, snapshot });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Could not stage file." });
  }
});

app.post("/api/projects/push", async (req, res) => {
  try {
    const projectPath = await ensureDirectory(req.body?.path);
    await ensureGitRepository(projectPath);

    const currentBranch = await runCommand("git", ["branch", "--show-current"], { cwd: projectPath });
    const branch = currentBranch.stdout.trim();

    if (!branch) {
      res.status(400).json({ error: "Cannot push while HEAD is detached." });
      return;
    }

    const upstreamCheck = await runCommand(
      "git",
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      { cwd: projectPath, okExitCodes: [0, 128] }
    );

    if (upstreamCheck.code === 0) {
      await runCommand("git", ["push"], { cwd: projectPath });
    } else {
      await runCommand("git", ["push", "-u", "origin", branch], { cwd: projectPath });
    }

    const snapshot = await getProjectSnapshot(projectPath);
    res.json({ path: projectPath, branch, snapshot });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Could not push changes." });
  }
});

app.get("/api/projects/search", async (req, res) => {
  try {
    const query = typeof req.query.query === "string" ? req.query.query : "";
    const matches = await searchDirectories(query);
    res.json({ query, matches });
  } catch {
    res.json({ query: req.query.query || "", matches: [] });
  }
});

app.listen(PORT, () => {
  console.log(`Local review web app running at http://localhost:${PORT}`);
});
