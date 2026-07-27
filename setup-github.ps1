#requires -Version 5.1
param(
  [string]$RepoName = "ashen-oath-soulslike",
  [ValidateSet("public", "private")]
  [string]$Visibility = "public"
)

$ErrorActionPreference = "Stop"

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command was not found: $Name"
  }
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command,
    [Parameter(Mandatory = $true)]
    [string]$FailureMessage
  )

  # Windows PowerShell 5.1 can convert native stderr into a terminating
  # NativeCommandError when ErrorActionPreference is Stop. Run native commands
  # with Continue locally, then check their real process exit code ourselves.
  $PreviousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $Command
    $ExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $PreviousPreference
  }

  if ($ExitCode -ne 0) {
    throw "$FailureMessage Exit code: $ExitCode"
  }
}

function Test-GhCommand([string]$Arguments) {
  # Missing repositories and missing Pages sites are expected probe results.
  # Running the probe through cmd.exe prevents their stderr from becoming a
  # terminating PowerShell NativeCommandError.
  & $env:ComSpec /d /s /c "gh $Arguments >nul 2>nul"
  return ($LASTEXITCODE -eq 0)
}

Require-Command "git"
Require-Command "gh"

$PreviousPreference = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
try {
  $Owner = gh api user --jq .login 2>$null
  $OwnerExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $PreviousPreference
}

if ($OwnerExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($Owner)) {
  throw "GitHub login could not be confirmed. Run: gh auth login"
}

$HasNode = [bool](Get-Command node -ErrorAction SilentlyContinue)
$HasNpm = [bool](Get-Command npm -ErrorAction SilentlyContinue)

if ($HasNode -and $HasNpm) {
  Write-Host "[1/5] Installing dependencies and verifying the foundation"
  Invoke-Checked { npm install --no-audit --no-fund } "npm install failed."
  Invoke-Checked { npm run verify } "Project verification failed."
} else {
  Write-Host "[1/5] Node.js is unavailable. GitHub Actions will run the build verification."
}

Write-Host "[2/5] Checking the local Git repository"
if (-not (Test-Path ".git")) {
  Invoke-Checked { git init -b main } "git init failed."
}

Invoke-Checked { git add . } "git add failed."
$HasChanges = -not [string]::IsNullOrWhiteSpace((git status --porcelain))
if ($HasChanges) {
  Invoke-Checked { git commit -m "chore: update 3D soulslike foundation" } "git commit failed."
}

Write-Host "[3/5] Creating or connecting the GitHub repository"
$FullName = "$Owner/$RepoName"
$RepoExists = Test-GhCommand "repo view $FullName --json name"

if ($RepoExists) {
  Write-Host "GitHub repository already exists: $FullName"
} else {
  Write-Host "Creating GitHub repository: $FullName"
  $VisibilityFlag = "--$Visibility"
  Invoke-Checked {
    gh repo create $FullName $VisibilityFlag --description "Browser-based 3D soulslike developed in ten passes"
  } "GitHub repository creation failed."
}

$RemoteUrl = "https://github.com/$FullName.git"
$OriginExists = Test-GhCommand "repo view $FullName --json name"
if (-not $OriginExists) {
  throw "The GitHub repository is still unavailable after creation: $FullName"
}

$RemoteNames = @(git remote)
if ($RemoteNames -contains "origin") {
  Invoke-Checked { git remote set-url origin $RemoteUrl } "Could not update the origin remote."
} else {
  Invoke-Checked { git remote add origin $RemoteUrl } "Could not add the origin remote."
}

Invoke-Checked { git push -u origin main } "Push to GitHub failed."

Write-Host "[4/5] Configuring GitHub Pages for Actions"
$PagesConfigured = $false
$PagesExists = Test-GhCommand "api repos/$FullName/pages"

if ($PagesExists) {
  $PreviousPreference = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  try {
    gh api --method PUT "repos/$FullName/pages" -f build_type=workflow 1>$null 2>$null
    $PagesConfigured = ($LASTEXITCODE -eq 0)
  } finally {
    $ErrorActionPreference = $PreviousPreference
  }
} else {
  $PreviousPreference = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  try {
    gh api --method POST "repos/$FullName/pages" -f build_type=workflow 1>$null 2>$null
    $PagesConfigured = ($LASTEXITCODE -eq 0)
  } finally {
    $ErrorActionPreference = $PreviousPreference
  }
}

if (-not $PagesConfigured) {
  Write-Warning "Pages could not be configured automatically. Open Settings > Pages and select GitHub Actions."
}

Write-Host "[5/5] Complete"
Write-Host "Repository: https://github.com/$FullName"
Write-Host "Deployment status: https://github.com/$FullName/actions"
if ($PagesConfigured) {
  Write-Host "Expected game URL: https://$Owner.github.io/$RepoName/"
}
