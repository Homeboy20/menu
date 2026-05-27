# RestOrder SaaS Security Checklist

This project follows OWASP Top 10 2021 guidance for development, review, deployment, and maintenance.

The app is an Express/vanilla HTML SaaS, not Next.js. Apply these rules to `server.js`, static HTML clients, APIs, database queries, uploads, payments, and deployment configuration.

## Mandatory Rules

### Authentication
- Use server-side sessions and HTTPOnly cookies for admin/customer auth.
- Cookies must be `HttpOnly`, `Secure` in production, and `SameSite=strict`.
- Do not store admin auth tokens in `localStorage`.
- Passwords must be hashed with bcrypt or argon2.
- Login endpoints must be rate limited and lock accounts after repeated failures.
- Sessions must expire and be revoked on logout/password reset.
- MFA is required for SaaS admin users before production hardening is considered complete.

### Authorization And Tenant Isolation
- Authenticate every protected API route.
- Authorize every action server-side.
- Verify customer/menu ownership before reading or writing tenant data.
- Enforce RBAC server-side for SaaS admin routes.
- Never rely on hidden buttons or client-side role checks for protection.
- Every tenant query must filter by the owning `customer_id` or equivalent tenant key unless the caller is a verified SaaS admin.

### API Security
- Validate all input before use.
- Prefer schema validation for new endpoints.
- Use parameterized SQL only.
- Restrict HTTP methods.
- Return generic production errors.
- Do not return stack traces, tokens, secrets, or raw internal details.

### Secrets
- Keep secrets server-side only.
- Do not commit `.env` or credentials.
- Do not log passwords, tokens, private keys, or payment secrets.
- Use separate secrets per environment and rotate them regularly.

### Input And Output
- Sanitize all user-provided HTML.
- Escape rendered output.
- Validate email, URL, phone, IDs, numbers, and enum-like values.
- Treat every request body, query string, path parameter, upload, and webhook as untrusted.

### File Uploads
- Restrict MIME types and file extensions.
- Restrict file size.
- Rename uploaded files.
- Store uploads outside executable paths where possible.
- Do not allow executable uploads.
- Treat SVG uploads as unsafe unless sanitized.

### Database
- Use parameterized queries.
- Use least-privilege DB credentials.
- Encrypt sensitive customer fields.
- Back up production data.
- Never expose database ports publicly.

### Payments
- Verify webhook signatures for every payment provider that supports signatures.
- Validate subscription status server-side.
- Do not unlock paid features based only on frontend state.
- Log payment and billing events without exposing secrets.

### Security Headers
Required headers:
- `Content-Security-Policy`
- `X-Frame-Options`
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- `Strict-Transport-Security` in production HTTPS deployments

### Logging And Monitoring
- Log authentication events, admin actions, payment events, and suspicious failures.
- Monitor failed logins and rate-limit hits.
- Never log secrets, passwords, or session tokens.

### Deployment
Block deployment if:
- Secrets are exposed.
- Critical dependency CVEs exist.
- Admin routes are unprotected.
- Tenant isolation fails.
- Authentication bypass is possible.
- Payment webhook verification is missing for an enabled provider.

## Required Review Checks

- Broken access control / IDOR
- Tenant isolation failure
- Unprotected APIs
- LocalStorage auth token usage
- SQL injection
- XSS in dashboards and menus
- File upload bypass
- Payment webhook spoofing
- Admin privilege escalation
- Sensitive data in logs

## Recommended Tooling

- `npm audit`
- Semgrep
- OWASP ZAP
- Snyk or Dependabot
- Trivy for containers
- Cloudflare WAF in production

## Current Implementation Notes

- Express Helmet is enabled for baseline security headers.
- API and login rate limiters exist.
- Passwords are bcrypt-hashed.
- Admin sessions are issued as HTTPOnly cookies.
- Customer/staff sessions are issued as HTTPOnly cookies.
- Menu ownership checks exist and must be used on every menu-scoped customer route.
- SaaS admin UI belongs under `/admin-dashboard`.
- Customer/business-owner UI belongs under `/dashboard` and `/menu-editor`.

