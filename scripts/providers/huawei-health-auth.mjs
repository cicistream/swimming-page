import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_HUAWEI_TOKEN_URL = "https://oauth-login.cloud.huawei.com/oauth2/v3/token";

function getDefaultPaths(providerConfig = {}) {
  return {
    apiScaffoldPath: providerConfig.apiScaffoldPath ?? "data/sources/huawei-health/api-scaffold.json",
    syncMetaPath: providerConfig.syncMetaPath ?? "data/sources/huawei-health/sync-meta.json",
    tokenCachePath: providerConfig.tokenCachePath ?? "data/sources/huawei-health/token-cache.json",
  };
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

async function writeJson(targetPath, payload) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, JSON.stringify(payload, null, 2));
}

function summarizeCredentialsEnv(providerConfig = {}) {
  const credentialsEnv = providerConfig.credentialsEnv ?? {};
  const entries = [
    ["clientId", credentialsEnv.clientIdEnv],
    ["clientSecret", credentialsEnv.clientSecretEnv],
    ["redirectUri", credentialsEnv.redirectUriEnv],
  ];

  const values = Object.fromEntries(
    entries.map(([key, envName]) => [
      key,
      envName ? process.env[envName] ?? null : null,
    ]),
  );

  return {
    envNames: credentialsEnv,
    values,
    missing: entries.filter(([, envName]) => envName && !process.env[envName]).map(([, envName]) => envName),
    ready: entries.every(([, envName]) => !envName || Boolean(process.env[envName])),
  };
}

export function getHuaweiHealthOauthConfig(providerConfig = {}) {
  const oauthEndpoints = providerConfig.oauthEndpoints ?? {};
  const credentials = summarizeCredentialsEnv(providerConfig);

  return {
    authorizationUrl: oauthEndpoints.authorizationUrl ?? "",
    tokenUrl: oauthEndpoints.tokenUrl || DEFAULT_HUAWEI_TOKEN_URL,
    scope: oauthEndpoints.scope ?? "",
    clientId: credentials.values.clientId,
    clientSecret: credentials.values.clientSecret,
    redirectUri: credentials.values.redirectUri,
    env: credentials,
  };
}

function normalizeTokenResponse(raw) {
  const accessToken = raw?.access_token ?? raw?.accessToken ?? null;
  const refreshToken = raw?.refresh_token ?? raw?.refreshToken ?? null;
  const tokenType = raw?.token_type ?? raw?.tokenType ?? null;
  const scope = raw?.scope ?? null;
  const expiresIn = Number(raw?.expires_in ?? raw?.expiresIn ?? 0);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : raw?.expiresAt ?? null;

  return {
    accessToken,
    refreshToken,
    tokenType,
    scope,
    expiresAt,
    rawResponse: raw,
  };
}

