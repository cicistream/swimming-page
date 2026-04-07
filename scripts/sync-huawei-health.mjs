import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  buildHuaweiHealthAuthorizationUrl,
  exchangeHuaweiHealthAuthorizationCode,
  refreshHuaweiHealthAccessToken,
  readHuaweiHealthAuthState,
  saveHuaweiHealthAuthorizationCode,
  writeHuaweiHealthTokenCache,
  writeHuaweiHealthApiScaffold,
  writeHuaweiHealthSyncMeta,
} from "./providers/huawei-health-auth.mjs";
import {
  fetchHuaweiHealthActivities,
  fetchHuaweiHealthActivityDetail,
  summarizeHuaweiHealthActivityEnvelope,
  writeHuaweiHealthRawActivities,
} from "./providers/huawei-health-api.mjs";

const rootDir = process.cwd();
const configPath = path.join(rootDir, "swim.config.json");

function printUsage() {
  console.log("Usage:");
  console.log("  npm run sync:huawei:health");
  console.log("  npm run sync:huawei:health -- --from /absolute/path/to/export.json");
  console.log("  npm run sync:huawei:health -- --print-auth-url");
  console.log("  npm run sync:huawei:health -- --authorization-code YOUR_CODE");
  console.log("  npm run sync:huawei:health -- --exchange-code");
  console.log("  npm run sync:huawei:health -- --refresh-access-token");
  console.log("  npm run sync:huawei:health -- --fetch-activities --mock-activities-response sample-data/huawei-health-export.sample.json");
  console.log("  npm run sync:huawei:health -- --fetch-activity-detail ACTIVITY_ID --mock-activities-response sample-data/huawei-health-export.sample.json");
  console.log("");
  console.log("Options:");
  console.log("  --from <path>      Optional Huawei Health raw JSON file to stage into the local cache");
  console.log("  --print-auth-url   Print the configured Huawei Health authorization URL if env/config are ready");
  console.log("  --authorization-code <code>  Store an OAuth authorization code in the local scaffold metadata");
  console.log("  --set-token <json> Store a token cache JSON string for local scaffold testing");
  console.log("  --exchange-code    Exchange the stored or provided authorization code for tokens");
  console.log("  --refresh-access-token  Refresh the stored access token using the cached refresh token");
  console.log("  --fetch-activities Fetch activities from the configured Huawei endpoint or a mock JSON response");
  console.log("  --fetch-activity-detail <id>  Fetch a single activity detail payload from the configured Huawei endpoint or a mock JSON response");
  console.log("  --mock-activities-response <path>  Use a local JSON file instead of the live Huawei activities endpoint");
  console.log("  --days <n>         Days of activity lookback for activity fetch, default 30");
  console.log("  --skip-build       Write scaffold files but do not run build:data");
}

function expandHome(inputPath) {
  if (!inputPath) {
    return inputPath;
  }

  if (inputPath === "~" || inputPath.startsWith("~/")) {
    const homeDir = process.env.HOME;
    if (!homeDir) {
      throw new Error("Cannot expand '~' because HOME is not set.");
    }
    return path.join(homeDir, inputPath.slice(2));
  }

  return inputPath;
}

function parseArgs(argv) {
  const args = {
    from: undefined,
    printAuthUrl: false,
    authorizationCode: undefined,
    setToken: undefined,
    exchangeCode: false,
    refreshAccessToken: false,
    fetchActivities: false,
    fetchActivityDetail: undefined,
    mockActivitiesResponse: undefined,
    days: 30,
    skipBuild: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--from") {
      args.from = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--print-auth-url") {
      args.printAuthUrl = true;
      continue;
    }

    if (value === "--authorization-code") {
      args.authorizationCode = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--set-token") {
      args.setToken = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--exchange-code") {
      args.exchangeCode = true;
      continue;
    }

    if (value === "--refresh-access-token") {
      args.refreshAccessToken = true;
      continue;
    }

    if (value === "--fetch-activities") {
      args.fetchActivities = true;
      continue;
    }

    if (value === "--fetch-activity-detail") {
      args.fetchActivityDetail = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--mock-activities-response") {
      args.mockActivitiesResponse = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--days") {
      args.days = Number(argv[index + 1]);
      index += 1;
      continue;
    }

    if (value === "--skip-build") {
      args.skipBuild = true;
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

async function readConfig() {
  const raw = await fs.readFile(configPath, "utf8");
  return JSON.parse(raw);
}

async function ensureJsonFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);

  if (parsed == null || typeof parsed !== "object") {
    throw new Error(`Expected JSON object or array in ${filePath}`);
  }

  return raw;
}

function parseTokenCacheArg(rawValue) {
  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Token cache must be a JSON object.");
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `Invalid --set-token payload. Pass a JSON object string such as '{"accessToken":"...","refreshToken":"...","expiresAt":"2026-04-02T12:00:00Z"}'. ${error instanceof Error ? error.message : ""}`,
    );
  }
}

