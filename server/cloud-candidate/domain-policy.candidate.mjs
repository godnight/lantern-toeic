// Pure configuration checks only. This module does not start an HTTPS server.
export function validDomainOrigin(origin) {
  if (typeof origin !== 'string') return false;
  const match = /^https:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$/.exec(origin);
  return !!match && match[1].length <= 253 && /[a-z]/.test(match[1].split('.').at(-1));
}

export function isRootManagedCertificateStat(stat, gid, directory) {
  return !!stat && Number.isInteger(gid) && gid > 0 && stat.uid === 0 && stat.gid === gid &&
    (stat.mode & 0o777) === (directory ? 0o750 : 0o640) && (directory || stat.nlink === 1);
}
