$icons = New-Object System.Collections.Generic.HashSet[string]
Get-ChildItem *.html | ForEach-Object {
  $content = Get-Content $_.FullName -Raw
  $matches = [regex]::Matches($content, '<span\b[^>]*class="[^"]*(material-symbols-outlined|material-icons)[^"]*"[^>]*>\s*([a-zA-Z0-9_]+)\s*</span>', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  foreach($m in $matches){ [void]$icons.Add($m.Groups[2].Value.ToLower()) }
}
$icons | Sort-Object
Write-Host ("TOTAL=" + $icons.Count)
