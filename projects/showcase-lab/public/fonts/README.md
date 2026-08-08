# Fonts

## Outfit (display only)

`outfit-700-latin.woff2` — 14,064 bytes. Weight 700, latin subset only.

- **Licence:** SIL Open Font License 1.1 (`OFL.txt` in this directory). Self-hosting and
  redistribution are explicitly permitted; the licence must travel with the file, which is why
  `OFL.txt` is committed beside it.
- **Source:** Google Fonts CDN, resolved from the css2 API for `Outfit:wght@700` (v15), latin subset.
- **Why self-hosted rather than a `<link>`:** a render-blocking stylesheet request to a third-party
  origin costs LCP, and this page is deliberately built around poster-as-LCP. Self-hosted plus
  `<link rel=preload>` and `font-display: swap` means the poster still paints first and the headline
  swaps in without ever blocking it.
- **Why ONE weight:** display only. Headlines and the configurator heading use it; body copy, UI and
  code stay on the system stack, which costs nothing and is already well drawn on every platform.
  One file, one request, ~14 KB.
- **Why Outfit:** a geometric grotesque with a tight, confident display range. Deliberately not Inter
  (the loudest AI tell) and not Fraunces or Instrument Serif (burned for the same reason).
