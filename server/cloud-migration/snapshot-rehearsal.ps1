<#
Review-only local snapshot rehearsal. No database file or cloud service is
written. Snapshot identity/pairing and cross-database atomicity remain outside
this tool; never use this output as approval for a production cutover.
#>
[CmdletBinding()]
param(
    [switch] $Enable,
    [string] $SnapshotDirectory,
    [string] $PythonExecutable
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $Enable) { throw 'Explicit -Enable is required.' }
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or $PSVersionTable.PSVersion.Major -lt 7) {
    throw 'Windows and PowerShell 7 are required.'
}
function LocalPath([string] $Value) {
    if ([string]::IsNullOrWhiteSpace($Value) -or -not [IO.Path]::IsPathFullyQualified($Value) -or
        $Value -notmatch '^[A-Za-z]:\\' -or $Value.Substring(2).Contains(':')) { throw 'Absolute local path required.' }
    $path = [IO.Path]::GetFullPath($Value).TrimEnd('\')
    if ($path.Length -lt 3 -or [IO.DriveInfo]::new([IO.Path]::GetPathRoot($path)).DriveType -ne [IO.DriveType]::Fixed) {
        throw 'Fixed local drive required.'
    }
    return $path
}
$directory = LocalPath $SnapshotDirectory
$python = LocalPath $PythonExecutable
if ([IO.Path]::GetFileName($directory) -notmatch '^lantern-online-review-[0-9a-f]{32}$') { throw 'Review snapshot required.' }
$guardSource = Join-Path $PSScriptRoot '../../tools/cloud-migration/windows_handle_guard.cs'
Add-Type -Path $guardSource
$held = [Collections.Generic.List[Microsoft.Win32.SafeHandles.SafeFileHandle]]::new()
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$trusted = @($sid.Value, 'S-1-5-18', 'S-1-5-32-544')
function HoldChain([string] $Value, [bool] $File) {
    $root = [IO.Path]::GetPathRoot($Value)
    $held.Add([LanternMigrationPathGuard]::Hold($root, $true))
    $current = $root.TrimEnd('\')
    $parts = $Value.Substring($root.Length) -split '\\'
    for ($index = 0; $index -lt $parts.Length; $index++) {
        if ($parts[$index] -eq '') { throw 'Invalid path component.' }
        $current = $current + '\' + $parts[$index]
        $held.Add([LanternMigrationPathGuard]::Hold($current, -not ($File -and $index -eq $parts.Length - 1)))
    }
}
function AssertPrivateAcl([string] $Value, [bool] $Directory) {
    $acl = Get-Acl -LiteralPath $Value
    if ($Directory -and -not $acl.AreAccessRulesProtected) { throw 'Snapshot ACL must be protected.' }
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Unexpected owner.' }
    $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    if ($rules.Count -ne 3) { throw 'Unexpected access rules.' }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($rule in $rules) {
        if ($rule.IdentityReference.Value -notin $trusted -or -not $seen.Add($rule.IdentityReference.Value) -or
            $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
            ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne [Security.AccessControl.FileSystemRights]::FullControl) {
            throw 'Unsafe snapshot access rule.'
        }
        if ($Directory -and ($rule.IsInherited -or
            $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None -or
            ($rule.InheritanceFlags -band [Security.AccessControl.InheritanceFlags]::ContainerInherit) -eq 0 -or
            ($rule.InheritanceFlags -band [Security.AccessControl.InheritanceFlags]::ObjectInherit) -eq 0)) {
            throw 'Unsafe snapshot inheritance.'
        }
    }
}
$oldGuard = [Environment]::GetEnvironmentVariable('LANTERN_SNAPSHOT_REHEARSAL_GUARD', 'Process')
try {
    HoldChain $directory $false
    AssertPrivateAcl $directory $true
    foreach ($name in @('manifest.json', 'main.sqlite', 'metadata.sqlite')) {
        $file = Join-Path $directory $name
        HoldChain $file $true
        AssertPrivateAcl $file $false
    }
    $names = @(Get-ChildItem -LiteralPath $directory -Force | ForEach-Object { $_.Name } | Sort-Object)
    if (($names -join ',') -ne 'main.sqlite,manifest.json,metadata.sqlite') { throw 'Snapshot has unexpected files.' }
    $nonce = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
    [Environment]::SetEnvironmentVariable('LANTERN_SNAPSHOT_REHEARSAL_GUARD', $nonce, 'Process')
    $request = @{ guard = $nonce; directory = $directory } | ConvertTo-Json -Compress
    $OutputEncoding = [Text.UTF8Encoding]::new($false)
    $result = @($request | & $python -I -X utf8 (Join-Path $PSScriptRoot 'snapshot-rehearsal.py') 2>&1)
    if ($LASTEXITCODE -ne 0 -or $result.Count -ne 1 -or $result[0] -ne 'SNAPSHOT_REHEARSAL_OK') {
        throw 'Snapshot rehearsal failed.'
    }
    Write-Output 'SNAPSHOT_REHEARSAL_OK: in-memory only; source retained; not a cutover.'
} finally {
    [Environment]::SetEnvironmentVariable('LANTERN_SNAPSHOT_REHEARSAL_GUARD', $oldGuard, 'Process')
    foreach ($handle in $held) { $handle.Dispose() }
}
