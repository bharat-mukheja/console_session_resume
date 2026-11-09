"""Build an installable VSIX with Python's standard library; no npm downloads."""
import json
from pathlib import Path
from xml.sax.saxutils import escape
import zipfile

root = Path(__file__).resolve().parents[1]
package = json.loads((root / "package.json").read_text())
output = root / "dist" / f"{package['name']}-{package['version']}.vsix"
output.parent.mkdir(exist_ok=True)
manifest = f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="{escape(package['name'])}" Version="{package['version']}" Publisher="{escape(package['publisher'])}" />
    <DisplayName>{escape(package['displayName'])}</DisplayName>
    <Description xml:space="preserve">{escape(package['description'])}</Description>
    <Categories>Other</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="{package['engines']['vscode']}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true" />
    </Properties>
    <License>extension/LICENSE</License>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true" />
  </Assets>
</PackageManifest>'''
types = '''<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
  <Default Extension="bash" ContentType="text/plain" />
  <Default Extension="ps1" ContentType="text/plain" />
  <Default Extension="fish" ContentType="text/plain" />
</Types>'''
files = [root / name for name in ["package.json", "README.md", "LICENSE"]]
files += sorted((root / "src").glob("*.js"))
files += sorted(file for file in (root / "shell").rglob("*") if file.is_file())
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
    archive.writestr("extension.vsixmanifest", manifest)
    archive.writestr("[Content_Types].xml", types)
    for file in files:
        archive.write(file, "extension/" + file.relative_to(root).as_posix())
print(output)
