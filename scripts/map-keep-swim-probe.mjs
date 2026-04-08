import fs from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const probeDir = path.join(rootDir, "data", "sources", "keep-probe");
const defaultSummaryPath = path.join(probeDir, "swimming-summary.json");
const defaultOutputPath = path.join(probeDir, "canonical-swims.draft.json");

function printUsage() {
  console.log("Usage:");
  console.log("  npm run map:keep:swim-probe");
  console.log("  npm run map:keep:swim-probe -- --summary data/sources/keep-probe/swimming-summary.json");
  console.log("");
  console.log("Options:");
  console.log("  --summary <path>   Summary file produced by probe:keep:swimming");
  console.log("  --out <path>       Output path for the canonical draft JSON");
  console.log("  --help             Show this message");
}

function parseArgs(argv) {
  const args = {
    summary: defaultSummaryPath,
    out: defaultOutputPath,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--summary") {
      args.summary = path.resolve(rootDir, argv[index + 1]);
      index += 1;
      continue;
    }

    if (value === "--out") {
      args.out = path.resolve(rootDir, argv[index + 1]);
      index += 1;
      continue;
    }

    if (value === "--help" || value === "-h") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${value}`);
  }

  return args;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function pickRecords(raw) {
  if (Array.isArray(raw?.data?.records)) {
    return raw.data.records;
  }

  if (Array.isArray(raw?.data)) {
    return raw.data;
  }

  if (Array.isArray(raw?.records)) {
    return raw.records;
  }

  return [];
}

function deriveListPath({ summaryPath, summary, selectedSportType }) {
  const configuredListPath = summary?.listFiles?.[selectedSportType];
  if (typeof configuredListPath === "string" && configuredListPath.trim()) {
    return path.resolve(path.dirname(summaryPath), configuredListPath);
  }

  const summaryFileName = path.basename(summaryPath);
  const summaryPrefix = summaryFileName.endsWith("-summary.json")
    ? summaryFileName.slice(0, -"-summary.json".length)
    : "swimming";

  return path.join(path.dirname(summaryPath), summaryPrefix + "-" + selectedSportType + "-list.json");
}

function pickPreferredSportType(summary) {
  const withRecords = summary.summaries.filter((entry) => entry.hasRecords);
  if (withRecords.length === 0) {
    throw new Error("No Keep swim probe records found in summary.");
  }

  const preferredOrder = ["swim", "poolSwimming", "indoorSwimming", "outdoorSwimming", "openWaterSwimming"];
  for (const type of preferredOrder) {
    const match = withRecords.find((entry) => entry.sportType === type);
    if (match) {
      return match.sportType;
    }
  }

  return withRecords[0].sportType;
}

function decodeDistanceFromName(name) {
  if (typeof name !== "string") {
    return null;
  }

  const meterMatch = name.match(/(\d+(?:\.\d+)?)\s*米/);
  if (meterMatch) {
    return Math.round(Number(meterMatch[1]));
  }

  const kmMatch = name.match(/(\d+(?:\.\d+)?)\s*公里/);
  if (kmMatch) {
    return Math.round(Number(kmMatch[1]) * 1000);
  }

  return null;
}

function isSwimRecord(stats) {
  const title = typeof stats?.name === "string" ? stats.name : "";
  const subtype = typeof stats?.subtype === "string" ? stats.subtype.toLowerCase() : "";
  const schema = typeof stats?.schema === "string" ? stats.schema.toLowerCase() : "";
  const dataType = typeof stats?.dataType === "string" ? stats.dataType.toLowerCase() : "";

  if (/游泳|swim/i.test(title)) {
    return true;
  }

  if (subtype.includes("swim") || dataType.includes("swim")) {
    return true;
  }

  if (schema.includes("traininglogs/") && schema.includes("swimming")) {
    return true;
  }

  return false;
}

function buildCanonicalSession(stats) {
  if (!isSwimRecord(stats)) {
    return null;
  }

  const titleDistance = decodeDistanceFromName(stats.name);
  const titleImpliesPoolSwim = typeof stats?.name === "string" && /游泳池游泳|pool/i.test(stats.name);
  const distanceMeters =
    (titleImpliesPoolSwim && titleDistance ? titleDistance : null) ??
    (typeof stats.accurateDistance === "number" && stats.accurateDistance > 0 ? stats.accurateDistance : null) ??
    (typeof stats.distance === "number" && stats.distance > 0 ? stats.distance : null) ??
    titleDistance;
  const durationSeconds =
    (typeof stats.accurateDuration === "number" && stats.accurateDuration > 0 ? stats.accurateDuration : null) ??
    (typeof stats.duration === "number" && stats.duration > 0 ? stats.duration : null);

  if (!distanceMeters || !durationSeconds) {
    return null;
  }

  const pacePer100mSeconds = Math.round((durationSeconds / distanceMeters) * 100);
  const startedAt =
    typeof stats.startTime === "number" ? new Date(stats.startTime).toISOString() : stats.doneDate ?? null;

  if (!startedAt) {
    return null;
  }

  const averageHeartRate = stats.heartRate?.averageHeartRate ?? null;
  const maxHeartRate = stats.heartRate?.maxHeartRate ?? null;
  const vendor = stats.vendor?.manufacturer && stats.vendor?.deviceModel
    ? `${stats.vendor.manufacturer} ${stats.vendor.deviceModel}`
    : stats.vendor?.manufacturer ?? null;

  const noteParts = [
    "Mapped from Keep swimming probe list response.",
    vendor ? `Source device: ${vendor}.` : null,
    averageHeartRate ? `Avg HR: ${averageHeartRate}.` : null,
    maxHeartRate ? `Max HR: ${maxHeartRate}.` : null,
    stats.schema ? `Schema: ${stats.schema}.` : null,
  ].filter(Boolean);

  return {
    id: `keep-${stats.id}`,
    source: "keep_swim_probe",
    sourceActivityId: stats.id,
    startedAt,
    timezone: stats.timezone ?? "Asia/Shanghai",
    title: stats.name ?? "Keep swim session",
    distanceMeters,
    durationSeconds,
    pacePer100mSeconds,
    poolLengthMeters: null,
    laps: null,
    stroke: null,
    swolf: null,
    calories: stats.calorie ?? null,
    notes: noteParts.join(" "),
    location: null,
    isManualOverride: false,
    rawSource: {
      subtype: stats.subtype ?? null,
      dataType: stats.dataType ?? null,
      averageHeartRate,
      maxHeartRate,
      vendor: stats.vendor ?? null,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = await readJson(args.summary);
  const selectedSportType = pickPreferredSportType(summary);
  const listPath = deriveListPath({ summaryPath: args.summary, summary, selectedSportType });
  const listPayload = await readJson(listPath);
  const records = pickRecords(listPayload?.raw);

  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(`No records found in ${path.relative(rootDir, listPath)}.`);
  }

  const seenIds = new Set();
  const sessions = [];
  for (const dailyRecord of records) {
    for (const entry of dailyRecord.logs ?? []) {
      const stats = entry?.type === "stats" ? entry.stats : null;
      if (!stats?.id || seenIds.has(stats.id)) {
        continue;
      }

      const mapped = buildCanonicalSession(stats);
      if (mapped) {
        sessions.push(mapped);
        seenIds.add(stats.id);
      }
    }
  }

  sessions.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(
    args.out,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "keep_swim_probe",
        selectedSportType,
        inputSummaryPath: path.relative(rootDir, args.summary),
        inputListPath: path.relative(rootDir, listPath),
        sessions,
      },
      null,
      2,
    ),
  );

  console.log(`Mapped ${sessions.length} Keep swim sessions.`);
  console.log(`Selected Keep sport type: ${selectedSportType}`);
  console.log(`Saved canonical draft to ${path.relative(rootDir, args.out)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
