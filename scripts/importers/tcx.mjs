import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: true,
  trimValues: true,
});

function asArray(value) {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function pickPoolLengthMeters(laps) {
  for (const lap of laps) {
    const candidates = [
      lap?.Extensions?.LX?.PoolLengthMeters,
      lap?.Extensions?.LX?.PoolLength,
      lap?.Extensions?.LX?.LengthMeters,
      lap?.Extensions?.LX?.lengthMeters,
      lap?.Extensions?.PoolLengthMeters,
      lap?.Extensions?.PoolLength,
      lap?.Extensions?.LengthMeters,
      lap?.PoolLengthMeters,
      lap?.PoolLength,
      lap?.LengthMeters,
    ];

    const lengthMeters = candidates
      .map((value) => Number(value))
      .find((value) => Number.isFinite(value) && value > 0);
    if (Number.isFinite(lengthMeters)) {
      return lengthMeters;
    }
  }
  return 25;
}

function normalizeStroke(lap) {
  const value = lap?.Extensions?.LX?.SwimStroke;
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.includes("free")) return "Freestyle";
  if (normalized.includes("back")) return "Backstroke";
  if (normalized.includes("breast")) return "Breaststroke";
  if (normalized.includes("fly")) return "Butterfly";
  if (normalized.includes("medley") || normalized.includes("mixed")) return "Mixed";
  return value;
}

function parseLapCount(distanceMeters, poolLengthMeters) {
  if (!distanceMeters || !poolLengthMeters) {
    return null;
  }

  const laps = Math.round(distanceMeters / poolLengthMeters);
  return Number.isFinite(laps) ? laps : null;
}

export function parseTcxSwims(xml, sourceName) {
  const doc = parser.parse(xml);
  const activities = asArray(
    doc?.TrainingCenterDatabase?.Activities?.Activity ??
      doc?.Activities?.Activity,
  );

  const swims = [];

  for (const activity of activities) {
    const sport = typeof activity?.Sport === "string" ? activity.Sport.toLowerCase() : "";
    const laps = asArray(activity?.Lap);
    const id = activity?.Id;
    if (!id || laps.length === 0) {
      continue;
    }

    const totalDistanceMeters = laps.reduce((sum, lap) => sum + Number(lap?.DistanceMeters ?? 0), 0);
    const totalDurationSeconds = laps.reduce((sum, lap) => sum + Number(lap?.TotalTimeSeconds ?? 0), 0);
    const title = `${sourceName} import`;
    const startedAt = new Date(id).toISOString();
    if (!Number.isFinite(totalDistanceMeters) || !Number.isFinite(totalDurationSeconds) || totalDistanceMeters <= 0 || totalDurationSeconds <= 0) {
      continue;
    }

    if (sport && !sport.includes("swim")) {
      continue;
    }

    const poolLengthMeters = pickPoolLengthMeters(laps);
    const pacePer100mSeconds = Math.round((totalDurationSeconds / totalDistanceMeters) * 100);
    const stroke = normalizeStroke(laps.find((lap) => normalizeStroke(lap)) ?? null);

    swims.push({
      id: `tcx-${startedAt}-${totalDistanceMeters}`,
      source: "sample_json",
      sourceActivityId: String(id),
      startedAt,
      timezone: "Asia/Shanghai",
      title,
      distanceMeters: Math.round(totalDistanceMeters),
      durationSeconds: Math.round(totalDurationSeconds),
      pacePer100mSeconds,
      poolLengthMeters,
      laps: parseLapCount(totalDistanceMeters, poolLengthMeters),
      stroke,
      swolf: null,
      calories: null,
      notes: `Imported from TCX file ${sourceName}.`,
      location: null,
      isManualOverride: false,
    });
  }

  return swims.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}
