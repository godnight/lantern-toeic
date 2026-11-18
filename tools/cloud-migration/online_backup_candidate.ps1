<#
Review candidate: individually backs up two SQLite files, never a cutover.
Explicit -Enable and all paths are required. Windows/PowerShell 7 only.
Trusted principals: current user, SYSTEM and local Administrators.
#>
[CmdletBinding()]
param(
    [switch] $Enable,
    [string] $SourceRoot,
    [string] $MainRelative,
    [string] $MetadataRelative,
    [string] $TargetParent,
    [string] $PythonExecutable
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $Enable) { throw 'Explicit -Enable is required.' }
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or $PSVersionTable.PSVersion.Major -lt 7) {
    throw 'Windows and PowerShell 7 are required.'
}
if (@($SourceRoot, $MainRelative, $MetadataRelative, $TargetParent, $PythonExecutable).Where({ [string]::IsNullOrWhiteSpace($_) }).Count -ne 0) {
    throw 'All source, target and Python paths must be explicit.'
}

function LocalPath([string] $PathValue) {
    if (-not [IO.Path]::IsPathFullyQualified($PathValue) -or $PathValue -notmatch '^[A-Za-z]:\\' -or $PathValue.Substring(2).Contains(':')) {
        throw 'Only absolute local drive paths are allowed.'
    }
    $full = [IO.Path]::GetFullPath($PathValue).TrimEnd('\')
    if ($full.Length -lt 3 -or [IO.DriveInfo]::new([IO.Path]::GetPathRoot($full)).DriveType -ne [IO.DriveType]::Fixed) {
        throw 'A fixed local drive path is required.'
    }
    return $full
}

function SourceChild([string] $Root, [string] $Relative) {
    if ([IO.Path]::IsPathRooted($Relative) -or $Relative.Contains(':')) { throw 'Source paths must be relative.' }
    $pieces = $Relative -split '[\\/]'
    if ($pieces.Count -eq 0 -or @($pieces.Where({ $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' })).Count -gt 0) {
        throw 'Invalid source relative path.'
    }
    $full = LocalPath ([IO.Path]::Combine($Root, $Relative))
    if (-not $full.StartsWith($Root + '\', [StringComparison]::OrdinalIgnoreCase) -or
        -not $full.EndsWith('.sqlite', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Source must be a SQLite file within the explicit source root.'
    }
    return $full
}

$source = LocalPath $SourceRoot
$parent = LocalPath $TargetParent
$python = LocalPath $PythonExecutable
$main = SourceChild $source $MainRelative
$metadata = SourceChild $source $MetadataRelative
if ([string]::Equals($main, $metadata, [StringComparison]::OrdinalIgnoreCase) -or
    [string]::Equals($source, $parent, [StringComparison]::OrdinalIgnoreCase) -or
    $source.StartsWith($parent + '\', [StringComparison]::OrdinalIgnoreCase) -or
    $parent.StartsWith($source + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Source databases and target parent must be distinct and non-overlapping.'
}

Add-Type -Path (Join-Path $PSScriptRoot 'windows_handle_guard.cs')
$script:held = [Collections.Generic.List[Microsoft.Win32.SafeHandles.SafeFileHandle]]::new()
function HoldChain([string] $PathValue, [bool] $File) {
    $root = [IO.Path]::GetPathRoot($PathValue)
    $script:held.Add([LanternMigrationPathGuard]::Hold($root, $true))
    $current = $root.TrimEnd('\')
    $pieces = $PathValue.Substring($root.Length) -split '\\'
    for ($i = 0; $i -lt $pieces.Length; $i++) {
        if ($pieces[$i] -eq '') { throw 'Invalid path component.' }
        $current = $current + '\' + $pieces[$i]
        $isDirectory = -not ($File -and $i -eq $pieces.Length - 1)
        $script:held.Add([LanternMigrationPathGuard]::Hold($current, $isDirectory))
    }
}

$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$trusted = @($currentSid.Value, 'S-1-5-18', 'S-1-5-32-544')
function AssertPrivateAcl([string] $PathValue, [bool] $Protected) {
    $acl = Get-Acl -LiteralPath $PathValue
    if ($Protected -and -not $acl.AreAccessRulesProtected) { throw 'Target directory DACL must be protected.' }
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $currentSid.Value) { throw 'Target owner is not the current user.' }
    $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    if ($rules.Count -ne 3) { throw 'Target ACL must contain exactly the trusted principals.' }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($rule in $rules) {
        $sid = $rule.IdentityReference.Value
        if ($sid -notin $trusted -or -not $seen.Add($sid) -or
            $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
            ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne [Security.AccessControl.FileSystemRights]::FullControl) {
            throw 'Target ACL contains an untrusted or insufficient rule.'
        }
        if ($Protected -and ($rule.IsInherited -or
            $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None -or
            ($rule.InheritanceFlags -band [Security.AccessControl.InheritanceFlags]::ContainerInherit) -eq 0 -or
            ($rule.InheritanceFlags -band [Security.AccessControl.InheritanceFlags]::ObjectInherit) -eq 0)) {
            throw 'Target directory ACL inheritance is not explicit.'
        }
    }
    if ($seen.Count -ne 3) { throw 'Target ACL is incomplete.' }
}

$target = $null
$targetCreated = $false
$oldGuard = [Environment]::GetEnvironmentVariable('LANTERN_MIGRATION_GUARD', 'Process')
try {
    HoldChain $source $false
    foreach ($file in @($main, $metadata)) {
        HoldChain $file $true
        # The read-only SQLite connection may update WAL coordination; require
        # both existing files so an unguarded sidecar cannot be substituted.
        HoldChain ($file + '-wal') $true
        HoldChain ($file + '-shm') $true
    }
    HoldChain $parent $false
    AssertPrivateAcl $parent $true

    $target = Join-Path $parent ('lantern-online-review-' + [Guid]::NewGuid().ToString('N'))
    # CreateDirectoryW fails atomically for an existing name. The validated
    # parent is private to the explicitly trusted principals during creation.
    [LanternMigrationPathGuard]::CreateDirectoryExclusive($target)
    $targetCreated = $true
    HoldChain $target $false
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner($currentSid)
    foreach ($sid in $trusted) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new($sid),
            [Security.AccessControl.FileSystemRights]::FullControl,
            ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit),
            [Security.AccessControl.PropagationFlags]::None,
            [Security.AccessControl.AccessControlType]::Allow)
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $target -AclObject $acl
    AssertPrivateAcl $target $true

    $nonce = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
    [Environment]::SetEnvironmentVariable('LANTERN_MIGRATION_GUARD', $nonce, 'Process')
    $request = @{ guard = $nonce; main = $main; metadata = $metadata; target = $target } | ConvertTo-Json -Compress
    $worker = Join-Path $PSScriptRoot 'online_backup_worker.py'
    Write-Output 'ONLINE_BACKUP_STARTED'
    # Use UTF-8 on both sides of the pipe so Chinese and spaced source paths
    # are not decoded using the machine's legacy Windows code page.
    $OutputEncoding = [Text.UTF8Encoding]::new($false)
    $workerResult = @($request | & $python -I -X utf8 $worker 2>&1)
    if ($LASTEXITCODE -ne 0 -or $workerResult.Count -ne 1 -or $workerResult[0] -ne 'ONLINE_BACKUP_OK') {
        throw 'Online backup worker failed.'
    }
    foreach ($name in @('main.sqlite', 'metadata.sqlite', 'manifest.json')) {
        $file = Join-Path $target $name
        $guard = [LanternMigrationPathGuard]::Hold($file, $false)
        try { AssertPrivateAcl $file $false } finally { $guard.Dispose() }
    }
    $manifest = Get-Content -LiteralPath (Join-Path $target 'manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.kind -ne 'online-backup-review' -or $manifest.crossDatabaseAtomic -ne $false -or $manifest.finalMigration -ne $false) {
        throw 'Invalid backup manifest.'
    }
    foreach ($entry in @(@('main', 'main.sqlite'), @('metadata', 'metadata.sqlite'))) {
        $item = $manifest.($entry[0])
        $hash = (Get-FileHash -LiteralPath (Join-Path $target $entry[1]) -Algorithm SHA256).Hash.ToLowerInvariant()
        $expectedRole = if ($entry[0] -eq 'main') { 'legacy-auth' } else { 'miniflare-metadata' }
        if ($item.role -ne $expectedRole -or $item.integrity -ne 'ok' -or $item.sha256 -ne $hash -or -not $item.startUtc -or -not $item.endUtc) {
            throw 'Backup manifest validation failed.'
        }
    }
    Write-Output ('ONLINE_BACKUP_REVIEW_OK ' + $target)
    Write-Output 'Snapshots are independent and are not an atomic cutover.'
} catch {
    # Only known files in our new protected directory may be deleted. If an
    # unexpected object or link appears, leave the private directory untouched.
    $cleanup = 'no-target'
    if ($targetCreated) {
        $cleanup = 'private-incomplete-retained'
        try {
            AssertPrivateAcl $target $true
            $allowed = @('main.sqlite', 'main.sqlite-journal', 'main.sqlite-wal', 'main.sqlite-shm',
                         'metadata.sqlite', 'metadata.sqlite-journal', 'metadata.sqlite-wal', 'metadata.sqlite-shm', 'manifest.json')
            $entries = @(Get-ChildItem -LiteralPath $target -Force)
            if (@($entries.Where({ $_.Name -notin $allowed -or $_.PSIsContainer -or ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) })).Count -eq 0) {
                # Reject hard links and links replaced after enumeration; never
                # recursively delete an unexpected object or the source.
                foreach ($entry in $entries) {
                    $guard = [LanternMigrationPathGuard]::Hold($entry.FullName, $false)
                    $guard.Dispose()
                }
                foreach ($entry in $entries) { Remove-Item -LiteralPath $entry.FullName -Force }
                $cleanup = 'known-partial-files-removed; private-empty-directory-retained'
            }
        } catch { $cleanup = 'private-incomplete-retained' }
    }
    [Console]::Error.WriteLine('ONLINE_BACKUP_REVIEW_FAILED ' + $cleanup)
    exit 1
} finally {
    [Environment]::SetEnvironmentVariable('LANTERN_MIGRATION_GUARD', $oldGuard, 'Process')
    foreach ($handle in $script:held) { $handle.Dispose() }
}
