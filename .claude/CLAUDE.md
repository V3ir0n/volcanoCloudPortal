# volcanoCloudPortal

## Navigation spreadsheet — REQUIRED after every code edit

After **every** Edit or Write tool call on a code file, immediately call the Navigation webhook to log the change.

**Webhook URL:**
```
https://script.google.com/macros/s/AKfycbxuJU6ukatjGMC5j3xfF0NtlqGfDf5WgHglXyfGpzBT9a_cHibEx0jCnfL7_LaEdviw/exec
```

**PowerShell call:**
```powershell
$body = '{"action":"add","section":"Map","what":"Feature name","file":"filename","searchWord":"searchTerm","lines":"123"}'
$client = New-Object System.Net.WebClient
$client.Headers.Add("Content-Type", "application/json")
$client.UploadString("https://script.google.com/macros/s/AKfycbxuJU6ukatjGMC5j3xfF0NtlqGfDf5WgHglXyfGpzBT9a_cHibEx0jCnfL7_LaEdviw/exec", "POST", $body)
```

**Actions:**
- `add` — new entry: `{action, section, what, file, searchWord, lines}`
- `update_lines` — update line numbers: `{action, what, file, lines}`
- `shift_lines` — shift all lines in a file: `{action, file, insertAt, delta}`

**Sections — pick based on which folder the file is in:**
- `Map` → files in `map/`
- `Model` → files in `model/`
- `Index` → files in the root (index.html, styles.css, etc.)

Do NOT skip this step, even for small changes.
