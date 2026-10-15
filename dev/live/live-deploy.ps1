param([string]$Ver = '1', [switch]$NoValidate)
# DEV ONLY (never run on prod; needs the sp-env global skill + dev cert auth).
# Uploads the whole src/ folder to <code root>/ps-zone-attestation/ on the dev site via PnP, then
# (re)creates two test pages:
#   SitePages/ps-zone-attestation-test.aspx         the form and the resources panel. The page
#     template has one script web part, so they share it, side by side in a 3:1 grid (on prod
#     they're two web parts in a ¾ + ¼ page section).
#   SitePages/ps-zone-attestation-access-test.aspx  the employee access list, linked from the form.
# Checks the configs and the template before uploading or recycling anything.
# Bump -Ver on every engine upload. Merges BSP Forms' live-setup.ps1 + live-page.ps1 for this
# repo. The folder is the form's own, so - unlike the shared bsp-forms engine on dev - nothing
# else needs backing up or restoring around a run.
# Order: node live-zone-lists.js (once) -> node live-zone-perms.js (once) -> live-deploy.ps1 -Ver <n>
#        -> node live-zone.js [--as <profile>]
$ErrorActionPreference = 'Stop'
. "$HOME\.claude\skills\sp-env\scripts\sp-env-common.ps1"
$t = Get-SpEnvTenants
$conn = Connect-SpEnvDev
$siteRel = ([uri]$t.dev.siteUrl).AbsolutePath.TrimEnd('/')
$codeRel = "$siteRel/$($t.dev.roots.code)"
$src = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'src'
$folder = "$($t.dev.roots.code)/ps-zone-attestation"
$cfgName = 'ps-zone-attestation.json'
$resName = 'ps-zone-attestation.resources.json'
$accName = 'ps-zone-attestation.access.json'
$pagesRel = "$siteRel/SitePages"
$pageName = 'ps-zone-attestation-test'
$accPageName = 'ps-zone-attestation-access-test'
function J([string]$s) { $b = [char]92; $s.Replace('<', "${b}u003C").Replace('>', "${b}u003E").Replace('"', "${b}u0022").Replace("`n", "${b}n") }
# swap a string that must occur exactly $n times
function Swap([string]$text, [string]$name, [string]$from, [string]$to, [int]$n) {
  if (([regex]::Matches($text, [regex]::Escape($from))).Count -ne $n) { throw "$name no longer has $n x $from - update live-deploy.ps1" }
  $text.Replace($from, $to)
}

