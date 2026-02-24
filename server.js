const express = require("express");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const app = express();
const PREFERRED_PORT = Number.parseInt(process.env.PORT, 10) || 5050;
const MAX_PORT_FALLBACK_ATTEMPTS = 25;
const RUN_PROFILE_STORE_PATH = path.join(os.homedir(), ".openreview-run-profiles.json");
const RUN_LOG_LIMIT = 600;
const RUN_FORCE_KILL_DELAY_MS = 2500;
const COMMIT_ASSIST_DIFF_MAX_CHARS = 9000;
const COMMIT_ASSIST_SUMMARY_LIMIT = 4;
const COMMIT_ASSIST_DESCRIPTION_MAX_CHARS = 1200;
const COMMIT_ASSIST_TIMEOUT_MS = 9000;
const COMMIT_ASSIST_DEFAULT_AGENT = "plan";
const runProfileStore = {
  loaded: false,
  data: { projects: {} }
};
const activeRuns = new Map();

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

function parseWorktreeList(stdout) {
  const lines = String(stdout || "").split("\n");
  const worktrees = [];
  let current = null;

  const pushCurrent = () => {
    if (!current || !current.path) return;
    const branchName = current.branchRef
      ? current.branchRef.replace("refs/heads/", "")
      : current.detached
        ? "detached"
        : "unknown";

    worktrees.push({
      path: current.path,
      branch: branchName,
      head: current.head || "",
      detached: Boolean(current.detached),
      bare: Boolean(current.bare)
    });
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      pushCurrent();
      current = null;
      continue;
    }

    if (line.startsWith("worktree ")) {
      pushCurrent();
      current = { path: line.slice("worktree ".length) };
      continue;
    }

    if (!current) continue;

    if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      current.branchRef = line.slice("branch ".length);
    } else if (line === "detached") {
      current.detached = true;
    } else if (line === "bare") {
      current.bare = true;
    }
  }

  pushCurrent();
  return worktrees;
}

async function loadRunProfileStore() {
  if (runProfileStore.loaded) return;
  const raw = await fs.readFile(RUN_PROFILE_STORE_PATH, "utf8").catch(() => "");
  if (!raw.trim()) {
    runProfileStore.loaded = true;
    runProfileStore.data = { projects: {} };
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    const projects = parsed && typeof parsed === "object" ? parsed.projects : null;
    runProfileStore.data = {
      projects: projects && typeof projects === "object" ? projects : {}
    };
  } catch {
    runProfileStore.data = { projects: {} };
  }
  runProfileStore.loaded = true;
}

async function saveRunProfileStore() {
  await fs.writeFile(RUN_PROFILE_STORE_PATH, JSON.stringify(runProfileStore.data, null, 2));
}

function toSafeId(value, fallbackPrefix) {
  const raw = String(value || "").trim().toLowerCase();
  const safe = raw.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (safe) return safe;
  return `${fallbackPrefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeRunGroups(inputGroups) {
  if (!Array.isArray(inputGroups)) return [];

  return inputGroups
    .map((group, groupIndex) => {
      const name = String(group?.name || "").trim();
      const commandsInput = Array.isArray(group?.commands) ? group.commands : [];
      const commands = commandsInput
        .map((commandItem, commandIndex) => {
          const command = String(commandItem?.command || "").trim();
          if (!command) return null;
          const label = String(commandItem?.label || `cmd-${commandIndex + 1}`).trim();
          const envInput = commandItem?.env && typeof commandItem.env === "object" ? commandItem.env : {};
          const env = Object.fromEntries(
            Object.entries(envInput).map(([key, value]) => [String(key), String(value)])
          );
          return {
            id: toSafeId(commandItem?.id || label, `cmd-${commandIndex + 1}`),
            label,
            command,
            cwd: String(commandItem?.cwd || "").trim() || null,
            env
          };
        })
        .filter(Boolean);

      if (!name || !commands.length) return null;
      return {
        id: toSafeId(group?.id || name, `group-${groupIndex + 1}`),
        name,
        commands
      };
    })
    .filter(Boolean);
}

function getRunRepoConfig(projectKey) {
  const current = runProfileStore.data.projects[projectKey];
  if (current) {
    const normalized = normalizeSharedRunRepoConfig(current);
    runProfileStore.data.projects[projectKey] = normalized.config;
    return normalized.config;
  }
  const created = { defaults: [] };
  runProfileStore.data.projects[projectKey] = created;
  return created;
}

function mergeRunGroups(baseGroups, extraGroups) {
  const merged = [];
  const seen = new Set();

  const addGroups = (groups) => {
    groups.forEach((group) => {
      const key = `${group.id}::${group.name}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(group);
    });
  };

  addGroups(baseGroups);
  addGroups(extraGroups);
  return merged;
}

function normalizeSharedRunRepoConfig(repoConfig) {
  const defaultGroups = sanitizeRunGroups(repoConfig?.defaults || []);
  const worktreeMap = repoConfig?.worktrees && typeof repoConfig.worktrees === "object" ? repoConfig.worktrees : {};
  const worktreeGroups = Object.values(worktreeMap)
    .flatMap((value) => sanitizeRunGroups(value));
  const mergedDefaults = mergeRunGroups(defaultGroups, worktreeGroups);
  const migratedFromWorktrees = Object.keys(worktreeMap).length > 0;

  return {
    config: {
      defaults: mergedDefaults
    },
    migratedFromWorktrees
  };
}

function getEffectiveRunGroups(repoConfig, worktreePath) {
  void worktreePath;
  const normalized = normalizeSharedRunRepoConfig(repoConfig).config;
  const worktreeGroups = [];
  const defaultGroups = Array.isArray(normalized.defaults) ? normalized.defaults : [];
  const effective = defaultGroups;
  return {
    defaultGroups,
    worktreeGroups,
    effectiveGroups: effective
  };
}

function buildRunKey(projectPath, groupId) {
  return `${projectPath}::${groupId}`;
}

