"""Read back Printify and live storefront prices; produce a size-column report."""
import csv
import html
import json
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlparse

import requests

from printify_shirt_pricing import OUT, PRICES, expected, size_map, signature


def storefront(p, catalog):
    ext = p.get('external') or {}
    if not ext.get('id'):
        return p['id'], {'status': 'Unlinked; left unpublished as requested'}
    d = catalog[str(ext['id'])]
    url = f'https://www.shopmanyworlds.com/products/{d["handle"]}'
    assert str(d['id']) == str(ext['id']), f'Product ID mismatch: {p["title"]}'
    size_key = 'option' + str(next(o['position'] for o in d['options'] if o['name'].lower() == 'size'))
    bad = [v['id'] for v in d['variants']
           if v[size_key] not in PRICES or int(Decimal(v['price']) * 100) != PRICES[v[size_key]]]
    enabled = [v for v in p['variants'] if v['is_enabled']]
    assert {v[size_key] for v in d['variants']} == set(PRICES), f'Missing sizes: {p["title"]}'
    return p['id'], {'status': 'Verified on Shopify' if not bad else 'Shopify price mismatch',
                      'bad_variant_ids': bad, 'product': d, 'url': url,
                      'printify_enabled_variants': len(enabled),
                      'shopify_variants': len(d['variants'])}


def main():
    products = [p for p in json.loads((OUT / 'printify-after.json').read_text()) if p['blueprint_id'] == 36]
    checks = {}
    catalog = {}
    page_num = 1
    while True:
        r = requests.get('https://www.shopmanyworlds.com/products.json',
                         params={'limit': 250, 'page': page_num}, timeout=90,
                         headers={'User-Agent': 'ManyWorldsPricingVerification/1.0'})
        r.raise_for_status()
        batch = r.json()['products']
        catalog.update({str(p['id']): p for p in batch})
        if len(batch) < 250:
            break
        page_num += 1
    (OUT / 'shopify-public-catalog.json').write_text(json.dumps({'products': list(catalog.values())}), encoding='utf-8')
    for p in products:
        try:
            pid, result = storefront(p, catalog)
            checks[pid] = result
        except Exception as e:
            checks[p['id']] = {'status': 'Verification failed', 'error': str(e)}
    (OUT / 'shopify-storefront-after.json').write_text(json.dumps(checks), encoding='utf-8')
    fields = ['Style', *PRICES, 'Status', 'Printify pricing', 'Shopify listing']
    rows = []
    before = {p['id']: p for p in json.loads((OUT / 'printify-before.json').read_text())}
    for p in sorted(products, key=lambda p: p['title'].lower()):
        assert all(v['price'] == expected(p, v) for v in p['variants']), p['title']
        assert signature(p) == signature(before[p['id']]), f'Printify variant configuration changed: {p["title"]}'
        prices = {}
        for size in PRICES:
            vals = {v['price'] for v in p['variants'] if v['is_enabled']
                    and any(size_map(p).get(o) == size for o in v['options'])}
            prices[size] = ', '.join(f'${v / 100:.2f}' for v in sorted(vals)) or 'Unavailable'
        status = checks[p['id']]['status']
        if p['is_locked']:
            status = 'Still publishing; ' + status
        rows.append({'Style': p['title'], **prices, 'Status': status,
                     'Printify pricing': 'https://printify.com/app/product-details/' + p['id'],
                     'Shopify listing': (p.get('external') or {}).get('handle', '')})
    with (OUT / 'verified-shirt-prices.csv').open('w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    heading = '<tr>' + ''.join(f'<th>{html.escape(f)}</th>' for f in fields) + '</tr>'
    body = ''
    for row in rows:
        body += '<tr>' + ''.join('<td>' + (f'<a href="{html.escape(row[f], quote=True)}">Open</a>'
                     if f in ['Printify pricing', 'Shopify listing'] and row[f]
                     else html.escape(row[f])) + '</td>' for f in fields) + '</tr>'
    page = '''<!doctype html><html lang="en"><meta charset="utf-8"><title>Many Worlds shirt pricing</title>
<style>body{font:15px system-ui;margin:30px;color:#172334;background:#f6f8fb}h1{margin-bottom:8px}table{border-collapse:collapse;background:white;width:100%}th,td{padding:10px 12px;border-bottom:1px solid #dce2ea;text-align:left}th{background:#243a54;color:white;position:sticky;top:0}tr:hover{background:#eef5ff}td:first-child{min-width:290px}a{color:#135bb4}input{font:inherit;padding:10px;margin:14px 0;width:380px}</style>
<h1>Many Worlds — shirt prices</h1><p>USD retail prices, October 20, 2026. Each cell covers all enabled colors in that size. Check each row's verification status. The unlinked legacy shirt was left unpublished as requested.</p>
<input id="filter" placeholder="Filter styles or artists" oninput="document.querySelectorAll('tbody tr').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(this.value.toLowerCase()))">
<table><thead>''' + heading + '</thead><tbody>' + body + '</tbody></table></html>'
    (OUT / 'verified-shirt-prices.html').write_text(page, encoding='utf-8')
    summary = {status: sum(x['status'] == status for x in checks.values()) for status in {x['status'] for x in checks.values()}}
    summary['checked_at_utc'] = datetime.now(timezone.utc).isoformat()
    summary['printify_shirts'] = len(products)
    summary['locked_products'] = sum(p['is_locked'] for p in products)
    linked = {str(p['external']['id']) for p in products if (p.get('external') or {}).get('id')}
    summary['linked_unique_shopify_products'] = len(linked)
    summary['linked_shopify_variants'] = sum(len(catalog[i]['variants']) for i in linked if i in catalog)
    (OUT / 'verification-summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    print(json.dumps(summary), flush=True)


if __name__ == '__main__':
    main()
