param(
    [Parameter(Mandatory=$true)][string]$Tool,
    [Parameter(ValueFromRemainingArguments=$true)][string[]]$CliArguments
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
& $Tool @CliArguments
exit $LASTEXITCODE
