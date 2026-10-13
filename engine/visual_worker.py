#!/usr/bin/env python3
"""
ArtworkGuard visual-difference worker.

Renders aligned page pairs with PDFium (pypdfium2) and finds pixel-level differences with OpenCV.
It is invoked by the Node backend as a plain subprocess (no shell), with a JSON job file:

    python visual_worker.py --job /path/job.json

Job schema (all paths are trusted internal paths supplied by the backend):
    original, revised : PDF paths
    pairs             : [[origPageIndex|null, revPageIndex|null], ...]   (0-based)
    outDir            : directory that receives page PNGs
    dpi               : MINIMUM render resolution (default 150). Pages are rendered at the highest of this value and
                        the resolution needed to reach `targetLongSidePx`, capped by `maxPixels`, so large-format
                        packaging artwork keeps small print legible.
    targetLongSidePx  : desired pixel length of the page's longest side (default 4000)
    maxPixels         : hard cap on pixels per rendered page (default 20 million; protects memory)
    sensitivity       : "standard" | "high"   (default "standard")
    minRegionPx       : ignore regions smaller than this many pixels (default 12)

Prints ONE JSON document on stdout. Exit code 0 only if the JSON is complete.
Region coordinates are normalised to 0..1 of the (padded) page so the UI can scale them.
"""
import argparse, json, os, sys
import numpy as np
import cv2
import pypdfium2 as pdfium

WORKER_VERSION = "1.1.0"
# (strong, weak) per-channel absolute difference thresholds out of 255.
SENSITIVITY = {"standard": (28, 10), "high": (14, 4)}


def pick_dpi(sizes_pt, min_dpi, target_long_px, max_px):
    """One shared DPI per page pair so both sides are rasterised identically (a pixel diff is only meaningful
    when both images use the same scale)."""
    dpi = float(min_dpi)
    for w, h in sizes_pt:
        long_pt = max(w, h)
        if long_pt > 0:
            dpi = max(dpi, target_long_px / long_pt * 72.0)
    for w, h in sizes_pt:                       # never exceed the pixel budget
        px_at_dpi = (w * dpi / 72.0) * (h * dpi / 72.0)
        if px_at_dpi > max_px:
            dpi = min(dpi, dpi * (max_px / px_at_dpi) ** 0.5)
    return max(int(round(dpi)), 50)


def render(page, dpi):
    # may_draw_forms keeps form fields visible; crisp text/line art via PDFium's anti-aliased renderer.
    bmp = page.render(scale=dpi / 72.0, rev_byteorder=False, may_draw_forms=True)  # BGR(A) numpy-compatible
    arr = bmp.to_numpy()
    if arr.shape[2] == 4:
        # Flatten any alpha onto white so transparent areas compare as paper.
        alpha = arr[:, :, 3:4].astype(np.float32) / 255.0
        arr = (arr[:, :, :3].astype(np.float32) * alpha + 255.0 * (1 - alpha)).astype(np.uint8)
    return np.ascontiguousarray(arr[:, :, :3])


def pad_to(img, h, w):
    if img.shape[0] == h and img.shape[1] == w:
        return img
    out = np.full((h, w, 3), 255, dtype=np.uint8)
    out[: img.shape[0], : img.shape[1]] = img
    return out


def regions_from_mask(mask, min_px, kind, close_px):
    if close_px:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_px, close_px))
        mask = cv2.dilate(mask, k)
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    out = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area >= min_px:
            out.append({"x": int(x), "y": int(y), "w": int(w), "h": int(h), "kind": kind})
    return out


def classify(a, b, r):
    x, y, w, h = r["x"], r["y"], r["w"], r["h"]
    la = float(cv2.cvtColor(a[y:y + h, x:x + w], cv2.COLOR_BGR2GRAY).mean())
    lb = float(cv2.cvtColor(b[y:y + h, x:x + w], cv2.COLOR_BGR2GRAY).mean())
    if la > 247 and lb <= 247: return "added"       # blank on original, content on revised
    if lb > 247 and la <= 247: return "removed"     # content on original, blank on revised
    return "changed"


