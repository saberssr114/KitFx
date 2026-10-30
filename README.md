# KitFX for EffectCraft

**A native ScriptUI panel for [EffectCraft](https://github.com/storytold/effectcraft):
easing, alignment, beat markers, spring motion, captions and presets — inside the app, not beside it.**

![EffectCraft](https://img.shields.io/badge/EffectCraft-0.18%2B-8b5cf6?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Windows-0078D4?style=flat-square)
![Panel](https://img.shields.io/badge/type-ScriptUI%20panel-22d3ee?style=flat-square)
![Website]([https://img.shields.io/badge/website-live-22c55e?style=flat-square])

**Website: <https://celebrated-fudge-34970b.netlify.app>** · **GitHub: [@saberssr114](https://github.com/saberssr114)**

![KitFX panel docked in EffectCraft](assets/curve.png)

**Direct download: [`KitFX.jsx`](KitFX.jsx)** — the whole panel in one 78 KB file.
Copy it into `%APPDATA%\EffectCraft\Scripts\ScriptUI Panels\` and restart EffectCraft.

> **Why a ScriptUI panel?** EffectCraft is not After Effects. It cannot load CEP
> HTML extensions (the `CSXS/manifest.xml` kind). It *can* load ScriptUI panels
> and run After Effects-style JavaScript, so KitFX is rebuilt natively on that
> API. Every action is an undoable EffectCraft engine command.

---

## Website

The landing page lives in this repository and is published with GitHub Pages:

- **Live:** <https://saberssr114.github.io/KitFx/>
- Files: index.html, 404.html, css/site.css, js/site.js, ssets/
- A custom 404.html catches stale links with a themed page instead of GitHub's default.

If the site returns 404, see **Fix a 404** in [docs/PUBLISH.md](docs/PUBLISH.md).

---

## Install (replace the kit in EffectCraft)

You need EffectCraft **0.18.0 or newer** on Windows. No administrator rights.

### Option 1 — installer (recommended)

1. Download **[dist/KitFX-Setup.exe](dist/KitFX-Setup.exe)** (or from the Releases page).
2. Close EffectCraft.
3. Run the installer and click **Install**. It replaces any previous copy.
4. Start EffectCraft and open **Window ▸ KitFX.jsx**.

The installer writes exactly one file:

```
%APPDATA%\EffectCraft\Scripts\ScriptUI Panels\KitFX.jsx
```

### Option 2 — manual copy (PowerShell)

Close EffectCraft, then either run the bundled script:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

or copy the file yourself:

```powershell
$panels = "$env:APPDATA\EffectCraft\Scripts\ScriptUI Panels"
New-Item -ItemType Directory -Path $panels -Force | Out-Null
Copy-Item .\KitFX.jsx $panels -Force
```

Full walkthrough and troubleshooting: **[docs/INSTALL.md](docs/INSTALL.md)**.

Start EffectCraft → **Window ▸ KitFX.jsx**. To remove it:
`powershell -ExecutionPolicy Bypass -File .\uninstall.ps1`.

### Option 3 — try it without installing

In EffectCraft: **File ▸ Scripts ▸ Run Script File…** → pick `KitFX.jsx`.
It opens as a floating palette instead of a docked panel.

### Replacing an older copy

The installer and the `Copy-Item -Force` command both overwrite
`KitFX.jsx` in place. Nothing else is touched. After replacing:

1. Restart EffectCraft (the Window menu is built at launch).
2. Open **Window ▸ KitFX.jsx** and check the version next to the logo.

### Remove the old CEP version (if you copied one)

A folder like `<EffectCraft install>\KitFX` containing `CSXS\manifest.xml`
does nothing in EffectCraft. Delete it:

```powershell
Remove-Item "<EffectCraft install>\KitFX" -Recurse -Force
```

### Update / uninstall

- **Update:** run the newer `KitFX-Setup.exe` — it replaces the panel.
- **Uninstall:** Windows *Settings ▸ Apps ▸ KitFX* → Uninstall, or
  `& "$env:LOCALAPPDATA\KitFX-EC\KitFX-Setup.exe" /U`, or delete
  `%APPDATA%\EffectCraft\Scripts\ScriptUI Panels\KitFX.jsx`.

Command-line switches:

```text
/S                         silent install
/S /P                      portable: copy the panel only, no uninstall entry
/U /S                      silent uninstall
/S /D="C:\path\ScriptUI Panels"   install into another panels folder
/SELFTEST /LOG="C:\x.txt"  build the window without showing it (CI check)
```

---

## First run

1. Open a composition with at least one layer.
2. **Window ▸ KitFX.jsx**.
3. Click **Info** in the panel header — four lines should be OK:
   EffectCraft, project, active composition, settings storage.
4. Select a keyframed property, click **Easy** in **Curve**: the keys ease.

![Curve](docs/curve.png)
![Spring](docs/spring.png)

---

## Tools

| Tool | What it does |
| --- | --- |
| **Curve** | Six easing presets (Easy, Smooth, Snap, Soft, Strong, Anticipate), custom in/out influence, Linear/Hold/Auto, copy & paste easing or keyframe values. |
| **Align** | Align selected layers to the composition or the last selected layer, with a margin; spread three or more layers with equal gaps; move anchor points without moving the artwork. |
| **Beat** | Composition or layer markers from a BPM grid (division, offset, work area), tap tempo, and a clear action that removes only KitFX markers. |
| **Spring** | Overshoot/bounce on any keyframed property, with four native `KitFX Spring …` sliders in Effect Controls. |
| **Captions** | Load SRT/VTT or paste subtitles → one timed text layer per cue. |
| **Library** | Six motion presets, plus save/apply/delete layer presets stored in EffectCraft's settings. |

The tool selector remembers the last page. Every slider also has a typable value
field (EffectCraft 0.18 draws slider handles without a track).

![Align](docs/align.png) ![Beat](docs/beat.png)

---

## Requirements

- EffectCraft **0.18.0+** (Windows; the installer targets the Windows settings
  folder — the panel itself is host-agnostic).
- No admin rights, no network access, no external dependencies.

---

## How it works

The panel is one self-contained `KitFX.jsx` built from `src/`:

```text
src/kitfx-core.jsx   engine calls: ease, align, markers, spring, captions, presets
src/kitfx-srt.jsx    SRT / WebVTT parser
src/kitfx-ui.jsx     ScriptUI layout
```

- **Easing** uses `comp.selectedProperties`, `Property.selectedKeys`,
  `keyInTemporalEase` / `keyOutTemporalEase` and `setTemporalEaseAtKey`.
- **Alignment** measures `sourceRectAtTime` and applies the layer transform
  itself (EffectCraft 0.18's `sourcePointToComp` is inconsistent for solids).
- **Markers** use `MarkerValue` and are written frame-accurately.
- **Spring** uses expressions plus four `ADBE Slider Control` effects. Since
  `numKeys` / `key()` / `valueAtTime` do not evaluate on vector properties in
  0.18, the key windows and directions are baked in when you apply it —
  re-apply after moving keyframes.
- **Captions** use `comp.layers.addText` and `TextDocument`.
- **Presets** live in `app.settings`, so they survive restarts.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| KitFX.jsx is not in the Window menu | Restart EffectCraft; confirm the file is directly in `%APPDATA%\EffectCraft\Scripts\ScriptUI Panels\` (a subfolder becomes a submenu). |
| "Open a composition first" | Click the composition in the Project panel so it is active. |
| "Select keyframes" though a layer is selected | Select the keyframes or the property row in the Timeline. |
| Spring adds sliders but no bounce | The property needs ≥2 keyframes and no foreign expression. Re-apply after editing keys. |
| Loading .srt says file access is blocked | Keep the file next to the project, or enable *Settings ▸ Scripting & Expressions ▸ Allow scripts to write files and access network*, or paste the subtitle text. |
| Sliders are hard to drag | Drag the small handle, or type into the value box beside it (0.18 limitation). |

---

## Build from source

```powershell
# panel only
powershell -ExecutionPolicy Bypass -File tools\build.ps1 -SkipInstaller

# panel + 23 headless tests + zip + setup.exe
powershell -ExecutionPolicy Bypass -File tools\build.ps1

# installer round-trip
powershell -ExecutionPolicy Bypass -File tools\test\test-installer.ps1
```

The build concatenates the three sources, syntax-checks the result, runs
`tools/test/test-core.jsx` through `effectcraft-cli --demo script` (the **real**
engine, not a mock), then packages `dist/KitFX.jsx`, `dist/KitFX-1.0.0.zip` and
`dist/KitFX-Setup.exe`.

---

## Verification

- **23/23** engine tests — easing values, alignment math, marker counts, spring
  overshoot evaluated at real times, captions, presets, SRT.
- **12/12** installer checks — byte-identical install, reinstall, uninstall,
  headless window construction.
- **6/6** live checks in the running app — panel opens, pages switch, **Easy**
  sets 33.33 influence, **Place markers** creates 17 markers, **Apply spring**
  creates the expression + 4 sliders, **TL** moves animated keys.

See [docs/VERIFICATION.md](docs/VERIFICATION.md).

---

## Limitations

- No audio analysis: EffectCraft's script API exposes no audio samples, so
  **Beat** is a BPM/tap grid (not WAV onset detection).
- Subtitle *files* are subject to EffectCraft's scripting file permission;
  pasting always works.
- Spring windows are generated at apply time; re-apply after major keyframe edits.
- Windows installer only (the panel itself runs anywhere EffectCraft runs).

---

## Repository layout

```text
index.html  the website (space theme, screenshots, download buttons)
404.html    themed fallback page for stale links
assets/     screenshots, KitFX-1.0.0.zip, KitFX-Setup.exe, favicon
css/ js/    the site's styles and scripts
KitFX.jsx   the built panel (one file, same bytes as dist/KitFX.jsx)
dist/       KitFX.jsx, KitFX-1.0.0.zip, KitFX-Setup.exe, SHA256SUMS.txt
src/        panel sources (core, SRT parser, ScriptUI)
installer/  setup.exe sources (C#)
tools/      build.ps1, syntax-check.js, serve-site.js, tests
docs/       INSTALL.md, VERIFICATION.md, PUBLISH.md, screenshots
```

---

## Credits and licence

Original code for this project. EffectCraft is MIT/Apache-2.0 by the ArtCraft
Team; KitFX is not affiliated with ArtCraft, Adobe, or any other panel product.
Add a `LICENSE` file before publishing if you want to grant explicit terms
(MIT is a common choice for ScriptUI tools).