function appendRunLog(run, stream, message) {
  const text = String(message || "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return;
  for (const line of lines) {
    run.logSeq += 1;
    run.logs.push({ seq: run.logSeq, at: new Date().toISOString(), stream, line });
  }
  if (run.logs.length > RUN_LOG_LIMIT) {
    run.logs.splice(0, run.logs.length - RUN_LOG_LIMIT);
  }
}

function serializeRun(run) {
  return {
    key: run.key,
    projectPath: run.projectPath,
    groupId: run.groupId,
    groupName: run.groupName,
    startedAt: run.startedAt,
    stoppedAt: run.stoppedAt,
    status: run.status,
    commands: run.commands.map((item) => ({
      id: item.id,
      label: item.label,
      command: item.command,
      pid: item.pid,
      status: item.status,
      exitCode: item.exitCode
    }))
  };
}

function startRunForGroup(projectPath, group) {
  const run = {
    key: buildRunKey(projectPath, group.id),
    projectPath,
    groupId: group.id,
    groupName: group.name,
    startedAt: new Date().toISOString(),
    stoppedAt: null,
    status: "running",
    logSeq: 0,
    logs: [],
    stopRequested: false,
    commands: group.commands.map((commandDef) => ({
      id: commandDef.id,
      label: commandDef.label,
      command: commandDef.command,
      pid: null,
      status: "pending",
      exitCode: null,
      child: null
    }))
  };

  const markStopped = () => {
    if (run.status === "stopped") return;
    run.status = "stopped";
    run.stoppedAt = new Date().toISOString();
  };

  const markRemainingSkipped = (fromIndex) => {
    for (let index = fromIndex; index < run.commands.length; index += 1) {
      if (run.commands[index].status === "pending") {
        run.commands[index].status = "skipped";
      }
    }
  };

  const launchNext = (index) => {
    if (run.stopRequested) {
      markRemainingSkipped(index);
      markStopped();
      return;
    }

    const runCommandDef = run.commands[index];
    const sourceDef = group.commands[index];
    if (!runCommandDef || !sourceDef) {
      markStopped();
      return;
    }

    const commandCwd = sourceDef.cwd ? path.resolve(projectPath, sourceDef.cwd) : projectPath;
    const child = spawn(sourceDef.command, {
      cwd: commandCwd,
      shell: true,
      env: {
        ...process.env,
        ...(sourceDef.env || {})
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    runCommandDef.child = child;
    runCommandDef.pid = child.pid || null;
    runCommandDef.status = "running";

    appendRunLog(run, "system", `[${runCommandDef.label}] started: ${runCommandDef.command}`);

    child.stdout.on("data", (chunk) => {
      appendRunLog(run, "stdout", `[${runCommandDef.label}] ${String(chunk)}`);
    });

    child.stderr.on("data", (chunk) => {
      appendRunLog(run, "stderr", `[${runCommandDef.label}] ${String(chunk)}`);
    });

    child.on("error", (error) => {
      runCommandDef.status = "failed";
      runCommandDef.exitCode = 1;
      run.stopRequested = true;
      appendRunLog(run, "stderr", `[${runCommandDef.label}] ${error.message || "Failed to start command."}`);
      markRemainingSkipped(index + 1);
      markStopped();
    });

    child.on("close", (code) => {
      runCommandDef.exitCode = code;
      if (runCommandDef.status !== "failed") {
        runCommandDef.status = "exited";
      }
      appendRunLog(run, "system", `[${runCommandDef.label}] exited with code ${code}`);

      if (run.stopRequested) {
        markRemainingSkipped(index + 1);
        markStopped();
        return;
      }

      if (code !== 0) {
        appendRunLog(run, "system", `[${runCommandDef.label}] failed, stopping remaining commands.`);
        markRemainingSkipped(index + 1);
        markStopped();
        return;
      }

      launchNext(index + 1);
    });
  };

  launchNext(0);

  return run;
}

async function stopRun(run) {
  run.stopRequested = true;
  const activeChildren = run.commands
    .map((item) => item.child)
    .filter((child) => child && !child.killed);

  if (!activeChildren.length) {
    run.status = "stopped";
    if (!run.stoppedAt) run.stoppedAt = new Date().toISOString();
    return;
  }

  await Promise.all(
    activeChildren.map(
      (child) =>
        new Promise((resolve) => {
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            resolve();
          };

          const timer = setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {
              // ignore kill failures
            }
            done();
          }, RUN_FORCE_KILL_DELAY_MS);

          child.once("close", () => {
            clearTimeout(timer);
            done();
          });

          try {
            child.kill("SIGTERM");
          } catch {
            clearTimeout(timer);
            done();
          }
        })
    )
  );

  run.status = "stopped";
  run.stoppedAt = new Date().toISOString();
}

async function getProjectSnapshot(projectPath) {
  const name = path.basename(projectPath);
  const git = await isGitRepository(projectPath);

  if (!git) {
    return {
      name,
      path: projectPath,
      isGit: false,
      repoId: null,
      repoRoot: null,
      repoName: name,
      branch: null,
      changedFiles: [],
      remote: {
        hasUpstream: false,
        upstream: null,
        ahead: 0,
        behind: 0
      }
    };
  }

  const [branchResult, statusResult, upstreamCheck, commonDirResult] = await Promise.all([
    runCommand("git", ["branch", "--show-current"], { cwd: projectPath }).catch(() =>
      runCommand("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: projectPath }).catch(() => ({ stdout: "" }))
    ),
    runCommand("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: projectPath }),
    runCommand("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], {
      cwd: projectPath,
      okExitCodes: [0, 128]
    }),
    runCommand("git", ["rev-parse", "--git-common-dir"], { cwd: projectPath }).catch(() => ({ stdout: ".git" }))
  ]);

  const lines = statusResult.stdout.split("\n").filter(Boolean);
  const changedFiles = lines.map(parseStatusLine);
  const hasUpstream = upstreamCheck.code === 0;
  const upstream = hasUpstream ? upstreamCheck.stdout.trim() : null;
  let ahead = 0;
  let behind = 0;

  if (hasUpstream) {
    try {
      const aheadBehind = await runCommand("git", ["rev-list", "--left-right", "--count", "@{u}...HEAD"], {
        cwd: projectPath
      });
      const [behindRaw, aheadRaw] = aheadBehind.stdout.trim().split(/\s+/);
      behind = Number.parseInt(behindRaw, 10) || 0;
      ahead = Number.parseInt(aheadRaw, 10) || 0;
    } catch {
      ahead = 0;
      behind = 0;
    }
  }

  const commonDirRaw = commonDirResult.stdout.trim() || ".git";
  const repoId = path.resolve(projectPath, commonDirRaw);
  const repoRoot = path.dirname(repoId);

  return {
    name,
    path: projectPath,
    isGit: true,
    repoId,
    repoRoot,
    repoName: path.basename(repoRoot) || name,
    branch: branchResult.stdout.trim() || "no-commit-branch",
    changedFiles,
    remote: {
      hasUpstream,
      upstream,
      ahead,
      behind
    }
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

async function syncRemoteRefs(projectPath) {
  await runCommand("git", ["fetch", "--prune", "--quiet"], {
    cwd: projectPath,
    okExitCodes: [0, 1, 128]
  }).catch(() => null);
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

function buildCommitAssistPrompt({ repoName, branch, stagedFiles, stagedDiff, recentCommitSubjects }) {
  const filesText = stagedFiles.map((file) => `- ${file}`).join("\n");
  const recentSubjects = Array.isArray(recentCommitSubjects)
    ? recentCommitSubjects.map((item) => `- ${item}`).join("\n")
    : "";
  const hasRecentSubjects = Boolean(recentSubjects);
  return [
    "You are a senior engineer preparing a commit.",
    "Analyze the staged git changes and return strict JSON only with this shape:",
    '{"commitMessage":"type(scope): short message","commitDescription":"line 1\\nline 2"}',
    "Rules:",
    "- commitMessage must be <= 72 chars, imperative mood, no trailing period.",
    "- commitMessage MUST use conventional commits (type(scope): msg or type: msg).",
    "- commitDescription should explain intent and key impact in 2-4 short lines.",
    "- do not mention file counts, insertions/deletions, or diff stats.",
    hasRecentSubjects
      ? "- align wording and scope style with the recent commit subjects shown below."
      : "- use concise wording and conventional commit style.",
    "- return only one JSON object, no markdown, no extra keys.",
    "- wrap the JSON object between these exact markers:",
    "OC_JSON_START",
    "OC_JSON_END",
    "",
    `Repository: ${repoName}`,
    `Branch: ${branch || "unknown"}`,
    "",
    ...(hasRecentSubjects
      ? [
          "Recent commit subjects (style reference):",
          recentSubjects,
          ""
        ]
      : []),
    "Staged files:",
    filesText,
    "",
    "Staged diff:",
    stagedDiff
  ].join("\n");
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeCommitAssistConfig(rawConfig) {
  const defaults = {
    agent: COMMIT_ASSIST_DEFAULT_AGENT,
    model: "",
    variant: "",
    timeoutMs: COMMIT_ASSIST_TIMEOUT_MS,
    diffMaxChars: COMMIT_ASSIST_DIFF_MAX_CHARS,
    historyCount: 12
  };

  const commitAssist =
    rawConfig?.commitAssist && typeof rawConfig.commitAssist === "object" ? rawConfig.commitAssist : rawConfig;
  if (!commitAssist || typeof commitAssist !== "object") return defaults;

  const agentInput = String(commitAssist.agent || "").trim();
  const modelInput = String(commitAssist.model || "").trim();
  const variantInput = String(commitAssist.variant || "").trim();

  return {
    agent: agentInput || defaults.agent,
    model: modelInput,
    variant: variantInput,
    timeoutMs: clampInt(commitAssist.timeoutMs, 3000, 45000, defaults.timeoutMs),
    diffMaxChars: clampInt(commitAssist.diffMaxChars, 3000, 30000, defaults.diffMaxChars),
    historyCount: clampInt(commitAssist.historyCount, 0, 50, defaults.historyCount)
  };
}

async function readProjectCommitAssistConfig(projectPath) {
  const candidates = [
    path.join(projectPath, ".openreview.json"),
    path.join(projectPath, "openreview.config.json")
  ];

  for (const filePath of candidates) {
    const raw = await fs.readFile(filePath, "utf8").catch(() => "");
    if (!raw.trim()) continue;
    try {
      return normalizeCommitAssistConfig(JSON.parse(raw));
    } catch {
      return normalizeCommitAssistConfig(null);
    }
  }

  return normalizeCommitAssistConfig(null);
}

function parseRecentCommitSubjects(stdout, limit) {
  return String(stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
}

async function runCommitAssistWithTimeout(projectPath, prompt, options) {
  const timeoutMs = Number(options?.timeoutMs) || COMMIT_ASSIST_TIMEOUT_MS;
  const args = ["run", "--agent", options?.agent || COMMIT_ASSIST_DEFAULT_AGENT, "--format", "json"];
  if (options?.model) {
    args.push("--model", options.model);
  }
  if (options?.variant) {
    args.push("--variant", options.variant);
  }
  args.push(prompt);

  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => resolve(null), timeoutMs);
  });

  const commandPromise = runCommand("opencode", args, { cwd: projectPath })
    .then((result) => result)
    .catch((error) => ({ error }));

  const result = await Promise.race([commandPromise, timeoutPromise]);
  if (!result) return { timedOut: true };
  if (result.error) throw result.error;
  return { timedOut: false, result };
}

function normalizeCommitAssistPayload(payload) {
  const commitMessage = String(payload?.commitMessage || "").trim();
  const commitDescription = String(payload?.commitDescription || payload?.description || "")
    .replace(/\r\n/g, "\n")
    .trim();

  if (!commitMessage) {
    const error = new Error("OpenCode returned an incomplete draft.");
    error.status = 502;
    throw error;
  }

  let normalizedMessage = commitMessage.replace(/\s+/g, " ").trim();
  const conventionalPattern = /^[a-z]+(?:\([^)]+\))?!?:\s+.+/;
  if (!conventionalPattern.test(normalizedMessage)) {
    normalizedMessage = `chore: ${normalizedMessage.replace(/^[^a-z0-9]+/i, "")}`.trim();
  }

  return {
    commitMessage: normalizedMessage.slice(0, 72),
    commitDescription: commitDescription.slice(0, COMMIT_ASSIST_DESCRIPTION_MAX_CHARS)
  };
}

function extractOpencodeTextFromJsonStream(stdout) {
  const raw = String(stdout || "").trim();
  if (!raw) return "";

  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  const textParts = [];

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event?.type === "text" && typeof event?.part?.text === "string") {
        textParts.push(event.part.text);
      }
    } catch {
      return raw;
    }
  }

  return textParts.length ? textParts.join("\n").trim() : raw;
}

