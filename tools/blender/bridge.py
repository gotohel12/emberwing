# ARVEX Blender bridge: runs the .py files dropped in bridge/inbox (one per tick) and writes their output to bridge/done/<name>.log
import bpy, os, io, traceback, contextlib, time
ROOT = r"C:\Users\mohse\Desktop\Mohsen ~ Danial Games\EMBERWING\arvex_blender\bridge"
INBOX, DONE = os.path.join(ROOT, 'inbox'), os.path.join(ROOT, 'done')
def _arvex_tick():
    try:
        for f in sorted(os.listdir(INBOX)):
            if not f.endswith('.py'): continue
            log = os.path.join(DONE, f[:-3] + '.log')
            if os.path.exists(log): continue
            open(log, 'w').write('RUNNING\n')
            buf = io.StringIO(); ok = True; t = time.time()
            try:
                with contextlib.redirect_stdout(buf):
                    exec(compile(open(os.path.join(INBOX, f), encoding='utf-8').read(), f, 'exec'), {'__name__': '__main__', 'bpy': bpy, 'ROOT': ROOT})
            except Exception:
                ok = False; buf.write('\n' + traceback.format_exc())
            open(log, 'w', encoding='utf-8').write(('OK' if ok else 'ERROR') + ' %.1fs\n' % (time.time() - t) + buf.getvalue())
            break
    except Exception:
        pass
    return 1.0
if not bpy.app.timers.is_registered(_arvex_tick): bpy.app.timers.register(_arvex_tick, persistent=True)
open(os.path.join(ROOT, 'alive.txt'), 'w').write(bpy.app.version_string + ' ' + time.ctime())
