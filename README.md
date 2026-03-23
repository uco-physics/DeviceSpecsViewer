# Device Specs Viewer

A lightweight static web app that surfaces device, browser, and capability signals available to standard web pages. Built for GitHub Pages and modern browsers with graceful fallbacks.

## Project goals

- Clean, modern, white-based UI with dashboard cards + detailed tables
- Progressive loading states that resolve to real values or "Unavailable in browser"
- Accurate, honest reporting of what browsers can and cannot reveal
- Fully localized UI and tooltips (EN/JA/ZH/ES/HI)
- Minimal dependencies and GitHub Pages friendly

## Local run

Because the app loads locale JSON files via `fetch`, a local web server is required.

```bash
# from /home/uco/DSVdev
python3 -m http.server 8000
```

Then open:

```
http://localhost:8000/
```

## Deployment (GitHub Pages)

This project uses **two repositories**:

1. **Private development repo**: `uco-physics/DSVdev` (source of truth)
2. **Public GitHub Pages repo**: `uco-physics/DeviceSpecsViewer` (static files only)

### Publishing flow

1. Update the private repo (this repo).
2. Copy only the public static files to the Pages repo:
   - `index.html`
   - `style.css`
   - `script.js`
   - `locales/`
3. Commit and push to `uco-physics/DeviceSpecsViewer`.
4. Enable GitHub Pages in repo settings (main branch / root).

### Manual publish commands

```bash
# clone Pages repo once
gh repo clone uco-physics/DeviceSpecsViewer /home/uco/DeviceSpecsViewer

# copy static files over
cp /home/uco/DSVdev/index.html /home/uco/DeviceSpecsViewer/index.html
cp /home/uco/DSVdev/style.css /home/uco/DeviceSpecsViewer/style.css
cp /home/uco/DSVdev/script.js /home/uco/DeviceSpecsViewer/script.js
cp /home/uco/DSVdev/locales/*.json /home/uco/DeviceSpecsViewer/locales/

# commit + push
cd /home/uco/DeviceSpecsViewer
git add index.html style.css script.js locales
git commit -m "Update site content"
git push origin main
```

### Safe publishing rules

- Never copy any of these into the public repo:
  - `.env`, `.claude/`, `logs/`, `compose.yaml`, `docs/`, `scripts/`, `tools/`
- Only the static site artifacts should be present in the public repo

## Architecture

- `index.html`: semantic layout + data field hooks
- `style.css`: layout, typography, states, and tooltip styling
- `script.js`: i18n, data collection, rendering, tooltips, and export
- `locales/*.json`: all localizable UI strings

### Extension points

The HTML has placeholders for:
- Canonical link
- Open Graph / Twitter cards
- JSON-LD structured data
- Analytics/tracking scripts
- Ad slot initialization

## Internationalization

- Supported languages: English, Japanese, Simplified Chinese, Spanish, Hindi
- Auto-detects from `navigator.language` / `navigator.languages`
- Manual override via language selector
- Add a new language by creating `locales/<lang>.json` and adding it to the selector

## Data accuracy & limitations

### Exact
- Online status (`navigator.onLine`)
- Timezone
- Screen resolution
- Viewport size
- Device pixel ratio
- Capability checks (WebGL, WebRTC, WebAssembly, etc.)

### Estimated / bucketed
- Device memory (`navigator.deviceMemory`)
- Network downlink / RTT
- Storage usage/quota (`navigator.storage.estimate`)

### Alternative / derived
- OS name/family (user agent parsing)
- Browser name/version (user agent parsing)
- GPU renderer/vendor (WebGL strings)
- Touch support (maxTouchPoints)

### Unavailable in standard browsers
- Exact CPU model
- Used/free RAM
- VRAM total/used/free

## Export format

JSON export includes:
- App name/version
- Timestamp
- Selected language + detected language list
- Displayed values
- Raw field data (value/raw/quality/notes/source)
- Capability flags

## Debugging

Enable debug mode with `?debug=1`:
- Debug panel appears in footer
- Copy/download log JSON
- `window.DSVDebug` exposes helpers

## Testing checklist

Manual (Chrome recommended):
- Desktop/tablet/mobile layout
- Progressive loading transitions
- Unavailable states
- Language switching
- Tooltips (hover/tap/close)
- JSON export and clipboard copy

Automated:
- `node scripts/check-locales.js`

## Maintenance guidance

- Keep UI text in `locales/` only
- Add new data collection in `script.js` and map to `data-field` keys
- Update tooltips for any new fields
- Keep public repo limited to static artifacts

## License

Add a license before public release.
