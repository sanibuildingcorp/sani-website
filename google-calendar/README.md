# Site visits → Google Calendar, automatically

One-time setup, about 5 minutes. Easier on a computer than a phone.

## 1. Make the script

1. Open https://script.google.com while signed in as **sanibuildingcorp@gmail.com**.
2. **New project**. Delete the sample code in the editor.
3. Open `Code.gs` from this folder, copy everything, paste it in.
4. On the line `var SECRET = "PASTE-A-LONG-RANDOM-SECRET-HERE";` replace the text in quotes with a long random password (30+ letters and numbers). Keep it, you need it in step 3.
5. Click the project name at the top left and call it `Sani visits calendar`. Save (💾).

## 2. Publish it as a web app

1. **Deploy → New deployment**.
2. Click the gear next to "Select type" → **Web app**.
3. Execute as: **Me**. Who has access: **Anyone**. (Anyone can reach the URL, but nothing happens without the secret.)
4. **Deploy**. Google asks you to authorize: choose your account → Advanced → Go to Sani visits calendar → Allow.
5. Copy the **Web app URL**. It ends in `/exec`.

Test: open that URL in a browser. It should show `{"ok":true,"service":"sani-visits-gcal"}`.

## 3. Tell Netlify

Netlify → the site → **Site configuration → Environment variables → Add a variable**:

| Key | Value |
|---|---|
| `GCAL_SYNC_URL` | the Web app URL from step 2 |
| `GCAL_SYNC_SECRET` | the secret from step 1 |

Then **Deploys → Trigger deploy → Deploy site**.

## 4. Done

- The Visits tab shows **📆 Google Calendar: connected**.
- Every new visit goes into your calendar with a popup reminder 1 hour before and one the day before.
- Changing a visit's time or address updates the event. Deleting the visit deletes the event.
- Visits saved before the setup show a **🔁 Sync** button. Press it once.

## If you change the script later

Edit, then **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL stays the same.