# --- Phase 1: preflight (read-only on the tenant; only local temp files are written) ---
# The configs target PROD's list site (/teams/FCUWebDatastores); on dev the twin lists are on the
# tenant root site (live-zone-lists.js), so every siteUrl line swaps to "/". The two pages link
# each other through vars (accessListUrl, formUrl): those point at the dev test pages.
$prodStore = '"siteUrl": "/teams/FCUWebDatastores"'
$cfgText = Get-Content (Join-Path $src $cfgName) -Raw
$cfgText = Swap $cfgText $cfgName $prodStore '"siteUrl": "/"' 3
$cfgText = Swap $cfgText $cfgName '"accessListUrl": "/sites/FCUPortal/SitePages/PS-Work-Zone-Access.aspx"' "`"accessListUrl`": `"$pagesRel/$accPageName.aspx`"" 1
$accText = Get-Content (Join-Path $src $accName) -Raw
$accText = Swap $accText $accName $prodStore '"siteUrl": "/"' 3
$accText = Swap $accText $accName '"formUrl": "/sites/FCUPortal/SitePages/PS-Work-Zone-Confirmation.aspx"' "`"formUrl`": `"$pagesRel/$pageName.aspx`"" 1
# The resources panel: the job aid (the first "url") becomes the dev site's home page, so it shows
# as a link; the other placeholders stay unlinked.
$resText = Get-Content (Join-Path $src $resName) -Raw
$firstUrl = [regex]'"url":\s*""'
if (-not $firstUrl.IsMatch($resText)) { throw "$resName has no empty url to point at dev - update live-deploy.ps1" }
$resText = $firstUrl.Replace($resText, "`"url`": `"$($t.dev.siteUrl)`"", 1)
$devDir = Join-Path ([IO.Path]::GetTempPath()) 'psz-dev'
New-Item -ItemType Directory -Force -Path $devDir | Out-Null
[IO.File]::WriteAllText((Join-Path $devDir $cfgName), $cfgText)
[IO.File]::WriteAllText((Join-Path $devDir $resName), $resText)
[IO.File]::WriteAllText((Join-Path $devDir $accName), $accText)
# The test pages are copied from the site's _app-template.aspx (a working Modern Script Editor web
# part) with its SEWP script replaced. (Add-PnPPageWebPart -Component <guid> saves the SEWP with
# a null webPartId on this tenant - an empty shell - which is why the page is copied instead.)
$old = J "<div id=`"sp-env-harness`"></div>`n<div id=`"sp-env-app-root`"></div>`n<script src=`"__SP_ENV_SCRIPT__`"></script>"
$validate = if ($NoValidate) { '' } else { ' data-validate' }
$engine = "<script src=`"$codeRel/ps-zone-attestation/ps-zone-attestation.js?v=$Ver`"></script>"
$new = J ("<div style=`"display:grid;grid-template-columns:minmax(0,3fr) minmax(0,1fr);gap:32px;align-items:start`">`n" +
  "<div data-psz-form$validate data-config=`"$codeRel/ps-zone-attestation/$cfgName`"></div>`n" +
  "<div data-psz-resources data-config=`"$codeRel/ps-zone-attestation/$resName`"></div>`n</div>`n" + $engine)
$newAcc = J ("<div data-psz-access data-config=`"$codeRel/ps-zone-attestation/$accName`"></div>`n" + $engine)
$tpl = Get-PnPFile -Url "$pagesRel/_app-template.aspx" -AsListItem -Connection $conn
if (-not ([string]$tpl['CanvasContent1']).Contains($old)) { throw 'template SEWP script string not found verbatim - inspect _app-template.aspx' }

# --- Phase 2: upload every runtime file, keeping the design/ and lib/ subfolders ---
$swapped = @($cfgName, $resName, $accName)
$files = Get-ChildItem $src -Recurse -File | Where-Object { $swapped -notcontains $_.Name }
foreach ($f in $files) {
  $rel = $f.DirectoryName.Substring($src.Length).Replace('\', '/')
  Add-PnPFile -Path $f.FullName -Folder "$folder$rel" -Connection $conn | Out-Null
}
foreach ($n in $swapped) { Add-PnPFile -Path (Join-Path $devDir $n) -Folder $folder -Connection $conn | Out-Null }
Write-Host "uploaded $($files.Count + $swapped.Count) files to $codeRel/ps-zone-attestation/"

# --- Phase 3: the test pages ---
function New-TestPage([string]$name, [string]$title, [string]$script, [string]$marker) {
  $target = "$pagesRel/$name.aspx"
  if (Get-PnPFile -Url $target -Connection $conn -ErrorAction SilentlyContinue) {
    Remove-PnPFile -ServerRelativeUrl $target -Recycle -Force -Connection $conn
    Write-Host "recycled old $name.aspx"
  }
  Copy-PnPFile -SourceUrl "$pagesRel/_app-template.aspx" -TargetUrl $target -Force -Connection $conn
  $item = Get-PnPFile -Url $target -AsListItem -Connection $conn
  $canvas = [string]$item['CanvasContent1']
  if (-not $canvas.Contains($old)) { throw 'template SEWP script string not found verbatim - inspect _app-template.aspx' }
  Set-PnPListItem -List 'Site Pages' -Identity $item.Id -Values @{ CanvasContent1 = $canvas.Replace($old, $script); Title = $title } -Connection $conn | Out-Null
  Set-PnPPage -Identity $name -Publish -Connection $conn | Out-Null
  $check = [string](Get-PnPFile -Url $target -AsListItem -Connection $conn)['CanvasContent1']
  if (-not $check.Contains($marker)) { throw "rewrite did not land on $name.aspx" }
  Write-Host "PAGE: $($t.dev.siteUrl)/SitePages/$name.aspx (published, rewrite verified)"
}
New-TestPage $pageName 'PS Work Zone Confirmation (test)' $new 'data-psz-resources'
New-TestPage $accPageName 'PS Work Zone access list (test)' $newAcc 'data-psz-access'
