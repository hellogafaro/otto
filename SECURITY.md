# Security Policy

## Reporting a Vulnerability

If you find a security vulnerability in Otto, please report it responsibly.

**Do not report vulnerabilities through public GitHub issues.** Use either:

- a private [security advisory](https://github.com/hellogafaro/otto/security/advisories/new), or
- email **hello@hellogafaro.com**

Include a description, steps to reproduce, the potential impact and, optionally, a suggested fix.

## What to Expect

- **Acknowledgment** within 48 hours
- **Initial assessment** within 7 days
- **Resolution** of critical issues within 30 days

## Scope

In scope: the Otto desktop app, the Otto server and web UI, and the packages and
repositories under github.com/hellogafaro/otto.

Out of scope: third-party dependencies (report to their maintainers), social
engineering and denial of service attacks.

## Supported Versions

Only the latest version receives security updates. Please keep your installation up to date.

## Security Best Practices

1. **Keep credentials secure**: never commit `.env` files or credentials.
2. **Use a secret manager or environment variables** for tokens and keys.
3. **Review permissions**: be cautious with the Auto permission mode.
4. **Update regularly.**

## Acknowledgments

We acknowledge security researchers who report valid vulnerabilities, with their permission.
