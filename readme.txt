Oregano's Bakehouse & Cafe website https://kisshan2202.github.io/oregano/#bakery

Files
- index.html, styles.css, app.js : the site
- config.js                      : address of the admin service (see below)
- menu.json                      : all menu items, locations and opening hours
- images/                        : logo; item photos live in images/items/
- admin-service/                 : small Cloud Run service that saves admin changes to this repo

Editing the menu (admin mode)
1. Deploy the admin service once (steps in admin-service/README.md) and put its URL in config.js.
2. Open the site, click "Admin" in the footer (or add #admin to the URL) and enter the admin password.
3. Add / edit / delete items, photos, locations and hours. Changes are kept as a draft in your browser.
4. Click "Publish". The service commits the changes to GitHub and the site updates about a minute later.

No GitHub token is needed in the browser; the token and the password are kept in Google Secret Manager.
Anyone without the admin password can only view the menu.

Online ordering (cart + WhatsApp)
- Customers can add items to a cart and send the order to a store on WhatsApp.
- It is hidden by default. To preview it, add ?order=1 to the site address
  (for example https://kisshan2202.github.io/oregano/?order=1).
- To switch it on for everyone, set window.OREGANO_ORDERING = true in config.js.
- Each store's WhatsApp number is set in admin mode: Edit locations & hours.
