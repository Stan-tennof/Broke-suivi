param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRef
)

$secureToken = Read-Host "Collez le token Discord (la saisie reste masquee)" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)

try {
    $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    & npx.cmd supabase secrets set "DISCORD_BOT_TOKEN=$plainToken" `
        --project-ref $ProjectRef --output-format text --agent no

    if ($LASTEXITCODE -eq 0) {
        Write-Host "Token Discord enregistre dans Supabase." -ForegroundColor Green
    } else {
        Write-Host "Supabase a refuse le secret. Verifiez le message ci-dessus." -ForegroundColor Red
    }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    Remove-Variable plainToken -ErrorAction SilentlyContinue
    Remove-Variable secureToken -ErrorAction SilentlyContinue
}
