' Parallx.vbs — Launch Parallx without a visible console window
' Double-click this file (or create a shortcut to it) to start Parallx.
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
WshShell.Run "cmd /c npm run start", 0, False
