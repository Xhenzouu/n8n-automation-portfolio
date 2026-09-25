# Cloudflare Tunnel Setup (Windows)

Exposes local n8n to the internet for webhook testing.

## Prerequisites

- `cloudflared.exe` installed (via winget or manual download)

## Steps

1. **Start n8n with the tunnel URL:**

   Open a PowerShell window for n8n.

   ```powershell
   $env:WEBHOOK_URL="https://YOUR-TUNNEL-URL.trycloudflare.com"
   n8n start
   ```

2. **Start the Cloudflare Tunnel:**

   Open a second PowerShell window.

   ```powershell
   cloudflared tunnel --url http://localhost:5678
   ```

   Copy the `trycloudflare.com` URL it outputs. Use this in Step 1.

3. **Verify:**

   Open the tunnel URL in a browser. You should see the n8n editor.

## Important Notes

- **Keep both windows open.** Closing the tunnel window kills the public URL.
- **URL is temporary.** It changes every time you restart `cloudflared`.
- **No interstitial page.** Unlike localtunnel, Cloudflare's Quick Tunnel doesn't show a warning page to browsers or webhooks.
- **Production requires a stable URL.** Quick Tunnels are for development only.
