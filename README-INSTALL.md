# Survey PDF Editor — Installation Guide

This guide covers deploying the Survey PDF Editor on a standard PHP/MySQL shared hosting
account (e.g. Plesk, cPanel, shared Linux hosting).

---

## Contents of this package

| Path | Description |
|---|---|
| `api/` | PHP backend endpoints |
| `app/` | Frontend JavaScript modules |
| `assets/` | CSS and image assets |
| `icons/` | PWA icon set |
| `install/` | Web-based installation wizard |
| `sql/database.sql` | Full database schema |
| `storage/` | Runtime file storage (writable) |
| `vendor/` | PHP dependencies (pre-bundled) |
| `index.html` | Application shell |
| `manifest.json` | PWA manifest |
| `service-worker.js` | Offline service worker |
| `VERSION.txt` | Package version |
| `README-INSTALL.md` | This file |

---

## Hosting requirements

| Requirement | Minimum |
|---|---|
| PHP | 7.4 or newer (8.x recommended) |
| MySQL / MariaDB | 5.7 / 10.3 or newer |
| PDO PHP extension | Required |
| PDO MySQL driver | Required |
| mbstring extension | Required |
| fileinfo extension | Required |
| json extension | Required |
| openssl extension | Required |
| GD or Imagick | Recommended (for PDF thumbnail generation) |
| `upload_max_filesize` | 8 MB minimum, 128 MB recommended |
| `post_max_size` | 8 MB minimum, 128 MB recommended |

> **Note:** The installer checks all requirements automatically and will flag any missing items.

---

## Step-by-step installation

### 1. Create an empty MySQL database

Log in to your hosting control panel (Plesk, cPanel, etc.) and:

1. Create a new MySQL database (e.g. `survey_db`)
2. Create a database user and assign a strong password
3. Grant the user **All Privileges** on the new database
4. Note down: hostname, database name, username, password

In Plesk: **Databases → Add Database**
In cPanel: **MySQL Databases Wizard**

The hostname is usually `localhost`.

---

### 2. Upload files to your web root

Using FTP (e.g. FileZilla) or the hosting file manager:

1. Connect to your hosting account
2. Navigate to your web root directory (e.g. `httpdocs`, `public_html`, or `www`)
3. Upload **all contents** of this package into the web root

> Upload the _contents_ of the `release/` folder, not the folder itself.
> After uploading, your web root should contain `api/`, `app/`, `index.html`, etc.

---

### 3. Set directory permissions

The following directories must be writable by the web server:

| Directory | Required permission |
|---|---|
| `storage/` | Writable (e.g. 755 or 775) |
| `storage/plans/` | Writable |
| `storage/photos/` | Writable |
| `storage/files/` | Writable |
| `storage/exports/` | Writable |
| `storage/tmp/` | Writable |
| `storage/trash/` | Writable |
| `api/` | Writable (so the installer can write `config.php`) |

In most shared hosting environments these are writable by default for your own files.
If not, set them to `755` or `775` via FTP or the hosting file manager.

---

### 4. Run the web installer

In your browser, visit:

```
https://yoursite.com/install/
```

The installer will walk you through four steps:

**Step 1 — Requirements**
The installer checks your server environment. All required items must show as **OK** before
you can continue. Optional items (GD, Imagick) may show as warnings — these are not blockers.

**Step 2 — Database & Settings**
Enter your database details:

| Field | Value |
|---|---|
| Database Host | Usually `localhost` |
| Port | Usually `3306` |
| Database Name | The database you created in step 1 |
| Database Username | The user you created in step 1 |
| Database Password | Your database user's password |
| Base URL | The full URL of your site (e.g. `https://yoursite.com`) |
| Actor Name | Optional name used in audit log entries |
| Max Upload (MB) | Maximum file size for uploads |

Use **Test DB Connection** to verify credentials before running the install.

**Step 3 — Install**
The installer will:
- Import the database schema from `sql/database.sql`
- Write `api/config.php` with your settings
- Create any missing storage subdirectories
- Write `install/install.lock` to lock the installer

**Step 4 — Complete**
You will see a confirmation of what was done and a link to open the application.

---

### 5. Verify the installation

- Click **Open Application** on the success screen
- The application should load and display the main interface
- Try creating a test project to verify database connectivity

---

## After installation

### Secure the installer

Once installed, the installer is automatically locked via `install/install.lock`.
Visiting `/install/` will show a "Already Installed" message.

For additional security you can:
- Delete the `install/` directory entirely (recommended for production)
- Restrict access to `install/` in your hosting control panel

### Generated config file

Your settings are stored in `api/config.php`. This file is created by the installer
and is not included in the package. To update settings (e.g. change max upload size),
edit this file directly.

---

## What folders must be writable

The application stores uploaded files, plans, photos, and exports in the `storage/`
directory. All subdirectories must be writable by the PHP process:

```
storage/
├── plans/      ← uploaded plan PDFs
├── photos/     ← issue photos and thumbnails
├── files/      ← generic attached files
├── exports/    ← generated export PDFs
├── tmp/        ← temporary processing files
└── trash/      ← soft-deleted items
```

---

## Troubleshooting

**"DB config missing" error after visiting the app**
The installer did not complete successfully or `api/config.php` was not written.
Re-run the installer, or copy `api/config.sample.php` to `api/config.php` and fill in your values manually.

**"Database connection failed" in the installer**
- Double-check hostname, database name, username, and password
- Ensure the database user has been granted privileges on the database
- On some hosts the hostname is an IP address — check your hosting panel

**Blank page or 500 error**
- Check PHP error logs in your hosting panel
- Ensure `api/config.php` exists and is valid PHP
- Check that `storage/` and subdirectories are writable

**Uploads fail or images don't appear**
- Check `storage/` directory permissions (must be writable)
- Check `upload_max_filesize` and `post_max_size` in PHP settings
- Some hosts require these to be set in a `.user.ini` or `.htaccess` file

**Service worker / PWA not working**
- The app must be served over HTTPS for the service worker to activate
- Clear browser cache and reload

**Re-running the installer**
To reset and reinstall:
1. Delete `install/install.lock` via FTP or file manager
2. Delete `api/config.php`
3. Optionally drop and recreate your database
4. Visit `/install/` again

---

## How to find the generated config file

After installation, your configuration is stored at:

```
api/config.php
```

This file is not included in the release package (it is machine-specific).
It is created by the installer and contains your database credentials and app settings.

---

## Support

For issues with the application, refer to the project documentation or contact your developer.
