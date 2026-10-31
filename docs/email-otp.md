# Email OTP registration

Registration uses Better Auth email OTP with 6 digits, a 5-minute expiry, hashed storage, 5 failed attempts per code, and a 60-second resend cooldown. Password login requires a verified email when enabled. Google registration retains Google's verified email flow.

## Gmail setup

1. Sign in to `laporpakemail@gmail.com`.
2. Enable 2-Step Verification at https://myaccount.google.com/security.
3. Open https://myaccount.google.com/apppasswords and create an app password named Garda Jakarta.
4. Store the 16-character app password as `SMTP_PASS` in the Railway **GardaJakarta-BE** service. Do not use the main Google password or commit the app password.

Set these backend variables:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=laporpakemail@gmail.com
SMTP_PASS=<app password>
SMTP_FROM="Garda Jakarta <laporpakemail@gmail.com>"
EMAIL_OTP_ENABLED=true
```

Keep `EMAIL_OTP_ENABLED=false` until delivery is tested. No credentials belong in frontend variables. Existing unverified password accounts will also need to verify on their next login after activation.

If App Passwords is unavailable, check the account's 2-Step Verification settings and administrator restrictions. If Railway blocks SMTP on the project's plan, use an HTTPS email provider or an eligible plan before enabling OTP; do not disable TLS verification to work around delivery failures.

## Validation

`node --test tests/otp.integration.mjs` requires `TEST_DATABASE_URL` pointing to a migrated database and a current backend build. The test captures mail in memory, uses unique temporary accounts, and removes those accounts afterward. It never sends real email.

After credentials are supplied, verify actual delivery to an address owned by the operator, code expiry, resend, and login. This final delivery check cannot be completed with an empty `SMTP_PASS`.
