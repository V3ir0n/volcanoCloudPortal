# Navigation hook - fires after Edit/Write, analyzes the change, updates Navigation spreadsheet
$inputJson = [Console]::In.ReadToEnd()
$data = $inputJson | ConvertFrom-Json -ErrorAction SilentlyContinue
if (-not $data) { exit 0 }

if ($data.tool_name -notin @('Edit', 'Write')) { exit 0 }

$filePath = [string]$data.tool_input.file_path
$oldString = [string]$data.tool_input.old_string
$newString = [string]$data.tool_input.new_string

if (-not $filePath) { exit 0 }

# Only track code files
$ext = [IO.Path]::GetExtension($filePath).ToLower()
if ($ext -notin @('.js', '.ts', '.html', '.css', '.py')) { exit 0 }

$fileName = [IO.Path]::GetFileNameWithoutExtension($filePath)

# Find line numbers of the change
$lineRange = "?"
if (Test-Path $filePath) {
    $content = Get-Content $filePath -Raw -ErrorAction SilentlyContinue
    if ($content -and $newString.Length -gt 0) {
        $searchSnippet = $newString.Substring(0, [Math]::Min(60, $newString.Length))
        $idx = $content.IndexOf($searchSnippet)
        if ($idx -ge 0) {
            $lineNum = ($content.Substring(0, $idx) -split "`n").Count
            $endLine = $lineNum + ($newString -split "`n").Count - 1
            $lineRange = if ($lineNum -eq $endLine) { "$lineNum" } else { "$lineNum-$endLine" }
        }
    }
}

$oldSnippet = if ($oldString.Length -gt 250) { $oldString.Substring(0, 250) } else { $oldString }
$newSnippet = if ($newString.Length -gt 250) { $newString.Substring(0, 250) } else { $newString }

$prompt = "File '$fileName' (lines $lineRange) was edited. Old: $oldSnippet /// New: $newSnippet. For a code navigation spreadsheet, output ONLY a JSON object. If trivial (typo/comment/whitespace) output: {""action"":""skip""}. Otherwise: {""action"":""add"",""section"":""Map"",""what"":""short feature name"",""file"":""$fileName"",""searchWord"":""bestSearchTerm"",""lines"":""$lineRange""}. Only JSON, no markdown."

$webhookUrl = "https://script.google.com/macros/s/AKfycbxuJU6ukatjGMC5j3xfF0NtlqGfDf5WgHglXyfGpzBT9a_cHibEx0jCnfL7_LaEdviw/exec"

try {
    $result = & claude -p $prompt 2>$null
    $trimmed = $result.Trim()
    # Strip markdown fences if present
    $trimmed = $trimmed -replace '```json\s*', '' -replace '```\s*', ''
    $trimmed = $trimmed.Trim()
    if ($trimmed -match '^\{') {
        $json = $trimmed | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($json -and $json.action -ne 'skip') {
            $client = New-Object System.Net.WebClient
            $client.Headers.Add("Content-Type", "application/json")
            $client.UploadString($webhookUrl, "POST", $trimmed)
        }
    }
} catch {}
