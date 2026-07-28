$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js가 설치되어 있지 않습니다. Node.js 22 LTS를 설치한 뒤 다시 실행해주세요.'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'npm을 찾을 수 없습니다. Node.js를 다시 설치해주세요.'
}

$nodeVersion = [version]((node --version).TrimStart('v'))
$supported = (($nodeVersion.Major -eq 20) -and ($nodeVersion -ge [version]'20.19.0')) -or
             (($nodeVersion.Major -eq 22) -and ($nodeVersion -ge [version]'22.12.0')) -or
             ($nodeVersion.Major -gt 22)
if (-not $supported) {
    throw "현재 Node.js 버전은 $nodeVersion 입니다. Node.js 20.19 이상 또는 22.12 이상이 필요합니다."
}

if (-not (Test-Path 'node_modules')) {
    Write-Host '최초 실행에 필요한 패키지를 설치합니다.'
    npm install
    if ($LASTEXITCODE -ne 0) { throw 'npm install에 실패했습니다. 인터넷 연결과 방화벽을 확인해주세요.' }
}

Write-Host 'Ashen Oath를 로컬 브라우저에서 실행합니다.'
npm run start
if ($LASTEXITCODE -ne 0) { throw '개발 서버 실행에 실패했습니다.' }
