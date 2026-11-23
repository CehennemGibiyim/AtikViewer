; ATIKVIEWER — Windows kurulum paketi (Inno Setup 6)
; =====================================================
; Derleme (depo kökünden):
;   windows\Paket.ps1                 -> dist\ATIKVIEWER-<sürüm>-Setup.exe
;   ISCC.exe /DAppVersion=0.1.0 windows\atikviewer.iss
;
; Paket, uygulamanın kendisini kurar; Node.js / Python / AI modelleri gibi
; ağır bağımlılıklar kurulum sonunda windows\Kurulum.bat ile (idempotent olarak)
; hazırlanır. Böylece kurulum dosyası küçük ve güncellenebilir kalır.
; Yönetici izni gerekmez: %LOCALAPPDATA%\ATIKVIEWER altına kurulur.

#define AppName "ATIKVIEWER"
#define AppPublisher "CehennemGibiyim"
#define AppUrl "https://github.com/CehennemGibiyim/AtikViewer"

#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif

[Setup]
AppId={{8C4F2B71-2A4C-4E0E-9D6B-3A5C1E7F21AA}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}/issues
AppUpdatesURL={#AppUrl}/releases
DefaultDirName={localappdata}\ATIKVIEWER
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
LicenseFile=..\LICENSE
OutputDir=..\dist
OutputBaseFilename=ATIKVIEWER-{#AppVersion}-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
UninstallDisplayName={#AppName}

[Languages]
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl"

[Tasks]
Name: "desktopicon"; Description: "Masaüstü kısayolu oluştur"; GroupDescription: "Kısayollar:"; Flags: checkedonce

[Files]
; Kaynak ağacı: bağımlılıklar, derleme çıktıları, sanal ortam ve veriler hariç.
Source: "..\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion; \
    Excludes: ".git\*,.git,.freebuff\*,.next\*,.data\*,.venv\*,node_modules\*,dist\*,.env,windows\*.log,ai-worker\data\*,*.tsbuildinfo,tmp\*"

[Icons]
Name: "{group}\ATIKVIEWER"; Filename: "{app}\windows\Baslat.bat"; WorkingDir: "{app}"
Name: "{group}\ATIKVIEWER kurulumu (bağımlılıklar)"; Filename: "{app}\windows\Kurulum.bat"; WorkingDir: "{app}"
Name: "{group}\ATIKVIEWER'ı durdur"; Filename: "{app}\windows\Dur.bat"; WorkingDir: "{app}"
Name: "{group}\Kaldır {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\ATIKVIEWER"; Filename: "{app}\windows\Baslat.bat"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\windows\Kurulum.bat"; Description: "Bağımlılıkları şimdi kur (Node.js, Python, AI modelleri — ücretsiz)"; Flags: postinstall shellexec nowait skipifsilent
Filename: "{app}\windows\Baslat.bat"; Description: "ATIKVIEWER'ı başlat"; Flags: postinstall shellexec nowait skipifsilent unchecked
