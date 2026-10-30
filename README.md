# Media Consumption Calendar – Obsidian Plugin

An obsidian plugin for a month-view calendar which logs what you read, watch, play and listen to. Each day shows the covers of the things you consumed. Supports comics, manga, books, movies, TV, anime, games and podcasts.

[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/arnavratan)

![Screenshot 1](https://github.com/user-attachments/assets/288ec429-9045-432e-aa4d-f6ad72109a91)
![Screenshot 2](https://github.com/user-attachments/assets/c3c0acdc-e602-4016-a925-207d5fb01338)
![Screenshot 3](https://github.com/user-attachments/assets/af9aa7cb-062f-43ea-b507-bd0c110c263b)
![Screenshot 4](https://github.com/user-attachments/assets/c9296f71-fa88-43bf-9f82-4d5e56eb651e)
![Screenshot 5](https://github.com/user-attachments/assets/5b9e0176-d090-4e05-8e50-49bc198050f5)

<!-- Add a screenshot here: ![Calendar view](./images/calendar.png) -->

## Features

* **Card deck stacking:** Each day's covers can overlap like a deck of cards with hover-to-lift interactions (can be toggled off for a classic grid).
* **Drag-and-drop management:** Drag cards within the same day to reorder them, or drag onto another day to either duplicate or move entries (configurable in settings).
* **Customizable aesthetics:** Transparent calendar background that adopts your active Obsidian theme, adjustable cover sizes, and frosted-glass add/edit modal windows with an adjustable background blur slider.
* **Search-and-select:** Fetch cover art automatically (with unified Book/Comic lookup) or add custom entries manually when no result is found.
* **Full entry control:** Change covers directly via entry details, rename, edit fields, duplicate, reorder via right-click ("Bring to front" / "Send to back"), or delete.
* **Unified local storage:** All entries are stored in a single JSON file in your vault (default `Media/media-cache.json`) with an optional `order` attribute. No per-item notes are created.
* **Data safety protections:** Malformed items are routed to `unparsed` rather than deleted, unreadable files trigger save locks to prevent overwrites, and `.bak.json` safety backups are generated once per session.

## Usage

* Open the calendar from the ribbon icon or via the command **Open calendar**.
* Click a day or use **+ Quick add** to search and log an entry.
* Click a card to view and edit details, or update cover art directly under the preview.
* Reorder cards on the same day by dragging, or right-click (or long-press on mobile) and select **Bring to front** or **Send to back**.
* Drag a card to another day to duplicate or move it, depending on your preferences under **Settings**.

## Setup

Some external sources require a free API key, configured in **Settings → Media Consumption Calendar**:

| Media | Source | Key needed |
| --- | --- | --- |
| Movies, TV | TMDB | Yes (free) |
| Games | IGDB (preferred) or RAWG | Yes (free) |
| Books, Comics | Open Library, Google Books | No (Google Books key optional) |
| Manga, anime | AniList | No |
| Podcasts | Apple iTunes Search API | No |

*Manual entries and custom cover URLs can always be added without API keys.*

## Where your data lives

Your entries are stored in `Media/media-cache.json` (configurable in settings). Because it is a standard vault file, it syncs alongside your notes and **persists across plugin updates or reinstalls**.

* **Obsidian Sync:** Ensure **Other file types** is toggled on under **Settings → Sync → Selective sync** to include `.json` files. Third-party sync providers (iCloud, Dropbox, Syncthing, Git) sync it natively.
* **Custom Paths:** Custom file locations are stored in plugin settings and must be re-entered if the plugin is uninstalled.
* **External Edits:** If you edit the cache file externally, run **Reload data from file** from the command palette.
* **Backward Compatibility:** Order metadata is stored using an optional `order` key; older versions gracefully ignore this field without corrupting data.

## Disclosures

* **Network use:** Search queries send entered text to relevant third-party endpoints: `api.themoviedb.org` (TMDB), `openlibrary.org`, `[www.googleapis.com](https://www.googleapis.com)` (Google Books), `graphql.anilist.co` (AniList), `id.twitch.tv` and `api.igdb.com` (IGDB), `api.rawg.io` (RAWG), and `itunes.apple.com` (Apple Podcasts). Images are loaded directly from the respective service CDNs or custom user-provided URLs.
* **API keys:** Keys are stored in plain text in `data.json` inside your vault's plugin folder (`.obsidian/plugins/media-consumption-calendar/`). Exclude this folder from unencrypted or public sync targets.
* **File system access:** Reads and writes are strictly restricted to your configured data JSON path and local recovery copies (`.bak.json` and `.corrupt-<timestamp>.json`). No files outside the vault are accessed.
* **Support link:** An optional external link to Buy Me a Coffee is included in the README and settings tab; it connects only when deliberately clicked.
* **Privacy:** No telemetry, tracking, account requirements, or ads.

## Installation

* **Community Plugins:** Search for **Media Consumption Calendar** under **Settings → Community plugins** and click **Install**.
* **Manual Installation:** Download `main.js`, `manifest.json`, and `styles.css` from the latest release, place them in `<vault>/.obsidian/plugins/media-consumption-calendar/`, and enable the plugin under Community plugins.

## Support

The plugin is completely free and uninhibited by paywalls. If you enjoy using it, you can [buy me a coffee](https://buymeacoffee.com/YOUR-BMC-USERNAME).

## Credits

Metadata and artwork are provided by TMDB, Open Library, Google Books, AniList, IGDB, RAWG, and Apple. This product uses the TMDB API but is not endorsed or certified by TMDB.

## License

MIT
