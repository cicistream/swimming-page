import fs from "node:fs/promises";
import path from "node:path";

function timestampLabel() {
  return new Date().toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  });
}

export async function loadSampleJsonProvider({ config, rootDir }) {
  const configuredPath = config.provider?.sampleJson?.path ?? "sample-data/swims.json";
  const sourcePath = path.join(rootDir, configuredPath);
  const raw = await fs.readFile(sourcePath, "utf8");

  return {
    provider: "sample_json",
    inputPath: configuredPath,
    sessions: JSON.parse(raw),
    staleButValid: false,
    warnings: [],
    lastSuccessfulSyncLabel: timestampLabel(),
  };
}
