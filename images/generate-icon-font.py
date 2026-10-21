# Builds images/icons.woff, the font behind $(universal-chat-provider-logo). Needs: pip install fonttools
import math
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

UPM = 300  # matches the codicon font
KAPPA = 0.5523
# The shape's ink spans y 1..13.3 around x = 8 on a 16-unit grid.
SHAPE_TOP, SHAPE_BOTTOM = 1, 13.3
# Rests on the baseline instead of centring: the open gap between the prongs makes a centred U look high.
SCALE = 14.72 / (SHAPE_BOTTOM - SHAPE_TOP)


def pt(x, y):
    """Map shape coordinates (16-unit grid, y down) to font units (y up)."""
    gx = 8 + (x - 8) * SCALE
    return (gx * UPM / 16, (SHAPE_BOTTOM - y) * SCALE * UPM / 16)


def arc(pen, cx, cy, r, a, b):
    """Quarter-circle cubic from angle a to b, in SVG coordinates."""
    (ax, ay), (bx, by) = [(math.cos(t), math.sin(t)) for t in (a, b)]
    k = KAPPA * (1 if b > a else -1)
    pen.curveTo(
        pt(cx + r * (ax - k * ay), cy + r * (ay + k * ax)),
        pt(cx + r * (bx + k * by), cy + r * (by - k * bx)),
        pt(cx + r * bx, cy + r * by),
    )


def logo_glyph():
    tt = TTGlyphPen(None)
    pen = Cu2QuPen(tt, max_err=0.5)
    cx, cy, outer, inner, top = 8, 8.6, 4.7, 2.3, 4.4

    for x in (3.4, 10.4):
        pen.moveTo(pt(x, 1))
        pen.lineTo(pt(x, top))
        pen.lineTo(pt(x + 2.2, top))
        pen.lineTo(pt(x + 2.2, 1))
        pen.closePath()

    pen.moveTo(pt(cx - outer, top))
    pen.lineTo(pt(cx - outer, cy))
    arc(pen, cx, cy, outer, math.pi, math.pi / 2)
    arc(pen, cx, cy, outer, math.pi / 2, 0)
    pen.lineTo(pt(cx + outer, top))
    pen.lineTo(pt(cx + inner, top))
    pen.lineTo(pt(cx + inner, cy))
    arc(pen, cx, cy, inner, 0, math.pi / 2)
    arc(pen, cx, cy, inner, math.pi / 2, math.pi)
    pen.lineTo(pt(cx - inner, top))
    pen.closePath()

    dot = 1.5
    pen.moveTo(pt(cx + dot, cy))
    for a, b in ((0, -math.pi / 2), (-math.pi / 2, -math.pi), (math.pi, math.pi / 2), (math.pi / 2, 0)):
        arc(pen, cx, cy, dot, a, b)
    pen.closePath()
    return tt.glyph()


logo = logo_glyph()
logo.recalcBounds(None)
fb = FontBuilder(UPM, isTTF=True)
fb.setupGlyphOrder(['.notdef', 'logo'])
fb.setupCharacterMap({0xE000: 'logo'})
fb.setupGlyf({'.notdef': TTGlyphPen(None).glyph(), 'logo': logo})
# The left side bearing must equal xMin, or renderers shift the glyph to the left edge.
fb.setupHorizontalMetrics({'.notdef': (UPM, 0), 'logo': (UPM, logo.xMin)})
fb.setupHorizontalHeader(ascent=UPM, descent=0)
fb.setupNameTable({'familyName': 'universal-chat-provider-icons', 'styleName': 'Regular'})
fb.setupOS2(sTypoAscender=UPM, sTypoDescender=0, usWinAscent=UPM, usWinDescent=0)
fb.setupPost()
fb.font.flavor = 'woff'
fb.save(Path(__file__).with_name('icons.woff'))
