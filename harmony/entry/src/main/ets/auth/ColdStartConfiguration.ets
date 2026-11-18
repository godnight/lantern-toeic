// Candidate only. A successful background request does not itself grant any
// local or remote owner access; the real page must independently consume it.
export const COLD_START_PREFETCH_ENABLED: boolean = false;
