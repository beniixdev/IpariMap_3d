"""Verziószám frissítése feltöltés előtt: python3 tools/stamp.py
A fájlok tartalmából számolt rövid azonosítót beírja az index.html-be és a version.json-ba,
így a böngészők a GitHub Pages gyorsítótára helyett biztosan az új fájlokat töltik le."""
import hashlib, json, os, re
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
h = hashlib.sha1()
for f in ['app.js', 'style.css', 'data/building.json']:
    h.update(open(os.path.join(ROOT, f), 'rb').read())
v = h.hexdigest()[:10]
p = os.path.join(ROOT, 'index.html')
s = open(p, encoding='utf-8').read()
s = re.sub(r'data-version="[^"]*"', f'data-version="{v}"', s)
s = re.sub(r'(style\.css|app\.js)\?v=[^"]*"', lambda m: f'{m.group(1)}?v={v}"', s)
open(p, 'w', encoding='utf-8').write(s)
json.dump({'v': v}, open(os.path.join(ROOT, 'version.json'), 'w'))
print('verzió:', v)