function parseCommitAssistResponse(stdout) {
  const text = extractOpencodeTextFromJsonStream(stdout);
  if (!text) {
    const error = new Error("OpenCode returned an empty response.");
    error.status = 502;
    throw error;
  }

  const normalizedText = text
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\r\n/g, "\n")
    .trim();

  const markerPattern = /OC_JSON_START\s*([\s\S]*?)\s*OC_JSON_END/g;
  const markerMatches = [...normalizedText.matchAll(markerPattern)];
  for (let i = markerMatches.length - 1; i >= 0; i -= 1) {
    const candidate = markerMatches[i]?.[1]?.trim();
    if (!candidate) continue;
    try {
      return normalizeCommitAssistPayload(JSON.parse(candidate));
    } catch {
      // keep trying candidates
    }
  }

  const jsonBlockMatch = normalizedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonBlockMatch?.[1]) {
    try {
      return normalizeCommitAssistPayload(JSON.parse(jsonBlockMatch[1].trim()));
    } catch {
      // continue with other parsers
    }
  }

  try {
    return normalizeCommitAssistPayload(JSON.parse(normalizedText));
  } catch {
    const start = normalizedText.indexOf("{");
    const end = normalizedText.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const extracted = normalizedText.slice(start, end + 1);
        return normalizeCommitAssistPayload(JSON.parse(extracted));
      } catch {
        // fall through
      }
    }
  }

  const error = new Error("Could not parse OpenCode response.");
  error.status = 502;
  throw error;
}

