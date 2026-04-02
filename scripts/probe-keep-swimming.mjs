import fs from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const outputDir = path.join(rootDir, "data", "sources", "keep-probe");

const LOGIN_API = "https://api.gotokeep.com/v1.1/users/login";
const LIST_API = "https://api.gotokeep.com/pd/v3/stats/detail";
const DEFAULT_DETAIL_API = "https://api.gotokeep.com/pd/v3/{sportType}log/{runId}";
const DEFAULT_CANDIDATE_TYPES = [
  "swimming",
  "swim",
  "poolSwimming",
  "indoorSwimming",
  "innerPoolSwimming",
  "outPoolSwimming",
  "outdoorSwimming",
  "openWaterSwimming",
  "pool_swimming",
  "indoor_swimming",
  "open_water_swimming",
];

const DEFAULT_DETAIL_SUBTYPES = [
  "swimming",
  "swim",
  "poolSwimming",
  "indoorSwimming",
  "innerPoolSwimming",
  "outPoolSwimming",
  "outdoorSwimming",
  "openWaterSwimming",
  "pool_swimming",
  "indoor_swimming",
  "open_water_swimming",
];

function printUsage() {
  console.log("Usage:");
  console.log("  npm run probe:keep:swimming -- --phone 13800000000 --password 'your-password'");
  console.log("");
  console.log("Options:");
  console.log("  --phone <value>          Keep phone number");
  console.log("  --password <value>       Keep password");
  console.log("  --type <value>           Sport type to probe, defaults to swimming");
  console.log("  --types <a,b,c>          Probe multiple sport types in one run");
  console.log("  --default-types          Probe a built-in set of swimming candidate types");
  console.log("  --detail-path <value>    Override detail path template");
  console.log("  --detail-candidates      Try several likely training log detail paths");
  console.log("  --save-prefix <value>    Prefix for saved probe files");
  console.log("  --help                   Show this message");
}

function parseArgs(argv) {
  const args = {
    phone: undefined,
    password: undefined,
    type: "swimming",
    types: [],
    useDefaultTypes: false,
    detailPath: DEFAULT_DETAIL_API,
    detailCandidates: false,
    savePrefix: "swimming",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--phone") {
      args.phone = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--password") {
      args.password = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--type") {
      args.type = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--types") {
      args.types = String(argv[index + 1] ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }

    if (value === "--default-types") {
      args.useDefaultTypes = true;
      continue;
    }

    if (value === "--detail-path") {
      args.detailPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--detail-candidates") {
      args.detailCandidates = true;
      continue;
    }

    if (value === "--save-prefix") {
      args.savePrefix = argv[index + 1];
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

async function ensureOutputDir() {
  await fs.mkdir(outputDir, { recursive: true });
}

async function saveJson(fileName, payload) {
  await ensureOutputDir();
  const target = path.join(outputDir, fileName);
  await fs.writeFile(target, JSON.stringify(payload, null, 2));
  return target;
}

async function loginKeep({ phone, password }) {
  const response = await fetch(LOGIN_API, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "user-agent": "Deep-Water-Swimming-Page/0.1",
    },
    body: new URLSearchParams({
      mobile: phone,
      password,
    }),
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Keep login returned non-JSON response (${response.status}).`);
  }

  if (!response.ok) {
    throw new Error(`Keep login failed with HTTP ${response.status}: ${text.slice(0, 240)}`);
  }

  const token = json?.data?.token;
  if (!token) {
    throw new Error(`Keep login succeeded but no token was found: ${text.slice(0, 240)}`);
  }

  return { token, raw: json };
}

async function fetchList({ token, sportType }) {
  const url = new URL(LIST_API);
  url.searchParams.set("dateUnit", "all");
  url.searchParams.set("type", sportType);
  url.searchParams.set("lastDate", "0");

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      "user-agent": "Deep-Water-Swimming-Page/0.1",
    },
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Keep list API returned non-JSON response (${response.status}).`);
  }

  return { ok: response.ok, status: response.status, url: url.toString(), raw: json };
}

function pickFirstRecord(raw) {
  if (Array.isArray(raw?.data?.records) && raw.data.records.length > 0) return raw.data.records[0];
  if (Array.isArray(raw?.data) && raw.data.length > 0) return raw.data[0];
  if (Array.isArray(raw?.records) && raw.records.length > 0) return raw.records[0];
  return null;
}

function pickFirstStatsLog(record) {
  if (!Array.isArray(record?.logs)) {
    return null;
  }

  for (const entry of record.logs) {
    if (entry?.type === "stats" && entry?.stats && typeof entry.stats === "object") {
      return entry.stats;
    }
  }

  return null;
}

function pickRunId(record) {
  const candidates = [record?.runId, record?.id, record?.logId, record?.trackId, record?.meta?.runId];
  for (const candidate of candidates) {
    if (candidate != null && candidate !== "") return String(candidate);
  }
  return null;
}

async function fetchDetail({ token, sportType, runId, detailPath }) {
  const url = detailPath
    .replace("{sportType}", encodeURIComponent(sportType))
    .replace("{runId}", encodeURIComponent(runId));

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      "user-agent": "Deep-Water-Swimming-Page/0.1",
    },
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { nonJsonBody: text };
  }

  return { ok: response.ok, status: response.status, url, raw: json };
}

