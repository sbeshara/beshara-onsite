# Connecting QuickBooks Online

OnSite creates invoices in QuickBooks Online, has QuickBooks email them to the client, and reads back the payments you record in QuickBooks. To do that it needs its own "app" in Intuit's developer site. It's free and takes about 15 minutes. Do it once for the test copy (sandbox), then again for the real company (production).

## 1. Create the Intuit app

1. Go to [developer.intuit.com](https://developer.intuit.com) and sign in with the Intuit account that owns your QuickBooks company.
2. **Dashboard → Create an app → QuickBooks Online and Payments**. Name it `Beshara OnSite`.
3. Under scopes, pick **com.intuit.quickbooks.accounting**.
4. Open the app → **Keys & credentials**. There are two tabs: **Development** (sandbox) and **Production**.
   - Development works right away with a free sandbox company (test data).
   - Production asks a few questions about the app (your website, privacy policy and terms URLs). Use `https://besharabuilders.com` pages; they're only shown to you.
5. In the tab you're using, add this **Redirect URI** exactly:
   - Test copy: `https://<your-test-preview-address>/api/qbo/callback`
   - Real app: `https://onsite.besharabuilders.com/api/qbo/callback`
6. Copy the **Client ID** and **Client Secret**.

## 2. Payment updates (webhook)

1. In the app, open **Webhooks**.
2. Endpoint URL: the same address as above, but ending in `/api/qbo/webhook` (e.g. `https://onsite.besharabuilders.com/api/qbo/webhook`).
3. Tick **Payment** (Create, Update, Delete, Void). Save.
4. Copy the **Verifier Token**.

If the webhook isn't set up, payments still come in: the Invoicing page has a **Check payments now** button.

## 3. Add the settings in Vercel

Vercel → the project → **Settings → Environment Variables**:

| Name | Value |
|---|---|
| `QBO_CLIENT_ID` | Client ID from step 1 |
| `QBO_CLIENT_SECRET` | Client Secret from step 1 (keep it private) |
| `QBO_ENV` | `sandbox` for the test copy, `production` for the real app |
| `QBO_WEBHOOK_VERIFIER` | Verifier Token from step 2 |

Redeploy so they take effect.

## 4. Connect

In OnSite, as the Owner or an Admin: **Office → Invoicing → Connect QuickBooks Online**. Approve access, pick the company, and you're back in OnSite. The connection stays on (OnSite renews it automatically); if it's ever dropped, connect again.

## How invoicing works once connected

- On a job's **Invoicing** tab, mark a payment step **reached** when the work is done. It shows under **Ready to invoice**.
- **Create invoice** → check the amount, due date and email → **Send through QuickBooks**. OnSite finds or creates the customer in QuickBooks (matched by name), creates the invoice under a "Construction Services" item, and QuickBooks emails it, with the pay-online link if you use QuickBooks Payments.
- When a payment is recorded in QuickBooks (online payment, or your bookkeeper entering a check), OnSite shows it: paid date, amount and method, and the invoice turns **Paid** or **Partly paid**.
- To void or edit an invoice that's already in QuickBooks, do it in QuickBooks.