function inferCommitType(files) {
  if (!files.length) return "chore";

  const lower = files.map((file) => file.toLowerCase());
  const isDocs = lower.every((file) =>
    file.endsWith(".md") || file.includes("/docs/") || file.startsWith("docs/") || file.endsWith(".txt")
  );
  if (isDocs) return "docs";

  const isTests = lower.every((file) =>
    file.includes("test") || file.includes("spec") || file.endsWith(".snap")
  );
  if (isTests) return "test";

  const isUiOnly = lower.every((file) =>
    file.startsWith("public/") || file.endsWith(".css") || file.endsWith(".html")
  );
  if (isUiOnly) return "feat";

  if (lower.some((file) => file.includes("package-lock") || file === "package.json")) return "chore";
  return "feat";
}

function inferCommitScope(files) {
  if (!files.length) return "";
  const counts = new Map();

  files.forEach((file) => {
    const clean = String(file || "").trim();
    if (!clean) return;
    const head = clean.includes("/") ? clean.split("/")[0] : path.parse(clean).name;
    if (!head) return;
    counts.set(head, (counts.get(head) || 0) + 1);
  });

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const scope = String(sorted[0]?.[0] || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return scope;
}

function buildConventionalFallbackMessage(files) {
  const type = inferCommitType(files);
  const scope = inferCommitScope(files);
  const subject = files.length === 1 ? `update ${path.basename(files[0])}` : "update staged changes";
  return `${type}${scope ? `(${scope})` : ""}: ${subject}`.slice(0, 72);
}

function extractDiffInsights(stagedDiff) {
  const lines = String(stagedDiff || "").split("\n");
  const insights = [];
  let currentFile = "";

  const pushInsight = (value) => {
    const text = String(value || "").trim();
    if (!text) return;
    if (!insights.includes(text)) insights.push(text);
  };

  for (const line of lines) {
    const fileMatch = line.match(/^\+\+\+\s+b\/(.+)$/);
    if (fileMatch?.[1]) {
      currentFile = fileMatch[1].trim();
      continue;
    }

    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const added = line.slice(1).trim();
    if (!added) continue;

    const routeMatch = added.match(/^app\.(get|post|put|delete|patch)\("([^"]+)"/);
    if (routeMatch) {
      pushInsight(`API: ${routeMatch[1].toUpperCase()} ${routeMatch[2]}`);
      continue;
    }

    const functionMatch = added.match(/^(?:async\s+)?function\s+([a-zA-Z0-9_]+)/);
    if (functionMatch?.[1]) {
      pushInsight(`Logic: ${functionMatch[1]}()`);
      continue;
    }

    if (currentFile.endsWith(".html")) {
      const idMatch = added.match(/id="([^"]+)"/);
      if (idMatch?.[1]) {
        pushInsight(`UI: ${idMatch[1]}`);
        continue;
      }
    }

    if (currentFile.endsWith(".css")) {
      const classMatch = added.match(/^\.([a-zA-Z0-9_-]+)/);
      if (classMatch?.[1]) {
        pushInsight(`Styles: .${classMatch[1]}`);
        continue;
      }
    }
  }

  return insights.slice(0, 6);
}

