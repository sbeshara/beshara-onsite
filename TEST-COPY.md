# The OnSite test copy

A separate copy of OnSite for trying the new office tools (estimates, plans & takeoff, e-sign, invoicing) with real data, without touching the live app or its database. About 20 minutes, once.

It's the `office-foundation` branch, deployed by Vercel as a **preview**, connected to its own **test Supabase project**.

> The one rule: the preview must never use the live Supabase keys. Step 3 makes sure of that.

## 1. Create the test database (Supabase)

1. In [supabase.com](https://supabase.com) click **New project**. Name it `beshara-onsite-test`, region **East US**, and save the database password.
2. Open **SQL Editor → New query**. Paste the whole `onsite-test-database.sql` file (all of OnSite's database setup in one script) and click **Run**. It finishes with "Success" or a small table showing a number; either means it worked.
3. **New query** again: paste `supabase/test-copy/permissions-fix.sql` and **Run**. New Supabase projects no longer give the app access to tables by default (the live project, made earlier, does); this gives the standard access and then puts back every limit OnSite applies, so the test copy behaves exactly like live. Without it, signing in bounces straight back to the sign-in page.
4. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up".
5. **Project Settings → API Keys**: keep this page open for step 3 (Project URL, anon/publishable key, service_role/secret key).

## 2. Find the preview address (Vercel)

Vercel already builds a preview of every pushed branch.

1. Vercel → the `beshara-onsite` project → **Deployments**. Find the newest one for branch **office-foundation**.
2. Open it and copy its **branch address**. It looks like `https://beshara-onsite-git-office-foundation-<team>.vercel.app`. That address stays the same as the branch updates.

## 3. Point the preview at the test database

Vercel → project → **Settings → Environment Variables**.

Add these for **Preview** only, and under "Select a Custom Preview Branch" choose `office-foundation`. Variables set for one branch win over the general ones, so the live keys (which may also be ticked for Preview) never reach the test copy. Don't edit the live keys themselves; they're saved as Secrets and can't be safely re-saved.

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | the **test** project's URL, ending in `.supabase.co` (no `/rest/v1/` on the end) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the **test** project's anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | the **test** project's service_role/secret key |
| `NEXT_PUBLIC_SITE_URL` | the preview address from step 2 |
| `RESEND_API_KEY` | `off` (so the test copy never emails anyone) |

The JobTread key already applies to previews; the import only reads from JobTread.

Changes take effect on the next build of the branch. A new push to `office-foundation` always works; a Redeploy may not move the branch address.

## 4. Finish Supabase's settings

1. **Authentication → URL Configuration**: Site URL = the preview address; Redirect URLs: add `<preview address>/**`.
2. **SQL Editor**: run this, with your preview address:
   ```sql
   update public.app_settings set value = 'https://<preview address>' where key = 'site_url';
   ```

## 5. Sign in

The test project can't send OnSite's invite emails (new Supabase projects lock email templates until you connect an email service), so create accounts with a password directly:

1. **Authentication → Users → Add user → Create new user**: your email, a password, and **Auto Confirm User** ticked. The first account becomes the **Owner**.
2. Sign in to the test copy at `<preview address>/login`.
3. For teammates or a test client, create their accounts the same way, then set roles in **Team & Access** and add them to jobs.

## 6. Bring in your JobTread data

**Office → JobTread Import**: check the catalog, customers and jobs counts, and the duplicate invoice-job pairings, then **Import from JobTread**. Nothing in JobTread changes.

## 7. Things to try

- **Estimates:** open a lead → Estimates → New estimate → pick a budget template → fill quantities.
- **Plans:** on the project's Plans & Takeoff tab, upload a real plan PDF, set the scale, measure, mark up, export.
- **Takeoff link:** back in the estimate, link line items to takeoffs with the 📐 button.
- **E-sign:** Send for signature → sign in as your test client (Proposals tab) → see the signature land in the office.
- **QuickBooks:** connect a QuickBooks sandbox company (see SETUP-QUICKBOOKS.md, with `QBO_ENV=sandbox`), mark a step reached, send an invoice, record a payment in the sandbox, and watch it show as paid.
- **Roles:** view as a PM: Plans and Scope tabs, no dollar amounts anywhere.
