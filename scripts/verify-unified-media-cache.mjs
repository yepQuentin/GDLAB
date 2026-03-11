import { createHash } from "node:crypto";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const DEFAULT_AUDIO_SIZE = 64 * 1024;
const CONTENT_TYPE_TO_EXT = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["audio/mpeg", ".mp3"],
  ["audio/mp4", ".m4a"],
  ["audio/wav", ".wav"],
  ["audio/ogg", ".ogg"],
]);

function parseArgs(argv) {
  const options = {
    cacheDir: "",
    keepCache: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--cache-dir") {
      options.cacheDir = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--no-keep-cache") {
      options.keepCache = false;
      continue;
    }
  }

  return options;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function inferExtension(contentType, sourceUrl, kind) {
  const normalizedContentType = String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const explicitExt = CONTENT_TYPE_TO_EXT.get(normalizedContentType);
  if (explicitExt) {
    return explicitExt;
  }

  try {
    const pathname = new URL(sourceUrl).pathname;
    const parsedExt = path.extname(pathname).toLowerCase();
    if (parsedExt) {
      return parsedExt;
    }
  } catch {
    // Ignore malformed URLs and fall back to the media kind.
  }

  return kind === "audio" ? ".bin" : ".asset";
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeBufferAtomic(filePath, buffer) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, buffer);
  await rename(tempPath, filePath);
}

async function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(tempPath, payload, "utf8");
  await rename(tempPath, filePath);
}

function buildFakeAudioBuffer() {
  const header = Buffer.from("ID3");
  const payload = Buffer.alloc(DEFAULT_AUDIO_SIZE, 0);
  header.copy(payload, 0);

  for (let index = header.length; index < payload.length; index += 1) {
    payload[index] = index % 251;
  }

  return payload;
}

async function loadFixtures() {
  const imagePath = path.join(repoRoot, "public", "GoerDynamics.png");
  const imageBuffer = await readFile(imagePath);
  const audioBuffer = buildFakeAudioBuffer();

  return {
    "/test.png": {
      body: imageBuffer,
      contentType: "image/png",
    },
    "/test.mp3": {
      body: audioBuffer,
      contentType: "audio/mpeg",
    },
  };
}

