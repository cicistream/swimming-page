import fs from "node:fs/promises";
import path from "node:path";
import { loadProviderPayload } from "./providers/index.mjs";

const rootDir = process.cwd();
const configPath = path.join(rootDir, "swim.config.json");
const privateDir = path.join(rootDir, "data", "private");
const publicDir = path.join(rootDir, "public", "generated");

const baseRequiredFields = [
  "id",
  "source",
  "sourceActivityId",
  "startedAt",
  "timezone",
  "distanceMeters",
  "durationSeconds",
  "pacePer100mSeconds",
];

const providerRequiredFields = {
  default: ["poolLengthMeters", "laps"],
  huawei_health: [],
  keep_swim_probe: [],
};

const optionalFields = ["stroke", "swolf", "calories", "notes", "location"];

function toLocalDateKey(input, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(input));
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return `${minutes}:${String(remain).padStart(2, "0")}`;
}

function formatLocalTime(input, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(input));
}

function getRequiredFieldsForSource(source) {
  return [...baseRequiredFields, ...(providerRequiredFields[source] ?? providerRequiredFields.default)];
}

function normalizeSession(raw) {
  const requiredFields = getRequiredFieldsForSource(raw.source);
  const missingRequired = requiredFields.filter((field) => raw[field] == null);
  if (missingRequired.length > 0) {
    return {
      status: "rejected",
      reason: "missing_required_field",
      missingRequired,
      raw,
    };
  }

  const missingOptional = optionalFields.filter((field) => raw[field] == null);
  const isPartial = missingOptional.length > 0;

  return {
    status: "accepted",
    session: {
      ...raw,
      isPartial,
      missingOptional,
      startedDateKey: toLocalDateKey(raw.startedAt, raw.timezone),
      startedTimeLabel: formatLocalTime(raw.startedAt, raw.timezone),
      durationLabel: formatDuration(raw.durationSeconds),
      paceLabel: `${formatDuration(raw.pacePer100mSeconds)}/100m`,
    },
  };
}

function buildSummary(sessions, providerPayload) {
  const totalDistanceMeters = sessions.reduce((sum, item) => sum + item.distanceMeters, 0);
  const totalDurationSeconds = sessions.reduce((sum, item) => sum + item.durationSeconds, 0);
  const averagePaceSeconds =
    sessions.length > 0
      ? Math.round(sessions.reduce((sum, item) => sum + item.pacePer100mSeconds, 0) / sessions.length)
      : 0;
  const partialCount = sessions.filter((item) => item.isPartial).length;

  return {
    totalDistanceMeters,
    totalDistanceKilometers: Number((totalDistanceMeters / 1000).toFixed(1)),
    totalSessions: sessions.length,
    totalDurationSeconds,
    totalDurationLabel: `${Math.floor(totalDurationSeconds / 3600)}h ${Math.round(
      (totalDurationSeconds % 3600) / 60,
    )}m`,
    averagePaceSeconds,
    averagePaceLabel: `${formatDuration(averagePaceSeconds)}/100m`,
    partialCount,
    lastSuccessfulSyncLabel: providerPayload.lastSuccessfulSyncLabel,
  };
}

