const express = require("express");
const fs = require("fs/promises");
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

  return { file, xy, status };
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

    const git = await isGitRepository(projectPath);
    if (!git) {
      res.status(400).json({ error: "Selected project is not a git repository." });
      return;
    }

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

app.listen(PORT, () => {
  console.log(`Local review web app running at http://localhost:${PORT}`);
});
