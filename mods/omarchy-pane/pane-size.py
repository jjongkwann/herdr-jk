"""Keeps a tab's pane sizes across the Chat/Terminal swap (the core document's layout).

  pane-size.py get <pane> [--machine M]
      prints the sizes of the pane and its siblings as JSON ({pane id: size}), or null
  pane-size.py carry <old> <new> <sizes> [--machine M]
      once <old> has left the layout and <new> is in it (the swap went through), puts the
      sizes back: <new> takes <old>'s, the siblings their own

The swap splits a new pane beside the old one (the split halves the old pane's share) and then
removes the old pane (its share goes to a neighbor), so without this the row's widths shift.
Same protocol as equal-width.
"""
import argparse
import json
import selectors
import subprocess
import time


def find(node, pane, parent=None):
    if node.get('id') == pane:
        return node, parent
    for child in node.get('children') or []:
        hit = find(child, pane, node)
        if hit[0]:
            return hit
    return None, None


def locate(value, pane):
    for space in value['spaces']:
        for tab in space['tabs']:
            node, parent = find(tab['root'], pane)
            if node:
                return node, parent
    return None, None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['get', 'carry'])
    parser.add_argument('pane')
    parser.add_argument('rest', nargs='*')
    parser.add_argument('--machine')
    args = parser.parse_args()

    def local(pane):
        prefix = (args.machine or '') + '/'
        return pane[len(prefix):] if args.machine and pane.startswith(prefix) else pane

    pane = local(args.pane)
    params = {'name': 'herdr-app'}
    if args.machine:
        params['on'] = args.machine
    process = subprocess.Popen(['hc', 'connect'], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    ids = iter(range(1, 100000))

    def rpc(method, values):
        identifier = next(ids)
        process.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': identifier,
                                       'method': method, 'params': values}) + '\n')
        process.stdin.flush()
        if not selector.select(8):
            raise TimeoutError('Core did not respond')
        response = json.loads(process.stdout.readline())
        if response.get('id') != identifier:
            raise ValueError('Unexpected core response')
        if 'error' in response:
            raise ValueError(response['error'].get('message', 'Core request failed'))
        return response['result']

    try:
        if args.mode == 'get':
            node, parent = locate(rpc('doc.get', params)['value'], pane)
            siblings = parent['children'] if parent else [node] if node else []
            print(json.dumps({c['id']: c['size'] for c in siblings if 'size' in c} or None))
            return
        new, sizes = local(args.rest[0]), json.loads(args.rest[1])
        # The app edits the document too: wait (up to 15 s) for the swap to finish, and try a
        # write that lost the race again.
        deadline = time.time() + 15
        while True:
            snapshot = rpc('doc.get', params)
            value = snapshot['value']
            if locate(value, pane)[0] or not locate(value, new)[0]:
                if time.time() > deadline:
                    raise ValueError('The swap did not finish')
                time.sleep(0.25)
                continue
            changed = False
            for pid, size in sizes.items():
                node = locate(value, new if pid == pane else pid)[0]
                if node and node.get('size') != size:
                    node['size'] = size
                    changed = True
            if not changed:
                return
            try:
                rpc('doc.set', {**params, 'version': snapshot['version'], 'value': value})
                return
            except ValueError:
                if time.time() > deadline:
                    raise
                time.sleep(0.1)
    finally:
        selector.close()
        process.stdin.close()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=2)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        raise SystemExit(str(error))