async function startFixtureServer(fixtures) {
  const hitCounts = new Map();

  const server = createServer((request, response) => {
    const requestPath = request.url ? new URL(request.url, "http://127.0.0.1").pathname : "/";
    const fixture = fixtures[requestPath];
    hitCounts.set(requestPath, (hitCounts.get(requestPath) ?? 0) + 1);

    if (!fixture) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("missing");
      return;
    }

    response.writeHead(200, {
      "Content-Type": fixture.contentType,
      "Content-Length": String(fixture.body.length),
      "Cache-Control": "no-store",
      "Accept-Ranges": "bytes",
    });
    response.end(fixture.body);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve fixture server address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    hitCounts,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

class UnifiedDiskMediaCache {
  constructor(cacheDir) {
    this.cacheDir = cacheDir;
  }

  getKey(kind, sourceUrl) {
    return sha256(`${kind}:${new URL(sourceUrl).toString()}`);
  }

  getMetaPath(kind, key) {
    return path.join(this.cacheDir, kind, `${key}.json`);
  }

  async readMeta(kind, key) {
    const metaPath = this.getMetaPath(kind, key);
    if (!(await exists(metaPath))) {
      return null;
    }

    const raw = await readFile(metaPath, "utf8");
    return JSON.parse(raw);
  }

  async resolveCacheHit(kind, sourceUrl) {
    const key = this.getKey(kind, sourceUrl);
    const meta = await this.readMeta(kind, key);
    if (!meta) {
      return null;
    }

    const filePath = path.join(this.cacheDir, kind, meta.fileName);
    if (!(await exists(filePath))) {
      return null;
    }

    return {
      key,
      meta,
      filePath,
    };
  }

  async fetchAndCache(kind, sourceUrl) {
    await mkdir(path.join(this.cacheDir, kind), { recursive: true });

    const cached = await this.resolveCacheHit(kind, sourceUrl);
    if (cached) {
      return {
        source: "disk",
        filePath: cached.filePath,
        meta: cached.meta,
      };
    }

    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`Upstream fetch failed for ${sourceUrl}: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "";
    const extension = inferExtension(contentType, sourceUrl, kind);
    const key = this.getKey(kind, sourceUrl);
    const fileName = `${key}${extension}`;
    const filePath = path.join(this.cacheDir, kind, fileName);

    await writeBufferAtomic(filePath, buffer);
    await writeJsonAtomic(this.getMetaPath(kind, key), {
      kind,
      sourceUrl,
      contentType: contentType.split(";")[0].trim() || "",
      byteLength: buffer.length,
      fileName,
      cachedAt: new Date().toISOString(),
    });

    const meta = await this.readMeta(kind, key);
    return {
      source: "network",
      filePath,
      meta,
    };
  }

  async readRange(kind, sourceUrl, start, endInclusive) {
    const cached = await this.fetchAndCache(kind, sourceUrl);
    const fullBuffer = await readFile(cached.filePath);
    const normalizedStart = Math.max(0, start);
    const normalizedEnd = Math.min(endInclusive, fullBuffer.length - 1);

    if (normalizedEnd < normalizedStart) {
      throw new Error(`Invalid byte range ${start}-${endInclusive}`);
    }

    return {
      source: "disk",
      start: normalizedStart,
      end: normalizedEnd,
      byteLength: normalizedEnd - normalizedStart + 1,
      buffer: fullBuffer.subarray(normalizedStart, normalizedEnd + 1),
    };
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
}

async function listCacheArtifacts(cacheDir) {
  const results = [];

  for (const kind of ["image", "audio"]) {
    const kindDir = path.join(cacheDir, kind);
    if (!(await exists(kindDir))) {
      continue;
    }

    const entries = await readdir(kindDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const filePath = path.join(kindDir, entry.name);
      const fileStats = await stat(filePath);
      results.push({
        kind,
        name: entry.name,
        bytes: fileStats.size,
      });
    }
  }

  return results.sort((left, right) => left.name.localeCompare(right.name));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cacheDir =
    options.cacheDir ||
    (await mkdtemp(path.join(os.tmpdir(), "gdlab-unified-media-cache-")));

  await mkdir(cacheDir, { recursive: true });

  const fixtures = await loadFixtures();
  const fixtureServer = await startFixtureServer(fixtures);
  const imageUrl = `${fixtureServer.baseUrl}/test.png`;
  const audioUrl = `${fixtureServer.baseUrl}/test.mp3`;

  try {
    const cacheRoundOne = new UnifiedDiskMediaCache(cacheDir);
    const imageRoundOne = await cacheRoundOne.fetchAndCache("image", imageUrl);
    const audioRoundOne = await cacheRoundOne.fetchAndCache("audio", audioUrl);

    const imageRoundTwo = await cacheRoundOne.fetchAndCache("image", imageUrl);
    const audioRoundTwo = await cacheRoundOne.fetchAndCache("audio", audioUrl);

    const cacheAfterRestart = new UnifiedDiskMediaCache(cacheDir);
    const imageAfterRestart = await cacheAfterRestart.fetchAndCache("image", imageUrl);
    const audioAfterRestart = await cacheAfterRestart.fetchAndCache("audio", audioUrl);
    const audioRange = await cacheAfterRestart.readRange("audio", audioUrl, 128, 1023);

    assertEqual(imageRoundOne.source, "network", "Image first request should hit network");
    assertEqual(audioRoundOne.source, "network", "Audio first request should hit network");
    assertEqual(imageRoundTwo.source, "disk", "Image second request should hit disk");
    assertEqual(audioRoundTwo.source, "disk", "Audio second request should hit disk");
    assertEqual(imageAfterRestart.source, "disk", "Image should stay on disk after restart");
    assertEqual(audioAfterRestart.source, "disk", "Audio should stay on disk after restart");
    assertEqual(fixtureServer.hitCounts.get("/test.png") ?? 0, 1, "Image upstream hit count");
    assertEqual(fixtureServer.hitCounts.get("/test.mp3") ?? 0, 1, "Audio upstream hit count");
    assertEqual(audioRange.byteLength, 896, "Audio range byte length");

    const artifacts = await listCacheArtifacts(cacheDir);
    const summary = {
      cacheDir,
      requests: {
        image: [
          imageRoundOne.source,
          imageRoundTwo.source,
          imageAfterRestart.source,
        ],
        audio: [
          audioRoundOne.source,
          audioRoundTwo.source,
          audioAfterRestart.source,
        ],
      },
      upstreamHits: {
        image: fixtureServer.hitCounts.get("/test.png") ?? 0,
        audio: fixtureServer.hitCounts.get("/test.mp3") ?? 0,
      },
      audioRange: {
        source: audioRange.source,
        start: audioRange.start,
        end: audioRange.end,
        byteLength: audioRange.byteLength,
      },
      artifacts,
    };

    console.log("Unified media disk-cache verification passed.");
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await fixtureServer.close();
  }

  if (!options.keepCache) {
    await rm(cacheDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("Unified media disk-cache verification failed.");
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
