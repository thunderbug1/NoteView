# Git Remote Sync — Setup Guide

This guide walks through configuring NoteView's git remote sync so your notes are continuously backed up to a remote git repository. **Strongly recommended on mobile** — even with app-private storage, off-device backup is the only thing that survives device loss, factory reset, or accidental uninstall.

Sync works identically in the browser PWA and in the Android app.

## Why set this up?

| Scenario | Without sync | With sync |
|---|---|---|
| App data wiped (browser PWA eviction) | Data lost | One tap to recover |
| Phone lost / stolen | Data lost | Pull from any device |
| Factory reset | Data lost | Sign in, pull, continue |
| Accidental uninstall | Data lost | Reinstall, pull, continue |
| Edit on two devices | Last writer wins, silently | Three-way merge UI prompts on conflict |

## How it works

NoteView uses [`isomorphic-git`](https://isomorphic-git.org/) to push commits to a remote git repository over HTTPS. Every save creates a commit locally; `SyncManager` pushes those commits in the background (interval + on idle). Pull happens on app start and after network reconnect.

- **HTTPS only** — browsers cannot do SSH
- **HTTP basic auth** with a Personal Access Token (PAT) — token stored in IndexedDB, never written to git
- **CORS proxy required for private repos** — browsers cannot call `github.com` directly due to CORS; a proxy is needed (preset provided)

## Recommended setup: GitHub private repo

### 1. Create a private repository on GitHub

- Visit https://github.com/new
- Repository name: e.g. `noteview-sync`
- Visibility: **Private**
- Do **not** initialize with README (NoteView will push first)
- Note the clone URL: `https://github.com/<your-user>/noteview-sync.git`

### 2. Generate a Personal Access Token

- Visit https://github.com/settings/tokens?type=beta (fine-grained PATs, recommended)
  - Token name: `noteview-sync`
  - Expiration: choose what you're comfortable with (1 year is reasonable)
  - Repository access: **Only select repositories** → pick `noteview-sync`
  - Permissions → Repository permissions → **Contents: Read and write**
  - Generate, copy the token (starts with `github_pat_…`)
- Or use a classic PAT: https://github.com/settings/tokens/new → scope `repo` (full repo access)

Treat the token like a password — anyone with it can read/write your repo. NoteView stores it locally in IndexedDB only; it is never sent to any server other than GitHub via the git smart-http protocol.

### 3. Configure NoteView

1. Open NoteView → Settings (gear icon) → **Sync Status** section
2. Tap **Configure Git Remote**
3. Fill in:
   - **Remote Name**: `origin` (default)
   - **Remote URL**: `https://github.com/<your-user>/noteview-sync.git`
   - **Branch**: `main` (default)
   - **Username**: your GitHub username
   - **Password / Token**: paste the PAT
   - **CORS Proxy**: pick `https://cors.isomorphic-git.org` (preset button) — required for private GitHub repos
4. Tap **Save & Connect**

If everything is correct, you'll see a toast saying the remote was added and an initial push succeeds within a few seconds. The sync status indicator in the toolbar should change from *idle/disconnected* to *synced*.

### 4. Verify

- Refresh the GitHub repo page — you should see your `.md` files
- Open the NoteView vault on another device, configure the same remote, and a pull should fetch all notes

## Alternative providers

### GitLab

- Same flow; create PAT at https://gitlab.com/-/user_settings/personal_access_tokens → scope `write_repository`
- CORS proxy required

### Self-hosted Gitea / Forgejo

- Works the same way; configure your server's HTTPS URL + PAT
- CORS proxy may not be required if your server sends permissive `Access-Control-Allow-Origin` headers — test it first
- Example self-hosted setup: `https://gitea.yourdomain.com/user/noteview.git`

### Cloudflare Workers CORS proxy

If you'd rather not depend on the public `cors.isomorphic-git.org` proxy (it's a shared free service), deploy your own:

```js
// Cloudflare Worker — single-file CORS proxy for git smart-http
export default {
  async fetch(req) {
    const url = new URL(req.url);
    const target = url.pathname.replace(/^\//, '') + url.search;
    const upstream = await fetch(target, {
      method: req.method,
      headers: req.headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': '*',
        'Access-Control-Allow-Headers': '*',
        'Content-Type': upstream.headers.get('Content-Type') || 'application/octet-stream'
      }
    });
  }
};
```

Deploy and use the worker URL as the CORS proxy in NoteView settings.

## Recovery flow

If your local vault data ever disappears (e.g. browser evicted your PWA storage, or you reinstall the Android app):

1. Open NoteView — it will show the "no vault" welcome screen
2. Create a new Browser Vault with the **same name** as the lost one
3. Settings → Sync → Configure Git Remote → enter the same credentials
4. SyncManager will detect remote content that's newer than local and prompt to pull, OR tap the sync indicator and choose **Force Pull**

Your notes come back. This works on any device that can install NoteView.

## Conflict handling

If you edit the same note on two devices before sync completes, `SyncManager` detects the non-fast-forward condition on push and performs a three-way merge:

- Files changed on only one side → auto-resolved
- Files changed on both sides → modal with side-by-side diff and accept/reject controls
- Always-on auto-resolve for whitespace-only differences

See `docs/git-integration.md` for the architectural details.

## Security notes

- The PAT is stored in IndexedDB under the `'remoteConfig'` key in the `'handles'` store, in plaintext. Anyone with physical access to your device and USB debugging could read it. Use a fine-grained PAT scoped to only the sync repo to limit blast radius.
- The CORS proxy sees your encrypted HTTPS traffic to GitHub but **does** see your PAT in the Authorization header. The public `cors.isomorphic-git.org` is run by the isomorphic-git project. If that bothers you, deploy your own proxy (above).
- Notes themselves are plain markdown. Don't put secrets in them — anyone with repo access can read. GitHub private repos are visible to collaborators and to anyone who obtains your PAT.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "401 Unauthorized" on push | Wrong username, wrong PAT, or PAT expired | Regenerate PAT, update Settings → Sync |
| "403 Forbidden" on push | PAT lacks `Contents: Write` scope | Edit PAT scopes on GitHub |
| Push hangs forever | CORS proxy down | Switch to the other preset, or deploy your own |
| "fetch failed" / network error | Offline or proxy misconfigured | Verify device network; check proxy URL |
| Two devices keep overwriting each other | Both have stale views of remote | Force Pull on one device, then push normally |
| Toolbar icon spinning indefinitely | Large repo, first push | Wait — first push can take minutes for large vaults |

The sync status indicator in the toolbar reflects current state. Tap it to see last-sync time and any errors. The Settings view → Sync Status section also exposes detailed state.
