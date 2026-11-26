"""A fotószerkesztő jelszavának cseréje: python3 tools/jelszo.py "uj-jelszo"
Az app.js-be csak a jelszó SHA-256 lenyomata kerül, maga a jelszó nem."""
import hashlib, os, re, sys
if len(sys.argv) != 2 or not sys.argv[1]:
    sys.exit('Használat: python3 tools/jelszo.py "uj-jelszo"')
h = hashlib.sha256(sys.argv[1].encode('utf-8')).hexdigest()
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app.js')
s = open(p, encoding='utf-8').read()
s, n = re.subn(r"const EDITOR_HASH = '[0-9a-f]+';", f"const EDITOR_HASH = '{h}';", s)
if n != 1:
    sys.exit('Nem találom az EDITOR_HASH sort az app.js-ben.')
open(p, 'w', encoding='utf-8').write(s)
print('Jelszó lecserélve. Futtasd le a tools/stamp.py-t is, mielőtt feltöltöd.')
