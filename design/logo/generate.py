#!/usr/bin/env python3
"""Render every SoundCheck icon from mark.svg (the "Sound Hub" logo).

  python3 design/logo/generate.py      (needs Node + the repo's Playwright Chromium via render.mjs, and Pillow)

Writes the website icons, Android phone/TV launcher icons and banner, the Expo TV app's images, and the iOS and
tvOS asset catalogs. Re-run after changing mark.svg.
"""
import json, os, re, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
RENDER = Path(os.environ.get('RENDER_JS', HERE / 'render.mjs'))
MARK = (HERE / 'mark.svg').read_text()
INNER = re.sub(r'^<svg[^>]*>|</svg>\s*$', '', MARK.strip(), flags=re.S)
BG = '''<defs><radialGradient id="bgg" cx="0.35" cy="0.25" r="0.95"><stop offset="0" stop-color="#1f2a44"/>
<stop offset="1" stop-color="#090b14"/></radialGradient></defs>'''

def mark_at(x, y, size):
    return f'<svg x="{x}" y="{y}" width="{size}" height="{size}" viewBox="0 0 512 512">{INNER}</svg>'

def square(size, pad=0.15, radius=0.0):
    r = size * radius
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}">{BG}'
            f'<rect width="{size}" height="{size}" rx="{r}" fill="url(#bgg)"/>{mark_at(size*pad, size*pad, size*(1-2*pad))}</svg>')

def wide(w, h, wordmark=True):
    m = h * 0.62
    if not wordmark:
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">{BG}<rect width="{w}" height="{h}" fill="url(#bgg)"/>'
                f'{mark_at((w-m)/2, (h-m)/2, m)}</svg>')
    # mark + wordmark, scaled to fit within 86% of the width; the text is fixed to an exact length so it never overflows
    m, fs = h * 0.56, h * 0.2
    k = min(1.0, 0.86 * w / (m + h * 0.07 + fs * 5.9))
    m, fs, gap = m * k, fs * k, h * 0.07 * k
    tw = fs * 5.9
    x0 = (w - (m + gap + tw)) / 2
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">{BG}<rect width="{w}" height="{h}" fill="url(#bgg)"/>'
            f'{mark_at(x0, (h-m)/2, m)}'
            f'<text x="{x0 + m + gap}" y="{h/2 + fs*0.36}" textLength="{tw}" lengthAdjust="spacingAndGlyphs" '
            f'font-family="Sora, Inter, Helvetica Neue, Arial, sans-serif" font-weight="800" font-size="{fs}" fill="#eef3ff">'
            f'Sound<tspan fill="#8fb0ec">Check</tspan></text></svg>')

def png(svg, out, w, h, alpha=False):
    out = Path(out); out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('w', suffix='.svg', delete=False) as f:
        f.write(svg)
    subprocess.run(['node', str(RENDER), f.name, str(out), str(w), str(h)] + ([] if alpha else ['#090b14']), check=True)
    os.unlink(f.name)
    if not alpha:   # app stores reject icons with an alpha channel
        Image.open(out).convert('RGB').save(out)
    print('wrote', out.relative_to(ROOT))

