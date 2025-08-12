# Gemini MCP Worklog — README

A simple, local-first **per-project worklog** system powered by Gemini (via CLI) and local Git repositories. This README describes step-by-step how the system works, how to install and run it, and how to expose the functionality as an MCP server so Gemini can call it as tools.

---

## Summary

This project automates daily developer + manager work logs by:

- Reading commits and file diffs from a **local** Git repository (no GitHub API required)
- Sending a compact prompt to **Gemini CLI** to summarize the commits
- Saving the output as Markdown files in each project's `worklogs/` folder
- Providing a small Node.js CLI (`mcp-worklog.js`) with commands to list projects, set the active project, and generate worklogs
- Optionally exposing the same functionality as an HTTP MCP server so Gemini can call the tools programmatically

---

## Features

- Per-project configuration via a single `projects.json` file
- Flexible `since` parameter: accepts `today`, `yesterday`, or an explicit date (`YYYY-MM-DD`) and converts it to an ISO timestamp for `git --since`
- Developer work log + manager-friendly summary
- Local-only operation (reads local `.git`) — works offline
- Easy automation with cron or git hooks

---

## Prerequisites

- Node.js (v16+)
- `git` available on PATH
- Gemini CLI installed and **authenticated** on the machine you run jobs from
- A folder for the tool, e.g. `~/tools/mcp-worklog`

---

## Files & Conventions

- `mcp-worklog.js` — main Node.js CLI script
- `~/.worklogs/projects.json` — central config for all projects (sample below)
- Per-project `worklogs/` folder: generated files are saved as `worklogs/YYYY-MM-DD.md`

### Sample `projects.json`

```json
{
  "projects": {
    "crm-system": "/home/ashar/projects/crm-system",
    "ecommerce-app": "/home/ashar/projects/ecommerce-app"
  },
  "activeProject": "crm-system",
  "worklogFolderName": "worklogs"
}
```

**Note:** Keep this file in your home directory (or a secure path). Do not commit it to public repos.

---

## Installation

1. Create a folder for the tool and copy the script there:

```bash
mkdir -p ~/tools/mcp-worklog
cd ~/tools/mcp-worklog
# copy mcp-worklog.js here
chmod +x mcp-worklog.js
```

2. Initialize an npm project if you want dependencies (optional):

```bash
npm init -y
npm install minimist
```

3. Create your config file:

```bash
mkdir -p ~/.worklogs
nano ~/.worklogs/projects.json
# Paste the sample JSON and save
```

4. Add the tool to your PATH (so you can call `mcp-worklog.js` from anywhere):

```bash
echo 'export PATH="$HOME/tools/mcp-worklog:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

---

## Usage — CLI Commands

- **List projects**

```bash
mcp-worklog.js list-projects
# Output: Projects: [crm-system, ecommerce-app] \n activeProject: crm-system
```

- **Set active project**

```bash
mcp-worklog.js set-active ecommerce-app
```

- **Generate a worklog**

```bash
mcp-worklog.js generate [since]
# Examples:
# mcp-worklog.js generate         # defaults to today
# mcp-worklog.js generate today   # today at 00:00
# mcp-worklog.js generate yesterday
# mcp-worklog.js generate 2025-08-01
```

The script accepts `today`, `yesterday`, or an ISO date and converts it to a proper `git --since` value.

---

## How the script works (internals)

1. Reads `~/.worklogs/projects.json` to find the `activeProject` path.
2. Runs `git log --since="<iso>" --pretty=format:"%H|%an|%ad|%s" --date=iso --name-only` inside the repo.
3. Parses the `git` output into a list of commit objects `{ hash, author, date, message, files }`.
4. Builds a compact prompt with up to N commits and top files and calls the Gemini CLI.
5. Writes the Gemini response to `worklogs/YYYY-MM-DD.md` inside the target project.

---

## Configure `callGemini()` for your environment

The script includes a `callGemini(promptText)` function that spawns the `gemini` CLI. **Your local gemini CLI might accept prompts differently**, so update the function accordingly.

Two common patterns:

- **Prompt via STDIN** (script writes prompt to stdin):

```js
const child = spawn('gemini', ['--model=gemini-2.5-pro'], { stdio: ['pipe','pipe','inherit'] });
child.stdin.write(promptText);
child.stdin.end();
```

- **Prompt via **``** or **``** flag**:

```js
const child = spawn('gemini', ['-p', promptText, '--model=gemini-2.5-pro'], { stdio: ['ignore','pipe','inherit'] });
```

Test manually before automating:

```bash
echo "Hello" | gemini
# or
gemini -p "Hello"
```

---

## Exposing as an MCP server (HTTP example)

To let Gemini call your tools as MCP endpoints, run a small HTTP server that exposes each tool as a JSON endpoint.

Example using **Express** (quick skeleton):

```js
const express = require('express');
const app = express();
app.use(express.json());

