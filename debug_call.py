import sys
from compiler.rhizome import check as chk

orig = chk.check_vault
def wrapped(vault_path, staged_files=None):
    print("DEBUG staged_files=", staged_files, file=sys.stderr)
    r = orig(vault_path, staged_files=staged_files)
    print("DEBUG results_len=", len(r), file=sys.stderr)
    return r
chk.check_vault = wrapped

rc = chk.main(['D:/knowledge', '--staged-files-from', 'C:/Users/Administrator/AppData/Local/Temp/manual-manifest.txt'])
print("RC=", rc, file=sys.stderr)
