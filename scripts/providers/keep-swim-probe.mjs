import fs from "node:fs/promises";
import path from "node:path";

function timestampLabel() {
  return new Date().toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  });
}

export async function loadKeepSwimProbeProvider({ config, rootDir }) {
  const configuredPath =
    config.provider?.keepSwimProbe?.path ?? "data/sources/keep-probe/canonical-swims.draft.json";
  const sourcePath = path.join(rootDir, configuredPath);
  const raw = await fs.readFile(sourcePath, "utf8");
  const parsed = JSON.parse(raw);
  const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
  const warnings = [];

  if (sessions.length === 0) {
    warnings.push("Keep swim probe file exists at " + configuredPath + ", but no sessions were found.");
  }

  return {
    provider: "keep_swim_probe",
    inputPath: configuredPath,
    sessions,
    staleButValid: false,
    warnings,
    lastSuccessfulSyncLabel: timestampLabel(),
  };
}
