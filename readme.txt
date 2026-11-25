Oregano's Bakehouse & Cafe website

Files
- index.html, styles.css, app.js : the site
- menu.json                      : all menu items (name, price, description, image)
- images/                        : logo; item photos go in images/items/

Editing the menu (admin mode)
1. Create a GitHub fine-grained token: GitHub > Settings > Developer settings >
   Personal access tokens > Fine-grained tokens. Select only this repository and
   give it "Contents: Read and write".
2. Open the site, click "Admin" in the footer (or add #admin to the URL), enter the admin
   password, then paste the token the first time. The token is stored only in that browser;
   "Exit" locks admin mode again and the password is needed to re-enter.
3. Add / Edit / delete items. Changes are kept as a draft in your browser.
4. Click "Publish" to save to the site. It goes live about a minute later.

Anyone without the token can only view the menu.
