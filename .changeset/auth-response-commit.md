---
"@nestm/better-auth": patch
---

Send auth responses only after request middleware finishes, so transaction wrappers commit before session cookies and successful status codes become visible. Preserve request conversion, streaming response delivery, and middleware short-circuits.
