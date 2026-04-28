; CasaGG — .NET 8 Runtime prerequisite check
; Runs before the installer UI appears.
; If .NET 8 Runtime (x64) is not found, prompt the user:
;   YES → open download page, abort installer (user installs .NET then re-runs setup)
;   NO  → continue installing (voice features will be unavailable until .NET 8 is added)

!macro customInit
  ; Look for any .NET 8.x.x folder under the shared framework directory
  FindFirst $R0 $R1 "$PROGRAMFILES64\dotnet\shared\Microsoft.NETCore.App\8.*"
  FindClose $R0

  StrCmp $R1 "" dotnet8Missing dotnet8Found

  dotnet8Missing:
    MessageBox MB_YESNO|MB_ICONEXCLAMATION \
      "CasaGG requires the .NET 8 Runtime for voice features.$\n$\n\
It does not appear to be installed on this PC.$\n$\n\
Click YES to open the Microsoft download page.$\n\
After installing .NET 8 Runtime (x64), run this setup again.$\n$\n\
Click NO to install CasaGG now — voice will not work until .NET 8 is added." \
      IDNO dotnet8Found
    ExecShell "open" "https://dotnet.microsoft.com/en-us/download/dotnet/8.0"
    Abort

  dotnet8Found:
!macroend
