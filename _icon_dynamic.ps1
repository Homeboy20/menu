Get-ChildItem *.html | ForEach-Object {
  $content = Get-Content $_.FullName -Raw
  $matches = [regex]::Matches($content, '<span\b[^>]*class="[^"]*(material-symbols-outlined|material-icons)[^"]*"[^>]*>([\s\S]*?)</span>', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  foreach($m in $matches){
    $inner = $m.Groups[2].Value.Trim()
    if($inner -notmatch '^[a-zA-Z0-9_]+$'){
      "$($_.Name): $inner"
    }
  }
}
