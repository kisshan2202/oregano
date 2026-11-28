# Oregano admin service

A small Cloud Run service that lets the website's admin mode save changes **without a GitHub token in the browser**.

- `POST /login` checks the admin password and returns a signed session (valid 8 hours).
- `POST /publish` validates the menu and photos, then makes **one commit** to the GitHub repo:
  updates `menu.json`, adds new photos to `images/items/` and deletes photos that are no longer used.
- The GitHub token and the admin password live only in **Secret Manager** and are never sent to the browser.
- The site itself stays on GitHub Pages; Pages redeploys about a minute after each commit.

## One-time setup

Run these in a terminal with the [gcloud CLI](https://cloud.google.com/sdk/docs/install), signed in to the right project
(`gcloud auth login`, `gcloud config set project YOUR_PROJECT_ID`). Billing must be enabled on the project.

1. Enable the services:

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com
```

2. Create a GitHub **fine-grained token** (GitHub > Settings > Developer settings > Personal access tokens > Fine-grained tokens):
   repository access **only `oregano`**, permission **Contents: Read and write**. Choose the longest expiry you are comfortable
   with and note the date; you will need to replace the secret before it expires.

3. Store the token and the admin password as secrets:

```bash
printf '%s' 'PASTE_GITHUB_TOKEN' | gcloud secrets create github-token --data-file=-
```

```bash
printf '%s' 'CHOOSE_A_STRONG_ADMIN_PASSWORD' | gcloud secrets create admin-password --data-file=-
```

4. Let Cloud Run read the secrets:

```bash
PROJECT_NUMBER=$(gcloud projects describe "$(gcloud config get-value project)" --format='value(projectNumber)')
for s in github-token admin-password; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role=roles/secretmanager.secretAccessor
done
```

5. Deploy from the repo root. `ALLOWED_ORIGINS` is the list of website addresses allowed to call the service
   (comma separated, no trailing slash, no path). Add your new domain here once you have it.

```bash
gcloud run deploy oregano-admin \
  --source ./admin-service \
  --region australia-southeast1 \
  --allow-unauthenticated \
  --max-instances 1 \
  --set-secrets GITHUB_TOKEN=github-token:latest,ADMIN_PASSWORD=admin-password:latest \
  --set-env-vars ALLOWED_ORIGINS=https://kisshan2202.github.io
```

   (`australia-southeast2` is Melbourne; `australia-southeast1` is Sydney.) The command prints a **Service URL**.

6. Put that URL in `config.js` at the repo root:

```js
window.OREGANO_API = 'https://oregano-admin-xxxxx-ts.a.run.app';
```

   Commit it (or ask Claude to). Admin mode is switched off while this is empty.

## Day-to-day

- Open the hidden admin page (your website address followed by `/oregano.html`), enter the admin password, edit, then **Publish**.
- Old photos are deleted automatically when you replace or remove them.

## Changing things later

- **New domain:** add it to `ALLOWED_ORIGINS` (keep the old one until the switch is done):

```bash
gcloud run services update oregano-admin --region australia-southeast1 \
  --update-env-vars '^@^ALLOWED_ORIGINS=https://kisshan2202.github.io,https://YOUR-NEW-DOMAIN'
```

- **New password or token:** add a new secret version, then redeploy so the service picks it up. Everyone is signed out.

```bash
printf '%s' 'NEW_VALUE' | gcloud secrets versions add admin-password --data-file=-
```

```bash
gcloud run services update oregano-admin --region australia-southeast1 --update-secrets ADMIN_PASSWORD=admin-password:latest
```

## Notes

- `--max-instances 1` keeps the "5 wrong passwords = 15 minute lockout" counter effective.
- Use a long, unique admin password. Anyone with it can edit the menu.
- If two people publish at once, the second gets "The menu changed elsewhere. Reload and try again."
- Local test: `GITHUB_TOKEN=... ADMIN_PASSWORD=... ALLOWED_ORIGINS=http://localhost:8000 node admin-service/server.js`
