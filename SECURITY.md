# Security

These servers run locally and talk only to Share a Wish endpoints (`*.supabase.co/functions/v1/...`, `shareawish.shop`). Credentials are read from environment variables and never written to disk.

- Use a personal access token (`SHAREAWISH_TOKEN`) per machine or agent and revoke it in the Partner Portal when you no longer need it.
- Please report vulnerabilities to contact@share-a-wish.com. Do not open a public issue for security problems.
