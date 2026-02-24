# Local Review Web App

A local web app to open project folders from your machine, keep them pinned in a sidebar, and inspect git changes in the browser.

## Features

- Open any local folder path and keep it in your opened-projects sidebar
- Show branch and changed files for git repositories
- Inspect per-file diff for staged, unstaged, and untracked files
- Refresh project state at any time
- Persist opened projects in browser local storage

## Run

```bash
npm install
npm start
```

Then open `http://localhost:5050`.

## Notes

- This app is intended for local use on your machine.
- Folder opening is path-based (paste absolute path).

## Commit Assist Model Configuration

For commit drafting, each target repository can define OpenCode settings in either:

- `.openreview.json`
- `openreview.config.json`

Use `.openreview.json.example` in this project as a template.

Example:

```json
{
  "commitAssist": {
    "agent": "plan",
    "model": "openai/gpt-5.3-codex",
    "variant": "high",
    "timeoutMs": 9000,
    "diffMaxChars": 9000
  }
}
```

Notes:

- `agent` defaults to `plan`.
- `model` is optional; if omitted, OpenCode uses its configured default model.
- `timeoutMs` and `diffMaxChars` are optional tuning knobs.
