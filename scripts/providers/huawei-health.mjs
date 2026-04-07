import fs from "node:fs/promises";
import path from "node:path";
import { readHuaweiHealthAuthState } from "./huawei-health-auth.mjs";

function timestampLabel() {
  return new Date().toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  });
}

function pickFirst(...values) {
  for (const value of values) {
    if (value != null && value !== "") {
      return value;
    }
  }
  return undefined;
}

function toNumber(value) {
  if (value == null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toDurationSeconds(value) {
  const numeric = toNumber(value);
  if (numeric == null) {
    return undefined;
  }

  if (numeric > 1000000) {
    return Math.round(numeric / 1000);
  }

  return Math.round(numeric);
}

function toIsoDateTime(value) {
  if (value == null || value === "") {
    return undefined;
  }

  if (typeof value === "number") {
    const normalized = value > 1000000000000 ? value : value * 1000;
    return new Date(normalized).toISOString();
  }

  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString();
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(`${value.replace(" ", "T")}+08:00`).toISOString();
  }

  return undefined;
}

function normalizeStroke(value) {
  if (typeof value === "number") {
    if (value === 1) return "Breaststroke";
    if (value === 2) return "Freestyle";
    if (value === 3) return "Butterfly";
    if (value === 4) return "Backstroke";
    if (value === 5) return "Mixed";
    return undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (["free", "freestyle", "自由泳"].includes(normalized)) return "Freestyle";
  if (["back", "backstroke", "仰泳"].includes(normalized)) return "Backstroke";
  if (["breast", "breaststroke", "蛙泳"].includes(normalized)) return "Breaststroke";
  if (["fly", "butterfly", "蝶泳"].includes(normalized)) return "Butterfly";
  if (["mixed", "medley", "混合泳"].includes(normalized)) return "Mixed";
  return value;
}

function buildSessionTitle(raw) {
  const explicit = pickFirst(raw.title, raw.name, raw.trainingName, raw.sportName);
  if (explicit) {
    return String(explicit);
  }

  const swimType = pickFirst(raw.swimType, raw.scene, raw.activityType, raw.sportType);
  if (typeof swimType === "string" && /open|open_water|公开水域|开放水域/i.test(swimType)) {
    return "Open water swim";
  }

  return "Pool swim";
}

function pickActivitySummaryValue(raw, dataTypeName, fieldName) {
  const summaries = Array.isArray(raw?.activitySummary?.dataSummary) ? raw.activitySummary.dataSummary : [];

  for (const summary of summaries) {
    if (summary?.dataTypeName !== dataTypeName || !Array.isArray(summary?.value)) {
      continue;
    }

    for (const entry of summary.value) {
      if (entry?.fieldName === fieldName) {
        return pickFirst(entry.floatValue, entry.intValue, entry.longValue, entry.stringValue);
      }
    }
  }

  return undefined;
}

function pickSwimmingPoolFeature(raw, fieldName) {
  return pickActivitySummaryValue(raw, "com.huawei.activity.feature.swimming.pool", fieldName);
}

function normalizeHuaweiTimezone(value, fallbackTimezone) {
  if (typeof value === "string" && /^[+-]\d{4}$/.test(value)) {
    return `${value.slice(0, 3)}:${value.slice(3)}`;
  }

  return String(pickFirst(value, fallbackTimezone));
}

function normalizeHuaweiSession(raw, index, fallbackTimezone) {
  const startedAt = toIsoDateTime(
    pickFirst(raw.startedAt, raw.startTime, raw.start_time, raw.beginTime, raw.begin_time, raw.time?.start),
  );
  const distanceMeters = toNumber(
    pickFirst(
      raw.distanceMeters,
      raw.distance,
      raw.totalDistance,
      raw.totalDistanceMeters,
      raw.swimDistance,
      pickActivitySummaryValue(raw, "com.huawei.continuous.distance.total", "distance"),
    ),
  );
  const durationSeconds = toDurationSeconds(
    pickFirst(
      raw.durationSeconds,
      raw.duration,
      raw.totalTimeSeconds,
      raw.totalDuration,
      raw.durationMs,
      raw.activeTime,
    ),
  );
  const poolLengthMeters = toNumber(
    pickFirst(
      raw.poolLengthMeters,
      raw.poolLength,
      raw.pool_length,
      raw.laneLength,
      raw.laneDistanceMeters,
      pickSwimmingPoolFeature(raw, "pool_length"),
    ),
  );
  const derivedLaps =
    poolLengthMeters && distanceMeters ? Math.round(distanceMeters / poolLengthMeters) : undefined;
  const laps = toNumber(
    pickFirst(
      raw.laps,
      raw.lapCount,
      raw.trip_times,
      raw.lengths,
      raw.poolTrips,
      pickSwimmingPoolFeature(raw, "trip_times"),
      derivedLaps,
    ),
  );
  const pacePer100mSeconds =
    toDurationSeconds(pickFirst(raw.pacePer100mSeconds, raw.avgPacePer100mSeconds, raw.paceSecondsPer100m)) ??
    (distanceMeters && durationSeconds ? Math.round((durationSeconds / distanceMeters) * 100) : undefined);
  const sourceActivityId = String(
    pickFirst(raw.sourceActivityId, raw.activityId, raw.recordId, raw.uuid, raw.id, `huawei-${index + 1}`),
  );
  const timezone = normalizeHuaweiTimezone(pickFirst(raw.timezone, raw.tz, raw.timeZone), fallbackTimezone);

  return {
    id: String(pickFirst(raw.id, `${sourceActivityId}-${startedAt ?? index}`)),
    source: "huawei_health",
    sourceActivityId,
    startedAt,
    timezone,
    title: buildSessionTitle(raw),
    distanceMeters,
    durationSeconds,
    pacePer100mSeconds,
    poolLengthMeters,
    laps,
    stroke: normalizeStroke(
      pickFirst(raw.stroke, raw.swimStyle, raw.strokeType, raw.swimming_stroke, pickSwimmingPoolFeature(raw, "swimming_stroke")),
    ),
    swolf: toNumber(pickFirst(raw.swolf, raw.SWOLF, raw.avgSwolf, pickSwimmingPoolFeature(raw, "swolf"))),
    calories: toNumber(pickFirst(raw.calories, raw.totalCalories, raw.energy)),
    notes: pickFirst(raw.notes, raw.note, raw.memo, raw.desc),
    location: pickFirst(raw.location, raw.poolName, raw.venueName),
    isManualOverride: false,
    rawProviderPayload: raw,
  };
}

async function readJsonIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function loadHuaweiHealthProvider({ config, rootDir }) {
  const providerConfig = config.provider?.huaweiHealth ?? {};
  const mode = providerConfig.mode ?? "raw_json_file";
  const configuredPath = providerConfig.rawDataPath ?? "data/sources/huawei-health/export.json";
  const sourcePath = path.join(rootDir, configuredPath);
  const fallbackTimezone = providerConfig.timezone ?? "Asia/Shanghai";
  const rawJson = await readJsonIfExists(sourcePath);
  const authState = await readHuaweiHealthAuthState({ rootDir, providerConfig });

  const warnings = [];
  if (mode !== "raw_json_file") {
    if (authState.env.missing.length > 0) {
      warnings.push(`Missing Huawei Health env vars: ${authState.env.missing.join(", ")}`);
    }

    if (authState.status === "authorized") {
      warnings.push("Huawei Health auth scaffold has a usable token cache, but the live API pull is not wired in yet.");
    } else if (authState.status === "refreshable") {
      warnings.push("Huawei Health token cache has a refresh token but no live refresh flow yet.");
    } else if (authState.status === "env_ready") {
      warnings.push("Huawei Health env vars are present. The remaining work is wiring the live authorization and activity fetch flow.");
    }
  }

  if (rawJson == null) {
    warnings.push(`No Huawei Health raw export found at ${configuredPath}`);
    warnings.push("Drop a JSON export at that path or add an API sync step before build:data.");

    return {
      provider: "huawei_health",
      inputPath: configuredPath,
      sessions: [],
      staleButValid: false,
      warnings,
      lastSuccessfulSyncLabel: authState.syncMeta?.updatedAt ?? timestampLabel(),
    };
  }

  const parsed = JSON.parse(rawJson);
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.activityRecord)
      ? parsed.activityRecord
      : Array.isArray(parsed.sessions)
        ? parsed.sessions
        : Array.isArray(parsed.activities)
          ? parsed.activities
          : Array.isArray(parsed.data)
            ? parsed.data
            : [];

  if (rows.length === 0) {
    warnings.push(`Huawei Health import file exists at ${configuredPath}, but no activity array was found.`);
  }

  const sessions = rows.map((row, index) => normalizeHuaweiSession(row, index, fallbackTimezone));

  return {
    provider: "huawei_health",
    inputPath: configuredPath,
    sessions,
    staleButValid: false,
    warnings,
    lastSuccessfulSyncLabel: authState.syncMeta?.updatedAt ?? timestampLabel(),
  };
}
