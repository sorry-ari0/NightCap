import { execFileSync } from "node:child_process";

const status = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();

if (status) {
  console.error("Uncommitted changes exist. Commit, stash, or discard them before release.");
  console.error(status);
  process.exit(1);
}

console.log("Git working tree is clean.");
