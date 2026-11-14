# Deployment and GitHub

## Local
`python3 -m http.server 8000` in the repository root. Visit http://localhost:8000.

## Existing private repository
Keep repository **private**. Extract ZIP, then from the extracted directory:

```bash
git init
git branch -M main
git remote add origin https://github.com/higherfrequencies/higher-frequencies-intelligence.git
git fetch origin main
git pull origin main --allow-unrelated-histories --no-rebase
git add .
git commit -m "Add Intelligence Portal v0.1"
git push -u origin main
```

If README conflicts occur during the pull, resolve and commit before pushing. Alternatively use GitHub's Add file > Upload files in the existing private repository and commit to `main`. Do not upload backups, secrets or personal customer information.

Static hosting can run the UI but **cannot** securely connect to third-party APIs without a backend. Never make the repository public to bypass access issues.
