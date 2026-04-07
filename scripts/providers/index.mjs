import { loadHuaweiHealthProvider } from "./huawei-health.mjs";
import { loadKeepSwimProbeProvider } from "./keep-swim-probe.mjs";
import { loadSampleJsonProvider } from "./sample-json.mjs";

const providerLoaders = {
  sample_json: loadSampleJsonProvider,
  huawei_health: loadHuaweiHealthProvider,
  keep_swim_probe: loadKeepSwimProbeProvider,
};

export async function loadProviderPayload({ config, rootDir }) {
  const selectedProvider = process.env.SWIM_PROVIDER_OVERRIDE || config.provider?.selected;
  const loader = providerLoaders[selectedProvider];

  if (!selectedProvider || !loader) {
    throw new Error(`Unsupported provider "${selectedProvider ?? "unknown"}" in swim.config.json`);
  }

  const payload = await loader({ config, rootDir });

  return {
    ...payload,
    selectedProvider,
  };
}
