"""Work out how each product photo should be framed so the product fills the
frame — measured from the picture itself, never cut off.

    python3 .tools/product_framing.py <products folder> <files.json> <out.json>

For every photo: shrink it with macOS `sips` to a small BMP, find the
background colour from the border, find the box the product occupies, then
compute for each frame shape the zoom and centre point that make that box fill
the frame with a small margin. The result is in the form the site's "crops"
record uses: { "products/<file>": { "stage": {x, y, z}, "card": {x, y, z} } }.
"""
import json, os, struct, subprocess, sys, tempfile

FRAMES = {'stage': 1.5, 'card': 1.28}     # width ÷ height, as in styles.css
MARGIN = 0.05                             # breathing room on each side, as a share of the frame
MAX_ZOOM = 4.0

def bmp_pixels(path):
    d = open(path, 'rb').read()
    off = struct.unpack_from('<I', d, 10)[0]
    w, h = struct.unpack_from('<ii', d, 18)
    bpp = struct.unpack_from('<H', d, 28)[0]
    bottom_up = h > 0; h = abs(h)
    step = bpp // 8; stride = (w * step + 3) & ~3
    rows = []
    for yy in range(h):
        r = (h - 1 - yy) if bottom_up else yy
        base = off + r * stride
        row = []
        for xx in range(w):
            i = base + xx * step
            b, g, rr = d[i], d[i + 1], d[i + 2]
            a = d[i + 3] if step == 4 else 255
            row.append((rr, g, b, a))
        rows.append(row)
    return w, h, rows

def measure(path, tmp):
    out = os.path.join(tmp, 'x.bmp')
    subprocess.run(['sips', '-Z', '360', '-s', 'format', 'bmp', path, '--out', out],
                   check=True, capture_output=True)
    w, h, px = bmp_pixels(out)
    # Shrinking leaves a faint line along the very edge, so the outer two
    # pixels are ignored: the background is read from the ring just inside.
    E = 2
    border = [px[y][x] for y in range(E, h - E) for x in range(E, w - E)
              if x < E + 2 or y < E + 2 or x >= w - E - 2 or y >= h - E - 2]
    opaque = [p for p in border if p[3] >= 20] or [(255, 255, 255, 255)]
    bg = [sorted(p[c] for p in opaque)[len(opaque) // 2] for c in range(3)]
    cols = [0] * w; rows = [0] * h
    for y in range(E, h - E):
        for x in range(E, w - E):
            p = px[y][x]
            if p[3] < 20: continue
            if max(abs(p[0] - bg[0]), abs(p[1] - bg[1]), abs(p[2] - bg[2])) > 18:
                cols[x] += 1; rows[y] += 1
    tc, tr = max(1, h * 0.006), max(1, w * 0.006)
    xs = [i for i, v in enumerate(cols) if v >= tc]; ys = [i for i, v in enumerate(rows) if v >= tr]
    if not xs or not ys: return None
    return w / h, (xs[0] / w, ys[0] / h, (xs[-1] + 1) / w, (ys[-1] + 1) / h)

def framing(aspect_img, box, A):
    """Zoom and centre point for a contained picture in a frame of shape A."""
    if aspect_img > A: dw, dh = A, A / aspect_img
    else: dw, dh = aspect_img, 1.0
    ox, oy = (A - dw) / 2, (1 - dh) / 2
    X0, Y0 = ox + box[0] * dw, oy + box[1] * dh
    X1, Y1 = ox + box[2] * dw, oy + box[3] * dh
    bw, bh = X1 - X0, Y1 - Y0
    z = min(A * (1 - 2 * MARGIN) / bw, (1 - 2 * MARGIN) / bh, MAX_ZOOM)
    if z < 1.04: return None                         # already fills it; leave as is
    vw, vh = A / z, 1 / z
    L = min(max((X0 + X1) / 2 - vw / 2, 0), A - vw)
    T = min(max((Y0 + Y1) / 2 - vh / 2, 0), 1 - vh)
    x = L / (1 - 1 / z) / A * 100
    y = T / (1 - 1 / z) * 100
    return {'x': round(x), 'y': round(y), 'z': round(z, 2)}

def main(folder, files_json, out_json):
    files = json.load(open(files_json))
    result, skipped = {}, []
    with tempfile.TemporaryDirectory() as tmp:
        for f in files:
            p = os.path.join(folder, f)
            if not os.path.exists(p): skipped.append((f, 'missing')); continue
            m = measure(p, tmp)
            if not m: skipped.append((f, 'no product found')); continue
            aspect, box = m
            entry = {k: v for k, v in ((k, framing(aspect, box, A)) for k, A in FRAMES.items()) if v}
            if entry: result['products/' + f] = entry
    json.dump(result, open(out_json, 'w'), indent=1, sort_keys=True)
    print(len(files), 'photos;', len(result), 'given framing;', len(skipped), 'skipped', skipped[:8])

if __name__ == '__main__':
    main(*sys.argv[1:4])
