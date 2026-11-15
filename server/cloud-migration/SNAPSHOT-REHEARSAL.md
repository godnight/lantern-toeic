# Local snapshot ledger rehearsal

This is a **non-final, in-memory rehearsal**, not a migration or cutover. It
does not write a database or contact a server. It is disabled unless `-Enable`
is supplied to the PowerShell wrapper. This change has only been exercised on
synthetic data; do not execute it on actual snapshots without a separate review
of their provenance and location.

Before any future rehearsal, independently establish that both review
snapshots came from the confirmed running service directory and verify the
backup manifest and its hashes. The manifest and hashes detect accidental
changes; they do **not** authenticate the snapshot's source or pair the two
databases. The backup process snapshots each database independently, so neither
the manifest nor this tool proves a cross-database point-in-time view. Same-user
or administrator tampering is outside the path and ACL guard's trust boundary.
No result here authorizes writing production data or switching traffic.

On Windows with PowerShell 7 and a suitable Python installation, after that
independent review the entry point is:

```powershell
pwsh -NoProfile -File server/cloud-migration/snapshot-rehearsal.ps1 `
  -Enable -SnapshotDirectory '<private-review-snapshot-directory>' `
  -PythonExecutable '<absolute-path-to-python.exe>'
```

The wrapper accepts a fixed local drive path with the review snapshot naming
convention, checks private ACLs, pins path handles, and rejects unexpected
files and sidecars. The worker reads each SQLite snapshot with
`mode=ro&immutable=1`, checks the expected roles, legacy schema and ledger,
integrity, and foreign keys. It copies both databases to memory and checks both
copies; it changes only the reviewed account ledger entries there, checks the
target ledger, unchanged schema and typed row digests, and repeats source and
manifest checks. It emits only a generic success or failure, never database
contents or digests.

The source databases must be self-contained backups, not live database files.
A success does not establish correctness of a later copy, an active service,
cloud deployment, real account migration, or client login. Use synthetic data
for development tests:

```powershell
node --test server/cloud-migration/snapshot-rehearsal.test.mjs
```
