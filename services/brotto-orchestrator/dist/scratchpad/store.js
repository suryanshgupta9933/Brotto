/**
 * File-backed scratchpad store for long-horizon agent memory.
 *
 * Each session gets one append-only JSONL file under `<dataDir>/scratchpad/<sessionId>.jsonl`.
 * The model emits memory updates and verification checks; the orchestrator
 * persists them so context can stay compact (a summary is rendered, the full
 * log is fetched on demand via the read_scratchpad tool).
 *
 * ponytail: append-only JSONL is the simplest durable log. No index, no
 * compaction, no rotation. If the file ever needs to be large, switch to
 * sqlite or a per-bucket shard; until then the linear scan in
 * summarize.ts is fine for v1.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
export function createFileScratchpadStore(dataDir) {
    const dir = path.join(dataDir, "scratchpad");
    return {
        async append(sessionId, entry) {
            await fs.mkdir(dir, { recursive: true });
            const file = path.join(dir, `${sanitize(sessionId)}.jsonl`);
            const line = JSON.stringify(entry) + "\n";
            await fs.appendFile(file, line, "utf8");
        },
        async read(sessionId) {
            const file = path.join(dir, `${sanitize(sessionId)}.jsonl`);
            try {
                const text = await fs.readFile(file, "utf8");
                const out = [];
                for (const raw of text.split("\n")) {
                    const line = raw.trim();
                    if (!line)
                        continue;
                    try {
                        out.push(JSON.parse(line));
                    }
                    catch {
                        // ponytail: skip corrupt lines, do not crash the session.
                    }
                }
                return out;
            }
            catch (e) {
                if (isNotFound(e))
                    return [];
                throw e;
            }
        },
    };
}
// ponytail: keep filenames tight and shell-safe. sessionId is a UUID, but
// defensive normalization avoids any future shape change leaking path
// separators or NULs into the filename.
function sanitize(id) {
    return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128) || "session";
}
function isNotFound(e) {
    return !!e && typeof e === "object" && e.code === "ENOENT";
}
//# sourceMappingURL=store.js.map