def tolerant_diff(A, B, tol):
    """Per-pixel difference that forgives sub-pixel misalignment.

    Two renderings of identical artwork can differ along every edge by a fraction of a pixel (anti-aliasing,
    different PDF producers). For each pixel we take the smallest difference between A and any B pixel within
    +/- tol px (and vice-versa) and keep the larger of the two directions. A real change is still caught because
    nothing nearby matches; edge fringing is not.
    """
    base = cv2.absdiff(A, B).max(axis=2)
    if tol <= 0:
        return base
    best_ab, best_ba = base.copy(), base.copy()
    H, W = base.shape
    for dy in range(-tol, tol + 1):
        for dx in range(-tol, tol + 1):
            if dx == 0 and dy == 0:
                continue
            ys, ye = max(0, dy), H + min(0, dy)
            xs, xe = max(0, dx), W + min(0, dx)
            a = A[ys:ye, xs:xe]
            b = B[ys - dy:ye - dy, xs - dx:xe - dx]
            d = cv2.absdiff(a, b).max(axis=2)
            np.minimum(best_ab[ys:ye, xs:xe], d, out=best_ab[ys:ye, xs:xe])
            np.minimum(best_ba[ys - dy:ye - dy, xs - dx:xe - dx], d, out=best_ba[ys - dy:ye - dy, xs - dx:xe - dx])
    return np.maximum(best_ab, best_ba)


def draw(img, regions, bgr):
    # Stroke/padding scale with resolution so markers look the same at 150 dpi and 400 dpi.
    k = max(1.0, img.shape[1] / 1600.0)
    pad, lw = int(round(3 * k)), max(2, int(round(2 * k)))
    out = img.copy()
    overlay = out.copy()
    for r in regions:
        cv2.rectangle(overlay, (r["x"] - pad, r["y"] - pad), (r["x"] + r["w"] + pad, r["y"] + r["h"] + pad), bgr, -1)
    out = cv2.addWeighted(overlay, 0.14, out, 0.86, 0)
    for r in regions:
        cv2.rectangle(out, (r["x"] - pad, r["y"] - pad), (r["x"] + r["w"] + pad, r["y"] + r["h"] + pad), bgr, lw)
    return out


def report_copy(img, max_long=1800):
    """Downscaled copy for the PDF report only (keeps the report small); the UI uses the full-resolution image."""
    h, w = img.shape[:2]
    k = max_long / float(max(h, w))
    return img if k >= 1 else cv2.resize(img, (int(w * k), int(h * k)), interpolation=cv2.INTER_AREA)


