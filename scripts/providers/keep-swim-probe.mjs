import fs from "node:fs/promises";
import path from "node:path";

function timestampLabel() {
  return new Date().toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  });
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function toLabel(value) {
  if (!value) {
    return "Unknown";
  }

  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  });
}

export async function loadKeepSwimProbeProvider({ config, rootDir }) {
  const configuredPath =
    config.provider?.keepSwimProbe?.path ?? "data/sources/keep-probe/canonical-swims.draft.json";
  const sourcePath = path.join(rootDir, configuredPath);
  const syncMetaPath = path.join(rootDir, "data", "sources", "keep-probe", "sync-meta.json");
  const staleAfterHours = config.provider?.keepSwimProbe?.staleAfterHours ?? 36;
  const raw = await fs.readFile(sourcePath, "utf8");
  const parsed = JSON.parse(raw);
  const syncMeta = await readJsonIfExists(syncMetaPath);
  const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
  const warnings = [];
  const lastSuccessfulSyncAt = syncMeta?.lastSuccessfulSyncAt ?? parsed?.generatedAt ?? null;
  const lastAttemptAt = syncMeta?.lastAttemptAt ?? null;
  const lastAttemptStatus = syncMeta?.lastAttemptStatus ?? null;
  const lastAttemptError = syncMeta?.lastAttemptError ?? null;
  const staleButValid =
    Boolean(lastSuccessfulSyncAt) &&
    sessions.length > 0 &&
    Date.now() - new Date(lastSuccessfulSyncAt).getTime() > staleAfterHours * 60 * 60 * 1000;

  if (sessions.length === 0) {
    warnings.push("Keep swim probe file exists at " + configuredPath + ", but no sessions were found.");
  }

  if (lastAttemptStatus === "failed" && lastAttemptError) {
    warnings.push(`Last Keep sync failed at ${toLabel(lastAttemptAt)}: ${lastAttemptError}`);
  }

  return {
    provider: "keep_swim_probe",
    inputPath: configuredPath,
    sessions,
    staleButValid,
    warnings,
    lastSuccessfulSyncAt,
    lastSuccessfulSyncLabel: toLabel(lastSuccessfulSyncAt),
    lastAttemptAt,
    lastAttemptLabel: lastAttemptAt ? toLabel(lastAttemptAt) : null,
    lastAttemptStatus,
    lastAttemptError,
  };
}
