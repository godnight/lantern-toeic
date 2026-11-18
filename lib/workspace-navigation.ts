/** Personal pages have a predictable native Back path, independent of old routes. */
const PARENTS: Readonly<Record<string, string>> = {
  profile: 'today', themes: 'profile', settings: 'profile', account: 'profile',
  backups: 'profile', about: 'profile', art: 'about',
};
export function workspaceParent(page: string): string { return PARENTS[page] || 'today'; }
export function isPersonalPage(page: string): boolean { return Object.hasOwn(PARENTS, page); }
