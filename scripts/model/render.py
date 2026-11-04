"""
Draw each skeleton of a Forma dataset as page images (2026-11-03, milestone 6
of docs/proposals/own-model.md).

    python scripts/model/render.py <dataset-dir> [--variants 4] [--seed 1] [--limit N] [--boxes]

--boxes (2026-11-04) writes the boxes design instead: each row's `prompt`
holds the text boxes drawn on the page, numbered, and its `target` the
bands and each box's band and role (see box_example); `truth` keeps the
skeleton text, for scoring on the page.

Reads <dataset-dir>/examples.jsonl, written by `npm run model:dataset`, and
writes into the same folder one PNG per skeleton per variant (r12-0.png,
r12-1.png ...) and train.jsonl and eval.jsonl, one line per image:
{"image", "id", "category", "target"}. The images sit flat beside the JSON
files because `kaggle datasets create` skips subfolders by default.

Every word drawn is a placeholder chosen here. A skeleton holds no text, so
no report's words can reach an image. A variant changes three things: the
placeholder words, how many records the Detail band repeats for, and a little
print noise. That way the model learns that a page of twenty rows is one
Detail band, which is what a picture of a real report shows it.

The scale is one pixel per hundredth of an inch (100 dpi), the unit a
skeleton is written in. Fonts are the Liberation faces in assets/pdf-fonts,
which are metric-compatible with Arial, Times New Roman and Courier New.
Needs Python 3 and Pillow.

This file is pure ASCII on purpose. Windows PowerShell 5.1 reads a script
without a BOM in the ANSI codepage (see CLAUDE.md), and an ASCII file reads
the same either way.
"""

import argparse
import json
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_DIR = os.path.normpath(os.path.join(HERE, '..', '..', 'assets', 'pdf-fonts'))

ORDER = ['TopMargin', 'ReportHeader', 'PageHeader', 'GroupHeader', 'Detail', 'DetailReport',
         'GroupFooter', 'ReportFooter', 'PageFooter', 'BottomMargin', 'Unknown']

TITLES = {
    'document': ['Delivery Note', 'Purchase Order', 'Quotation', 'Job Card'],
    'label': ['Shipping Label', 'Item Label', 'Carton Label'],
    'payroll': ['Payroll Register', 'Salary Slip', 'Pay Summary', 'Leave Statement'],
    'stock': ['Stock Register', 'Inventory List', 'Stock Movement', 'Goods Received'],
    'sales': ['Sales Report', 'Sales Invoice', 'Sales Summary', 'Customer Orders'],
    'accounts': ['General Ledger', 'Trial Balance', 'Account Statement', 'Payment Voucher'],
    'manufacturing': ['Production Report', 'Work Order', 'Bill of Materials'],
    'cheque': ['Cheque', 'Payment Advice'],
    'catalogue': ['Product Catalogue', 'Price List'],
    None: ['Report', 'Summary Report', 'Listing', 'Monthly Report', 'Statement'],
}

CAPTIONS = ['No.', 'Date', 'Code', 'Name', 'Description', 'Qty', 'Quantity', 'Rate', 'Price', 'Amount', 'Total',
            'Unit', 'Item', 'Item Code', 'Department', 'Customer', 'Supplier', 'Address', 'Balance', 'Debit',
            'Credit', 'Reference', 'Remarks', 'Status', 'Location', 'Warehouse', 'Account', 'Period', 'Tax',
            'Discount', 'Net Amount', 'Gross', 'Employee', 'Designation', 'Basic', 'Allowance', 'Deduction',
            'Net Pay', 'Opening', 'Closing', 'Received', 'Issued', 'Order No.', 'Invoice No.', 'Due Date',
            'Phone', 'Email', 'Prepared by', 'Approved by', 'Signature', 'Page', 'Printed on', 'Category',
            'Batch', 'Expiry', 'Weight', 'Size', 'Colour', 'Currency', 'Exchange Rate', 'VAT', 'Subtotal']

