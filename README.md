# Media Consumption Calendar – Obsidian Plugin

An obsidian plugin for a month-view calendar which logs what you read, watch, play and listen to. Each day shows the covers of the things you consumed. Supports comics, manga, books, movies, TV, anime, games and podcasts.

[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/arnavratan)

<img src="https://github.com/user-attachments/assets/729576e4-8461-44c6-bc29-3a58ce1c2265" alt="1" style="max-width: 100%; height: auto;" />
<img src="https://github.com/user-attachments/assets/4326da46-42fd-4664-81dd-aa67148b40be" alt="2" style="max-width: 100%; height: auto;" />
<img src="https://github.com/user-attachments/assets/778d0af2-edcc-4da2-b4fe-a122da060574" alt="3" style="max-width: 100%; height: auto;" />
<img src="https://github.com/user-attachments/assets/90803d70-41b8-40f0-b5b5-cea57cd13535" alt="4" style="max-width: 100%; height: auto;" />


<!-- Add a screenshot here: ![Calendar view](./images/calendar.png) -->

## Features

- Month calendar with cover art on each day, a "+N" tile when a day overflows, and per-type filtering.
- Search-and-select with cover art, or add an entry manually when nothing is found.
- Change covers, rename, edit details, duplicate to another day (drag a cover onto a date), delete.
- Adjustable cover size and add/edit window size.
- All entries live in a single JSON file in your vault (default `Media/media-cache.json`), so it syncs with your vault. No per-item notes are created.
- Your data is protected: malformed entries are set aside under `unparsed` instead of deleted, an unreadable file locks saving instead of overwriting it, and a `.bak.json` safety copy is written once per session.

## Usage

- Open the calendar from the ribbon icon or the command **Open calendar**.
- Click a day, or use **+ Quick add**, to search and add an entry.
- Right-click a cover for rename, change cover, duplicate and delete.

## Setup

Some sources need a free API key, entered in **Settings → Media Consumption Calendar**:

| Media | Source | Key needed |
| --- | --- | --- |
| Movies, TV | TMDB | Yes (free) |
| Games | IGDB (preferred) or RAWG | Yes (free) |
| Books | Open Library, then Google Books | No (Google key optional) |
| Comics | Google Books | No (key optional) |
| Manga, anime | AniList | No |
| Podcasts | Apple iTunes Search API | No |

You can always add entries manually without any key.

## Where your data lives

Your entries are stored in `Media/media-cache.json` (you can change the path in the settings). It is a normal vault file, so it syncs like the rest of your vault and **uninstalling and reinstalling the plugin keeps your data**: reinstall and your calendar is back.

- If you use Obsidian Sync, make sure **Other file types** is enabled under Settings → Sync → Selective sync, or `.json` files won't sync. Third-party sync tools (iCloud, Dropbox, Syncthing, Git) handle the file normally.
- If you choose a custom path, it is remembered in the plugin's settings, which are removed on uninstall, so enter the path again after a reinstall.
- If you edit the file outside Obsidian, run **Reload data from file**.

## Disclosures

- **Network use.** Searching sends the text you typed to the service for the media type you chose: `api.themoviedb.org` (TMDB), `openlibrary.org`, `www.googleapis.com` (Google Books), `graphql.anilist.co` (AniList), `id.twitch.tv` and `api.igdb.com` (IGDB, with your Twitch client credentials), `api.rawg.io` (RAWG) and `itunes.apple.com` (podcasts). Cover images are loaded directly from the hosting CDN of the service that returned them (for example `image.tmdb.org`, `covers.openlibrary.org`, `images.igdb.com`, Apple's image servers) or from any image URL you paste yourself.
- **API keys** you enter are stored in plain text in this plugin's `data.json` inside your vault's plugin folder, not in the media file. Do not sync that folder to places you don't trust.
- **Files.** The plugin reads and writes only the data file you configure inside your vault (default `Media/media-cache.json`), plus `.bak.json` and `.corrupt-<timestamp>.json` safety copies next to it. It uses the vault adapter because the data is a plain JSON file rather than a note. Nothing outside the vault is accessed.
- **Support link.** The settings tab and this README contain an optional static link to Buy Me a Coffee. It opens in your browser only when clicked. No payment is required to use any feature.
- **No telemetry, no ads, no account, no payment.** The plugin is free. Third-party services have their own terms and rate limits.

## Installation

Install from **Settings → Community plugins** by searching for "Media Consumption Calendar".

Manual install: download `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/media-consumption-calendar/`, then enable the plugin.

## Support

The plugin is free and nothing is locked behind payment. If you find it useful you can [buy me a coffee](https://buymeacoffee.com/YOUR-BMC-USERNAME). The same optional link appears in the plugin's settings.

## Credits

Metadata and artwork come from TMDB, Open Library, Google Books, AniList, IGDB, RAWG and Apple. This product uses the TMDB API but is not endorsed or certified by TMDB.

## License

MIT
