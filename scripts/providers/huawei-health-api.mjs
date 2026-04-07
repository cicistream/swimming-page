import fs from "node:fs/promises";
import path from "node:path";
import {
  readHuaweiHealthAuthState,
  refreshHuaweiHealthAccessToken,
} from "./huawei-health-auth.mjs";

function getApiConfig(providerConfig = {}) {
  const apiEndpoints = providerConfig.apiEndpoints ?? {};
  return {
    activitiesUrl: apiEndpoints.activitiesUrl ?? "",
    activityDetailUrl: apiEndpoints.activityDetailUrl ?? "",
    swimTypeParam: apiEndpoints.swimTypeParam ?? "swimming",
    detailDataType: apiEndpoints.detailDataType ?? "",
    sourceType: apiEndpoints.sourceType ?? "",
    activityIdParam: apiEndpoints.activityIdParam ?? "activityId",
  };
}

async function readMockJson(rootDir, mockPath) {
  const resolvedPath = path.resolve(rootDir, mockPath);
  return JSON.parse(await fs.readFile(resolvedPath, "utf8"));
}

async function getUsableAccessToken({ rootDir, providerConfig }) {
  const authState = await readHuaweiHealthAuthState({ rootDir, providerConfig });

  if (authState.tokenStatus.isUsable && authState.tokenCache?.accessToken) {
    return {
      accessToken: authState.tokenCache.accessToken,
      authState,
      refreshed: false,
    };
  }

  if (authState.tokenCache?.refreshToken) {
    const refreshedTokenCache = await refreshHuaweiHealthAccessToken({
      rootDir,
      providerConfig,
      refreshToken: authState.tokenCache.refreshToken,
    });

    return {
      accessToken: refreshedTokenCache.accessToken,
      authState: await readHuaweiHealthAuthState({ rootDir, providerConfig }),
      refreshed: true,
    };
  }

  throw new Error("Huawei Health activity fetch requires a usable access token or refresh token.");
}

function buildActivitiesUrl({ providerConfig, dateFrom, dateTo }) {
  const api = getApiConfig(providerConfig);
  if (!api.activitiesUrl) {
    throw new Error("Huawei Health activitiesUrl is not configured yet. Fill provider.huaweiHealth.apiEndpoints.activitiesUrl first.");
  }

  const url = new URL(api.activitiesUrl);
  if (dateFrom) {
    url.searchParams.set("startTime", dateFrom);
  }
  if (dateTo) {
    url.searchParams.set("endTime", dateTo);
  }
  if (api.swimTypeParam) {
    url.searchParams.set("activityType", api.swimTypeParam);
  }
  if (api.detailDataType) {
    url.searchParams.set("detailDataType", api.detailDataType);
  }
  if (api.sourceType) {
    url.searchParams.set("sourceType", api.sourceType);
  }
  return url.toString();
}

function buildActivityDetailUrl({ providerConfig, activityId }) {
  const api = getApiConfig(providerConfig);
  if (!api.activityDetailUrl) {
    throw new Error("Huawei Health activityDetailUrl is not configured yet. Fill provider.huaweiHealth.apiEndpoints.activityDetailUrl first.");
  }

  const url = new URL(api.activityDetailUrl);
  url.searchParams.set(api.activityIdParam, activityId);
  return url.toString();
}

export async function fetchHuaweiHealthActivities({
  rootDir,
  providerConfig,
  dateFrom,
  dateTo,
  mockPath,
}) {
  if (mockPath) {
    const mock = await readMockJson(rootDir, mockPath);
    return {
      requestUrl: mockPath,
      status: 200,
      ok: true,
      usedMock: true,
      refreshedToken: false,
      raw: mock,
    };
  }

  const { accessToken, refreshed } = await getUsableAccessToken({ rootDir, providerConfig });
  const requestUrl = buildActivitiesUrl({ providerConfig, dateFrom, dateTo });
  const response = await fetch(requestUrl, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Huawei Health activities endpoint returned non-JSON response (${response.status}).`);
  }

  if (!response.ok) {
    throw new Error(`Huawei Health activities request failed with HTTP ${response.status}: ${text.slice(0, 240)}`);
  }

  return {
    requestUrl,
    status: response.status,
    ok: true,
    usedMock: false,
    refreshedToken: refreshed,
    raw: json,
  };
}

export async function fetchHuaweiHealthActivityDetail({
  rootDir,
  providerConfig,
  activityId,
  mockPath,
}) {
  if (!activityId) {
    throw new Error("Huawei Health activity detail fetch requires an activity ID.");
  }

  if (mockPath) {
    const mock = await readMockJson(rootDir, mockPath);
    return {
      requestUrl: mockPath,
      status: 200,
      ok: true,
      usedMock: true,
      refreshedToken: false,
      raw: mock,
    };
  }

  const { accessToken, refreshed } = await getUsableAccessToken({ rootDir, providerConfig });
  const requestUrl = buildActivityDetailUrl({ providerConfig, activityId });
  const response = await fetch(requestUrl, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Huawei Health activity detail endpoint returned non-JSON response (${response.status}).`);
  }

  if (!response.ok) {
    throw new Error(`Huawei Health activity detail request failed with HTTP ${response.status}: ${text.slice(0, 240)}`);
  }

  return {
    requestUrl,
    status: response.status,
    ok: true,
    usedMock: false,
    refreshedToken: refreshed,
    raw: json,
  };
}

export async function writeHuaweiHealthRawActivities({ rootDir, providerConfig, payload }) {
  const rawDataPath = providerConfig.rawDataPath ?? "data/sources/huawei-health/export.json";
  const targetPath = path.join(rootDir, rawDataPath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, JSON.stringify(payload, null, 2));
  return rawDataPath;
}

export function summarizeHuaweiHealthActivityEnvelope(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.activities)
      ? payload.activities
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.sessions)
          ? payload.sessions
          : [];

  const sample = rows[0] ?? null;

  return {
    count: rows.length,
    sampleKeys: sample && typeof sample === "object" ? Object.keys(sample) : [],
    nestedKeys:
      sample && typeof sample === "object"
        ? Object.fromEntries(
            Object.entries(sample)
              .filter(([, value]) => value && typeof value === "object" && !Array.isArray(value))
              .map(([key, value]) => [key, Object.keys(value)]),
          )
        : {},
  };
}