function runBuildData() {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["scripts/build-data.mjs"], {
      cwd: rootDir,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`build:data exited with code ${code}`));
    });
  });
}

function createApiScaffold({ providerConfig, sourceArg, sourcePath, hasStagedRawData, authState }) {
  const credentialsEnv = authState.env.envNames;

  return {
    generatedAt: new Date().toISOString(),
    provider: "huawei_health",
    mode: providerConfig.mode ?? "health_kit_scaffold",
    status: hasStagedRawData ? "raw_data_staged" : authState.status,
    authStatus: authState.status,
    rawDataPath: providerConfig.rawDataPath ?? "data/sources/huawei-health/export.json",
    tokenCachePath: providerConfig.tokenCachePath ?? "data/sources/huawei-health/token-cache.json",
    importPath: providerConfig.importPath ?? "",
    sourceArg: sourceArg ?? null,
    stagedSourcePath: sourcePath ?? null,
    credentialsEnv,
    oauth: {
      clientIdEnv: credentialsEnv.clientIdEnv ?? null,
      clientSecretEnv: credentialsEnv.clientSecretEnv ?? null,
      redirectUriEnv: credentialsEnv.redirectUriEnv ?? null,
      authorizationCode: authState.apiScaffold?.oauth?.authorizationCode ?? null,
      accessToken: authState.tokenStatus.hasAccessToken ? "present" : null,
      refreshToken: authState.tokenStatus.hasRefreshToken ? "present" : null,
      expiresAt: authState.tokenStatus.expiresAt ?? null
    },
    syncPlan: {
      goal: "Pull Huawei Health swim sessions into local raw cache, normalize them, and rebuild the static site.",
      nextSteps: [
        "Fill the Huawei Health env vars in your shell or local env file.",
        "Wire this scaffold to the real Huawei Health authorization and activity query flow.",
        "Map the returned swim records into the canonical swim contract used by scripts/providers/huawei-health.mjs."
      ],
      currentFallback: hasStagedRawData
        ? "Using staged raw JSON while live Huawei Health sync is still scaffold-only."
        : "No raw JSON staged yet. You can still pass --from to import a local export while the live sync is unfinished.",
      currentAuthState: authState.status,
      missingEnv: authState.env.missing
    }
  };
}