app.post('/list_projects', async (req, res) => {
  const cfg = loadConfig();
  res.json({ projects: Object.keys(cfg.projects), activeProject: cfg.activeProject });
});

app.post('/set_active_project', async (req, res) => {
  const { projectName } = req.body;
  try {
    setActiveProject(projectName);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/generate_worklog', async (req, res) => {
  const since = req.body.since || 'today';
  try {
    const iso = parseSinceDate(since);
    await generate(iso);
    res.json({ ok: true, path: 'worklogs/<date>.md' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log('MCP server listening on 3000'));
```

**Notes:**

- Secure your MCP server (bind to localhost or use authentication tokens) before exposing it on a network.
- Gemini’s MCP integration can be configured to call these endpoints as tools (check your Gemini MCP docs / config if you use an official connector).

---

## Automation

- **Cron (daily summary at 17:00 on weekdays)**

```bash
crontab -e
# add line:
0 17 * * 1-5 /usr/bin/env PATH="$HOME/tools/mcp-worklog:$PATH" mcp-worklog.js generate "today" >> ~/mcp-worklog.log 2>&1
```

- **Git hook (post-commit)**: add a `post-commit` script that runs `mcp-worklog.js generate "today"` — but be aware this can be noisy.

- **Systemd service**: run the MCP server as a system service if you want it always-on. (Create a `systemd` unit that runs the Node process.)

---

## Optional: Commit worklogs to a branch

If you want to keep a remote history of worklogs in a `worklogs` branch, you can add these commands after the worklog is generated:

```bash
cd /path/to/project
git checkout -B worklogs
git add worklogs/$(date +%F).md
git commit -m "worklog: $(date +%F)"
git push origin worklogs --force
```

Be careful: pushing with `--force` will rewrite that branch remotely. Prefer manual review if you share this branch.

---

## Prompts — Templates

**Developer log prompt** (used by script):

```
You are a developer assistant.
Input: list of commits (hash, author, date, message, files).
Produce a "Developer Work Log" in Markdown. For each commit write one bullet with a short action, the short-hash, and top files touched. Tag [docs] or [refactor] when appropriate. Limit to 8 bullets.
```

**Manager summary prompt**:

```
Produce a short manager-friendly summary (3 lines): a one-line headline and 2 bullets stating business impact in plain language.
```

---

## Troubleshooting

- `` — check the `since` value and run the `git log` command manually to confirm output.
- **Gemini CLI errors / authentication failures** — run `gemini --help` and re-authenticate if needed.
- **Large repos** — the `git log` output can be big; increase `maxBuffer` when calling child processes if necessary.
- **Permissions** — ensure the script can write to project `worklogs/` folders.

---

## Security & Best Practices

- Keep `projects.json` outside of code repos and do **not** commit it.
- Run the MCP HTTP server on `localhost` or behind authentication if you expose it.
- Avoid storing raw API keys in the script. Use OS-level credential stores or your user account for Gemini auth.

---

## Next steps / Enhancements

- Add issue/PR integration to include ticket links.
- Add file-path based categorization (frontend/backend/docs).
- Create weekly and monthly aggregated reports.
- Post or sync logs automatically to Notion, Google Sheets, Slack, or an internal dashboard.

---

## License

MIT © You

---

If you want, I can also:

- Generate a `systemd` unit file to run your MCP server continuously.
- Produce a GitHub Gist with the full code and sample `projects.json`.
- Convert this README into a nicely formatted markdown file inside your tool folder.

Tell me which of the above you want next.