function buildDetailCandidates({ sportType, runId, statsRecord }) {
  const schema = typeof statsRecord?.schema === "string" ? statsRecord.schema : null;
  const schemaRestPath = schema?.startsWith("keep://")
    ? schema.replace("keep://", "")
    : null;

  const candidates = [
    DEFAULT_DETAIL_API
      .replace("{sportType}", encodeURIComponent(sportType))
      .replace("{runId}", encodeURIComponent(runId)),
    `https://api.gotokeep.com/pd/v3/traininglogs/${encodeURIComponent(runId)}`,
    `https://api.gotokeep.com/pd/v3/traininglogs/${encodeURIComponent(runId)}/detail`,
    `https://api.gotokeep.com/training/v1/logs/${encodeURIComponent(runId)}`,
  ];

  for (const subtype of DEFAULT_DETAIL_SUBTYPES) {
    const encodedSubtype = encodeURIComponent(subtype);
    candidates.push(
      `https://api.gotokeep.com/pd/v3/traininglogs/${encodeURIComponent(runId)}?subtype=${encodedSubtype}`,
    );
    candidates.push(
      `https://api.gotokeep.com/pd/v3/traininglogs/${encodeURIComponent(runId)}?subtype=${encodedSubtype}&dataType=swimming`,
    );
    candidates.push(
      `https://api.gotokeep.com/pd/v3/traininglogs/${encodeURIComponent(runId)}/detail?subtype=${encodedSubtype}`,
    );
    candidates.push(
      `https://api.gotokeep.com/pd/v3/traininglogs/${encodeURIComponent(runId)}/detail?subtype=${encodedSubtype}&dataType=swimming`,
    );
    candidates.push(
      `https://api.gotokeep.com/training/v1/logs/${encodeURIComponent(runId)}?subtype=${encodedSubtype}`,
    );
    candidates.push(
      `https://api.gotokeep.com/training/v1/logs/${encodeURIComponent(runId)}?subtype=${encodedSubtype}&dataType=swimming`,
    );
  }

  if (schemaRestPath) {
    candidates.push(`https://api.gotokeep.com/pd/v3/${schemaRestPath}`);
    candidates.push(`https://api.gotokeep.com/${schemaRestPath}`);
  }

  return [...new Set(candidates)];
}

async function fetchDetailCandidates({ token, sportType, runId, statsRecord, savePrefix }) {
  const candidates = buildDetailCandidates({ sportType, runId, statsRecord });
  const results = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidateUrl = candidates[index];
    const response = await fetch(candidateUrl, {
      headers: {
        authorization: `Bearer ${token}`,
        "user-agent": "Deep-Water-Swimming-Page/0.1",
      },
    });

    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { nonJsonBody: text };
    }

    const result = {
      candidateIndex: index,
      requestUrl: candidateUrl,
      status: response.status,
      ok: response.ok,
      raw: json,
    };
    results.push(result);

    await saveJson(`${savePrefix}-${sportType}-detail-candidate-${index}.json`, {
      fetchedAt: new Date().toISOString(),
      sportType,
      runId,
      ...result,
    });

    if (response.ok) {
      return { matched: result, results };
    }
  }

  return { matched: null, results };
}

function summarizeRecord(record) {
  if (!record) return null;

  const stats = pickFirstStatsLog(record) ?? record;

  return {
    keys: Object.keys(record),
    statsKeys: stats && stats !== record ? Object.keys(stats) : undefined,
    runId: pickRunId(stats),
    type: stats?.type ?? null,
    subtype: stats?.subtype ?? null,
    dataType: stats?.dataType ?? null,
    distance: stats?.distance ?? stats?.distanceMeters ?? null,
    duration: stats?.duration ?? stats?.durationSeconds ?? null,
    startTime: stats?.startTime ?? stats?.startDate ?? stats?.startedAt ?? null,
  };
}

