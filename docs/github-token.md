# Setting up: private plan repo + read-only token

The page is public. Your plan is not: it lives in a **private** GitHub repository, and
the page reads it with a **fine-grained personal access token** that can only *read*
that *one* repository.

## 1. Create the private data repository (once)

1. On github.com, click **+** → **New repository**.
2. Name it something like `our-plan`. Choose **Private**. Create it.
3. Click **Add file** → **Create new file**, name it `plan.yaml`.
4. Paste in the contents of the [example plan](../examples/example.yaml) and replace the
   made-up numbers with yours (see [editing-plan.md](editing-plan.md)).
5. Click **Commit changes**.

Never put `plan.yaml` in the public `retire-planner` repository.

## 2. Create a read-only token (each person who views the plan)

1. github.com → your profile picture → **Settings** → **Developer settings** →
   **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. **Token name**: `retirement planner (read plan)`.
3. **Expiration**: pick something you'll remember to renew (e.g. 1 year).
4. **Resource owner**: the account that owns `our-plan`.
5. **Repository access**: **Only select repositories** → choose `our-plan`.
   Do this *before* adding permissions: repository permissions only appear once a
   repository is selected.
6. **Permissions**: click **+ Add permissions**, type `Contents` in the filter box, and
   select it. Then set **Contents** to **Read-only** (it may default to Read and write).
   The long list also offers things like repository creation, license policy, and
   security advisories: add none of them. GitHub adds *Metadata: Read-only*
   automatically. The finished token has exactly two: **Contents: Read-only** and
   **Metadata: Read-only**. If `Contents` doesn't show up, check that **Resource owner**
   is the account that owns `our-plan`.
7. **Generate token** and copy it. It starts with `github_pat_`. GitHub shows it only once,
   so save it straight into your password manager (see "Not retyping the token" below).

If your spouse also has a GitHub account, add them as a collaborator on `our-plan`
(Settings → Collaborators) and have them create their own token the same way.
If the repo belongs to an organization, an org owner may need to approve the token.

## 3. Load the plan

On the page, fill in **Owner** (the account name), **Repository** (`our-plan`), **File
path** (`plan.yaml`), paste the token, and click **Load plan**.

- Tick **Remember the token until this tab is closed** to skip re-pasting when you
  reload. It is kept in this tab's session storage and disappears when the tab closes.
- The token is sent only to `api.github.com`. It is never saved permanently, put in a
  link, or sent anywhere else. Owner/repo/path (not the token) are remembered in this
  browser for convenience.
- **Forget token** clears it immediately.

## Not retyping the token

The page never stores the token past the tab (by design), so each new tab asks for it.
Let a password manager fill it instead:

- The form is marked up as a sign-in: **Owner** is the username and **GitHub token** is
  the password. After a successful **Load plan**, your browser or password manager
  (1Password, Bitwarden, iCloud Keychain, Chrome/Firefox) should offer to save it for
  `shadansari.github.io`. If it doesn't, add an entry by hand: site
  `https://shadansari.github.io`, username = the owner, password = the token.
- Next time, autofill the token field and click **Load plan**.
- When the token expires, make a new one and update the saved entry.

Keep it in the password manager, not in a note or file: it reads your whole plan.

## If something goes wrong

| Message | What to do |
|---|---|
| *GitHub rejected the token* | It was mistyped, expired, or revoked. Make a new one. |
| *Not found* | Check owner / repository / path spelling, and that the token was given access to this repository (step 2.5). |
| *doesn't have permission* | The token needs **Contents: Read-only** on this repository. |

If a token is ever exposed, revoke it at **Settings → Developer settings → Fine-grained
tokens** and make a new one. A read-only token can't change or delete anything.
