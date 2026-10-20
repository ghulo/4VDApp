# 4VD for Windows

A Windows app that opens the live dashboard (4vd.app) in its own window.
Dashboard changes reach it the moment they are deployed; only changes to this
folder need a new app version.

- Download on any PC: https://4vd.app/download
- Try it locally: `npm install`, then `npm start`. To try dashboard changes before they
  are deployed, run `npm run dev` in `admin/` and start with `DASHBOARD_URL=http://localhost:5173/`.

## Releasing a new version

Installed copies check GitHub Releases on start and update themselves.

1. Raise `version` in `package.json` (for example 0.1.0 → 0.2.0).
2. `npm run dist`
3. `gh release create v<version> dist/4VD-Setup.exe dist/4VD-Setup.exe.blockmap dist/latest.yml --title "4VD for Windows <version>"`

The app isn't code-signed, so Windows shows "Windows protected your PC" the
first time: click **More info**, then **Run anyway**.