def save_png(path, img):
    ok, buf = cv2.imencode(".png", img, [cv2.IMWRITE_PNG_COMPRESSION, 5])
    if not ok:
        raise RuntimeError("PNG encode failed")
    with open(path, "wb") as f:
        f.write(buf.tobytes())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True)
    job = json.load(open(ap.parse_args().job, "r", encoding="utf-8"))
    min_dpi = int(job.get("dpi", 150))
    target_long = int(job.get("targetLongSidePx", 4000))
    max_px = int(job.get("maxPixels", 20_000_000))
    strong, weak = SENSITIVITY.get(job.get("sensitivity", "standard"), SENSITIVITY["standard"])
    min_px_base = int(job.get("minRegionPx", 12))
    out_dir = job["outDir"]
    os.makedirs(out_dir, exist_ok=True)

    docs = {}
    for role in ("original", "revised"):
        if not os.path.isfile(job[role]):
            raise FileNotFoundError(role)
        docs[role] = pdfium.PdfDocument(job[role])

    warnings, pages = [], []
    for idx, (oi, ri) in enumerate(job["pairs"]):
        entry = {"pairIndex": idx, "originalPage": oi, "revisedPage": ri}
        sizes = [docs[r][i].get_size() for r, i in (("original", oi), ("revised", ri)) if i is not None]
        dpi = pick_dpi(sizes, min_dpi, target_long, max_px)
        # Region/noise thresholds are defined at 110 dpi; scale the area ones with resolution^2.
        res_k = (dpi / 110.0) ** 2
        min_px = max(min_px_base, int(round(min_px_base * res_k)))
        tol = 0 if dpi < 140 else (1 if dpi < 260 else 2)
        a = render(docs["original"][oi], dpi) if oi is not None else None
        b = render(docs["revised"][ri], dpi) if ri is not None else None
        ref = a if a is not None else b
        H = max(x.shape[0] for x in (a, b) if x is not None)
        W = max(x.shape[1] for x in (a, b) if x is not None)
        blank = np.full((H, W, 3), 255, dtype=np.uint8)
        A = pad_to(a, H, W) if a is not None else blank
        B = pad_to(b, H, W) if b is not None else blank
        entry["widthPx"], entry["heightPx"] = W, H
        entry["dpi"] = dpi
        # Rendered size of each side before padding: lets the UI map per-page normalised coordinates (text boxes)
        # onto the padded canvas when the two page sizes differ.
        entry["originalSizePx"] = {"w": int(a.shape[1]), "h": int(a.shape[0])} if a is not None else None
        entry["revisedSizePx"] = {"w": int(b.shape[1]), "h": int(b.shape[0])} if b is not None else None

        # Only warn when the page boxes really differ (>1 pt); a pixel of rounding is not a trim change.
        size_mismatch = len(sizes) == 2 and (abs(sizes[0][0] - sizes[1][0]) > 1.0 or abs(sizes[0][1] - sizes[1][1]) > 1.0)
        entry["pageSizeMismatch"] = bool(size_mismatch)
        if size_mismatch:
            warnings.append({"code": "PAGE_SIZE_MISMATCH", "pairIndex": idx,
                             "message": f"Page sizes differ (original {a.shape[1]}x{a.shape[0]}px, revised {b.shape[1]}x{b.shape[0]}px at {dpi} dpi). Differences may include trim/size changes."})

        diff = tolerant_diff(A, B, tol) if (a is not None and b is not None) else cv2.absdiff(A, B).max(axis=2)
        strong_mask = (diff >= strong).astype(np.uint8) * 255
        weak_mask = ((diff >= weak) & (diff < strong)).astype(np.uint8) * 255
        # Remove isolated weak pixels (anti-aliasing / JPEG noise) but keep solid areas.
        k_open = max(5, int(round(5 * dpi / 110.0)) | 1)
        weak_mask = cv2.morphologyEx(weak_mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (k_open, k_open)))

        close_px = max(9, int(round(9 * dpi / 110.0)))
        regs = regions_from_mask(strong_mask, min_px, "visible", close_px=close_px)
        regs += [r for r in regions_from_mask(weak_mask, max(min_px, int(round(400 * res_k))), "subtle", close_px=0)
                 if not any(r["x"] < v["x"] + v["w"] and v["x"] < r["x"] + r["w"] and r["y"] < v["y"] + v["h"] and v["y"] < r["y"] + r["h"] for v in regs)]
        if oi is None:
            regs = [{"x": 0, "y": 0, "w": W, "h": H, "kind": "visible", "change": "page_added"}]
        elif ri is None:
            regs = [{"x": 0, "y": 0, "w": W, "h": H, "kind": "visible", "change": "page_removed"}]
        else:
            for r in regs:
                r["change"] = classify(A, B, r) if r["kind"] == "visible" else "colour_shift"

        entry["regions"] = [{
            "x": round(r["x"] / W, 5), "y": round(r["y"] / H, 5), "w": round(r["w"] / W, 5), "h": round(r["h"] / H, 5),
            "kind": r["kind"], "change": r["change"]} for r in regs]
        entry["diffPixelRatio"] = round(float((diff >= weak).sum()) / float(W * H), 6)
        entry["changed"] = len(regs) > 0

        files = {}
        if oi is not None:
            files["original"] = f"p{idx:03d}_original.png"
            marked = draw(A, regs, (40, 40, 220))                                              # red (BGR)
            save_png(os.path.join(out_dir, files["original"]), marked)
            files["originalReport"] = f"p{idx:03d}_original_report.png"
            save_png(os.path.join(out_dir, files["originalReport"]), report_copy(marked))
        if ri is not None:
            files["revised"] = f"p{idx:03d}_revised.png"
            marked = draw(B, regs, (60, 170, 40))                                              # green (BGR)
            save_png(os.path.join(out_dir, files["revised"]), marked)
            files["revisedReport"] = f"p{idx:03d}_revised_report.png"
            save_png(os.path.join(out_dir, files["revisedReport"]), report_copy(marked))
        entry["images"] = files
        pages.append(entry)

    print(json.dumps({
        "worker": {"name": "artworkguard-visual", "version": WORKER_VERSION, "opencv": cv2.__version__,
                   "pdfium": pdfium.PDFIUM_INFO.version if hasattr(pdfium, "PDFIUM_INFO") else None},
        "dpi": min(p["dpi"] for p in pages) if pages else min_dpi, "dpiMax": max(p["dpi"] for p in pages) if pages else min_dpi,
        "sensitivity": job.get("sensitivity", "standard"), "pages": pages, "warnings": warnings,
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # structured failure; never echo document content
        print(json.dumps({"error": {"type": type(e).__name__, "message": str(e)[:300]}}))
        sys.exit(2)