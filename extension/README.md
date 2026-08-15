# PullSRC extension

The browser-native half of PullSRC. The web app can only see what an anonymous
visitor sees, inside a 60-second serverless function. This runs in your own
browser instead, which removes both limits.

## Install (development)

```bash
npm run build:ext      # outputs extension/dist
```

Then in Chrome:

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select `extension/dist`
4. Open any page, click the PullSRC toolbar icon — the side panel opens

`npm run dev:ext` rebuilds on change. Press the reload arrow on the
`chrome://extensions` card to pick changes up.

## Why it can do more than the site

| | Web app | Extension |
|---|---|---|
| Pages needing a login | ✗ | ✓ your session |
| Time limit | 60s | none |
| Blocked as a bot | often | no, residential IP |
| Signed CDN links expiring | a real problem | fetched in-session |
| Server cost | per scan | zero |

## How it works

- **`background.ts`** — a service worker watching `chrome.webRequest`. This
  replaces the headless browser the web app has to boot: your browser already
  loaded the page, so the media list comes for free.
- **`collect.ts`** — runs inside the page via `chrome.scripting.executeScript`
  and reads the live DOM: images (via `currentSrc`, so it gets the exact srcset
  the browser chose), CSS backgrounds, fonts from `document.fonts`, the
  rendered colour palette, and the resource timeline.
- **`assemble.ts`** — merges both into the same `ScanResult` the web app
  produces, so the credit sheet and ZIP export work unchanged.
- **`download.ts`** — saves files through `chrome.downloads`, and assembles
  HLS playlists into a real MP4 locally with no size ceiling.

Everything in `src/lib/pullsrc/` is shared with the site — the classifier, the
HLS parser, the MP4 `hdlr` probe and the track reconciliation are imported, not
copied, so the two can't drift.

## Known gaps

- DASH (`.mpd`) is detected but not assembled; only HLS is.
- HLS audio published as a separate `EXT-X-MEDIA` rendition is not merged yet,
  so such a stream assembles to silent video.
- YouTube video is deliberately not extracted. Publishing that to the Chrome
  Web Store risks the whole listing, and it violates YouTube's terms.
- `icon128.png` is currently the full-size site logo; replace it with a real
  128px icon before publishing.
