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
6. **Permissions** → **Repository permissions** → **Contents**: **Read-only**.
   (GitHub adds *Metadata: Read-only* automatically. Nothing else.)
7. **Generate token** and copy it. It starts with `github_pat_`. GitHub shows it only once.

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

## If something goes wrong

| Message | What to do |
|---|---|
| *GitHub rejected the token* | It was mistyped, expired, or revoked. Make a new one. |
| *Not found* | Check owner / repository / path spelling, and that the token was given access to this repository (step 2.5). |
| *doesn't have permission* | The token needs **Contents: Read-only** on this repository. |

If a token is ever exposed, revoke it at **Settings → Developer settings → Fine-grained
tokens** and make a new one. A read-only token can't change or delete anything.
