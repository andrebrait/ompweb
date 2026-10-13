// Web Storage is origin-scoped, not path-scoped. Keep opt-in deployments out
// of the root application's drafts, queues, navigation and preferences.
const namespace = process.env.NEXT_PUBLIC_BASE_PATH ? `omp-web:${process.env.NEXT_PUBLIC_BASE_PATH}:` : "";

/** @param {string} key @returns {string} */
export function withStorageNamespace(key) {
  return namespace + key;
}
