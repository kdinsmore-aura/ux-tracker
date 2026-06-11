# Deploying the `ux-tracker-ingest` Edge Function

The Edge Function routes all participant and recorder database operations through a server-side service-role key so that the Supabase anon key never needs to appear in prototype page HTML.

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) installed (`npm install -g supabase`)
- Your Supabase project already created and the schema applied (`supabase/schema.sql`)

## Steps

1. **Log in to the Supabase CLI**

   ```bash
   supabase login
   ```

2. **Link your project**

   Replace `{your-project-ref}` with the subdomain from your Supabase URL
   (e.g. if your URL is `https://xyzabc.supabase.co`, the ref is `xyzabc`).

   ```bash
   supabase link --project-ref {your-project-ref}
   ```

3. **Set the service role key as a secret**

   Find the service role key in the Supabase dashboard under
   **Project Settings → API → service_role key**.
   **Never commit this key to git.**

   ```bash
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
   ```

   > `SUPABASE_URL` is injected automatically by the Supabase runtime — you do
   > not need to set it manually.

4. **Deploy the function**

   ```bash
   supabase functions deploy ux-tracker-ingest
   ```

5. **Note the function URL**

   ```
   https://{your-project-ref}.supabase.co/functions/v1/ux-tracker-ingest
   ```

   Use this URL as `data-ingest-url` in your prototype pages and in the Setup
   Tool's Step 5 snippet.

## Re-deploying after changes

```bash
supabase functions deploy ux-tracker-ingest
```

## Local development / testing

```bash
supabase start                  # start local Supabase stack
supabase functions serve        # serve all functions locally
```

The local function URL will be `http://localhost:54321/functions/v1/ux-tracker-ingest`.
