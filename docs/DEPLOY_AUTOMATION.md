# Automatic Deployment (GitHub Actions → Plesk via SSH) 🔧

This repo includes a GitHub Actions workflow that deploys `main` to your Plesk-hosted site via SSH when a push happens to `main` (or when manually invoked).

## What the workflow does ✅
- Checks out the repo
- Optionally lints `api/export_report.php`
- Connects to your server via SSH using a private key stored in GitHub Secrets
- `git reset --hard origin/main` in the configured `REMOTE_PATH` on the server
- Runs `composer install --no-dev` if composer is available
- Runs a simple `php -l api/export_report.php` check on the server
- Runs the local smoke test `node tools/run_smoke_http.js` to validate the export endpoint returns valid JSON

## Required GitHub repository secrets ⚠️
Add these in Settings → Secrets → Actions:
- `SSH_PRIVATE_KEY` — private key for the deploy user (no passphrase is simplest; passphrase works with additional steps)
- `SSH_HOST` — server host (e.g. `survey.defecttracker.uk`)
- `SSH_USER` — user to SSH in as (must have access to the site directory and ability to run `git`)
- `REMOTE_PATH` — full path to site root on the server (e.g. `/var/www/vhosts/hosting215226.ae97b.netcup.net/survey.defecttracker.uk/httpdocs`)
- `SSH_PORT` — *optional*, port number (default: 22)

## Server setup steps 🔐
1. Add the public key from `SSH_PRIVATE_KEY` to `/home/<user>/.ssh/authorized_keys` on the server for the deploy user.
2. Ensure the deploy user can run `git pull` and has read/write access to the web root and `storage/` directories.
3. (Optional) Install `composer` on the server if you want automatic `composer install` during deploy.

## Safety notes & recommendations 💡
- Test the workflow first on a staging server before enabling on production.
- Consider restricting deployments to protected branches and using branch protection rules on `main`.
- If your Plesk setup uses a different deployment model (Plesk Git extension or webhooks), this workflow can be adapted to call the Plesk API instead.

---
If you want, I can add a small script on the server to gracefully restart services or run additional checks after a deploy. Tell me how you'd like to secure the private key and whether you want me to add optional post-deploy steps (e.g., cache clear, permissions fix).
