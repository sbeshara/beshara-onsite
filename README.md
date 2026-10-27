# Beshara OnSite

The client portal for Beshara Builders: project communication, the documents we share, and live project progress, shared between the Beshara team and our clients.

## What it does

- **Every project starts with four chats:** Weekly Updates, Selections & Finishes, Schedule & Inspections, and Internal Only. Anyone on the project can add more chats, and those are always visible to the client. Internal Only is the project's one team-only chat.
- **Files:** drawings, submittals, permits, photos and contracts, each marked "Client + team" or "Team only". Anything attached in Internal Only is automatically team only.
- **Project phase:** Preconstruction → Permits → Construction → Punch list → Closeout. The team updates it, and the client sees it on their home screen.
- **Roles:**

  | Role | Sees | Can manage projects and people |
  |---|---|---|
  | Owner | Every project | Yes, and can add Admins and change roles |
  | Admin | Every project | Yes |
  | Construction Management | Only the jobs they're assigned to | No |
  | Client | Only their own project, never Internal Only or team-only files | No |

  These rules are enforced in the database itself (row-level security), not just hidden in the screens.
- **Logins:** people are invited by email. The invite link opens a page where they set a password, and their email address is their username. They can also sign in with an emailed link, and reset a forgotten password.

## How it's built

- [Next.js](https://nextjs.org) web app, hosted on [Vercel](https://vercel.com).
- [Supabase](https://supabase.com) for logins, the database, file storage and live chat updates.
- `supabase/migrations/` holds the database tables and access rules.
- `supabase/templates/` holds the branded invite, sign-in link and password reset emails.

## Setting it up (one time)

### 1. Supabase

1. Create a free account at [supabase.com](https://supabase.com) and click **New project**. Name it `beshara-onsite`, pick the **East US** region, and save the database password somewhere safe.
2. Open **SQL Editor**, click **New query**, paste the whole contents of `supabase/migrations/20261026000000_init.sql`, and click **Run**.
3. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up". Only invited people can get in.
4. **Authentication → URL Configuration**:
   - Site URL: `https://onsite.besharabuilders.com`
   - Redirect URLs: add `https://onsite.besharabuilders.com/**` and your Vercel address, for example `https://beshara-onsite.vercel.app/**`.
5. **Authentication → Emails → Templates**: for **Invite user**, **Magic link** and **Reset password**, paste the matching file from `supabase/templates/` (`invite.html`, `magic_link.html`, `recovery.html`) and use these subjects:
   - Invite user: `Your Beshara OnSite invite`
   - Magic link: `Your Beshara OnSite sign-in link`
   - Reset password: `Choose a new Beshara OnSite password`
6. **Authentication → Emails → SMTP Settings**: Supabase's built-in email only sends a few emails per hour, so connect a real email service before inviting clients. [Resend](https://resend.com) works well and is free for small volumes. Use `onsite@besharabuilders.com` as the sender.
7. **Project Settings → API Keys**: you'll need the **Project URL**, the **anon / publishable** key and the **service_role / secret** key in the next step.

### 2. Vercel

1. Sign in at [vercel.com](https://vercel.com) with GitHub and click **Add New → Project**. Import `sbeshara/beshara-onsite`.
2. Under **Environment Variables**, add the four values from `.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`: the Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the anon / publishable key
   - `SUPABASE_SERVICE_ROLE_KEY`: the service_role / secret key (never share this one)
   - `NEXT_PUBLIC_SITE_URL`: `https://onsite.besharabuilders.com`
3. Click **Deploy**.

### 3. Your web address

1. In Vercel, open the project → **Settings → Domains** and add `onsite.besharabuilders.com`. Vercel shows a **CNAME** record to add.
2. In Wix, go to **Domains → besharabuilders.com → Manage DNS Records**, and add that CNAME record (host `onsite`, value from Vercel).
3. It usually starts working within an hour.

### 4. Your owner account

The first account created becomes the **Owner**. In Supabase, go to **Authentication → Users → Add user → Send invitation** and enter your own email. Open the invite, set your password, and you're in. From there, use **Team** to invite your Admin and Construction Management, and **+ New project** to add jobs and invite clients.

### 5. Notifications

1. In Supabase **SQL Editor**, run `supabase/migrations/20261027000000_notifications.sql` the same way as the first file.
2. In Resend, create an API key with **Sending access** for besharabuilders.com.
3. In Vercel → **Settings → Environment Variables**, add `RESEND_API_KEY` with that key, then redeploy.

Phone and computer notifications need no keys; the app creates its own the first time someone turns them on. Each person turns them on per device in **Your account**. On iPhone and iPad, OnSite must be added to the home screen first (Safari → Share → Add to Home Screen).

Emails are a digest: every 5 minutes, anyone with messages they haven't read for at least 5 minutes gets one email listing them.

## Working on the code

```bash
npm install
cp .env.example .env.local   # fill in the values
npm run dev                  # http://localhost:3000
```

To run everything locally, including the database and a test inbox, install Docker and run `npx supabase start`. Invite emails show up at http://127.0.0.1:54324.
