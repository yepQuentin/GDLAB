import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const lockPath = path.join(process.cwd(), ".next", "dev", "lock");

if (!fs.existsSync(lockPath)) {
  process.exit(0);
}

const lsofResult = spawnSync("lsof", ["-nP", "-Fpc", "--", lockPath], {
  encoding: "utf8",
});

if (lsofResult.error?.code === "ENOENT") {
  console.warn(
    `[predev] \`lsof\` 不可用，无法确认锁占用状态。请手动检查: ${lockPath}`,
  );
  process.exit(0);
}

const holders = [];
let currentPid = "";
let currentCommand = "";

for (const rawLine of (lsofResult.stdout || "").split("\n")) {
  const line = rawLine.trim();
  if (!line) {
    continue;
  }

  const kind = line[0];
  const value = line.slice(1);

  if (kind === "p") {
    if (currentPid) {
      holders.push({ pid: currentPid, command: currentCommand || "unknown" });
    }
    currentPid = value;
    currentCommand = "";
  } else if (kind === "c") {
    currentCommand = value;
  }
}

if (currentPid) {
  holders.push({ pid: currentPid, command: currentCommand || "unknown" });
}

if (holders.length === 0) {
  fs.unlinkSync(lockPath);
  console.log(`[predev] 已清理僵尸锁: ${lockPath}`);
  process.exit(0);
}

console.error(`[predev] 检测到 lock 正在被占用: ${lockPath}`);
for (const holder of holders) {
  console.error(`[predev] PID=${holder.pid} CMD=${holder.command}`);
}
console.error("[predev] 请先停止已运行的 next dev 实例后再重试。");
process.exit(1);
