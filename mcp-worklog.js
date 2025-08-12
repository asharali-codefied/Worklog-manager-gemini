#!/usr/bin/env node
// mcp-worklog.js
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const CONFIG =
  process.env.WORKLOG_CONFIG ||
  path.join(process.env.HOME, ".worklogs", "projects.json");

function startSpinner(text = "Generating worklog") {
  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  process.stdout.write(text);
  const interval = setInterval(() => {
    process.stdout.write(
      "\r" + spinnerFrames[i % spinnerFrames.length] + " " + text
    );
    i++;
  }, 80);
  return () => {
    clearInterval(interval);
    process.stdout.write("\r\x1b[K");
  };
}
// Get commit hashes since a date
function getCommitHashes(repoPath, since) {
  return new Promise((resolve, reject) => {
    const cmd = `git -C "${repoPath}" log --since="${since}" --pretty=format:"%H"`;
    require("child_process").exec(cmd, (err, stdout, stderr) => {
      if (err) return reject(err);
      const hashes = stdout.trim().split(/\r?\n/).filter(Boolean);
      resolve(hashes);
    });
  });
}

// Get diff for a single commit
function getCommitDiff(repoPath, commitHash) {
  return new Promise((resolve, reject) => {
    const cmd = `git -C "${repoPath}" show ${commitHash} --unified=3 --pretty=format:"Commit: %H%nAuthor: %an%nDate: %ad%n"`;
    require("child_process").exec(
      cmd,
      { maxBuffer: 20 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve(stdout.trim());
      }
    );
  });
}

async function getCommitDiffs(repoPath, since) {
  const hashes = await getCommitHashes(repoPath, since);
  const limitedHashes = hashes.slice(0, 10);
  const diffs = [];
  for (const h of limitedHashes) {
    const diff = await getCommitDiff(repoPath, h);
    diffs.push(diff);
  }
  return diffs;
}

function buildPromptFromDiffs(diffs) {
  const combinedDiffs = diffs.join("\n\n---\n\n");
  return `You are a 10x developer assistant.
  
  Input: Recent git commit diffs below:
  
  ${combinedDiffs}
  
  Task 1: Produce a "Developer Work Log" in markdown format. For each commit write a bullet point summarizing the key code changes and files affected, using the commit hash short form.
  Task 2: Produce a "Manager Summary" with concise, non-technical bullet points describing overall progress.
  
  Output both sections separated by a horizontal rule.`;
}
function parseSinceDate(input) {
  const now = new Date();
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (!input || input.toLowerCase() === "today") {
    // today at 00:00
    const todayMidnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );
    return todayMidnight.toISOString();
  }

  if (input.toLowerCase() === "yesterday") {
    // yesterday at 00:00
    const yesterdayMidnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 1
    );
    return yesterdayMidnight.toISOString();
  }

  // Try to parse input as date
  const parsed = new Date(input);
  if (!isNaN(parsed)) {
    // return input date at midnight
    return new Date(
      parsed.getFullYear(),
      parsed.getMonth(),
      parsed.getDate()
    ).toISOString();
  }

  // If all fails, default to today
  const todayMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  return todayMidnight.toISOString();
}

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG, "utf8"));
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
}

function setActiveProject(name) {
  const cfg = loadConfig();
  if (!cfg.projects[name]) throw new Error("Unknown project: " + name);
  cfg.activeProject = name;
  saveConfig(cfg);
  console.log("activeProject set to", name);
}

function getActiveRepoPath() {
  const cfg = loadConfig();
  const name = cfg.activeProject;
  if (!name) throw new Error("No activeProject in config");
  const repo = cfg.projects[name];
  if (!repo) throw new Error("Project path missing for " + name);
  return { name, repo, worklogFolderName: cfg.worklogFolderName || "worklogs" };
}

function callGemini(promptText) {
  return new Promise((resolve, reject) => {
    const child = spawn("gemini", ["--model=gemini-2.5-pro"], {
      stdio: ["pipe", "pipe", "inherit"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error("gemini exited code " + code));
    });
    child.stdin.write(promptText);
    child.stdin.end();
  });
}
async function generate(since) {
  const { name, repo, worklogFolderName } = getActiveRepoPath();
  const stopSpinner = startSpinner("Generating worklog for " + name + "...");
 try {
    const diffs = await getCommitDiffs(repo, since);
    if (!diffs.length) {
      stopSpinner();
      console.log("No commits found since", since);
      return;
    }
    const prompt = buildPromptFromDiffs(diffs);
    const result = await callGemini(prompt);
    stopSpinner();
    const date = new Date().toISOString().slice(0, 10);
    const outDir = path.join(repo, worklogFolderName);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${date}.md`);
    fs.writeFileSync(outPath, `# Work Log — ${date}\n\n${result.trim()}\n`);
    console.log("Saved", outPath);
  } catch (error) {
    stopSpinner();
    console.error(error.message || error);
    process.exit(1);
  }
}
// --- simple CLI parsing ---
const argv = process.argv.slice(2);
const cmd = argv[0];
(async () => {
  try {
    if (cmd === "set-active") {
      setActiveProject(argv[1]);
    } else if (cmd === "generate") {
      const rawSince = argv[1] || "today";
      const since = parseSinceDate(rawSince);
      await generate(since);
    } else if (cmd === "list-projects") {
      const cfg = loadConfig();
      console.log("Projects:", Object.keys(cfg.projects));
      console.log("activeProject:", cfg.activeProject);
    } else {
      console.log(
        "usage: set-active <name> | list-projects | generate [since]"
      );
    }
  } catch (e) {
    console.error(e.message || e);
  }
})();
