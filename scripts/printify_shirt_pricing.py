"""Apply the owner's October 2026 shirt prices and republish linked shirts.

Reads PRINTIFY_API_TOKEN locally; never writes credentials to audit artifacts.
Run --apply to mutate. A durable journal makes interrupted runs resumable.
"""
import argparse
import csv
import json
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data' / 'pricing-audit'
PRICES = {'S': 1800, 'M': 1800, 'L': 1800, 'XL': 1800,
          '2XL': 2000, '3XL': 2100, '4XL': 2300, '5XL': 2300}
SHOP = 29215082


def save(path, data):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(data, indent=2), encoding='utf-8')
    for attempt in range(10):
        try:
            temp.replace(path)
            return
        except PermissionError:
            if attempt == 9:
                raise
            time.sleep(0.25)


def session():
    token = next(line.split('=', 1)[1].strip().strip('\"\'')
                 for line in (ROOT / '.env').read_text().splitlines()
                 if line.startswith('PRINTIFY_API_TOKEN='))
    s = requests.Session()
    s.headers.update({'Authorization': 'Bearer ' + token,
                      'User-Agent': 'ManyWorldsShirtPricing/1.0',
                      'Connection': 'close'})
    return s


def api(s, method, path, **kwargs):
    for attempt in range(8):
        r = s.request(method, f'https://api.printify.com/v1/shops/{SHOP}/' + path,
                      timeout=90, **kwargs)
        if r.status_code != 429:
            break
        delay = max(30, int(r.headers.get('Retry-After', '60')))
        print(f'Printify rate limit: waiting {delay}s before retrying {path}', flush=True)
        while delay > 0:
            time.sleep(min(delay, 30))
            delay -= min(delay, 30)
    if not r.ok:
        raise RuntimeError(f'{method} {path}: HTTP {r.status_code}: {r.text[:500]}')
    return r.json() if r.content else {}


def size_map(p):
    return {v['id']: v['title'] for o in p['options'] if o['type'] == 'size'
            for v in o['values']}


def expected(p, v):
    names = [size_map(p)[i] for i in v['options'] if i in size_map(p)]
    if len(names) != 1 or names[0] not in PRICES:
        raise ValueError(f'Unexpected size in {p["title"]}: {v["title"]}')
    return PRICES[names[0]]


def signature(p):
    return [(v['id'], v['sku'], v['is_enabled'], v['is_default'])
            for v in p['variants']]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    s = session()
    before = json.loads((OUT / 'printify-before.json').read_text())
    shirts = [p for p in before if p['blueprint_id'] == 36]
    assert len(shirts) == 145
    journal_path = OUT / 'printify-price-journal.json'
    journal = json.loads(journal_path.read_text()) if journal_path.exists() else {}
    current = {}
    if not args.apply:
        page = 1
        while True:
            response = api(s, 'GET', 'products.json', params={'limit': 50, 'page': page})
            current.update({p['id']: p for p in response['data']})
            if not response.get('next_page_url'):
                break
            page += 1
        save(OUT / 'printify-after.json', list(current.values()))
    for i, original in enumerate(shirts, 1):
        pid = original['id']
        entry = journal.setdefault(pid, {'title': original['title']})
        if args.apply and entry.get('publish_requested'):
            continue
        p = api(s, 'GET', f'products/{pid}.json') if args.apply else current[pid]
        bad = [v for v in p['variants'] if v['price'] != expected(p, v)]
        if args.apply:
            if p['is_locked']:
                raise RuntimeError(f'Product locked: {p["title"]}; wait for existing publish')
            if bad:
                payload = {'variants': [dict(id=v['id'], price=expected(p, v),
                                            is_enabled=v['is_enabled'],
                                            is_default=v['is_default'], sku=v['sku'])
                                        for v in p['variants']]}
                api(s, 'PUT', f'products/{pid}.json', json=payload)
                p2 = api(s, 'GET', f'products/{pid}.json')
                assert signature(p2) == signature(p), 'Variant configuration changed'
                assert all(v['price'] == expected(p2, v) for v in p2['variants'])
                entry['variants_corrected'] = len(bad)
            entry['printify_verified'] = True
            save(journal_path, journal)
            if not (p.get('external') or {}).get('id'):
                entry['publish_skipped'] = 'No linked Shopify product ID; inspect before creating a duplicate'
                save(journal_path, journal)
                print(f'{i}/{len(shirts)} {original["title"]}: prices verified; missing Shopify link', flush=True)
                continue
            api(s, 'POST', f'products/{pid}/publish.json', json={
                'title': False, 'description': False, 'images': False,
                'variants': True, 'tags': False, 'keyFeatures': False,
                'shipping_template': False})
            entry['publish_requested'] = True
            entry['publish_requested_at'] = time.time()
        else:
            entry['printify_verified'] = not bad
            entry['is_locked'] = p['is_locked']
            entry['external_id'] = p['external']['id']
            entry['enabled_variants'] = sum(v['is_enabled'] for v in p['variants'])
            entry['prices_by_size'] = {
                size: sorted({v['price'] for v in p['variants'] if v['is_enabled']
                              and any(size_map(p).get(o) == size for o in v['options'])})
                for size in PRICES}
            assert signature(p) == signature(original), 'Variant configuration differs from backup'
        save(journal_path, journal)
        print(f'{i}/{len(shirts)} {original["title"]}: ' +
              ('publish requested' if args.apply else f'prices valid={not bad}, publishing={p["is_locked"]}'), flush=True)
    print('Completed pass.', flush=True)


if __name__ == '__main__':
    main()
