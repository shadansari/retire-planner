# Hosting on Cloudflare Pages behind Cloudflare Access

Hosted mode: the site lives at `https://<project>.pages.dev`, only people you list can
open it (they sign in with an emailed code), and the plan loads automatically. No GitHub
token in anyone's browser: a small server function (`functions/api/plan.js`) reads
`plan.yaml` from the private repo with a token stored as a Cloudflare secret.

The GitHub Pages site keeps working as before (public demo + token form).

Dashboard labels move around; if a step's wording doesn't match, look for the nearest
equivalent. Order matters a little: until step 5 is done the function refuses to serve
anything (it fails closed), so there is no window where the plan is exposed.

## 1. Create the Pages project

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Authorize the Cloudflare GitHub app for **only** `retire-planner` (not `our-plan`; the
   function reads the plan with its own token).
3. Project name: `retire-planner` (the URL becomes `retire-planner.pages.dev`; if taken,
   pick another and use it below). Production branch: `main`.
4. Build settings: Framework preset **None**, build command **empty**, build output
   directory **`/`**. Save and deploy.
5. **Settings → Builds → Branch control**: set preview branches to **None**. We push to
   `main` only, and every preview URL would be another copy of the site to protect.

## 2. Turn on Cloudflare Access (Zero Trust)

1. Dashboard → **Zero Trust**. First time: choose a **team name** (this gives
   `<team>.cloudflareaccess.com`) and the **Free** plan (up to 50 users).
2. **Settings → Authentication**: **One-time PIN** is on by default (a code is emailed).
   Optionally add Google as a login method.

## 3. Protect the production URL

Per Cloudflare's documented route for `*.pages.dev`:

1. Pages project → **Settings → General → Enable access policy**. This creates an Access
   application for `*.retire-planner.pages.dev` (previews only).
2. Click **Manage** on it → edit the application → under **Public hostname**, clear the
   **Subdomain** field (remove the `*`) so it covers `retire-planner.pages.dev` itself.
3. **Policies**: one policy, action **Allow**, include **Emails**: your address and your
   wife's. Nothing else (no "Everyone", no email domains).
4. **Session duration**: e.g. **1 month**, so you rarely see the login.
5. Note the application's **Application Audience (AUD) tag** (on its overview/basic
   information page).

Check: open `https://retire-planner.pages.dev` in a private window. You should get the
Cloudflare login page, not the site.

## 4. Server-side GitHub token

Create a fine-grained token exactly as in [github-token.md](github-token.md) step 2, but
name it `cloudflare retire-planner (server)`. Only `our-plan`, **Contents: Read-only**.
Copy it straight into step 5; don't store it anywhere else. When it expires the page will
say "Server's GitHub access: GitHub rejected the token"; make a new one and replace the
secret.

## 5. Variables and secrets

Pages project → **Settings → Variables and Secrets** → **Production**:

| Name | Type | Value |
|---|---|---|
| `GITHUB_TOKEN` | **Secret** | the token from step 4 |
| `PLAN_OWNER` | Text | `shadansari` |
| `PLAN_REPO` | Text | `our-plan` |
| `PLAN_PATH` | Text | `plan.yaml` |
| `ACCESS_TEAM_DOMAIN` | Text | `<team>.cloudflareaccess.com` |
| `ACCESS_AUD` | Text | the AUD tag from step 3 (several may be comma-separated) |

Variables apply to new deployments: **Deployments → latest → Retry deployment** (or push).

## 6. Try it

Open `https://retire-planner.pages.dev`, sign in with the emailed code. The page should say
"Loaded: our plan from GitHub (signed in as you@…)". Messages you might see instead:

| Message | Meaning |
|---|---|
| *Server not configured: missing …* | A variable from step 5 is missing, or the deployment predates it (retry it). |
| *Not signed in through Cloudflare Access (wrong audience)* | `ACCESS_AUD` doesn't match the application's AUD tag. |
| *… (wrong issuer)* / *couldn't fetch Access certs* | `ACCESS_TEAM_DOMAIN` is wrong. |
| *Server's GitHub access: …* | Token problem: see the GitHub message that follows. |
| *Your sign-in has expired* | Reload the page and sign in again. |

## Afterwards

- Delete the browser token you made earlier (GitHub → Settings → Developer settings →
  Fine-grained tokens) if you no longer use the GitHub Pages form.
- To add or remove a person: edit the Access policy's email list. Nothing in the repo changes.
