export const MAX_STT_AUDIO_BYTES = 25 * 1024 * 1024;
export const MAX_STT_REQUEST_BYTES = MAX_STT_AUDIO_BYTES + 1024 * 1024;

function cleanEnvVar(val?: string): string | undefined {
  const cleaned = val?.replace(/\\n|[\r\n]/g, "").trim();
  return cleaned || undefined;
}

export interface SttConfig {
  endpoint: string;
  apiKey: string | undefined;
  model: string | undefined;
}

/** STT settings from OMP_WEB_STT_*; null when no endpoint is configured. */
export function readSttConfig(): SttConfig | null {
  const endpoint = cleanEnvVar(process.env.OMP_WEB_STT_ENDPOINT);
  if (!endpoint) return null;
  return {
    endpoint,
    apiKey: cleanEnvVar(process.env.OMP_WEB_STT_KEY),
    model: cleanEnvVar(process.env.OMP_WEB_STT_MODEL),
  };
}