SYLLABLES = ['ka', 'ro', 'mi', 'ten', 'sa', 'lo', 'ver', 'dan', 'el', 'mar', 'tis', 'bo', 'ran', 'ne', 'pol',
             'ash', 'ri', 'gan', 'tor', 'li', 'su', 'ben', 'ca', 'del', 'fo', 'ha', 'jun', 'ko', 'nu', 'zi']

_fonts = {}


def font_file(family, bold, italic):
    f = (family or 'Arial').lower()
    if 'courier' in f or 'mono' in f or 'consolas' in f or 'console' in f:
        base = 'LiberationMono'
    elif ('times' in f or 'serif' in f and 'sans' not in f or 'georgia' in f or 'garamond' in f
          or 'book' in f or 'palatino' in f or 'cambria' in f or 'constantia' in f):
        base = 'LiberationSerif'
    else:
        base = 'LiberationSans'
    bold = bold or 'bold' in f or 'black' in f
    style = 'BoldItalic' if bold and italic else 'Bold' if bold else 'Italic' if italic else 'Regular'
    return os.path.join(FONT_DIR, '%s-%s.ttf' % (base, style))


def font_for(f, fallback_pt=9.0):
    family = f['family'] if f else 'Arial'
    size_pt = f['size'] if f else fallback_pt
    bold = bool(f and f['bold'])
    italic = bool(f and f['italic'])
    px = max(4, int(round(size_pt * 100.0 / 72.0)))
    key = (font_file(family, bold, italic), px)
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(key[0], px)
    return _fonts[key]


def word(rng):
    w = ''.join(rng.choice(SYLLABLES) for _ in range(rng.randint(2, 3)))
    return w.capitalize()


def caption_text(rng, chars):
    if chars <= 0:
        return ''
    text = rng.choice(CAPTIONS)
    while len(text) < chars - 4:
        text += ' ' + rng.choice(CAPTIONS).lower()
    return text[:max(chars, 1)]


def value_kind(rng, align, role):
    """What a column holds, chosen once per column so that it reads like a real one."""
    if role == 'total':
        return 'money'
    r = rng.random()
    if align == 'right':
        return 'money' if r < 0.6 else 'count' if r < 0.85 else 'big'
    if align == 'center':
        return 'date' if r < 0.5 else 'ref'
    return 'name' if r < 0.45 else 'code' if r < 0.7 else 'word' if r < 0.85 else 'date'


def value_text(rng, kind):
    if kind == 'money':
        return '{:,.2f}'.format(rng.uniform(1, 999999))
    if kind == 'count':
        return str(rng.randint(1, 999))
    if kind == 'big':
        return '{:,}'.format(rng.randint(1000, 999999))
    if kind == 'date':
        return '%02d/%02d/20%02d' % (rng.randint(1, 28), rng.randint(1, 12), rng.randint(18, 26))
    if kind == 'ref':
        return '%s-%04d' % (rng.choice(['INV', 'PO', 'GRN', 'EMP', 'ITM', 'DN']), rng.randint(1, 9999))
    if kind == 'code':
        return '%s-%04d' % (rng.choice(['A', 'B', 'C', 'K', 'M', 'S']), rng.randint(1, 9999))
    if kind == 'word':
        return word(rng)
    return '%s %s' % (word(rng), word(rng))


def page_info_text(rng, page):
    return rng.choice(['Page %d of %d' % (page, page + rng.randint(0, 4)), 'Page %d' % page,
                       'Printed on %02d/%02d/2026' % (rng.randint(1, 28), rng.randint(1, 12))])


def fit(draw, text, font, width):
    """The longest prefix of text that fits the width."""
    if not text or width <= 2:
        return ''
    while text and draw.textlength(text, font=font) > width - 2:
        text = text[:-1]
    return text.rstrip()


# Where text was drawn, for the boxes design (--boxes, 2026-11-04): each
# text's ink box, with the band, the band's appearance on the page and the
# role it was drawn for. Set by render() and the drawing functions, read by
# main(); recording draws nothing from the random generator, so a page comes
# out the same with it or without it.
_drawn = []
_bands = []
_where = {'band': None, 'instance': 0, 'role': 'decoration'}


