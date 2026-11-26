// URL of the deployed admin service (Cloud Run), without a trailing slash.
// Example: window.OREGANO_API = 'https://oregano-admin-abc123-ts.a.run.app';
// Leave empty until the service is deployed; admin mode is disabled while it is empty.
window.OREGANO_API = 'https://oregano-admin-ix4nbyrfvq-ts.a.run.app';

// Online ordering (cart + WhatsApp). false = hidden from customers; they can still be previewed by adding ?order=1 to the site address.
// Set to true when you are ready to take orders from everyone.
window.OREGANO_ORDERING = false;