def main():
    if not RENDER.exists():
        sys.exit('set RENDER_JS to the render.mjs helper')
    web = ROOT / 'apps/web'
    # website: favicon/manifest SVG (rounded), mark for the header, PNGs for iOS home screen and Android installs
    icon_svg = square(512, pad=0.1, radius=0.22)
    for p in [web / 'src/app/icon.svg', web / 'public/icon.svg']:
        p.write_text(icon_svg + '\n'); print('wrote', p.relative_to(ROOT))
    (web / 'public/logo-mark.svg').write_text(MARK)
    png(square(180, pad=0.1), web / 'src/app/apple-icon.png', 180, 180)
    png(square(192, pad=0.1), web / 'public/icon-192.png', 192, 192)
    png(square(512, pad=0.1), web / 'public/icon-512.png', 512, 512)
    png(square(512, pad=0.2), web / 'public/icon-maskable-512.png', 512, 512)
    # favicon: rounded tile with transparent corners (Next.js needs RGBA images inside the .ico)
    png(square(64, pad=0.04, radius=0.22).replace('<svg ', '<svg ', 1), HERE / '_fav64.png', 64, 64, alpha=True)
    Image.open(HERE / '_fav64.png').convert('RGBA').save(web / 'src/app/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    os.unlink(HERE / '_fav64.png')
    # Android phone + Android/Fire TV: launcher icon at every density, TV banner (320×180 dp at xhdpi)
    for app in ['mobile', 'tv']:
        res = ROOT / f'apps/android/{app}/src/main/res'
        for d, s in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
            png(square(s, pad=0.1, radius=0.0), res / f'mipmap-{d}/ic_soundcheck.png', s, s)
    png(wide(640, 360), ROOT / 'apps/android/tv/src/main/res/drawable-xhdpi/banner.png', 640, 360)
    # Expo TV app images (same names, new art)
    for f in (ROOT / 'apps/tv/assets/images').glob('icon-*x*.png'):
        w, h = map(int, re.findall(r'(\d+)x(\d+)', f.name)[0])
        png(square(w, pad=0.12) if w == h else wide(w, h, wordmark=w / h > 2), f, w, h)
    # iOS: single 1024 app icon
    ios = ROOT / 'apps/apple/SoundCheckMobile/Assets.xcassets'
    png(square(1024, pad=0.12), ios / 'AppIcon.appiconset/icon-1024.png', 1024, 1024)
    (ios / 'AppIcon.appiconset/Contents.json').write_text(json.dumps({'images': [{'filename': 'icon-1024.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'}], 'info': {'author': 'xcode', 'version': 1}}, indent=2))
    (ios / 'Contents.json').write_text(json.dumps({'info': {'author': 'xcode', 'version': 1}}, indent=2))
    # tvOS: layered app icon (background + mark, for the parallax effect) and top shelf images
    tv = ROOT / 'apps/apple/SoundCheckTV/Assets.xcassets'
    brand = tv / 'App Icon & Top Shelf Image.brandassets'
    info = {'author': 'xcode', 'version': 1}
    tv.mkdir(parents=True, exist_ok=True)
    (tv / 'Contents.json').write_text(json.dumps({'info': info}, indent=2))
    def stack(name, w, h, scales):
        st = brand / f'{name}.imagestack'
        layers = [('Front', 'front'), ('Back', 'back')]   # top first; the last (bottom) layer must be opaque
        (st / 'Contents.json').parent.mkdir(parents=True, exist_ok=True)
        (st / 'Contents.json').write_text(json.dumps({'info': info, 'layers': [{'filename': f'{n}.imagestacklayer'} for n, _ in layers]}, indent=2))
        for n, kind in layers:
            ls = st / f'{n}.imagestacklayer'
            ls.mkdir(parents=True, exist_ok=True)
            (ls / 'Contents.json').write_text(json.dumps({'info': info}, indent=2))
            imgs = []
            for sc in scales:
                W, H = w * sc, h * sc
                fn = f'{kind}@{sc}x.png'
                if kind == 'back':
                    png(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">{BG}<rect width="{W}" height="{H}" fill="url(#bgg)"/></svg>', ls / 'Content.imageset' / fn, W, H)
                else:
                    m = H * 0.7
                    png(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">{mark_at((W-m)/2, (H-m)/2, m)}</svg>', ls / 'Content.imageset' / fn, W, H, alpha=True)
                imgs.append({'filename': fn, 'idiom': 'tv', 'scale': f'{sc}x'})
            (ls / 'Content.imageset/Contents.json').write_text(json.dumps({'images': imgs, 'info': info}, indent=2))
    stack('App Icon - Small', 400, 240, [1, 2])
    stack('App Icon - Large', 1280, 768, [1])
    def shelf(name, w, h):
        d = brand / f'{name}.imageset'
        imgs = []
        for sc in [1, 2]:
            fn = f'shelf@{sc}x.png'
            png(wide(w * sc, h * sc), d / fn, w * sc, h * sc)
            imgs.append({'filename': fn, 'idiom': 'tv', 'scale': f'{sc}x'})
        (d / 'Contents.json').write_text(json.dumps({'images': imgs, 'info': info}, indent=2))
    shelf('Top Shelf Image', 1920, 720)
    shelf('Top Shelf Image Wide', 2320, 720)
    (brand / 'Contents.json').write_text(json.dumps({'assets': [
        {'filename': 'App Icon - Large.imagestack', 'idiom': 'tv', 'role': 'primary-app-icon', 'size': '1280x768'},
        {'filename': 'App Icon - Small.imagestack', 'idiom': 'tv', 'role': 'primary-app-icon', 'size': '400x240'},
        {'filename': 'Top Shelf Image Wide.imageset', 'idiom': 'tv', 'role': 'top-shelf-image-wide', 'size': '2320x720'},
        {'filename': 'Top Shelf Image.imageset', 'idiom': 'tv', 'role': 'top-shelf-image', 'size': '1920x720'},
    ], 'info': info}, indent=2))

if __name__ == '__main__':
    main()
