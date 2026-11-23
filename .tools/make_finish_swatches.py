"""Draw the finish swatches for brassware (taps, valves, showering, accessories)
and the gloss white furniture swatch. Pure Python, no image libraries.

    python3 .tools/make_finish_swatches.py   -> .tools/swatches/*.png

They are drawn, not photographed: a brushed finish is fine streaks running one
way with a soft band of light across it; chrome is a mirror, so it is bands of
reflected light and dark. Replace any of them with a photograph of a real
sample whenever one is available — the admin's Colours section takes uploads.
"""
import math, os, random, struct, zlib

N = 400
OUT = os.path.join(os.path.dirname(__file__), 'swatches')

def png(path, px):
    raw = b''.join(b'\x00' + bytes(v for p in row for v in p) for row in px)
    def chunk(t, c): return struct.pack('>I', len(c)) + t + c + struct.pack('>I', zlib.crc32(t + c) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', N, N, 8, 2, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

clamp = lambda v: 0 if v < 0 else 255 if v > 255 else int(v)

def smooth_noise(n, span, rnd):
    """1-D noise with features about `span` long, roughly -1..1."""
    pts = [rnd.uniform(-1, 1) for _ in range(n // span + 3)]
    out = []
    for i in range(n):
        t = i / span; k = int(t); f = t - k
        f = f * f * (3 - 2 * f)
        out.append(pts[k] * (1 - f) + pts[k + 1] * f)
    return out

def brushed(base, seed, streak=10.0, sheen=26.0, grain=3.0):
    rnd = random.Random(seed)
    # per row: a long horizontal streak pattern, different on every line
    rows = []
    for y in range(N):
        a = smooth_noise(N, rnd.choice((18, 30, 46, 70)), rnd)
        b = smooth_noise(N, 6, rnd)
        lift = rnd.gauss(0, 0.55)
        rows.append([(0.7 * a[x] + 0.3 * b[x] + lift) for x in range(N)])
    px = []
    for y in range(N):
        line = []
        for x in range(N):
            # a broad soft highlight running diagonally, as light falls on a brushed plate
            d = (x * 0.55 + y) / N
            band = math.exp(-((d - 0.62) ** 2) / 0.045) - 0.35 * math.exp(-((d - 0.15) ** 2) / 0.03)
            v = streak * rows[y][x] + sheen * band + rnd.gauss(0, grain)
            line.append(tuple(clamp(c + v * (0.85 + 0.15 * (c / 255))) for c in base))
        px.append(line)
    return px

def chrome(seed):
    rnd = random.Random(seed)
    # luminance across the plate: bright window reflections, a dark horizon band, cool sky
    stops = [(0.00, 120), (0.10, 205), (0.18, 246), (0.24, 214), (0.40, 150), (0.47, 92),
             (0.55, 128), (0.68, 222), (0.74, 252), (0.80, 210), (0.92, 140), (1.00, 168)]
    def lum(t):
        for (a, la), (b, lb) in zip(stops, stops[1:]):
            if a <= t <= b:
                f = (t - a) / (b - a); f = f * f * (3 - 2 * f)
                return la + (lb - la) * f
        return stops[-1][1]
    px = []
    for y in range(N):
        line = []
        for x in range(N):
            t = (x + 0.22 * y) / (N * 1.22)
            l = lum(t) + rnd.gauss(0, 0.8)
            # chrome reflects a cool, slightly blue world
            line.append((clamp(l * 0.96), clamp(l * 0.985), clamp(l * 1.02 + 4)))
        px.append(line)
    return px

def matt(base, seed, grain=4.5, fall=10.0):
    rnd = random.Random(seed)
    px = []
    for y in range(N):
        line = []
        for x in range(N):
            v = fall * (0.5 - (x + y) / (2 * N)) + rnd.gauss(0, grain)
            line.append(tuple(clamp(c + v) for c in base))
        px.append(line)
    return px

def gloss(base, seed):
    rnd = random.Random(seed)
    px = []
    for y in range(N):
        line = []
        for x in range(N):
            d = (x + y) / (2 * N)
            v = 10 * math.exp(-((d - 0.3) ** 2) / 0.02) - 9 * d + rnd.gauss(0, 0.6)
            line.append(tuple(clamp(c + v) for c in base))
        px.append(line)
    return px

os.makedirs(OUT, exist_ok=True)
SWATCHES = {
    'metal-chrome.png': chrome(1),
    'metal-brushed-black.png': brushed((52, 51, 50), 2, streak=7, sheen=20, grain=2.2),
    'metal-brushed-gold.png': brushed((190, 154, 96), 3, streak=9, sheen=30),
    'metal-brushed-stainless.png': brushed((172, 172, 168), 4, streak=10, sheen=28),
    'metal-matt-black.png': matt((40, 40, 40), 5, grain=3.2, fall=8),
    'metal-matt-white.png': matt((236, 235, 231), 6, grain=2.4, fall=7),
    'gloss-white.png': gloss((246, 246, 244), 7),
}
for name, px in SWATCHES.items():
    png(os.path.join(OUT, name), px)
    print('wrote', name)
