# Survey PDF Editor

A mobile-first construction plan survey tool for viewing PDF plans, placing issues (pins), uploading photos, and generating reports.

## Quick start (end user)

- Open the app in your browser. The left sidebar contains the **Plans** panel where you can upload a PDF plan or open an existing one.
- To upload a plan, use the **PDF** file input and optionally add a name and revision. After upload the plan will appear in the list.
- Click **Open** on a plan to view it.
- To remove a plan, click **Delete** in the Plans list or use the **Delete Plan** button while viewing a plan. This will **move** the plan file, photos, and generated exports to `storage/trash/<timestamp>` (soft-delete). Issues and DB rows are removed; files are retained in the `storage/trash` folder as a safety measure. Use the **Trash** button in the Plans panel to view recent deletes. From there you can **Restore** (moves files back and attempts to recreate DB rows) or **Delete permanently** to remove the trash folder. Action requires confirmation and cannot be undone from the UI.

## Viewer basics

- Use the Viewer controls to navigate pages, zoom in/out or fit to width.
- Toggle **Add Issue** mode to place new issue pins. Long-press (1s) on the plan area to drop a pin and fill the issue details in the modal.
- Saved issues get a numeric ID shown in the pin head. Click a pin to open the issue modal, add notes, and upload photos.
- Photos are attached to issues and appear as thumbnails in the Issues list.
- Use **View Issues** in the viewer to open a list of issues for the current plan and jump to issue pages.
- Export a PDF report of issues using the **Generate PDF Report** button in the Issues modal.

## Offline / PWA

- The app is installable as a Progressive Web App (PWA). The manifest includes a maskable icon (`/icons/icon-512-maskable.png`) for best results when installing on mobile/home screens.

## Troubleshooting

- If the plans list is empty, check your network or API (`/api/list_plans.php`).
- If the viewer fails to load, try refreshing or clearing the service worker and cache.

For developers: see the `app/` directory for client code and `api/` for server endpoints (PHP). Pull requests welcome.

Tools
- A new **Tools** section is available from the Plans panel. The first tool is the **Crop PDF Tool** (`/tools/crop.html`) — it lets you select a plan or upload a PDF, draw a crop rectangle on a page, preview it, and export the cropped area as a new PDF.
  - **DPI settings**: choose a target DPI (e.g. 150, 300, 600, 1200) for raster exports. The tool will render the page at the selected DPI and crop to the selection — higher DPI means sharper output but larger file sizes and more memory usage.
  - **Vector crop (server)**: create a true, vector (non-raster) cropped PDF using the server-side FPDI-based crop endpoint. This preserves vector text and produces smaller, exact crops.

DWG support
- The Tools section also includes a **DWG Viewer & Converter** (`/tools/dwg.html`) that can upload DWG/DXF and convert them to PDF/SVG/DXF when server utilities are available.
- Conversion requires system utilities on the server (recommended): `dwg2pdf`, `dwg2svg`, `dwg2dxf`, `pdf2svg`, `convert` (ImageMagick). These are system binaries and cannot be installed via Composer; instead install via your OS package manager.
- For Debian/Ubuntu, a helper script is provided at `tools/install_dwg_tools.sh` which attempts to install `libredwg-tools` and `imagemagick` (run with `sudo`).
- If you cannot install system packages or want an isolated runtime, you may configure a Docker image with conversion utilities and set `dwg_converter.docker_image` in `api/config.php`. (This is optional — you indicated you prefer not to use Docker.)


