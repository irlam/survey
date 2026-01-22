# Survey PDF Editor

A mobile-first construction plan survey tool for viewing PDF plans, placing issues (pins), uploading photos, and generating reports.

## Quick start (end user)

- Open the app in your browser. The left sidebar contains the **Plans** panel where you can upload a PDF plan or open an existing one.
- To upload a plan, use the **PDF** file input and optionally add a name and revision. After upload the plan will appear in the list.
- Click **Open** on a plan to view it.

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
