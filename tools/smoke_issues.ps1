# tools/smoke_issues.ps1
# Windows PowerShell smoke test for issues workflow
# Usage: .\smoke_issues.ps1 -BaseUrl "http://localhost" -PlanId 123
param(
    [string]$BaseUrl = "http://localhost",
    [int]$PlanId
)
if (-not $PlanId) { Write-Error "PlanId is required. Example: .\smoke_issues.ps1 -BaseUrl http://localhost -PlanId 1"; exit 2 }
Set-StrictMode -Version Latest
$headers = @{ 'Accept' = 'application/json' }

function PostJson($url, $data){
    $json = $data | ConvertTo-Json -Depth 10
    return Invoke-RestMethod -Uri $url -Method Post -Body $json -ContentType 'application/json' -Headers $headers -ErrorAction Stop
}

function GetJson($url){
    return Invoke-RestMethod -Uri $url -Method Get -Headers $headers -ErrorAction Stop
}

try{
    Write-Host "Creating issue..."
    $create = PostJson ("$BaseUrl/api/save_issue.php") @{ plan_id=$PlanId; page=1; x_norm=0.25; y_norm=0.25; title='Smoke Test Issue'; notes='Initial note from smoke test' }
    if (-not $create.ok) { throw "Failed to create issue: $($create | ConvertTo-Json)" }
    $issue = $create.issue
    Write-Host "Created issue id=$($issue.id)"

    Write-Host "Listing issues..."
    $listed = GetJson ("$BaseUrl/api/list_issues.php?plan_id=$PlanId")
    if (-not $listed.ok) { throw "list_issues failed" }
    $found = $listed.issues | Where-Object { $_.id -eq $issue.id }
    if (-not $found){ throw "Created issue not returned by list_issues" }
    Write-Host "List returned issue ok"

    Write-Host "Updating issue..."
    $upd = PostJson ("$BaseUrl/api/save_issue.php") @{ plan_id=$PlanId; id=$issue.id; page=1; x_norm=0.5; y_norm=0.5; title='Smoke Test Issue - updated'; notes='Updated note' }
    if (-not $upd.ok -or -not $upd.updated) { throw "Update failed: $($upd | ConvertTo-Json)" }
    Write-Host "Update ok"

    Write-Host "Uploading small PNG photo..."
    $tmp = [System.IO.Path]::GetTempFileName()
    $png = $tmp + ".png"
    # write a tiny 1x1 PNG (base64)
    $b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII='
    [System.IO.File]::WriteAllBytes($png, [System.Convert]::FromBase64String($b64))
    $form = @{ file = Get-Item $png; plan_id = $PlanId; issue_id = $issue.id }
    $up = Invoke-RestMethod -Uri "$BaseUrl/api/upload_photo.php" -Method Post -Form $form -ErrorAction Stop
    if (-not $up.ok) { throw "Photo upload failed: $($up | ConvertTo-Json)" }
    Write-Host "Photo uploaded id=$($up.photo_id)"

    Write-Host "Fetching photos list..."
    $p = GetJson ("$BaseUrl/api/list_photos.php?plan_id=$PlanId")
    if (-not $p.ok) { throw "list_photos failed" }
    Write-Host "Photos count: $($p.photos.Count)"

    Write-Host "Requesting PDF report..."
    $rpdf = Invoke-RestMethod -Uri "$BaseUrl/api/export_report.php" -Method Post -Body @{ plan_id = $PlanId } -ContentType 'application/x-www-form-urlencoded' -Headers $headers -ErrorAction Stop
    if (-not $rpdf.ok) { throw "Export PDF failed: $($rpdf | ConvertTo-Json)" }
    Write-Host "PDF report generated: $($rpdf.filename)"

    Write-Host "Requesting CSV report..."
    $rcsv = Invoke-RestMethod -Uri "$BaseUrl/api/export_report.php" -Method Post -Body @{ plan_id = $PlanId; format='csv' } -ContentType 'application/x-www-form-urlencoded' -Headers $headers -ErrorAction Stop
    if (-not $rcsv.ok) { throw "Export CSV failed: $($rcsv | ConvertTo-Json)" }
    Write-Host "CSV report generated: $($rcsv.filename)"

    Write-Host "Smoke test completed successfully"
} catch {
    Write-Error "Smoke test failed: $_"
    exit 1
} finally {
    if (Test-Path $png) { Remove-Item $png -Force }
}
