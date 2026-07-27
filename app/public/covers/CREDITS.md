# Cover pool credits

Clarity Phase 7 (Seeing Stone Reckoning) — the deterministic fallback cover pool for task
and arc kanban cards (see `lib/services/cover-assignment.ts`). Every image below was
downloaded directly from Unsplash's free CDN (`images.unsplash.com`, standard Unsplash
License — free for commercial use, attribution appreciated but not required) via its own
photo page, resized to 800px wide via Unsplash's own imgix query params at download time.
No Unsplash+ / premium photos are included (several candidates were found and deliberately
excluded because they resolved to `plus.unsplash.com/premium_photo-*`, which requires a
paid license). No bulk scraping of Unsplash's search pages was done — each photo below was
looked up and fetched individually by its own photo page URL.

Attribution (photographer, Unsplash profile, original photo page):

| File | Photographer | Profile | Original photo |
|---|---|---|---|
| concrete-texture-ingmar-v8o8Fvxxnto.jpg | Ingmar | https://unsplash.com/@visualsbying | https://unsplash.com/photos/v8o8Fvxxnto |
| dust-noise-illia-horokhovsky-8dGkMS305rE.jpg | Illia Horokhovsky | https://unsplash.com/@fili_ja | https://unsplash.com/photos/8dGkMS305rE |
| grey-rock-immo-wegmann-uvKYxUxaAi4.jpg | Immo Wegmann | https://unsplash.com/@tinkerman | https://unsplash.com/photos/uvKYxUxaAi4 |
| pastel-sky-scott-goodwill-A3u8Ugv1EAw.jpg | Scott Goodwill | https://unsplash.com/@scottagoodwill | https://unsplash.com/photos/A3u8Ugv1EAw |
| wood-grain-zoshua-colah-UhSCrH3p4Go.jpg | Zoshua Colah | https://unsplash.com/@zoshuacolah | https://unsplash.com/photos/UhSCrH3p4Go |
| weathered-wood-kristaps-ungurs-9n5XxzP8OXE.jpg | Kristaps Ungurs | https://unsplash.com/@kristapsungurs | https://unsplash.com/photos/9n5XxzP8OXE |
| beige-fabric-safwan-thottoli-QFQ6vsou7XA.jpg | Safwan Thottoli | https://unsplash.com/@safwan_thottoli | https://unsplash.com/photos/QFQ6vsou7XA |
| beige-fabric-mary-skrynnikova-ZaSGVsHQqk.jpg | Mary Skrynnikova | https://unsplash.com/@mary_skr | https://unsplash.com/photos/_ZaSGVsHQqk |
| green-leaf-stefan-steinbauer-YyWu19ab4M.jpg | Stefan Steinbauer | https://unsplash.com/@usinglight | https://unsplash.com/photos/YyWu19ab4_M |
| green-leaf-buddy-an-jm8GDQPAimc.jpg | Buddy AN | https://unsplash.com/@stbuddyp | https://unsplash.com/photos/jm8GDQPAimc |
| green-leaf-chuttersnap-xvr2ZA1f9pQ.jpg | CHUTTERSNAP | https://unsplash.com/@chuttersnap | https://unsplash.com/photos/xvr2ZA1f9pQ |
| crumpled-paper-marjan-blan-VcOk8CeBU.jpg | Marjan Blan | https://unsplash.com/@marjan_blan | https://unsplash.com/photos/-Vc-ok8CeBU |
| crumpled-paper-forest-s-Hve5GpgSxg.jpg | Forest S | https://unsplash.com/@forest_ms | https://unsplash.com/photos/Hve5GpgS_xg |
| sand-dune-untldshots-SUcsl2HpfbA.jpg | untldshots | https://unsplash.com/@rajabbarack | https://unsplash.com/photos/SUcsl2HpfbA |

14 photos (short of the ~16 target — 5 additional strong candidates surfaced during search
were Unsplash+ premium photos and were excluded rather than substituted with a weaker free
match; noted as a deviation in the build report). Pool is deliberately texture/abstract-only
(no faces, no recognizable brands/logos, no text) — brand-neutral and low-stimulation per
the universal-design-readability reference. Deterministic assignment (stable hash of the
item's id -> pool index) lives in `lib/services/cover-assignment.ts`; this file never needs
to change for that logic to keep working — it only needs to change if the pool itself is
ever revised (add/remove a file + update the manifest array + this table).
