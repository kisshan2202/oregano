# Deploy the whole site on Cloud Run (same way as Date-Guru)

One Cloud Run service serves the website **and** the admin API (`/api`). Cloud Build rebuilds and redeploys it
every time something is merged or published to `main`, using Google's buildpacks (no Dockerfile, no Firebase).

## One-time setup (in the Cloud console, like Date-Guru)

1. **Secrets** (skip if they already exist in this project): create `github-token` (fine-grained GitHub token for this repo,
   permission *Contents: Read and write*) and `admin-password` in Secret Manager. See `admin-service/README.md`, steps 2-4,
   including the step that lets Cloud Run read the secrets.
2. Open **Cloud Run → Create service → Continuously deploy from a repository → Set up with Cloud Build**.
3. Connect GitHub and pick the repo (for a **private** repo, give the Cloud Build GitHub app access to it), branch `^main$`.
4. **Build type:** *Go, Node.js, Python, Java, .NET Core, Ruby or PHP via Google Cloud's buildpacks*, source location `/`.
5. **Service name** `oregano`. **Region:** choose one close to your customers
   (`australia-southeast2` Melbourne or `australia-southeast1` Sydney; Date-Guru uses `us-central1`).
6. **Authentication:** Allow public access. **Autoscaling:** minimum 0, **maximum 1** (keeps the wrong-password lockout effective).
7. **Variables & secrets → Reference a secret**, exposed as environment variables:
   `GITHUB_TOKEN` = `github-token` (latest) and `ADMIN_PASSWORD` = `admin-password` (latest).
   Optional: `ALLOWED_ORIGINS` = `https://your-domain` (not needed for same-address use, but a good extra lock).
8. **Create.** The first build takes a few minutes and prints the service address.

## Day to day
- Admin changes: sign in on the site, edit, **Publish**. That makes a commit; Cloud Build redeploys; the site updates in a few minutes.
- Code changes: merge to `main`; same automatic deploy.

## Domain
- Cloud Run's built-in domain mapping is free but in preview and not in every region. Check your region first.
- Otherwise use a global load balancer in front of Cloud Run (works everywhere, fixed monthly charge) or Cloudflare's free plan for DNS/HTTPS.

## Moving over from GitHub Pages + the separate admin service
1. Deploy as above and test (admin edit, photo upload, test order with `?order=1`).
2. Point the domain at the new service.
3. Delete the old admin service and turn off GitHub Pages; then the repo can be made private:

```bash
gcloud run services delete oregano-admin --region australia-southeast1
```

## Notes
- Only the website files are served (`index.html`, `app.js`, `styles.css`, `config.js`, `menu.json`, `images/`). Everything else in the repo
  (server code, readme, `.git`) returns 404.
- Pages and scripts are never cached, so edits show immediately; photos are cached for a day.
- Local run: `GITHUB_TOKEN=... ADMIN_PASSWORD=... node server.js` then open http://localhost:8080
