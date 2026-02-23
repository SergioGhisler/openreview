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