def put_text(draw, text, font, x, y, w, h, align):
    text = fit(draw, text, font, w)
    if not text:
        return
    tw = draw.textlength(text, font=font)
    asc, desc = font.getmetrics()
    line_h = asc + desc
    if align == 'right':
        tx = x + w - tw - 2
    elif align == 'center':
        tx = x + (w - tw) / 2.0
    else:
        tx = x + 2
    ty = y + (h - line_h) / 2.0 if h < 2 * line_h else y + 2
    draw.text((tx, ty), text, font=font, fill=0)
    x0, y0, x1, y1 = draw.textbbox((tx, ty), text, font=font)
    _drawn.append({'box': [int(round(x0)), int(round(y0)), int(round(x1 - x0)), int(round(y1 - y0))],
                   'band': _where['band'], 'instance': _where['instance'], 'role': _where['role'], 'text': text})


def put_paragraph(draw, rng, font, x, y, w, h):
    asc, desc = font.getmetrics()
    line_h = asc + desc + 1
    lines = max(1, int(h // line_h))
    for i in range(lines):
        words = ' '.join(rng.choice(CAPTIONS).lower() for _ in range(12))
        put_text(draw, words, font, x, y + i * line_h, w, line_h, 'left')


def borders(draw, x, y, w, h, mask):
    x2, y2 = x + w, y + h
    if mask & 1:
        draw.line([(x, y), (x2, y)], fill=0, width=1)
    if mask & 2:
        draw.line([(x2, y), (x2, y2)], fill=0, width=1)
    if mask & 4:
        draw.line([(x, y2), (x2, y2)], fill=0, width=1)
    if mask & 8:
        draw.line([(x, y), (x, y2)], fill=0, width=1)


def control_text(rng, role, align, chars, ctx, column):
    """
    The placeholder for one place. `column` names the place across repeated
    records. A title or caption is a control's static text, so it prints the
    same in every record and every group; only values change (until
    2026-11-04 each record drew a caption of its own, which no report does,
    and Forma's box reader could not learn that a column of one word is a
    caption).
    """
    if role in ('title', 'caption'):
        if column not in ctx['captions']:
            ctx['captions'][column] = (rng.choice(TITLES.get(ctx['category'], TITLES[None])) if role == 'title'
                                       else caption_text(rng, chars))
        return ctx['captions'][column]
    if role in ('value', 'total'):
        if column not in ctx['kinds']:
            ctx['kinds'][column] = value_kind(rng, align, role)
        return value_text(rng, ctx['kinds'][column])
    if role == 'pageInfo':
        return page_info_text(rng, ctx['page'])
    return ''


def draw_control(draw, rng, c, ox, oy, ctx):
    x, y, w, h = ox + c['x'], oy + c['y'], c['w'], c['h']
    kind = c['kind']
    _where['role'] = 'caption' if kind == 'checkbox' else c['role']
    if kind == 'table':
        rows = c.get('rows') or []
        if rows:
            rh = h / float(len(rows))
            for ri, row in enumerate(rows):
                total = sum(max(0.01, cell['weight']) for cell in row) or 1.0
                cx = x
                for ci, cell in enumerate(row):
                    cw = w * max(0.01, cell['weight']) / total
                    f = font_for(cell['font'] or c['font'])
                    _where['role'] = cell['role']
                    text = control_text(rng, cell['role'], cell['align'], cell['chars'], ctx, (id(c), ri, ci))
                    put_text(draw, text, f, cx, y + ri * rh, cw, rh, cell['align'])
                    if c['borders']:
                        draw.rectangle([cx, y + ri * rh, cx + cw, y + (ri + 1) * rh], outline=0)
                    cx += cw
        elif c['borders']:
            borders(draw, x, y, w, h, c['borders'])
        return
    if kind == 'line':
        if w >= h:
            draw.line([(x, y + h / 2.0), (x + w, y + h / 2.0)], fill=0, width=rng.choice([1, 1, 2]))
        else:
            draw.line([(x + w / 2.0, y), (x + w / 2.0, y + h)], fill=0, width=rng.choice([1, 1, 2]))
        return
    if kind == 'shape':
        if rng.random() < 0.7:
            draw.rectangle([x, y, x + w, y + h], outline=0)
        else:
            draw.ellipse([x, y, x + w, y + h], outline=0)
        return
    if kind == 'picture':
        style = rng.random()
        if style < 0.4:
            draw.rectangle([x, y, x + w, y + h], fill=210)
        elif style < 0.8:
            r = min(w, h) / 2.5
            draw.ellipse([x + w / 2.0 - r, y + h / 2.0 - r, x + w / 2.0 + r, y + h / 2.0 + r], fill=90)
            draw.rectangle([x + w * 0.1, y + h * 0.8, x + w * 0.9, y + h * 0.9], fill=140)
        borders(draw, x, y, w, h, c['borders'])
        return
    if kind == 'barcode':
        bx = x + 2
        while bx < x + w - 2:
            bw = rng.choice([1, 1, 2, 3])
            if rng.random() < 0.55:
                draw.rectangle([bx, y + 2, bx + bw - 1, y + h * 0.75], fill=0)
            bx += bw
        return
    if kind == 'chart':
        draw.line([(x + 10, y + 5), (x + 10, y + h - 10), (x + w - 5, y + h - 10)], fill=0)
        bars = rng.randint(3, 8)
        step = (w - 20) / float(bars)
        for i in range(bars):
            bh = rng.uniform(0.2, 0.9) * (h - 20)
            draw.rectangle([x + 15 + i * step, y + h - 10 - bh, x + 15 + i * step + step * 0.6, y + h - 10],
                           fill=rng.choice([60, 120, 170]))
        return
    if kind == 'checkbox':
        s = min(h - 4, 14)
        draw.rectangle([x + 2, y + (h - s) / 2.0, x + 2 + s, y + (h + s) / 2.0], outline=0)
        if rng.random() < 0.5:
            draw.line([(x + 4, y + h / 2.0), (x + 2 + s / 2.0, y + (h + s) / 2.0 - 2), (x + s, y + (h - s) / 2.0 + 2)],
                      fill=0, width=2)
        put_text(draw, control_text(rng, 'caption', 'left', c['chars'], ctx, id(c)), font_for(c['font']), x + s + 4, y, w - s - 4, h, 'left')
        return
    if kind == 'richText':
        put_paragraph(draw, rng, font_for(c['font']), x, y, w, h)
        borders(draw, x, y, w, h, c['borders'])
        return
    if kind == 'subreport':
        f = font_for(c['font'])
        asc, desc = f.getmetrics()
        step = asc + desc + 4
        for i in range(max(1, int(h // step))):
            put_text(draw, value_text(rng, 'name'), f, x, y + i * step, w * 0.6, asc + desc, 'left')
            put_text(draw, value_text(rng, 'money'), f, x + w * 0.6, y + i * step, w * 0.4, asc + desc, 'right')
        return
    if kind in ('label', 'pageInfo'):
        text = control_text(rng, c['role'], c['align'], c['chars'], ctx, id(c))
        put_text(draw, text, font_for(c['font']), x, y, w, h, c['align'])
    borders(draw, x, y, w, h, c['borders'])


def draw_band(draw, rng, band, left, top, ctx):
    instance = sum(1 for b in _bands if b['kind'] == band['kind'])
    _bands.append({'kind': band['kind'], 'instance': instance, 'top': int(round(top)), 'height': int(round(printed_height(band)))})
    _where['band'], _where['instance'] = band['kind'], instance
    for c in band['controls']:
        draw_control(draw, rng, c, left, top, ctx)


def printed_height(band):
    """As tall as its controls reach: DevExpress grows a band to hold them."""
    return max([band['height']] + [c['y'] + c['h'] for c in band['controls']])


class Cursor(object):
    """Where the next band starts down the page, and where the page footer begins."""

    def __init__(self, draw, rng, ctx, left, top, limit):
        self.draw, self.rng, self.ctx, self.left, self.y, self.limit = draw, rng, ctx, left, top, limit

    def place(self, band):
        h = printed_height(band)
        if h <= 0 or self.y + h > self.limit + 0.5:
            return False
        draw_band(self.draw, self.rng, band, self.left, self.y, self.ctx)
        self.y += h
        return True


def render(skeleton, category, rng, noise):
    del _drawn[:]
    del _bands[:]
    W, H = int(round(skeleton['width'])), int(round(skeleton['height']))
    m = skeleton['margins']
    img = Image.new('L', (max(W, 8), max(H, 8)), 255)
    draw = ImageDraw.Draw(img)
    ctx = {'category': category, 'page': rng.randint(1, 3), 'kinds': {}, 'captions': {}}
    bands = sorted(skeleton['bands'], key=lambda b: ORDER.index(b['kind']) if b['kind'] in ORDER else 99)
    by_kind = {}
    for b in bands:
        by_kind.setdefault(b['kind'], []).append(b)
    footer_h = sum(printed_height(b) for b in by_kind.get('PageFooter', []))

    for b in by_kind.get('TopMargin', []):
        draw_band(draw, rng, b, m['left'], 0, ctx)
    cur = Cursor(draw, rng, ctx, m['left'], m['top'], H - m['bottom'] - footer_h)
    place = cur.place
    for b in by_kind.get('ReportHeader', []) + by_kind.get('PageHeader', []):
        place(b)
    details = by_kind.get('Detail', []) + by_kind.get('DetailReport', [])
    heads, feet = by_kind.get('GroupHeader', []), by_kind.get('GroupFooter', [])
    groups = rng.randint(1, 3) if heads else 1
    full = False
    for _ in range(groups):
        for b in heads:
            full = full or not place(b)
        records = rng.choice([1, 2, 3, 4, 6, 8, 12, 20, 40])
        for _ in range(records):
            for b in details:
                if not place(b):
                    full = True
                    break
            if full:
                break
        for b in feet:
            full = full or not place(b)
        if full:
            break
    for b in by_kind.get('ReportFooter', []) + by_kind.get('Unknown', []):
        place(b)
    fy = H - m['bottom'] - footer_h
    for b in by_kind.get('PageFooter', []):
        draw_band(draw, rng, b, m['left'], fy, ctx)
        fy += printed_height(b)
    for b in by_kind.get('BottomMargin', []):
        draw_band(draw, rng, b, m['left'], H - m['bottom'], ctx)

    if noise:
        if rng.random() < 0.5:
            img = img.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.3, 0.8)))
        if rng.random() < 0.4:
            img = img.rotate(rng.uniform(-0.6, 0.6), resample=Image.BICUBIC, fillcolor=255)
    return img


# The boxes design (2026-11-04): the model is given the page and the text read
# on it, as numbered boxes, and asked only for what OCR cannot tell: the bands,
# where each first prints, and which band and role each box belongs to. The
# places come from the boxes, so they are as good as the reading. Mirrored by
# BOX_INSTRUCTION in src/lib/boxText.ts, which a test keeps word for word.
BOX_INSTRUCTION = ('This is one page of a printed business report and the text boxes read on it, numbered, '
                   'each x y w h in hundredths of an inch from the top left of the page. Write its structure '
                   'as Forma box text: the page line, then each band where it first prints, with its top and '
                   'height, and under it the number and role of each box printed there.')


def box_example(skeleton_target, rng, exact):
    """The prompt and the answer for the page just drawn, from _drawn and _bands."""
    drawn = sorted(_drawn, key=lambda d: (d['box'][1], d['box'][0]))
    if not exact:
        # As OCR reads a page: each box a pixel or two off, and now and then one missed.
        kept = []
        for d in drawn:
            if rng.random() < 0.03:
                continue
            x, y, w, h = d['box']
            kept.append(dict(d, box=[x + rng.randint(-2, 2), y + rng.randint(-2, 2), max(1, w + rng.randint(-2, 2)), max(1, h + rng.randint(-1, 1))]))
        drawn = kept
    lines = [BOX_INSTRUCTION]
    for n, d in enumerate(drawn, 1):
        lines.append('%d %d %d %d %d' % (n, d['box'][0], d['box'][1], d['box'][2], d['box'][3]))
    answer = [skeleton_target.split('\n', 1)[0]]
    for b in sorted((b for b in _bands if b['instance'] == 0), key=lambda b: (b['top'], ORDER.index(b['kind']) if b['kind'] in ORDER else 99)):
        answer.append('band %s %d %d' % (b['kind'], b['top'], b['height']))
        for n, d in enumerate(drawn, 1):
            if d['band'] == b['kind'] and d['instance'] == 0:
                answer.append('%d %s' % (n, d['role']))
    return '\n'.join(lines), '\n'.join(answer)


def main():
    ap = argparse.ArgumentParser(description='Draw a Forma skeleton dataset as page images.')
    ap.add_argument('dataset')
    ap.add_argument('--variants', type=int, default=4)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--limit', type=int, default=0, help='draw only the first N examples (for a quick look)')
    ap.add_argument('--boxes', action='store_true', help='the boxes design: each row a prompt with the text boxes and their answer')
    ap.add_argument('--labels', action='store_true',
                    help="Forma's box reader: write labels.jsonl, every text drawn with its box, band and role")
    ap.add_argument('--no-images', action='store_true', help='draw the pages but do not save them, for --labels alone')
    args = ap.parse_args()

    src = os.path.join(args.dataset, 'examples.jsonl')
    if not os.path.exists(src):
        sys.exit('No examples.jsonl in %s. Run npm run model:dataset first.' % args.dataset)
    with open(src, encoding='utf-8') as fh:
        examples = [json.loads(line) for line in fh if line.strip()]
    if args.limit:
        examples = examples[:args.limit]

    out = {'train': [], 'eval': []}
    labels = []
    for ex in examples:
        for v in range(args.variants):
            rng = random.Random('%d-%s-%d' % (args.seed, ex['id'], v))
            img = render(ex['skeleton'], ex['category'], rng, noise=v > 0)
            name = '%s-%d.png' % (ex['id'], v)
            if not args.no_images:
                img.save(os.path.join(args.dataset, name), optimize=True)
            if args.labels:
                # Forma's box reader (2026-11-04) learns each text's band and role
                # from these. The words are this script's placeholders, never a
                # report's: a skeleton holds none.
                k = ex['skeleton']
                labels.append({'image': name, 'id': ex['id'], 'split': ex['split'], 'width': k['width'], 'height': k['height'],
                               'margins': k['margins'], 'bands': list(_bands), 'texts': list(_drawn)})
            row = {'image': name, 'id': ex['id'], 'category': ex['category'], 'target': ex['target']}
            if args.boxes:
                # Its own generator, so the page drawn is the same as without --boxes.
                box_rng = random.Random('boxes-%d-%s-%d' % (args.seed, ex['id'], v))
                prompt, answer = box_example(ex['target'], box_rng, exact=ex['split'] == 'eval')
                row.update({'prompt': prompt, 'target': answer, 'truth': ex['target']})
            out[ex['split']].append(row)
    for split, rows in out.items():
        with open(os.path.join(args.dataset, split + '.jsonl'), 'w', encoding='utf-8', newline='\n') as fh:
            for r in rows:
                fh.write(json.dumps(r) + '\n')
    if args.labels:
        with open(os.path.join(args.dataset, 'labels.jsonl'), 'w', encoding='utf-8', newline='\n') as fh:
            for r in labels:
                fh.write(json.dumps(r) + '\n')
    print('images %d (examples %d x variants %d): train %d, eval %d' % (
        len(out['train']) + len(out['eval']), len(examples), args.variants, len(out['train']), len(out['eval'])))


if __name__ == '__main__':
    main()
