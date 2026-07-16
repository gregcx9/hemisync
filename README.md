# Hemisync

Binaural beat instrument with pulsed-voice affirmations. Flat Vite + React
app — all files at root. Keeps playing when the screen locks.

## Deploy from iPhone

1. github.com → + → New repository → `hemisync` → Create
2. Add file → Upload files → select ALL 6 files → Commit
   (if any file uploads as "App 2.jsx", pencil-edit the name back)
3. vercel.com → Add New → Project → Import `hemisync` → Deploy
   (Vite auto-detected, defaults correct)
4. Live at hemisync-xxxx.vercel.app in ~30s

Custom URL: Vercel → Settings → Domains → add e.g. tones.lenoresable.com,
then add the CNAME Vercel shows you in Cloudflare DNS.

Add to Home Screen in Safari for the full-screen native feel — background
audio and mic both behave best that way.
