param([string]$BaseUrl = 'http://127.0.0.1:5188', [string]$StudyCode = 'SYNTH-UI-001')
$ErrorActionPreference = 'Stop'
function Invoke-Platform([string]$Path, [string]$Method = 'GET', $Body = $null, [string]$Actor = 'dev-operator') {
    $request = @{ Uri = "$BaseUrl/api$Path"; Method = $Method; Headers = @{ 'X-Development-User' = $Actor } }
    if ($null -ne $Body) { $request.ContentType = 'application/json; charset=utf-8'; $request.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 30)) }
    $result = Invoke-RestMethod @request
    return $result
}
$runtime = Invoke-Platform '/runtime'
if (-not $runtime.developmentIdentity -or -not $runtime.syntheticOnly) { throw '此腳本僅允許明確啟用開發身分的合成資料環境。' }
$study = @(Invoke-Platform '/studies') | Where-Object code -EQ $StudyCode | Select-Object -First 1
if (-not $study) { $study = Invoke-Platform '/studies' 'POST' @{ code = $StudyCode; name = '合成多院研究' } }
$sites = @(Invoke-Platform "/studies/$($study.id)/sites")
foreach ($entry in @(@('A','甲院'),@('B','乙院'))) {
    if (-not ($sites | Where-Object code -EQ $entry[0])) {
        $null = Invoke-Platform "/studies/$($study.id)/sites" 'POST' @{ code = $entry[0]; name = $entry[1] }
    }
}
$sites = @(Invoke-Platform "/studies/$($study.id)/sites")
$users = @(Invoke-Platform '/users')
$definitions = @(
    @{ name = '表單設計者'; site = $null; cross = $false; permissions = 258 },
    @{ name = '獨立核准／審閱者'; site = $null; cross = $true; permissions = 884 },
    @{ name = '甲院研究人員'; site = ($sites | Where-Object code -EQ 'A').id; cross = $false; permissions = 264 },
    @{ name = '乙院研究人員'; site = ($sites | Where-Object code -EQ 'B').id; cross = $false; permissions = 264 }
)
$grants = @(Invoke-Platform "/studies/$($study.id)/grants")
foreach ($definition in $definitions) {
    $user = $users | Where-Object name -EQ $definition.name
    if (-not ($grants | Where-Object { $_.userId -eq $user.id -and $_.siteId -eq $definition.site -and $_.permissions -eq $definition.permissions -and -not $_.expiresAt })) {
        $null = Invoke-Platform "/studies/$($study.id)/grants" 'POST' @{ userId = $user.id; siteId = $definition.site; crossSite = $definition.cross; permissions = $definition.permissions; reason = '合成研究測試指派' }
    }
}
$subjects = @(Invoke-Platform "/studies/$($study.id)/subjects")
foreach ($site in $sites) {
    $code = "SYNTH-$($site.code)-001"
    if (-not ($subjects | Where-Object code -EQ $code)) {
        $null = Invoke-Platform "/studies/$($study.id)/subjects" 'POST' @{ siteId = $site.id; code = $code }
    }
}
Write-Output "合成研究已就緒：$($study.name) [$($study.id)]；已建立院所、人員授權及研究代碼，尚未自動確認任何收集依據。"
