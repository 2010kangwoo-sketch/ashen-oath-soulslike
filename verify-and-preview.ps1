$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'Node.js와 npm이 필요합니다.'
}
if (-not (Test-Path 'node_modules')) {
    npm install
    if ($LASTEXITCODE -ne 0) { throw 'npm install에 실패했습니다.' }
}

npm run verify
if ($LASTEXITCODE -ne 0) { throw '타입 검사 또는 프로덕션 빌드 검증에 실패했습니다.' }

Write-Host '검증된 프로덕션 빌드를 브라우저에서 엽니다.'
npm run preview -- --host 127.0.0.1 --open
if ($LASTEXITCODE -ne 0) { throw '프로덕션 미리보기에 실패했습니다.' }
