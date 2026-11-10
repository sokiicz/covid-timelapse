# COVID-19 Timelapse

The COVID-19 pandemic week by week on an interactive 3D globe, from December 2019 to October 2026, as reported to
the World Health Organization.

- Drag to explore while time keeps running, scroll to zoom, click a country or region for its statistics.
- Compare a group of countries, regions or continents with a ranking per million people.
- Switch layers in the legend: reported cases, reported deaths, vaccination, government measures, countries that
  stopped reporting, key events.
- Key events coloured by type (WHO decisions, variants, vaccines and treatment, measures, death toll), with a list
  of recent events; the tour stops where the key events happened.
- At the end: totals for the whole period on the globe (deaths and cases per million, vaccination, measures) and key
  facts computed from the data.
- Country notes on how countries fared and what research points to as reasons, with sources (written with AI assistance, see below).

## Run locally

It is a static site with no build step. Serve the folder with any static server, for example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/`. Opening `index.html` directly from the disk does not work, because the browser
blocks loading the data files.

## Data and licences

All sources, licences and the changes made to the data are listed in the page itself (the "i" button, "About and
sources"). In short:

- Cases and deaths: WHO COVID-19 dashboard (CC BY 4.0). This is not a WHO product and WHO does not endorse it.
- Gaps in 2020 and early 2021 (three-week moving averages) and China's provinces: Johns Hopkins University CSSE
  (CC BY 4.0).
- Regions: ECDC (CC BY 4.0) and COVID-19 Data Hub (Guidotti and Ardia 2020, CC BY 4.0).
- Measures: Oxford COVID-19 Government Response Tracker (Hale et al. 2021, CC BY 4.0).
- Vaccination: Our World in Data (Mathieu et al. 2021, CC BY 4.0).
- Earth imagery: NASA Earth Observatory. Star map: NASA/Goddard SVS, Gaia DR2: ESA/Gaia/DPAC (Gaia data under
  CC BY-NC 3.0 IGO). Borders: Natural Earth.
- Typeface Inter: SIL Open Font License 1.1, see `data/Inter-OFL.txt`.
- three.js: MIT License, see `vendor/three/LICENSE`.

The country notes and key events were researched and written with AI assistance from the listed sources. A second AI
pass compared every sentence with its sources; a third checked the sentences that were rewritten after that. Then a
person read them all (November 2026).

## Licence

The code in this repository (HTML, CSS and JavaScript) is released under the MIT License, see `LICENSE`. The data,
imagery, typeface and three.js keep the licences of their sources listed above. The MIT License does not cover them.

## Non-commercial

This is a non-commercial project: no ads, no paid parts. The star map is based on Gaia data, whose licence
does not allow commercial use, so the site stays non-commercial.

## Privacy

No cookies, no analytics, no requests to third parties other than the host (GitHub Pages). The page stores only your
sound settings (mute and volume) in your browser.

Made by [Resonant Labs](https://resonantlabs.online) with Claude Code.