async function probeSportType({ token, sportType, detailPath, detailCandidates, savePrefix }) {
  const listResult = await fetchList({ token, sportType });
  const listFile = await saveJson(`${savePrefix}-${sportType}-list.json`, {
    fetchedAt: new Date().toISOString(),
    sportType,
    requestUrl: listResult.url,
    status: listResult.status,
    ok: listResult.ok,
    raw: listResult.raw,
  });

  console.log(`Saved Keep list response for "${sportType}" to ${path.relative(rootDir, listFile)}`);

  if (!listResult.ok) {
    return {
      sportType,
      listStatus: listResult.status,
      hasRecords: false,
      detailStatus: null,
      firstRecordSummary: null,
      detailSummary: null,
    };
  }

  const firstRecord = pickFirstRecord(listResult.raw);
  if (!firstRecord) {
    return {
      sportType,
      listStatus: listResult.status,
      hasRecords: false,
      detailStatus: null,
      firstRecordSummary: null,
      detailSummary: null,
    };
  }

  const statsRecord = pickFirstStatsLog(firstRecord) ?? firstRecord;
  const runId = pickRunId(statsRecord);
  const firstRecordSummary = summarizeRecord(firstRecord);
  if (!runId) {
    return {
      sportType,
      listStatus: listResult.status,
      hasRecords: true,
      detailStatus: null,
      firstRecordSummary,
      detailSummary: { note: "No run ID found in first record" },
    };
  }

  const detailResult = detailCandidates
    ? await fetchDetailCandidates({ token, sportType, runId, statsRecord, savePrefix })
    : { matched: await fetchDetail({ token, sportType, runId, detailPath }), results: [] };

  const resolvedDetail = detailResult.matched ?? detailResult.results.at(-1);
  const detailFile = resolvedDetail
    ? await saveJson(`${savePrefix}-${sportType}-detail-${runId}.json`, {
        fetchedAt: new Date().toISOString(),
        sportType,
        runId,
        requestUrl: resolvedDetail.requestUrl ?? resolvedDetail.url,
        status: resolvedDetail.status,
        ok: resolvedDetail.ok,
        raw: resolvedDetail.raw,
        triedCandidates: detailResult.results.map((item) => ({
          requestUrl: item.requestUrl,
          status: item.status,
          ok: item.ok,
        })),
      })
    : null;

  const detailData = resolvedDetail?.raw?.data ?? resolvedDetail?.raw;
  const detailSummary =
    detailData && typeof detailData === "object"
      ? {
          topLevelKeys: Object.keys(detailData),
          dataType: detailData.dataType ?? null,
          distance: detailData.distance ?? detailData.distanceMeters ?? null,
          duration: detailData.duration ?? detailData.durationSeconds ?? null,
          hasGeoPoints: Boolean(detailData.geoPoints),
          hasHeartRate: Boolean(detailData.heartRate),
          hasSwolf: detailData.swolf != null,
          hasStroke: detailData.stroke != null,
          hasPoolLength: detailData.poolLength != null || detailData.poolLengthMeters != null,
        }
      : null;

  if (detailFile) {
    console.log(`Saved Keep detail response for "${sportType}" to ${path.relative(rootDir, detailFile)}`);
  }

  return {
    sportType,
    listStatus: listResult.status,
    hasRecords: true,
    detailStatus: resolvedDetail?.status ?? null,
    firstRecordSummary,
    detailSummary,
    detailPathMatched: detailResult.matched?.requestUrl ?? null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.phone || !args.password) {
    printUsage();
    throw new Error("Missing --phone or --password.");
  }

  const login = await loginKeep({ phone: args.phone, password: args.password });
  const sportTypes = [
    ...new Set([
      ...(args.useDefaultTypes ? DEFAULT_CANDIDATE_TYPES : []),
      ...args.types,
      ...(args.types.length === 0 && !args.useDefaultTypes ? [args.type] : []),
    ]),
  ];

  const summaries = [];
  const listFiles = {};
  for (const sportType of sportTypes) {
    console.log(`\n== Probing sport type: ${sportType} ==`);
    const summary = await probeSportType({
      token: login.token,
      sportType,
      detailPath: args.detailPath,
      detailCandidates: args.detailCandidates,
      savePrefix: args.savePrefix,
    });
    summaries.push(summary);
    listFiles[sportType] = args.savePrefix + "-" + sportType + "-list.json";

    console.log(JSON.stringify(summary, null, 2));
  }

  const summaryFile = await saveJson(`${args.savePrefix}-summary.json`, {
    fetchedAt: new Date().toISOString(),
    sportTypes,
    listFiles,
    summaries,
  });

  console.log(`\nSaved aggregate probe summary to ${path.relative(rootDir, summaryFile)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
