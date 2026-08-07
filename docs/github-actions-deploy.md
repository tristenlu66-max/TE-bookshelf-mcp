# GitHub Actions deployment

Every push to `main` deploys this repository to `/srv/te/bookshelf-mcp` on the
VPS. The workflow preserves the VPS `.env` file and never sends it to GitHub.

## One-time VPS setup

As an administrator on the VPS, use `visudo -f /etc/sudoers.d/bookshelf-mcp-deploy`
to add exactly:

```sudoers
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart bookshelf-mcp
```

Confirm the restriction works:

```sh
sudo -n /usr/bin/systemctl restart bookshelf-mcp
```

## GitHub configuration

Repository Actions variables:

| Name | Value |
| --- | --- |
| `DEPLOY_HOST` | `23.169.168.192` |
| `DEPLOY_PORT` | `2222` |
| `DEPLOY_USER` | `deploy` |

Repository Actions secrets:

| Name | Value |
| --- | --- |
| `BOOKSHELF_DEPLOY_SSH_KEY` | Dedicated private deploy key |
| `BOOKSHELF_DEPLOY_KNOWN_HOSTS` | VPS `known_hosts` entry for port 2222 |