function getDateRange(days) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await readConfig();
  const providerConfig = config.provider?.huaweiHealth ?? {};
  const sourceArg = args.from ?? providerConfig.importPath;
  const sourcePath = sourceArg ? path.resolve(rootDir, expandHome(sourceArg)) : null;
  const rawDataRelativePath = providerConfig.rawDataPath ?? "data/sources/huawei-health/export.json";
  const rawDataPath = path.join(rootDir, rawDataRelativePath);
  const initialAuthState = await readHuaweiHealthAuthState({ rootDir, providerConfig });

  if (args.authorizationCode) {
    await saveHuaweiHealthAuthorizationCode({
      rootDir,
      providerConfig,
      code: args.authorizationCode,
    });
    console.log("Stored Huawei Health authorization code in local scaffold metadata.");
  }

  if (args.setToken) {
    const tokenCache = parseTokenCacheArg(args.setToken);
    await writeHuaweiHealthTokenCache({ rootDir, providerConfig, tokenCache });
    console.log("Stored Huawei Health token cache payload.");
  }

  const authState =
    args.authorizationCode || args.setToken
      ? await readHuaweiHealthAuthState({ rootDir, providerConfig })
      : initialAuthState;

  if (args.printAuthUrl) {
    const authUrl = buildHuaweiHealthAuthorizationUrl(providerConfig);
    if (authUrl) {
      console.log("Huawei Health authorization URL:");
      console.log(authUrl);
    } else {
      console.log("Huawei Health authorization URL is not ready yet.");
      console.log("Fill provider.huaweiHealth.oauthEndpoints.authorizationUrl and the required env vars first.");
    }
  }

  if (args.exchangeCode) {
    const codeToExchange = args.authorizationCode ?? authState.apiScaffold?.oauth?.authorizationCode;
    const tokenCache = await exchangeHuaweiHealthAuthorizationCode({
      rootDir,
      providerConfig,
      code: codeToExchange,
    });
    console.log("Exchanged Huawei Health authorization code for tokens.");
    console.log(`Token expires at: ${tokenCache.expiresAt ?? "unknown"}`);
  }

  if (args.refreshAccessToken) {
    const refreshToken = authState.tokenCache?.refreshToken;
    const tokenCache = await refreshHuaweiHealthAccessToken({
      rootDir,
      providerConfig,
      refreshToken,
    });
    console.log("Refreshed Huawei Health access token.");
    console.log(`Token expires at: ${tokenCache.expiresAt ?? "unknown"}`);
  }

  let hasStagedRawData = false;
  if (sourcePath) {
    const rawJson = await ensureJsonFile(sourcePath);
    await fs.mkdir(path.dirname(rawDataPath), { recursive: true });
    await fs.writeFile(rawDataPath, rawJson);
    hasStagedRawData = true;
    console.log(`Staged Huawei Health raw data from ${sourcePath}`);
    console.log(`Stored raw provider file at ${rawDataRelativePath}`);
  }

  if (args.fetchActivities) {
    const range = getDateRange(Number.isFinite(args.days) && args.days > 0 ? args.days : 30);
    const activitiesResult = await fetchHuaweiHealthActivities({
      rootDir,
      providerConfig,
      dateFrom: range.startTime,
      dateTo: range.endTime,
      mockPath: args.mockActivitiesResponse,
    });
    const storedRawPath = await writeHuaweiHealthRawActivities({
      rootDir,
      providerConfig,
      payload: activitiesResult.raw,
    });

    hasStagedRawData = true;
    console.log(`Fetched Huawei Health activities from ${activitiesResult.requestUrl}`);
    console.log(`Stored Huawei Health activity payload at ${storedRawPath}`);
    const activitySummary = summarizeHuaweiHealthActivityEnvelope(activitiesResult.raw);
    console.log(`Huawei Health activity rows: ${activitySummary.count}`);
    if (activitySummary.sampleKeys.length > 0) {
      console.log(`Sample activity keys: ${activitySummary.sampleKeys.join(", ")}`);
    }
    if (activitiesResult.refreshedToken) {
      console.log("Refreshed Huawei Health token before fetching activities.");
    }
  }

  if (args.fetchActivityDetail) {
    const detailResult = await fetchHuaweiHealthActivityDetail({
      rootDir,
      providerConfig,
      activityId: args.fetchActivityDetail,
      mockPath: args.mockActivitiesResponse,
    });
    console.log(`Fetched Huawei Health activity detail from ${detailResult.requestUrl}`);
    const detailKeys = detailResult.raw && typeof detailResult.raw === "object" ? Object.keys(detailResult.raw) : [];
    if (detailKeys.length > 0) {
      console.log(`Activity detail keys: ${detailKeys.join(", ")}`);
    }
    if (detailResult.refreshedToken) {
      console.log("Refreshed Huawei Health token before fetching activity detail.");
    }
  }

  const apiScaffold = createApiScaffold({
    providerConfig,
    sourceArg,
    sourcePath,
    hasStagedRawData,
    authState
  });
  const apiScaffoldRelativePath = await writeHuaweiHealthApiScaffold({
    rootDir,
    providerConfig,
    payload: apiScaffold,
  });

  const syncMetaRelativePath = await writeHuaweiHealthSyncMeta({
    rootDir,
    providerConfig,
    payload: {
    updatedAt: new Date().toISOString(),
    provider: "huawei_health",
    mode: providerConfig.mode ?? "health_kit_scaffold",
    authStatus: authState.status,
    missingEnv: authState.env.missing,
    tokenStatus: authState.tokenStatus,
    selectedProvider: config.provider?.selected ?? null,
    rawDataPath: rawDataRelativePath,
    apiScaffoldPath: apiScaffoldRelativePath,
    sourcePath,
    hasStagedRawData,
    buildTriggered: !args.skipBuild && hasStagedRawData,
    notes: hasStagedRawData
      ? [
          "Live Huawei Health authorization is still scaffold-only.",
          "The site is currently building from the staged raw JSON file."
        ]
      : [
          "No raw JSON was staged.",
          "Use --from or provider.huaweiHealth.importPath to seed the raw cache while the live sync remains scaffold-only."
        ]
    },
  });

  console.log(`Wrote Huawei Health API scaffold to ${apiScaffoldRelativePath}`);
  console.log(`Wrote Huawei Health sync metadata to ${syncMetaRelativePath}`);
  console.log(`Huawei Health auth status: ${authState.status}`);

  if (authState.env.missing.length > 0) {
    console.log(`Missing Huawei Health env vars: ${authState.env.missing.join(", ")}`);
  }

  if (!hasStagedRawData) {
    console.log("No raw Huawei Health JSON was staged in this run.");
    console.log("Pass --from /absolute/path/to/export.json if you want to seed the site with local data today.");
    return;
  }

  if (config.provider?.selected !== "huawei_health") {
    console.log('Note: swim.config.json still has provider.selected set to a non-Huawei provider.');
    console.log('Set "provider.selected" to "huawei_health" when you want the site to build from this source.');
  }

  if (args.skipBuild) {
    console.log("Skipped build:data.");
    return;
  }

  await runBuildData();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
