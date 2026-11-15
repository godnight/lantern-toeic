// Migration is deliberately disabled. The old origin must be verified against
// the installed release, and the destination plus token-to-owner mapping must
// be verified after the final server cutover before any migration is enabled.
// This file does not change the active authentication endpoint.
export const AUTH_MIGRATION_ENABLED: boolean = false;
export const AUTH_MIGRATION_OLD_ORIGIN: string = 'https://pc-20230610ztoe.tail490ec1.ts.net';
export const AUTH_MIGRATION_NEW_ORIGIN: string = 'https://weiguangxue.cn';