function buildHeatmap(sessions) {
  const buckets = new Map();
  for (const session of sessions) {
    const existing = buckets.get(session.startedDateKey) ?? {
      date: session.startedDateKey,
      sessions: 0,
      distanceMeters: 0,
    };
    existing.sessions += 1;
    existing.distanceMeters += session.distanceMeters;
    buckets.set(session.startedDateKey, existing);
  }
  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function buildPublicSession(session, config) {
  return {
    id: session.id,
    source: session.source,
    title: session.title,
    startedAt: session.startedDateKey,
    startedAtPrecise: config.display.showPreciseTime ? session.startedAt : undefined,
    startedTimeLabel: session.startedTimeLabel,
    distanceMeters: session.distanceMeters,
    durationLabel: session.durationLabel,
    paceLabel: session.paceLabel,
    poolLengthMeters: session.poolLengthMeters,
    laps: session.laps,
    stroke: session.stroke,
    swolf: session.swolf,
    isPartial: session.isPartial,
    missingOptional: session.missingOptional,
    location: config.display.showExactLocation ? session.location : undefined,
    notes: config.display.showNotes ? session.notes : undefined,
    manualOverride: Boolean(session.isManualOverride),
  };
}

function buildSyncReport({ accepted, rejected, config, providerPayload }) {
  const status =
    providerPayload.lastAttemptStatus === "failed"
      ? "failed"
      : accepted.length > 0
      ? rejected.length > 0 || providerPayload.warnings.length > 0
        ? "partial_success"
        : "success"
      : "failed";

  return {
    status,
    provider: config.provider.selected,
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    partialCount: accepted.filter((item) => item.isPartial).length,
    staleButValid: providerPayload.staleButValid,
    lastSuccessfulSyncAt: providerPayload.lastSuccessfulSyncAt,
    lastSuccessfulSyncLabel: providerPayload.lastSuccessfulSyncLabel,
    lastAttemptAt: providerPayload.lastAttemptAt,
    lastAttemptLabel: providerPayload.lastAttemptLabel,
    lastAttemptStatus: providerPayload.lastAttemptStatus,
    lastAttemptError: providerPayload.lastAttemptError,
    warnings: providerPayload.warnings,
    inputPath: providerPayload.inputPath,
    rejections: rejected.map((item) => ({
      reason: item.reason,
      id: item.raw.id ?? "unknown",
      missingRequired: item.missingRequired,
    })),
  };
}

async function main() {
  const configRaw = await fs.readFile(configPath, "utf8");
  const config = JSON.parse(configRaw);
  const providerPayload = await loadProviderPayload({ config, rootDir });
  const activeProvider = providerPayload.selectedProvider ?? config.provider.selected;

  const normalized = providerPayload.sessions.map(normalizeSession);
  const accepted = normalized
    .filter((item) => item.status === "accepted")
    .map((item) => item.session)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  const rejected = normalized.filter((item) => item.status === "rejected");

  const summary = buildSummary(accepted, providerPayload);
  const heatmap = buildHeatmap(accepted);
  const latest = accepted[0] ? buildPublicSession(accepted[0], config) : null;
  const activities = accepted.map((item) => buildPublicSession(item, config));
  const syncReport = buildSyncReport({
    accepted,
    rejected,
    config: {
      ...config,
      provider: {
        ...config.provider,
        selected: activeProvider,
      },
    },
    providerPayload,
  });
  const providerStatus = {
    selected: activeProvider,
    capabilities: config.provider.capabilityMatrix[activeProvider],
    freshness: syncReport.staleButValid ? "stale-but-valid" : "fresh",
    completeness: accepted.some((item) => item.isPartial) ? "partial" : "complete",
  };

  await fs.mkdir(privateDir, { recursive: true });
  await fs.mkdir(publicDir, { recursive: true });

  await Promise.all([
    fs.writeFile(
      path.join(privateDir, "canonical-swims.json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          provider: providerPayload.provider,
          inputPath: providerPayload.inputPath,
          warnings: providerPayload.warnings,
          sessions: accepted,
        },
        null,
        2,
      ),
    ),
    fs.writeFile(path.join(publicDir, "summary.json"), JSON.stringify(summary, null, 2)),
    fs.writeFile(path.join(publicDir, "activities.json"), JSON.stringify(activities, null, 2)),
    fs.writeFile(path.join(publicDir, "latest.json"), JSON.stringify(latest, null, 2)),
    fs.writeFile(path.join(publicDir, "heatmap.json"), JSON.stringify(heatmap, null, 2)),
    fs.writeFile(path.join(publicDir, "sync-report.json"), JSON.stringify(syncReport, null, 2)),
    fs.writeFile(
      path.join(publicDir, "config.json"),
      JSON.stringify(
        {
          profile: config.profile,
          providerStatus,
        },
        null,
        2,
      ),
    ),
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
