$gh = "C:\Program Files\GitHub CLI\gh.exe"

& $gh auth login --hostname github.com --git-protocol https --web --scopes "repo,workflow"
if ($LASTEXITCODE -ne 0) {
    Write-Host "La connexion GitHub a echoue." -ForegroundColor Red
    exit $LASTEXITCODE
}

& $gh auth status
if ($LASTEXITCODE -eq 0) {
    Write-Host "Connexion GitHub CLI verifiee." -ForegroundColor Green
}
