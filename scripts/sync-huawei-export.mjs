import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const rootDir = process.cwd();
const configPath = path.join(rootDir, "swim.config.json");

function printUsage() {
  console.log("Usage:");
  console.log("  npm run sync:huawei -- --from /absolute/path/to/export.json");
  console.log("  npm run sync:huawei -- --from ~/Downloads/huawei-export.json");
  console.log("");
  console.log("Options:");
  console.log("  --from <path>      Source Huawei Health export JSON file");
  console.log("  --skip-build       Copy the file but do not run build:data");
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
    skipBuild: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--from") {
      args.from = argv[index + 1];
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await readConfig();
  const providerConfig = config.provider?.huaweiHealth ?? {};
  const configuredSource = providerConfig.importPath;
  const sourceArg = args.from ?? configuredSource;

  if (!sourceArg) {
    printUsage();
    throw new Error("Missing source file. Provide --from or set provider.huaweiHealth.importPath.");
  }

  const sourcePath = path.resolve(rootDir, expandHome(sourceArg));
  const targetRelativePath = providerConfig.rawDataPath ?? "data/sources/huawei-health/export.json";
  const targetPath = path.join(rootDir, targetRelativePath);

  const rawJson = await ensureJsonFile(sourcePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, rawJson);

  const metadataPath = path.join(path.dirname(targetPath), "last-import.json");
  await fs.writeFile(
    metadataPath,
    JSON.stringify(
      {
        importedAt: new Date().toISOString(),
        sourcePath,
        targetPath: targetRelativePath,
      },
      null,
      2,
    ),
  );

  console.log(`Imported Huawei Health export from ${sourcePath}`);
  console.log(`Stored raw provider file at ${targetRelativePath}`);

  if (config.provider?.selected !== "huawei_health") {
    console.log('Note: swim.config.json still has provider.selected set to a non-Huawei provider.');
    console.log('Set "provider.selected" to "huawei_health" when you want the site to build from this import.');
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
