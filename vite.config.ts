import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { parseCsvSwims } from "./scripts/importers/csv.mjs";
import { parseGpxSwims } from "./scripts/importers/gpx.mjs";
import { parseTcxSwims } from "./scripts/importers/tcx.mjs";

function readJsonBody(req: import("node:http").IncomingMessage) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: import("node:http").ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function runScript(scriptPath: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const extension = path.extname(scriptPath).toLowerCase();
    const command = extension === ".py" ? "python3" : "node";
    const child = spawn(command, [scriptPath, ...args], {
      cwd: process.cwd(),
      env,
      stdio: "pipe",
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `${scriptPath} exited with code ${code}`));
    });
  });
}

async function buildWithProvider(providerOverride: string) {
  await runScript("scripts/build-data.mjs", [], {
    ...process.env,
    SWIM_PROVIDER_OVERRIDE: providerOverride,
  });
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function localAutomationPlugin() {
  const rootDir = process.cwd();
  const configPath = path.join(rootDir, "swim.config.json");

  return {
    name: "local-automation-api",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use("/api/dev/sync-keep", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed" });
          return;
        }

        if (!process.env.KEEP_PHONE || !process.env.KEEP_PASSWORD) {
          sendJson(res, 400, {
            error: "Missing KEEP_PHONE or KEEP_PASSWORD in the dev server environment.",
          });
          return;
        }

        try {
          await runScript("scripts/sync-keep-swim-probe.mjs", [], {
            ...process.env,
            SWIM_PROVIDER_OVERRIDE: "keep_swim_probe",
          });
          sendJson(res, 200, { ok: true });
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

      server.middlewares.use("/api/dev/import-data", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed" });
          return;
        }

        try {
          const body = (await readJsonBody(req)) as {
            fileName?: string;
            content?: string;
            base64?: string;
          };
          const fileName = body.fileName || "import.json";
          const content = body.content;
          const base64 = body.base64;
          const extension = path.extname(fileName).toLowerCase();
          const safeFileName = sanitizeFileName(fileName);

          if (!content && !base64) {
            sendJson(res, 400, { error: "Missing file content." });
            return;
          }

          const configRaw = await fs.readFile(configPath, "utf8");
          const config = JSON.parse(configRaw);
          const manualImportsDir = path.join(rootDir, "data", "sources", "manual-imports");

          if (extension === ".json") {
            const parsed = JSON.parse(content ?? "");
            const provider =
              Array.isArray(parsed) &&
              parsed.every(
                (item) =>
                  item &&
                  typeof item === "object" &&
                  "startedAt" in item &&
                  "distanceMeters" in item &&
                  "durationSeconds" in item,
              )
                ? "sample_json"
                : "huawei_health";

            let targetRelativePath = "";
            if (provider === "sample_json") {
              if (!Array.isArray(parsed)) {
                sendJson(res, 400, { error: "Sample JSON import expects a JSON array." });
                return;
              }
              targetRelativePath = config.provider?.sampleJson?.path ?? "sample-data/swims.json";
            } else if (provider === "huawei_health") {
              targetRelativePath =
                config.provider?.huaweiHealth?.rawDataPath ?? "data/sources/huawei-health/export.json";
            } else {
              sendJson(res, 400, { error: `Unsupported provider: ${provider}` });
              return;
            }

            const targetPath = path.join(rootDir, targetRelativePath);
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            await fs.writeFile(targetPath, JSON.stringify(parsed, null, 2));
            await buildWithProvider(provider);

            sendJson(res, 200, {
              ok: true,
              provider,
              fileName,
              targetPath: targetRelativePath,
              refreshTriggered: true,
              message:
                provider === "sample_json"
                  ? "Sample JSON imported and page refreshed."
                  : "Provider JSON imported and page refreshed.",
            });
            return;
          }

          if (extension === ".fit") {
            const fitDir = path.join(rootDir, "data", "sources", "fit-probe", "imports");
            const targetPath = path.join(fitDir, safeFileName);
            await fs.mkdir(fitDir, { recursive: true });
            await fs.writeFile(targetPath, Buffer.from(base64 ?? "", "base64"));
            await runScript("scripts/probe_fit_swim_fields.py", ["--dir", fitDir], {
              ...process.env,
            });

            sendJson(res, 200, {
              ok: true,
              fileName,
              targetPath: path.relative(rootDir, targetPath),
              refreshTriggered: false,
              message:
                "FIT file imported and swim field probe refreshed. This file is staged for analysis, not yet mapped into the page.",
            });
            return;
          }

          if (extension === ".tcx" || extension === ".xml") {
            const xmlContent =
              content != null ? content : Buffer.from(base64 ?? "", "base64").toString("utf8");
            const sessions = parseTcxSwims(xmlContent, fileName);
            if (sessions.length === 0) {
              sendJson(res, 400, {
                error:
                  "No swim activities were found in this TCX/XML file. The current importer only supports swim TCX activity payloads.",
              });
              return;
            }

            const targetRelativePath = config.provider?.sampleJson?.path ?? "sample-data/swims.json";
            const targetPath = path.join(rootDir, targetRelativePath);
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            await fs.writeFile(targetPath, JSON.stringify(sessions, null, 2));
            await buildWithProvider("sample_json");

            sendJson(res, 200, {
              ok: true,
              fileName,
              targetPath: targetRelativePath,
              refreshTriggered: true,
              message: `Imported ${sessions.length} swim session${sessions.length === 1 ? "" : "s"} from TCX and refreshed the page.`,
            });
            return;
          }

          if (extension === ".gpx") {
            const xmlContent =
              content != null ? content : Buffer.from(base64 ?? "", "base64").toString("utf8");
            const sessions = parseGpxSwims(xmlContent, fileName);
            if (sessions.length === 0) {
              sendJson(res, 400, {
                error:
                  "No swim tracks were found in this GPX file. The current importer expects track names that indicate swimming.",
              });
              return;
            }

            const targetRelativePath = config.provider?.sampleJson?.path ?? "sample-data/swims.json";
            const targetPath = path.join(rootDir, targetRelativePath);
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            await fs.writeFile(targetPath, JSON.stringify(sessions, null, 2));
            await buildWithProvider("sample_json");

            sendJson(res, 200, {
              ok: true,
              fileName,
              targetPath: targetRelativePath,
              refreshTriggered: true,
              message: `Imported ${sessions.length} swim session${sessions.length === 1 ? "" : "s"} from GPX and refreshed the page.`,
            });
            return;
          }

          if (extension === ".csv") {
            const csvContent =
              content != null ? content : Buffer.from(base64 ?? "", "base64").toString("utf8");
            const sessions = parseCsvSwims(csvContent, fileName);
            if (sessions.length === 0) {
              sendJson(res, 400, {
                error:
                  "No valid swim rows were found in this CSV file. Try including columns like date/start time, distance, duration, and optional pool length or laps.",
              });
              return;
            }

            const targetRelativePath = config.provider?.sampleJson?.path ?? "sample-data/swims.json";
            const targetPath = path.join(rootDir, targetRelativePath);
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            await fs.writeFile(targetPath, JSON.stringify(sessions, null, 2));
            await buildWithProvider("sample_json");

            sendJson(res, 200, {
              ok: true,
              fileName,
              targetPath: targetRelativePath,
              refreshTriggered: true,
              message: `Imported ${sessions.length} swim session${sessions.length === 1 ? "" : "s"} from CSV and refreshed the page.`,
            });
            return;
          }

          if (extension === ".zip") {
            const targetPath = path.join(manualImportsDir, safeFileName);
            await fs.mkdir(manualImportsDir, { recursive: true });
            const buffer =
              base64 != null ? Buffer.from(base64, "base64") : Buffer.from(content ?? "", "utf8");
            await fs.writeFile(targetPath, buffer);

            sendJson(res, 200, {
              ok: true,
              fileName,
              targetPath: path.relative(rootDir, targetPath),
              refreshTriggered: false,
              message:
                `${extension.slice(1).toUpperCase()} file uploaded and staged for future mapping. The page was not rebuilt yet.`,
            });
            return;
          }

          sendJson(res, 400, {
            error:
              "Unsupported file type. Upload JSON, CSV, TCX/XML, or GPX for direct swim import, FIT for swim probing, or ZIP for staging.",
          });
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");

  return {
    base: env.VITE_BASE_PATH || "/",
    plugins: [react(), localAutomationPlugin()],
  };
});
