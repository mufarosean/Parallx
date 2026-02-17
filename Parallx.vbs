' Parallx.vbs — Launch Parallx without a visible console window.
' Works from double-click, shortcut, or called by Parallx.bat.
Dim fso, shell, root
Set fso   = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root

' Launch: build then run electron.  Window style 0 = hidden.
shell.Run "cmd /c node scripts/build.mjs && node_modules\.bin\electron .", 0, False
