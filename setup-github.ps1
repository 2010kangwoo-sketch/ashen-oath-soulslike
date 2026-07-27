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

  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw $FailureMessage
  }
}

Require-Command "git"
Require-Command "gh"

$Owner = gh api user --jq .login
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($Owner)) {
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
gh repo view $FullName --json name 2>$null | Out-Null
$RepoExists = ($LASTEXITCODE -eq 0)

if (-not $RepoExists) {
  $VisibilityFlag = "--$Visibility"
  Invoke-Checked {
    gh repo create $FullName $VisibilityFlag --description "Browser-based 3D soulslike developed in ten passes"
  } "GitHub repository creation failed."
}

$RemoteUrl = "https://github.com/$FullName.git"
git remote get-url origin 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  Invoke-Checked { git remote set-url origin $RemoteUrl } "Could not update the origin remote."
} else {
  Invoke-Checked { git remote add origin $RemoteUrl } "Could not add the origin remote."
}

Invoke-Checked { git push -u origin main } "Push to GitHub failed."

Write-Host "[4/5] Configuring GitHub Pages for Actions"
$PagesConfigured = $false
gh api "repos/$FullName/pages" 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  gh api --method PUT "repos/$FullName/pages" -f build_type=workflow 2>$null | Out-Null
  $PagesConfigured = ($LASTEXITCODE -eq 0)
} else {
  gh api --method POST "repos/$FullName/pages" -f build_type=workflow 2>$null | Out-Null
  $PagesConfigured = ($LASTEXITCODE -eq 0)
}

if (-not $PagesConfigured) {
  Write-Warning "Pages could not be configured automatically. In the repository, open Settings > Pages and select GitHub Actions."
}

Write-Host "[5/5] Complete"
Write-Host "Repository: https://github.com/$FullName"
Write-Host "Deployment status: https://github.com/$FullName/actions"
if ($PagesConfigured) {
  Write-Host "Expected game URL: https://$Owner.github.io/$RepoName/"
}
