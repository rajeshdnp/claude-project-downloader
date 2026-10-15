# Claude Project Downloader

A small Chrome extension that downloads your [claude.ai](https://claude.ai) **projects** as a ZIP file: the project
instructions, the text knowledge you added, and the **original** files you uploaded (PDFs, images, CSVs, ...).

- Runs entirely in your browser, using the claude.ai session you are already signed in with.
- No server, no account, no analytics, no dependencies, no build step. About 400 lines of plain JavaScript.
- Talks only to `claude.ai`. Nothing is sent anywhere else.

> Unofficial. Not affiliated with or endorsed by Anthropic. It uses claude.ai's internal web API, which is undocumented and
> may change without notice. Use it only on your own account and data.

## Install (about 30 seconds)

1. Download this repository (green **Code** button, then **Download ZIP**) and unzip it, or `git clone` it.
2. In Chrome open `chrome://extensions`.
3. Switch on **Developer mode** (top right).
4. Click **Load unpacked** and select the **folder** that contains `manifest.json`
   (the dialog only selects folders, files such as the ZIP are greyed out).
5. Optional: click the puzzle-piece icon and pin **Claude Project Downloader**.

You must be signed in to claude.ai in the same Chrome profile.

## How to use

1. Open claude.ai in any tab (or directly a project page) and click the extension's icon.
2. If you belong to more than one organization, pick it in the dropdown. Personal accounts have one.
3. Tick the projects you want. **All** and **None** are shortcuts. If you opened a `claude.ai/project/...` page, that project is pre-ticked.
4. Click **Download ZIP**. Large projects take a while; the status line shows the file being fetched.
5. The browser saves `claude-projects-YYYY-MM-DD.zip` (or `<ProjectName>-YYYY-MM-DD.zip` for a single project).
6. When it finishes the popup lists, per project, how many text docs and files were saved and whether anything failed.

### What is in the ZIP
```
<Project name>/
  instructions.md      the project's custom instructions, if any
  description.txt      the project description, if any
  knowledge/*.txt      text knowledge added to the project (pasted or extracted text)
  files/*              uploaded files, original bytes (PDF, PNG, CSV, ...)
  _failed.txt          only present if something could not be fetched or is not the original
```
- Two projects with the same name become `Name` and `Name (2)`.
- Every file's size is compared with the size claude.ai reports. A mismatch is listed in `_failed.txt`, never hidden.
- If claude.ai no longer keeps the original of an image, only a downscaled preview exists; it is saved as
  `name (preview only).png` and listed in `_failed.txt`.

## Troubleshooting

| You see | Cause and fix |
| --- | --- |
| "Not logged in to claude.ai in this Chrome profile" | Sign in to claude.ai in this profile, then reopen the popup. |
| "No project access in this organization" | That organization does not expose projects (HTTP 403). Pick another one in the dropdown. |
| Some files listed in `_failed.txt` | Read the reason on each line. "File content not available" means claude.ai itself no longer holds that file. |
| Nothing happens / popup closes | Keep the popup open until the ZIP is saved; Chrome closes it when you click elsewhere. Re-run with fewer projects. |
| Browser runs out of memory | The ZIP is built in memory. Download a few projects at a time. |
| It stopped working after a claude.ai update | The internal API changed. See "How it works" and adjust `core.js`; issues and pull requests are welcome. |

## Privacy and permissions

- `host_permissions: https://claude.ai/*`: needed to call claude.ai's API with your existing session.
- `activeTab`: only to see whether the current tab is a project page so it can be pre-selected.
- No other permissions, no background script, no content script, no remote code, no tracking.
- The ZIP contains your private documents. Store it accordingly.

## How it works

The popup (`popup.js`) calls these endpoints with `fetch(..., {credentials: "include"})` (see `core.js`):

| Need | Endpoint |
| --- | --- |
| organizations | `GET /api/organizations` |
| projects | `GET /api/organizations/{org}/projects?limit=200` |
| instructions, description | `GET /api/organizations/{org}/projects/{project}` (`prompt_template`, `description`) |
| text knowledge | `GET .../projects/{project}/docs` (`file_name`, `content`) |
| uploaded files | `GET .../projects/{project}/files` |
| original bytes of a file | `GET .../projects/{project}/files/{id}/raw` returns JSON with `content_base64` |
| fallback | `document_asset.url` / `preview_asset.url` from the file list (preview images are downscaled) |

`core.js` also contains a tiny store-only ZIP writer (CRC32), so there is nothing to install.

Lessons learned while building it:
- `preview_asset` looks like the file but is a ~10x smaller JPEG for images. `/raw` is the only source of originals,
  so it is tried first and the size is always checked.
- CSV and sandbox ("blob") uploads have no asset at all; `/raw` is the only way.
- Knowledge docs from `/docs` are extracted text even when called `.docx` or `.pdf`; they are saved with a `.txt` suffix so Word and
  other tools do not choke on them.

## Develop and test

No build step: edit the files, then press the reload icon on the extension's card in `chrome://extensions`.

```
node test/zip.test.mjs      # checks the ZIP writer and unique folder names with `unzip -t`
```

For an end-to-end check, export a small project and compare the file counts and sizes with the project page.

## Layout
```
manifest.json    Manifest V3
popup.html       the popup
popup.js         UI: list projects, pick, download
core.js          API calls, ZIP writer, per-project export
test/            ZIP writer test
```

## License
MIT, see [LICENSE](LICENSE).
