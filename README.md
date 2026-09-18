# Panel Log Pro — GitHub Ready Cloud/PWA Package

This folder is ready for a GitHub repository used as the website source.

## Website files to upload
- index.html
- panel-cloud.js
- supabase-config.js
- manifest.json
- sw.js
- icon.svg

## Supabase-only file
- supabase-schema.sql — run in Supabase SQL Editor; do not use it as a public website file.

## Configuration
Edit `supabase-config.js` and replace the two placeholders with the Project URL and browser-safe publishable/anon key from your Supabase project.

## Deployment order
1. Create the GitHub repository.
2. Upload the six website files.
3. Configure GitHub Pages from the repository (if using GitHub Pages for the frontend).
4. Before testing cloud login, run `supabase-schema.sql` in Supabase SQL Editor.
5. Enable Email/password authentication in Supabase.
6. Open the HTTPS GitHub Pages URL.
7. Create a test account.
8. Test Customer → Branch → Site.
9. Test save/reload and a second browser/device.

## Security
Never put a Supabase secret/service_role key in the repository or browser code.


## Configuration status
The Supabase Project URL and browser-safe publishable key supplied by the user are preconfigured in `supabase-config.js`.