function buildInsightBasedMessage(stagedFiles, insights) {
  const joined = insights.join(" ").toLowerCase();
  const filesLower = stagedFiles.map((file) => file.toLowerCase());
  const touchedServer = filesLower.includes("server.js");
  const touchedClient = filesLower.some((file) => file.startsWith("public/"));

  if (joined.includes("/api/projects/commit-assist") || joined.includes("commit-draft") || joined.includes("commit-assist")) {
    return "feat(commit): add opencode-assisted commit draft flow";
  }
  if (touchedServer && touchedClient) {
    return "feat(commit): add commit summary and message assistant";
  }
  if (joined.includes("api:")) {
    return "feat(api): update staged change assistance endpoint";
  }
  if (joined.includes("ui:")) {
    return "feat(ui): add commit assistance modal";
  }
  return buildConventionalFallbackMessage(stagedFiles);
}

function buildCommitAssistFallback({ stagedFiles, stagedDiff }) {
  const filesLower = stagedFiles.map((file) => file.toLowerCase());
  const touchedServer = filesLower.includes("server.js");
  const touchedApp = filesLower.includes("public/app.js");
  const touchedHtml = filesLower.includes("public/index.html");
  const touchedStyles = filesLower.includes("public/styles.css");
  const hasCommitAssistRoute = String(stagedDiff || "").includes('/api/projects/commit-assist');
  const hasCommitDraftUi = String(stagedDiff || "").includes("commit-draft");
  const hasCommitDescription = String(stagedDiff || "").includes("commit-draft-description");
  const insights = extractDiffInsights(stagedDiff);
  const descriptionLines = [];
  const apiInsight = insights.find((line) => line.startsWith("API:"));
  const uiInsight = insights.find((line) => line.startsWith("UI:"));
  const logicInsights = insights.filter((line) => line.startsWith("Logic:")).slice(0, 2);

  if (hasCommitAssistRoute || (touchedServer && touchedApp)) {
    descriptionLines.push(
      apiInsight
        ? `Add OpenCode-powered commit drafting in ${apiInsight.replace("API: ", "")}.`
        : "Add OpenCode-powered commit drafting for staged changes."
    );
  }
  if (hasCommitAssistRoute || touchedServer) {
    descriptionLines.push("Generate both a conventional commit subject and an editable commit body.");
  }
  if (hasCommitDraftUi || touchedHtml || touchedApp || touchedStyles || hasCommitDescription) {
    descriptionLines.push(
      uiInsight
        ? `Update the commit modal UI (${uiInsight.replace("UI: ", "")}) to review and edit draft content.`
        : "Update the commit modal to review, regenerate, and edit draft content before committing."
    );
  }
  if (hasCommitDescription) {
    descriptionLines.push("Include commit description text in the final git commit body.");
  }
  if (logicInsights.length) {
    descriptionLines.push(`Wire drafting flow through ${logicInsights.map((line) => line.replace("Logic: ", "")).join(" and ")}.`);
  }

  if (!descriptionLines.length && insights.length) {
    descriptionLines.push(`Key updates include ${insights.slice(0, 2).join(" and ").toLowerCase()}.`);
  }
  if (!descriptionLines.length) {
    descriptionLines.push("Update commit workflow to provide an editable conventional commit draft.");
  }

  return {
    commitMessage: buildInsightBasedMessage(stagedFiles, insights).slice(0, 72),
    commitDescription: descriptionLines.slice(0, COMMIT_ASSIST_SUMMARY_LIMIT).join("\n")
  };
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
    if (await isGitRepository(projectPath)) {
      await syncRemoteRefs(projectPath);
    }
    const snapshot = await getProjectSnapshot(projectPath);
    res.json(snapshot);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Unexpected server error." });
  }
});

