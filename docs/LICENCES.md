# Licence review — status: NOT COMMERCIALLY CLEARED

This file records engineering findings. It is **not legal advice**, and ArtworkGuard must not be represented as
commercially cleared until the open items below are closed by qualified counsel.

Regenerate the dependency inventory at any time: `npm run licences` (npm production tree + the Python engine venv).
Last run: 192 production packages — 166 MIT, 8 Apache-2.0, 8 ISC, 5 BSD-3-Clause, remainder BSD/0BSD/MIT-CMU/permissive
combinations; **no copyleft and no unrecognised licences**; 2 packages flagged for review (below).

## Why Py-PDF-Compare / PyMuPDF are not used

| Item | Evidence (from the installed package, 2026.8.24) |
|---|---|
| Py-PDF-Compare | `METADATA` and README say **MIT**; the bundled `licenses/LICENSE` is the full **GPL-3.0** text (674 lines, no MIT text); the GitHub repository sidebar shows GPL-3.0. The licence is contradictory and unresolved. |
| PyMuPDF 1.28.2 | `Dual Licensed - GNU AFFERO GPL 3.0 or Artifex Commercial License`. Artifex's published licensing material states that network use (SaaS / web application) of AGPL software requires sharing the application's source, or buying a commercial licence. Running it in a separate process does **not** remove this. |
| customtkinter | Metadata says "Creative Commons Zero", classifier says MIT (GUI-only dependency). |

Decision: neither is a dependency. The engine contract (`backend/src/engines/engine.interface.js`) allows one to be added
later (for example under an Artifex commercial licence) without application changes.

## Current engine stack

| Component | Version | Licence (per installed metadata) | Notes |
|---|---|---|---|
| pdfjs-dist (backend text extraction, frontend viewer via react-pdf) | 6.3.289 | Apache-2.0 | Pinned to react-pdf's exact version; one copy |
| pypdfium2 | 5.14.0 | BSD-3-Clause, Apache-2.0, plus bundled PDFium third-party licences | **Review item 2** |
| opencv-python-headless | 5.0.0.93 | Apache-2.0 | **Review item 1** |
| numpy | 2.5.4 | BSD-3-Clause + bundled permissive | |
| diff / pdfkit / png-js | 9.0.0 / 0.20.2 / 2.0.0 | BSD-3 / MIT / MIT (png-js: LICENSE file only, `package.json` has no licence field) | confirm png-js with upstream if strict provenance is required |
| react, react-router, axios, react-pdf, lucide-react | see lockfile | MIT / ISC | |
| reportlab (dev only, generates test PDFs) | 5.0.1 | BSD | not shipped |

## Open items needing legal / security review

1. **OpenCV wheel contents.** The Apache-2.0 core ships in a wheel that also bundles **FFmpeg (LGPL)**, libvpx, libaom
   and **OpenSSL 1.1.1k (end-of-life)** as shared libraries (`cv2/LICENSE-3RD-PARTY.txt`). Only image diffing is used.
   Options: build OpenCV from source without FFmpeg; or replace OpenCV with a numpy-only diff (the algorithm only uses
   absdiff, threshold, morphology and connected components). Security: the EOL OpenSSL is unused by this code path but
   should not ship in a hardened image.
2. **PDFium notices.** pypdfium2 ships PDFium plus ~15 third-party licences (`pypdfium2-*.dist-info/licenses`). These
   notices must be reproduced in any distributed product or documentation bundle.
3. **Fonts.** Reports use pdfkit's built-in Helvetica. A future Unicode font (e.g. Noto, OFL-1.1) must be added to the
   notices.
4. **Customer documents** are processed locally; no telemetry or network calls are made by the engine components.
