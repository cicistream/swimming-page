import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

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

function runNodeScript(scriptPath: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("node", [scriptPath, ...args], {
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
  await runNodeScript("scripts/build-data.mjs", [], {
    ...process.env,
    SWIM_PROVIDER_OVERRIDE: providerOverride,
  });
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
          await runNodeScript("scripts/sync-keep-swim-probe.mjs", [], {
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
            provider?: string;
            fileName?: string;
            content?: string;
          };
          const provider = body.provider;
          const fileName = body.fileName || "import.json";
          const content = body.content;

          if (!provider || !content) {
            sendJson(res, 400, { error: "Missing provider or content." });
            return;
          }

          const parsed = JSON.parse(content);
          const configRaw = await fs.readFile(configPath, "utf8");
          const config = JSON.parse(configRaw);

          let targetRelativePath = "";
          if (provider === "sample_json") {
            if (!Array.isArray(parsed)) {
              sendJson(res, 400, { error: "Sample JSON import expects a JSON array." });
              return;
            }
            targetRelativePath = config.provider?.sampleJson?.path ?? "sample-data/swims.json";
          } else if (provider === "huawei_health") {
            targetRelativePath = config.provider?.huaweiHealth?.rawDataPath ?? "data/sources/huawei-health/export.json";
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