app.get("/api/projects/changes", async (req, res) => {
  try {
    const projectPath = await ensureDirectory(req.query.path);
    if (await isGitRepository(projectPath)) {
      await syncRemoteRefs(projectPath);
    }
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

app.post("/api/projects/commit-assist", async (req, res) => {
  try {
    const projectPath = await ensureDirectory(req.body?.path);
    await ensureGitRepository(projectPath);
    const commitAssistConfig = await readProjectCommitAssistConfig(projectPath);

    const historyCount = Number(commitAssistConfig.historyCount) || 0;
    const recentSubjectsPromise =
      historyCount > 0
        ? runCommand("git", ["log", `-${historyCount}`, "--pretty=%s"], { cwd: projectPath }).catch(() => ({ stdout: "" }))
        : Promise.resolve({ stdout: "" });

    const [repoNameResult, branchResult, stagedFilesResult, stagedDiffResult, recentSubjectsResult] = await Promise.all([
      runCommand("git", ["rev-parse", "--show-toplevel"], { cwd: projectPath }),
      runCommand("git", ["branch", "--show-current"], { cwd: projectPath }).catch(() => ({ stdout: "" })),
      runCommand("git", ["diff", "--cached", "--name-only"], { cwd: projectPath }),
      runCommand("git", ["diff", "--cached"], { cwd: projectPath }),
      recentSubjectsPromise
    ]);

    const stagedFiles = String(stagedFilesResult.stdout || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (!stagedFiles.length) {
      res.status(400).json({ error: "No staged changes to summarize." });
      return;
    }

    const stagedDiffRaw = String(stagedDiffResult.stdout || "").trim();
    const maxDiffChars = Number(commitAssistConfig.diffMaxChars) || COMMIT_ASSIST_DIFF_MAX_CHARS;
    const stagedDiff =
      stagedDiffRaw.length > maxDiffChars
        ? `${stagedDiffRaw.slice(0, maxDiffChars)}\n\n[Diff truncated for OpenCode prompt]`
        : stagedDiffRaw;

    const repoName = path.basename(String(repoNameResult.stdout || "").trim()) || path.basename(projectPath);
    const branch = String(branchResult.stdout || "").trim() || "detached";
    const recentCommitSubjects = parseRecentCommitSubjects(recentSubjectsResult.stdout, historyCount);
    const prompt = buildCommitAssistPrompt({ repoName, branch, stagedFiles, stagedDiff, recentCommitSubjects });
    const fallbackDraft = buildCommitAssistFallback({ stagedFiles, stagedDiff: stagedDiffRaw });

    const assistResult = await runCommitAssistWithTimeout(projectPath, prompt, commitAssistConfig);

    if (assistResult.timedOut) {
      res.json({
        path: projectPath,
        message: fallbackDraft.commitMessage,
        description: fallbackDraft.commitDescription,
        files: stagedFiles
      });
      return;
    }

    const draftOutput =
      String(assistResult.result.stdout || "").trim() || String(assistResult.result.stderr || "").trim();
    let draft;
    try {
      draft = parseCommitAssistResponse(draftOutput);
    } catch (error) {
      if (error?.status === 502) {
        draft = fallbackDraft;
      } else {
        throw error;
      }
    }

    if (!String(draft?.commitDescription || "").trim()) {
      draft.commitDescription = fallbackDraft.commitDescription;
    }

    res.json({
      path: projectPath,
      message: draft.commitMessage,
      description: draft.commitDescription || "",
      files: stagedFiles
    });
  } catch (error) {
    const message = `${error.message || ""}\n${error.stderr || ""}`.toLowerCase();
    if (error.code === "ENOENT" || message.includes("opencode: command not found")) {
      res.status(400).json({ error: "OpenCode CLI is required (install and ensure `opencode` is in PATH)." });
      return;
    }
    res.status(error.status || 500).json({ error: error.message || "Could not generate commit draft." });
  }
});

app.post("/api/projects/commit", async (req, res) => {
  try {
    const projectPath = await ensureDirectory(req.body?.path);
    const message = String(req.body?.message || "").trim();
    const description = String(req.body?.description || "").trim();

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

    const commitArgs = ["commit", "-m", message];
    if (description) {
      commitArgs.push("-m", description);
    }
    await runCommand("git", commitArgs, { cwd: projectPath });
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

app.post("/api/projects/unstage-file", async (req, res) => {
  try {
    const projectPath = await ensureDirectory(req.body?.path);
    const file = String(req.body?.file || "").trim();

    if (!file) {
      res.status(400).json({ error: "File path is required." });
      return;
    }

    await ensureGitRepository(projectPath);

    try {
      await runCommand("git", ["restore", "--staged", "--", file], { cwd: projectPath });
    } catch (error) {
      const message = `${error.message || ""}\n${error.stderr || ""}`;
      const unsupportedRestore =
        message.includes("unknown option") ||
        message.includes("is not a git command") ||
        message.includes("unknown switch `s`");

      if (!unsupportedRestore) {
        throw error;
      }

      await runCommand("git", ["reset", "HEAD", "--", file], { cwd: projectPath });
    }

    const snapshot = await getProjectSnapshot(projectPath);
    res.json({ path: projectPath, file, snapshot });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Could not unstage file." });
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

app.post("/api/projects/pull", async (req, res) => {
  try {
    const projectPath = await ensureDirectory(req.body?.path);
    await ensureGitRepository(projectPath);

    const currentBranch = await runCommand("git", ["branch", "--show-current"], { cwd: projectPath });
    const branch = currentBranch.stdout.trim();

    if (!branch) {
      res.status(400).json({ error: "Cannot pull while HEAD is detached." });
      return;
    }

    const upstreamCheck = await runCommand(
      "git",
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      { cwd: projectPath, okExitCodes: [0, 128] }
    );

    if (upstreamCheck.code === 0) {
      await runCommand("git", ["pull", "--ff-only"], { cwd: projectPath });
    } else {
      await runCommand("git", ["pull", "--ff-only", "origin", branch], { cwd: projectPath });
      await runCommand("git", ["branch", "--set-upstream-to", `origin/${branch}`, branch], {
        cwd: projectPath,
        okExitCodes: [0, 128]
      }).catch(() => null);
    }

    const snapshot = await getProjectSnapshot(projectPath);
    res.json({ path: projectPath, branch, snapshot });
  } catch (error) {
    const message = `${error.message || ""}\n${error.stderr || ""}`.toLowerCase();
    if (message.includes("not possible to fast-forward")) {
      res.status(400).json({
        error: "Cannot fast-forward pull. Rebase or merge this branch manually, then refresh."
      });
      return;
    }
    if (message.includes("local changes") || message.includes("would be overwritten")) {
      res.status(400).json({
        error: "Pull blocked by local changes. Commit or stash your work before pulling."
      });
      return;
    }

    res.status(error.status || 500).json({ error: error.message || "Could not pull changes." });
  }
});

app.post("/api/projects/pr", async (req, res) => {
  try {
    const projectPath = await ensureDirectory(req.body?.path);
    const title = String(req.body?.title || "").trim();
    const body = String(req.body?.body || "").trim();

    if (!title) {
      res.status(400).json({ error: "PR title is required." });
      return;
    }

    await ensureGitRepository(projectPath);

    const currentBranch = await runCommand("git", ["branch", "--show-current"], { cwd: projectPath });
    const branch = currentBranch.stdout.trim();

    if (!branch) {
      res.status(400).json({ error: "Cannot create a PR while HEAD is detached." });
      return;
    }

    const upstreamCheck = await runCommand(
      "git",
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      { cwd: projectPath, okExitCodes: [0, 128] }
    );

    if (upstreamCheck.code !== 0) {
      res.status(400).json({ error: "Push this branch first so it has an upstream before creating a PR." });
      return;
    }

    const args = ["pr", "create", "--head", branch, "--title", title, "--body", body || " "];
    const prCreate = await runCommand("gh", args, { cwd: projectPath });
    const output = `${prCreate.stdout}\n${prCreate.stderr}`;
    const urlMatch = output.match(/https?:\/\/[^\s]+/);

    res.json({
      path: projectPath,
      branch,
      url: urlMatch ? urlMatch[0] : null
    });
  } catch (error) {
    const message = `${error.message || ""}\n${error.stderr || ""}\n${error.stdout || ""}`;
    if (message.toLowerCase().includes("already exists")) {
      try {
        const projectPath = await ensureDirectory(req.body?.path);
        const existing = await runCommand("gh", ["pr", "view", "--json", "url", "--jq", ".url"], {
          cwd: projectPath
        });
        res.json({ path: projectPath, url: existing.stdout.trim() });
        return;
      } catch {
        res.status(409).json({ error: "A PR already exists for this branch." });
        return;
      }
    }

    res.status(error.status || 500).json({ error: error.message || "Could not create pull request." });
  }
});

app.get("/api/projects/prs", async (req, res) => {
  try {
    const projectPath = await ensureDirectory(req.query.path);
    await ensureGitRepository(projectPath);

    const listResult = await runCommand(
      "gh",
      [
        "pr",
        "list",
        "--state",
        "open",
        "--limit",
        "50",
        "--json",
        "number,title,url,headRefName,baseRefName,updatedAt,author"
      ],
      { cwd: projectPath }
    );

    let prs = [];
    try {
      const parsed = JSON.parse(listResult.stdout || "[]");
      prs = Array.isArray(parsed) ? parsed : [];
    } catch {
      prs = [];
    }

    res.json({ path: projectPath, prs });
  } catch (error) {
    const message = `${error.message || ""}\n${error.stderr || ""}`;
    if (
      error.code === "ENOENT" ||
      message.includes("gh: command not found") ||
      message.toLowerCase().includes("not logged into") ||
      message.toLowerCase().includes("authenticate")
    ) {
      res.status(400).json({ error: "GitHub CLI is required and must be authenticated (run: gh auth login)." });
      return;
    }

    res.status(error.status || 500).json({ error: error.message || "Could not load open pull requests." });
  }
});

app.get("/api/projects/outgoing-commits", async (req, res) => {
  try {
    const projectPath = await ensureDirectory(req.query.path);
    await ensureGitRepository(projectPath);
    await syncRemoteRefs(projectPath);

    const branchResult = await runCommand("git", ["branch", "--show-current"], { cwd: projectPath });
    const branch = branchResult.stdout.trim();

    if (!branch) {
      res.json({ path: projectPath, commits: [] });
      return;
    }

    const upstreamCheck = await runCommand(
      "git",
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      { cwd: projectPath, okExitCodes: [0, 128] }
    );

    let range = null;
    if (upstreamCheck.code === 0) {
      const upstream = upstreamCheck.stdout.trim();
      if (upstream) {
        range = `${upstream}..HEAD`;
      }
    } else {
      const remoteBranchRef = `refs/remotes/origin/${branch}`;
      const remoteBranchExists = await runCommand("git", ["show-ref", "--verify", "--quiet", remoteBranchRef], {
        cwd: projectPath,
        okExitCodes: [0, 1, 128]
      });
      if (remoteBranchExists.code === 0) {
        range = `origin/${branch}..HEAD`;
      }
    }

    if (!range) {
      res.json({ path: projectPath, commits: [] });
      return;
    }

    const logResult = await runCommand(
      "git",
      ["log", "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI", "-n", "30", range],
      { cwd: projectPath }
    );

    const commits = String(logResult.stdout || "")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, shortHash, subject, author, authoredAt] = line.split("\x1f");
        return {
          hash: hash || "",
          shortHash: shortHash || "",
          subject: subject || "",
          author: author || "",
          authoredAt: authoredAt || ""
        };
      });

    res.json({ path: projectPath, commits });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Could not load outgoing commits." });
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

app.get("/api/projects/worktrees", async (req, res) => {
  try {
    const projectPath = await ensureDirectory(req.query.path);
    await ensureGitRepository(projectPath);

    const result = await runCommand("git", ["worktree", "list", "--porcelain"], {
      cwd: projectPath
    });

    const worktrees = parseWorktreeList(result.stdout).map((item) => ({
      ...item,
      name: path.basename(item.path),
      current: item.path === projectPath
    }));

    res.json({ path: projectPath, worktrees });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Could not load worktrees." });
  }
});

app.post("/api/projects/worktrees/remove", async (req, res) => {
  try {
    const projectPath = await ensureDirectory(req.body?.path);
    const targetPath = await ensureDirectory(req.body?.worktreePath);
    const force = Boolean(req.body?.force);

    await ensureGitRepository(projectPath);

    const worktreeList = await runCommand("git", ["worktree", "list", "--porcelain"], {
      cwd: projectPath
    });

    const worktrees = parseWorktreeList(worktreeList.stdout);
    const target = worktrees.find((item) => item.path === targetPath);

    if (!target) {
      res.status(400).json({ error: "Selected path is not a worktree of this repository." });
      return;
    }

    if (target.branch === "main") {
      res.status(400).json({ error: "Main worktree is protected and cannot be removed." });
      return;
    }

    if (target.path === projectPath) {
      res.status(400).json({ error: "Cannot remove the currently opened worktree." });
      return;
    }

    const args = ["worktree", "remove"];
    if (force) args.push("--force");
    args.push(target.path);

    await runCommand("git", args, { cwd: projectPath });

    const updated = await runCommand("git", ["worktree", "list", "--porcelain"], {
      cwd: projectPath
    });

    const updatedWorktrees = parseWorktreeList(updated.stdout).map((item) => ({
      ...item,
      name: path.basename(item.path),
      current: item.path === projectPath
    }));

    res.json({
      path: projectPath,
      removedPath: target.path,
      worktrees: updatedWorktrees
    });
  } catch (error) {
    const message = `${error.message || ""}\n${error.stderr || ""}`.toLowerCase();
    if (message.includes("contains modified") || message.includes("contains untracked")) {
      res.status(400).json({
        error: "Worktree has local changes. Commit/stash them first, or force remove."
      });
      return;
    }

    res.status(error.status || 500).json({ error: error.message || "Could not remove worktree." });
  }
});

app.get("/api/projects/run-profiles", async (req, res) => {
  try {
    const projectPath = await ensureDirectory(req.query.path);
    const snapshot = await getProjectSnapshot(projectPath);
    const projectKey = snapshot.repoId || snapshot.repoRoot || projectPath;

    await loadRunProfileStore();
    const repoConfig = getRunRepoConfig(projectKey);
    const normalized = normalizeSharedRunRepoConfig(repoConfig);
    runProfileStore.data.projects[projectKey] = normalized.config;
    if (normalized.migratedFromWorktrees) {
      await saveRunProfileStore();
    }
    const { defaultGroups, worktreeGroups, effectiveGroups } = getEffectiveRunGroups(normalized.config, projectPath);

    res.json({
      path: projectPath,
      projectKey,
      defaultGroups,
      worktreeGroups,
      effectiveGroups
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Could not load run profiles." });
  }
});

app.post("/api/projects/run-profiles", async (req, res) => {
  try {
    const projectPath = await ensureDirectory(req.body?.path);
    const snapshot = await getProjectSnapshot(projectPath);
    const projectKey = snapshot.repoId || snapshot.repoRoot || projectPath;

    await loadRunProfileStore();
    const repoConfig = getRunRepoConfig(projectKey);
    const normalizedRepoConfig = normalizeSharedRunRepoConfig(repoConfig).config;

    const currentDefaultGroups = sanitizeRunGroups(normalizedRepoConfig.defaults || []);
    const nextDefaultGroups = req.body?.defaultGroups !== undefined
      ? sanitizeRunGroups(req.body.defaultGroups)
      : currentDefaultGroups;
    const incomingWorktreeGroups = req.body?.worktreeGroups !== undefined
      ? sanitizeRunGroups(req.body.worktreeGroups)
      : [];

    const sharedDefaults = mergeRunGroups(nextDefaultGroups, incomingWorktreeGroups);
    runProfileStore.data.projects[projectKey] = { defaults: sharedDefaults };

    await saveRunProfileStore();

    const { defaultGroups, worktreeGroups, effectiveGroups } = getEffectiveRunGroups(
      runProfileStore.data.projects[projectKey],
      projectPath
    );

    res.json({
      path: projectPath,
      projectKey,
      defaultGroups,
      worktreeGroups,
      effectiveGroups
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Could not save run profiles." });
  }
});

app.post("/api/projects/run/start", async (req, res) => {
  try {
    const projectPath = await ensureDirectory(req.body?.path);
    const groupId = String(req.body?.groupId || "").trim();
    if (!groupId) {
      res.status(400).json({ error: "Run profile id is required." });
      return;
    }

    const snapshot = await getProjectSnapshot(projectPath);
    const projectKey = snapshot.repoId || snapshot.repoRoot || projectPath;

    await loadRunProfileStore();
    const repoConfig = getRunRepoConfig(projectKey);
    const { effectiveGroups } = getEffectiveRunGroups(repoConfig, projectPath);
    const group = effectiveGroups.find((item) => item.id === groupId);

    if (!group) {
      res.status(400).json({ error: "Run profile not found for this worktree." });
      return;
    }

    const runKey = buildRunKey(projectPath, group.id);
    const current = activeRuns.get(runKey);
    if (current && current.status === "running") {
      res.status(400).json({ error: "Run profile is already running." });
      return;
    }

    const run = startRunForGroup(projectPath, group);
    activeRuns.set(run.key, run);
    res.json({ run: serializeRun(run) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Could not start run profile." });
  }
});

app.post("/api/projects/run/stop", async (req, res) => {
  try {
    const projectPath = await ensureDirectory(req.body?.path);
    const groupId = String(req.body?.groupId || "").trim();
    if (!groupId) {
      res.status(400).json({ error: "Run profile id is required." });
      return;
    }

    const runKey = buildRunKey(projectPath, groupId);
    const run = activeRuns.get(runKey);
    if (!run) {
      res.json({ stopped: true });
      return;
    }

    await stopRun(run);
    res.json({ stopped: true, run: serializeRun(run) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Could not stop run profile." });
  }
});

app.get("/api/projects/run/status", async (req, res) => {
  try {
    const projectPath = await ensureDirectory(req.query.path);
    const runs = Array.from(activeRuns.values())
      .filter((run) => run.projectPath === projectPath)
      .map(serializeRun);
    res.json({ path: projectPath, runs });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Could not load run status." });
  }
});

app.get("/api/projects/run/logs", async (req, res) => {
  try {
    const projectPath = await ensureDirectory(req.query.path);
    const groupId = String(req.query.groupId || "").trim();
    const since = Number.parseInt(String(req.query.since || "0"), 10) || 0;
    if (!groupId) {
      res.status(400).json({ error: "Run profile id is required." });
      return;
    }

    const runKey = buildRunKey(projectPath, groupId);
    const run = activeRuns.get(runKey);
    if (!run) {
      res.json({ path: projectPath, groupId, logs: [], nextSince: since });
      return;
    }

    const logs = run.logs.filter((entry) => entry.seq > since);
    res.json({
      path: projectPath,
      groupId,
      logs,
      nextSince: run.logSeq
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Could not load run logs." });
  }
});

function startServerWithPortFallback(preferredPort, retriesLeft) {
  const server = app.listen(preferredPort);

  server.once("listening", () => {
    const address = server.address();
    const activePort = typeof address === "object" && address ? address.port : preferredPort;
    if (activePort !== preferredPort) {
      console.log(`Requested port ${preferredPort} unavailable. Using http://localhost:${activePort}`);
    } else {
      console.log(`Local review web app running at http://localhost:${activePort}`);
    }
  });

  server.once("error", (error) => {
    if (error && error.code === "EADDRINUSE" && retriesLeft > 0) {
      const nextPort = preferredPort + 1;
      console.warn(`Port ${preferredPort} is in use. Retrying on ${nextPort}...`);
      startServerWithPortFallback(nextPort, retriesLeft - 1);
      return;
    }

    console.error(`Could not start server on port ${preferredPort}:`, error.message || error);
    process.exit(1);
  });
}

startServerWithPortFallback(PREFERRED_PORT, MAX_PORT_FALLBACK_ATTEMPTS);
