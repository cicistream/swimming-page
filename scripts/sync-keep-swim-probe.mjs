import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const rootDir = process.cwd();
const configPath = path.join(rootDir, "swim.config.json");
const keepProbeDir = path.join(rootDir, "data", "sources", "keep-probe");
const syncMetaPath = path.join(keepProbeDir, "sync-meta.json");

function printUsage() {
  console.log("Usage:");
  console.log("  KEEP_PHONE=13800000000 KEEP_PASSWORD='your-password' npm run sync:keep");
  console.log("  npm run sync:keep -- --phone 13800000000 --password 'your-password'");
  console.log("");
  console.log("Options:");
  console.log("  --phone <value>            Keep phone number (or set KEEP_PHONE)");
  console.log("  --password <value>         Keep password (or set KEEP_PASSWORD)");
  console.log("  --types <a,b,c>            Probe specific sport types");
  console.log("  --default-types            Probe built-in swim candidate types (default)");
  console.log("  --detail-candidates        Try likely training log detail paths");
  console.log("  --skip-build               Skip the final build:data step");
  console.log("  --help                     Show this message");
}

function parseArgs(argv) {
  const args = {
    phone: process.env.KEEP_PHONE,
    password: process.env.KEEP_PASSWORD,
    types: null,
    useDefaultTypes: true,
    detailCandidates: false,
    skipBuild: false,
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

    if (value === "--types") {
      args.types = argv[index + 1];
      args.useDefaultTypes = false;
      index += 1;
      continue;
    }

    if (value === "--default-types") {
      args.useDefaultTypes = true;
      continue;
    }

    if (value === "--detail-candidates") {
      args.detailCandidates = true;
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

function runNodeScript(scriptPath, scriptArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [scriptPath, ...scriptArgs], {
      stdio: "inherit",
      cwd: process.cwd(),
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${scriptPath} exited with code ${code}`));
    });
  });
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readConfig() {
  const raw = await fs.readFile(configPath, "utf8");
  return JSON.parse(raw);
}

async function readDraftMetadata(config) {
  const configuredPath =
    config.provider?.keepSwimProbe?.path ?? "data/sources/keep-probe/canonical-swims.draft.json";
  const draftPath = path.join(rootDir, configuredPath);
  const draft = await readJsonIfExists(draftPath);

  return {
    configuredPath,
    selectedSportType: draft?.selectedSportType ?? null,
    sessionCount: Array.isArray(draft?.sessions) ? draft.sessions.length : 0,
  };
}

async function writeSyncMeta(update) {
  const existing = (await readJsonIfExists(syncMetaPath)) ?? {};
  const next = {
    provider: "keep_swim_probe",
    mode: "list_probe_sync",
    updatedAt: update.updatedAt,
    lastAttemptAt: update.lastAttemptAt,
    lastAttemptStatus: update.lastAttemptStatus,
    lastAttemptError: update.lastAttemptError ?? null,
    lastSuccessfulSyncAt: update.lastSuccessfulSyncAt ?? existing.lastSuccessfulSyncAt ?? null,
    lastSuccessfulSyncSessionCount:
      update.lastSuccessfulSyncSessionCount ?? existing.lastSuccessfulSyncSessionCount ?? null,
    selectedSportType: update.selectedSportType ?? existing.selectedSportType ?? null,
    configuredDraftPath: update.configuredDraftPath ?? existing.configuredDraftPath ?? null,
    buildTriggered: update.buildTriggered,
  };

  await fs.mkdir(keepProbeDir, { recursive: true });
  await fs.writeFile(syncMetaPath, JSON.stringify(next, null, 2));
}

async function main() {
  const config = await readConfig();
  const previousSyncMeta = (await readJsonIfExists(syncMetaPath)) ?? {};
  const args = parseArgs(process.argv.slice(2));
  if (!args.phone || !args.password) {
    printUsage();
    throw new Error("Missing Keep credentials. Pass --phone/--password or set KEEP_PHONE/KEEP_PASSWORD.");
  }

  const probeArgs = ["--phone", args.phone, "--password", args.password];
  if (args.useDefaultTypes) {
    probeArgs.push("--default-types");
  }
  if (args.types) {
    probeArgs.push("--types", args.types);
  }
  if (args.detailCandidates) {
    probeArgs.push("--detail-candidates");
  }

  try {
    await runNodeScript("scripts/probe-keep-swimming.mjs", probeArgs);
    await runNodeScript("scripts/map-keep-swim-probe.mjs", []);

    const finishedAt = new Date().toISOString();
    const draftMetadata = await readDraftMetadata(config);
    await writeSyncMeta({
      updatedAt: finishedAt,
      lastAttemptAt: finishedAt,
      lastAttemptStatus: "success",
      lastAttemptError: null,
      lastSuccessfulSyncAt: finishedAt,
      lastSuccessfulSyncSessionCount: draftMetadata.sessionCount,
      selectedSportType: draftMetadata.selectedSportType,
      configuredDraftPath: draftMetadata.configuredPath,
      buildTriggered: !args.skipBuild,
    });

    if (!args.skipBuild) {
      await runNodeScript("scripts/build-data.mjs", []);
    }
  } catch (error) {
    const failedAt = new Date().toISOString();
    await writeSyncMeta({
      updatedAt: failedAt,
      lastAttemptAt: failedAt,
      lastAttemptStatus: "failed",
      lastAttemptError: error instanceof Error ? error.message : String(error),
      lastSuccessfulSyncAt: previousSyncMeta.lastSuccessfulSyncAt ?? null,
      lastSuccessfulSyncSessionCount: previousSyncMeta.lastSuccessfulSyncSessionCount ?? null,
      selectedSportType: previousSyncMeta.selectedSportType ?? null,
      configuredDraftPath: previousSyncMeta.configuredDraftPath ?? null,
      buildTriggered: !args.skipBuild,
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
