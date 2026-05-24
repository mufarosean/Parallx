$ps = (Get-ChildItem tests/unit -Recurse -File | ForEach-Object { Get-Content -Raw $_.FullName }) -join [Environment]::NewLine
$rows = @()
Get-ChildItem src -Recurse -File -Filter *.ts |
  Where-Object { $_.FullName -notmatch 'tests|\.d\.ts$' -and $_.Length -gt 4000 -and $_.Length -lt 12000 } |
  ForEach-Object {
    $c = Get-Content -Raw $_.FullName
    $m = [regex]::Match($c, 'export\s+(?:abstract\s+)?(?:class|function|const|enum)\s+(\w+)')
    if ($m.Success) {
      $sym = $m.Groups[1].Value
      if ($ps -notmatch "\b$sym\b") {
        $rows += [pscustomobject]@{ Size=$_.Length; Path=$_.FullName.Substring((Get-Location).Path.Length+1); Sym=$sym }
      }
    }
  }
$rows | Sort-Object Size | Select-Object -First 50 | Format-Table -AutoSize
