param(
  [string]$RepoName = "ashen-oath-soulslike",
  [ValidateSet("public", "private")]
  [string]$Visibility = "public"
)

$ErrorActionPreference = "Stop"

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "필수 명령을 찾지 못했습니다: $Name"
  }
}

Require-Command "git"
Require-Command "gh"

$Owner = gh api user --jq .login
if (-not $Owner) { throw "GitHub 로그인 정보를 확인하지 못했습니다. 먼저 gh auth login을 실행하세요." }

$HasNode = [bool](Get-Command node -ErrorAction SilentlyContinue)
$HasNpm = [bool](Get-Command npm -ErrorAction SilentlyContinue)

if ($HasNode -and $HasNpm) {
  Write-Host "[1/5] 의존성 설치 및 기반 검증"
  npm install --no-audit --no-fund
  npm run verify
} else {
  Write-Host "[1/5] Node.js가 없어 로컬 검증을 건너뜁니다. GitHub Actions가 대신 빌드합니다."
}

Write-Host "[2/5] 로컬 Git 기준점 생성"
if (-not (Test-Path ".git")) {
  git init -b main
}

git add .
$HasChanges = -not [string]::IsNullOrWhiteSpace((git status --porcelain))
if ($HasChanges) {
  git commit -m "chore: establish 3D soulslike foundation"
}

Write-Host "[3/5] GitHub 저장소 연결"
$FullName = "$Owner/$RepoName"
$RepoExists = $true
try { gh repo view $FullName --json name | Out-Null } catch { $RepoExists = $false }

if (-not $RepoExists) {
  $VisibilityFlag = "--$Visibility"
  gh repo create $FullName $VisibilityFlag --source . --remote origin --push `
    --description "Browser-based 3D soulslike developed in ten passes"
} else {
  $OriginExists = $true
  try { git remote get-url origin | Out-Null } catch { $OriginExists = $false }
  if (-not $OriginExists) {
    git remote add origin "https://github.com/$FullName.git"
  }
  git push -u origin main
}

Write-Host "[4/5] GitHub Pages를 Actions 방식으로 설정"
$PagesConfigured = $false
try {
  gh api "repos/$FullName/pages" | Out-Null
  gh api --method PUT "repos/$FullName/pages" -f build_type=workflow | Out-Null
  $PagesConfigured = $true
} catch {
  try {
    gh api --method POST "repos/$FullName/pages" -f build_type=workflow | Out-Null
    $PagesConfigured = $true
  } catch {
    Write-Warning "Pages 자동 설정 권한이 없습니다. 저장소 Settings > Pages에서 Source를 GitHub Actions로 선택하세요."
  }
}

Write-Host "[5/5] 완료"
Write-Host "저장소: https://github.com/$FullName"
Write-Host "배포 진행: https://github.com/$FullName/actions"
if ($PagesConfigured) {
  Write-Host "예상 게임 주소: https://$Owner.github.io/$RepoName/"
}
