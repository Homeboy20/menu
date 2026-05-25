Security remediation steps — remove secrets from repo and rotate keys

1) Prevent future commits of `.env` (already present in .gitignore)
   - Ensure `.env` is listed in `.gitignore` at repo root.

2) Remove `.env` from current index (stop tracking) and commit

   ```bash
   git rm --cached .env
   git commit -m "Remove .env from repository"
   ```

3) Remove secrets from history (if `.env` was committed previously)

   Option A — Using git-filter-repo (recommended):

   ```bash
   pip install git-filter-repo
   git -c protocol.file.allow=always clone --no-hardlinks . ../repo-backup
   cd ../repo-backup
   git filter-repo --invert-paths --paths .env
   # review, then push back to origin or replace your repo
   ```

   Option B — Using BFG Repo-Cleaner:

   ```bash
   # download bfg jar (https://rtyley.github.io/bfg-repo-cleaner/)
   java -jar bfg.jar --delete-files .env
   git reflog expire --expire=now --all && git gc --prune=now --aggressive
   ```

   Note: rewriting history requires force-pushing and coordination with collaborators.

4) Rotate all secrets that may have been exposed (immediately):
   - `SESSION_SECRET`, `ADMIN_SECRET`, `PHONE_HASH_SECRET`, API keys (NextSMS), Firebase keys.
   - Revoke and re-issue any third-party credentials that were committed.

5) Use a secrets manager for production (recommended):
   - Azure Key Vault, AWS Secrets Manager, HashiCorp Vault, or environment variables injected by CI/CD.

6) Audit commits for other accidental secrets (quick scan):

   ```bash
   # simple grep for common keys
   git grep -n "SESSION_SECRET\|ADMIN_SECRET\|FIREBASE_PRIVATE_KEY\|NEXTSMS" || true
   ```

7) After cleanup, inform stakeholders and rotate credentials used in deployments/services.

If you want, I can:
- Create a branch and run the cleanup commands (requires your approval and will rewrite history).
- Generate new strong secrets and place them in a secure file locally for you to copy into `.env`.
