// scripts/seed-data.ts — initialize a fresh data/ dir for a new user.
// Client data lives in its own nested git repo (parent repo ignores data/),
// so each install starts with empty clients and its own version history.
//
// Usage: bun run seed-data
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DATA = path.join(ROOT, "data");

function git(...args: string[]) {
  return execFileSync("git", args, { cwd: DATA, encoding: "utf-8" });
}

mkdirSync(path.join(DATA, "programs"), { recursive: true });
mkdirSync(path.join(DATA, "state", "sync"), { recursive: true });
mkdirSync(path.join(DATA, "state", "pending"), { recursive: true });
if (!existsSync(path.join(DATA, "clients.json"))) {
  writeFileSync(path.join(DATA, "clients.json"), "[]\n");
}
if (!existsSync(path.join(DATA, ".gitignore"))) {
  writeFileSync(path.join(DATA, ".gitignore"), "state/\n");
}

try {
  git("rev-parse", "HEAD");
  console.log("data/ repo already initialized");
} catch {
  git("init");
  git("add", "clients.json", "programs", ".gitignore");
  git("-c", "user.name=Coach", "-c", "user.email=coach@local", "commit", "-m", "Init client data");
  console.log("data/ repo initialized with empty clients");
}