async function postTokenRequest({ url, params }) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: new URLSearchParams(params),
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Huawei token endpoint returned non-JSON response (${response.status}).`);
  }

  if (!response.ok) {
    throw new Error(`Huawei token request failed with HTTP ${response.status}: ${text.slice(0, 240)}`);
  }

  return normalizeTokenResponse(json);
}

export function buildHuaweiHealthAuthorizationUrl(providerConfig = {}) {
  const oauth = getHuaweiHealthOauthConfig(providerConfig);
  if (!oauth.authorizationUrl || !oauth.clientId || !oauth.redirectUri) {
    return null;
  }

  const url = new URL(oauth.authorizationUrl);
  url.searchParams.set("client_id", oauth.clientId);
  url.searchParams.set("redirect_uri", oauth.redirectUri);
  url.searchParams.set("response_type", "code");

  if (oauth.scope) {
    url.searchParams.set("scope", oauth.scope);
  }

  return url.toString();
}

function determineTokenStatus(tokenCache) {
  if (!tokenCache || typeof tokenCache !== "object") {
    return {
      hasAccessToken: false,
      hasRefreshToken: false,
      expiresAt: null,
      isExpired: false,
      isUsable: false,
    };
  }

  const expiresAt = tokenCache.expiresAt ?? null;
  const expiryTime = expiresAt ? new Date(expiresAt).getTime() : null;
  const isExpired = typeof expiryTime === "number" && !Number.isNaN(expiryTime) && expiryTime <= Date.now();
  const hasAccessToken = Boolean(tokenCache.accessToken);
  const hasRefreshToken = Boolean(tokenCache.refreshToken);

  return {
    hasAccessToken,
    hasRefreshToken,
    expiresAt,
    isExpired,
    isUsable: hasAccessToken && !isExpired,
  };
}

export async function readHuaweiHealthAuthState({ rootDir, providerConfig }) {
  const paths = getDefaultPaths(providerConfig);
  const resolvedPaths = {
    apiScaffoldPath: path.join(rootDir, paths.apiScaffoldPath),
    syncMetaPath: path.join(rootDir, paths.syncMetaPath),
    tokenCachePath: path.join(rootDir, paths.tokenCachePath),
  };

  const [apiScaffold, syncMeta, tokenCache] = await Promise.all([
    readJsonIfExists(resolvedPaths.apiScaffoldPath),
    readJsonIfExists(resolvedPaths.syncMetaPath),
    readJsonIfExists(resolvedPaths.tokenCachePath),
  ]);

  const env = summarizeCredentialsEnv(providerConfig);
  const tokenStatus = determineTokenStatus(tokenCache);

  let status = "scaffold_only";
  if (tokenStatus.isUsable) {
    status = "authorized";
  } else if (tokenStatus.hasRefreshToken) {
    status = "refreshable";
  } else if (env.ready) {
    status = "env_ready";
  } else if (env.missing.length > 0) {
    status = "missing_env";
  }

  return {
    status,
    env,
    tokenStatus,
    apiScaffold,
    syncMeta,
    tokenCache,
    paths,
  };
}

export async function writeHuaweiHealthTokenCache({ rootDir, providerConfig, tokenCache }) {
  const paths = getDefaultPaths(providerConfig);
  await writeJson(path.join(rootDir, paths.tokenCachePath), {
    updatedAt: new Date().toISOString(),
    ...tokenCache,
  });
  return paths.tokenCachePath;
}

export async function writeHuaweiHealthSyncMeta({ rootDir, providerConfig, payload }) {
  const paths = getDefaultPaths(providerConfig);
  await writeJson(path.join(rootDir, paths.syncMetaPath), payload);
  return paths.syncMetaPath;
}

export async function writeHuaweiHealthApiScaffold({ rootDir, providerConfig, payload }) {
  const paths = getDefaultPaths(providerConfig);
  await writeJson(path.join(rootDir, paths.apiScaffoldPath), payload);
  return paths.apiScaffoldPath;
}

export async function saveHuaweiHealthAuthorizationCode({ rootDir, providerConfig, code }) {
  const authState = await readHuaweiHealthAuthState({ rootDir, providerConfig });
  const nextScaffold = {
    ...(authState.apiScaffold ?? {}),
    generatedAt: new Date().toISOString(),
    provider: "huawei_health",
    mode: providerConfig.mode ?? "health_kit_scaffold",
    oauth: {
      ...(authState.apiScaffold?.oauth ?? {}),
      authorizationCode: code,
    },
  };

  await writeHuaweiHealthApiScaffold({
    rootDir,
    providerConfig,
    payload: nextScaffold,
  });

  return nextScaffold;
}

export async function exchangeHuaweiHealthAuthorizationCode({ rootDir, providerConfig, code }) {
  const oauth = getHuaweiHealthOauthConfig(providerConfig);
  if (!oauth.clientId || !oauth.clientSecret || !oauth.redirectUri) {
    throw new Error("Huawei Health token exchange requires client ID, client secret, and redirect URI env vars.");
  }

  if (!code) {
    throw new Error("Huawei Health token exchange requires an authorization code.");
  }

  const tokenCache = await postTokenRequest({
    url: oauth.tokenUrl,
    params: {
      grant_type: "authorization_code",
      code,
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      redirect_uri: oauth.redirectUri,
    },
  });

  await writeHuaweiHealthTokenCache({ rootDir, providerConfig, tokenCache });
  return tokenCache;
}

export async function refreshHuaweiHealthAccessToken({ rootDir, providerConfig, refreshToken }) {
  const oauth = getHuaweiHealthOauthConfig(providerConfig);
  if (!oauth.clientId || !oauth.clientSecret) {
    throw new Error("Huawei Health token refresh requires client ID and client secret env vars.");
  }

  if (!refreshToken) {
    throw new Error("Huawei Health token refresh requires a refresh token.");
  }

  const tokenCache = await postTokenRequest({
    url: oauth.tokenUrl,
    params: {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
    },
  });

  const mergedTokenCache = {
    refreshToken: tokenCache.refreshToken ?? refreshToken,
    ...tokenCache,
  };

  await writeHuaweiHealthTokenCache({ rootDir, providerConfig, tokenCache: mergedTokenCache });
  return mergedTokenCache;
}
