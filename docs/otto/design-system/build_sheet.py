"""Writes otto-design-system.svg, the editable source of the Otto design-system sheet.

Token values mirror ./tokens.css exactly; change them there first.
"""
from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).with_name("otto-design-system.svg")

W, M = 1440, 96
R = W - M
CW = W - 2 * M

# Every color below is read from ./tokens.css at generation time — the
# single source of truth. Nothing here is a second hand-copied palette; if
# tokens.css changes, re-running this script picks up the new values.
import re as _re

_CSS = (Path(__file__).parent / "tokens.css").read_text()


def _block(selector):
    m = _re.search(_re.escape(selector) + r"\s*\{([^}]*)\}", _CSS)
    if not m:
        raise ValueError(f"selector not found in tokens.css: {selector}")
    return m.group(1)


def _vars(block_text):
    return dict(_re.findall(r"--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;", block_text))


_root = _vars(_block(":root"))
_dir_a = _vars(_block('[data-direction="a"]'))


def _mix(hexv, target, t):
    """Mix hexv with target (0..1 = how much of target)."""
    a = [int(hexv[i : i + 2], 16) for i in (1, 3, 5)]
    b = [int(target[i : i + 2], 16) for i in (1, 3, 5)]
    out = [round(x * (1 - t) + y * t) for x, y in zip(a, b)]
    return "#{:02X}{:02X}{:02X}".format(*out)


def _lin(c):
    c = c / 255
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def _luminance(hexv):
    r, g, b = (int(hexv[i : i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def contrast(hex1, hex2):
    l1, l2 = _luminance(hex1), _luminance(hex2)
    l1, l2 = max(l1, l2), min(l1, l2)
    return (l1 + 0.05) / (l2 + 0.05)


ON_SOLID = _root["success-foreground"]  # == warning/destructive/neutral-run-foreground
_accent = _dir_a["primary"]
C = dict(
    canvas=_root["background"], surface=_root["card"], ink=_root["foreground"],
    stone=_root["muted-foreground"], mist=_root["muted"], line=_root["border"],
    control=_root["border-control"], accent=_accent,
    # Hover/tint are this sheet's own presentation derivatives of --primary,
    # not new app tokens — darken for hover, lighten for a status-tint bg.
    accent_hover=_mix(_accent, "#000000", 0.12),
    accent_tint=_mix(_accent, "#FFFFFF", 0.88),
    success=_root["success"], success_bg=_root["success-muted"], success_ink=_root["success-muted-foreground"],
    warning=_root["warning"], warning_bg=_root["warning-muted"], warning_ink=_root["warning-muted-foreground"],
    danger=_root["destructive"], danger_bg=_root["destructive-muted"], danger_ink=_root["destructive-muted-foreground"],
    neutral=_root["neutral-run"], neutral_bg=_root["neutral-run-muted"], neutral_ink=_root["neutral-run-muted-foreground"],
)

SANS = "'Otto Inter', Inter, ui-sans-serif, system-ui, sans-serif"
DISPLAY = "'Otto Inter Display', 'Otto Inter', Inter, ui-sans-serif, sans-serif"
MONO = "'Otto Mono', 'JetBrains Mono', ui-monospace, monospace"

# Approximate Inter advance widths (em) for laying out pills and buttons.
NARROW = set("iljtfrI.,:;!|'")
WIDE = set("mwMW")


def text_width(s, size, weight=400):
    w = 0.0
    for ch in s:
        if ch == " ":
            w += 0.27
        elif ch in NARROW:
            w += 0.30
        elif ch in WIDE:
            w += 0.84
        elif ch.isupper():
            w += 0.66
        elif ch.isdigit():
            w += 0.58
        elif ch in "#·…→":
            w += 0.62
        else:
            w += 0.54
    return w * size * (1.03 if weight >= 500 else 1.0)


out = []


def add(s):
    out.append(s)


def t(x, y, s, size=14, weight=400, fill=C["ink"], family=SANS, anchor="start", ls=None, opacity=None):
    extra = f' letter-spacing="{ls}"' if ls is not None else ""
    if opacity is not None:
        extra += f' opacity="{opacity}"'
    add(
        f'<text x="{x:.1f}" y="{y:.1f}" font-family="{family}" font-size="{size}" '
        f'font-weight="{weight}" fill="{fill}" text-anchor="{anchor}"{extra}>{escape(s)}</text>'
    )


def rect(x, y, w, h, fill="none", stroke=None, sw=1, r=0, extra=""):
    s = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
    add(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{r}" fill="{fill}"{s} {extra}/>')


def line(x1, y1, x2, y2, stroke=C["line"], sw=1):
    add(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{stroke}" stroke-width="{sw}"/>')


ICONS = {
    "grid": '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    "chat": '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5A8 8 0 1 1 21 12z"/>',
    "file": '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    "bot": '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/>',
    "library": '<path d="M5 4h4v16H5zM10 4h4v16h-4z"/><path d="M15.5 4.5l3.8-1 3.2 15.5-3.8 1z"/>',
    "search": '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    "settings": '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    "arrow": '<path d="M5 12h14M13 6l6 6-6 6"/>',
    "up": '<path d="M12 19V5M6 11l6-6 6 6"/>',
    "check": '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    "alert": '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
    "plus": '<path d="M12 5v14M5 12h14"/>',
}


def icon(name, x, y, size=16, color=C["ink"], sw=1.75):
    s = size / 24
    add(
        f'<g transform="translate({x:.1f},{y:.1f}) scale({s:.4f})" fill="none" stroke="{color}" '
        f'stroke-width="{sw / s * s * (24 / size):.2f}" stroke-linecap="round" stroke-linejoin="round">{ICONS[name]}</g>'
    )


def section(num, title, note, y):
    add(
        f'<text x="{M}" y="{y}" font-family="{SANS}" font-size="22" font-weight="500" fill="{C["ink"]}">'
        f'<tspan fill="{C["stone"]}" font-family="{MONO}" font-size="15" font-weight="400">{num}</tspan>'
        f'<tspan dx="14">{escape(title)}</tspan></text>'
    )
    t(R, y, note, 14, fill=C["stone"], anchor="end")


def divider(y):
    line(M, y, R, y)


# ---------- badges, avatars, buttons ----------
def glyph(kind, cx, cy, color):
    if kind == "dot":
        add(f'<circle cx="{cx}" cy="{cy}" r="3.5" fill="{color}"/>')
    elif kind == "ring":
        add(f'<circle cx="{cx}" cy="{cy}" r="4.5" fill="none" stroke="{color}" stroke-width="1.5"/>')
    elif kind == "dashed":
        add(f'<circle cx="{cx}" cy="{cy}" r="4.5" fill="none" stroke="{color}" stroke-width="1.5" stroke-dasharray="2 2"/>')
    elif kind == "half":
        add(f'<circle cx="{cx}" cy="{cy}" r="4.5" fill="none" stroke="{color}" stroke-width="1.5"/>')
        add(f'<path d="M{cx},{cy - 4.5} A4.5,4.5 0 0 1 {cx},{cy + 4.5} Z" fill="{color}"/>')
    elif kind == "check":
        add(f'<circle cx="{cx}" cy="{cy}" r="5.5" fill="{color}"/>')
        add(f'<path d="M{cx - 2.6},{cy + 0.1} l1.8,1.8 l3.4,-3.6" fill="none" stroke="{ON_SOLID}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>')
    elif kind == "stop":
        add(f'<rect x="{cx - 3.5}" y="{cy - 3.5}" width="7" height="7" rx="1.5" fill="{color}"/>')
    elif kind == "alert":
        add(f'<circle cx="{cx}" cy="{cy}" r="5.5" fill="{color}"/>')
        add(f'<path d="M{cx},{cy - 2.8} v3 M{cx},{cy + 2.4} v0.2" stroke="{ON_SOLID}" stroke-width="1.6" stroke-linecap="round"/>')
    elif kind == "pause":
        add(f'<circle cx="{cx}" cy="{cy}" r="5.5" fill="{color}"/>')
        add(f'<path d="M{cx - 1.5},{cy - 2.2} v4.4 M{cx + 1.5},{cy - 2.2} v4.4" stroke="{ON_SOLID}" stroke-width="1.5" stroke-linecap="round"/>')


def badge(x, cy, label, bg, fg, kind, gcolor=None, size=13, h=28):
    w = text_width(label, size, 500) + 22 + 18
    rect(x, cy - h / 2, w, h, fill=bg, r=h / 2)
    glyph(kind, x + 16, cy, gcolor or fg)
    t(x + 28, cy + size * 0.36, label, size, 500, fg)
    return w


def pill(x, cy, label, size=12, h=24):
    w = text_width(label, size, 500) + 20
    rect(x, cy - h / 2, w, h, fill=C["surface"], stroke=C["line"], r=h / 2)
    t(x + w / 2, cy + size * 0.36, label, size, 500, C["neutral_ink"], anchor="middle")
    return w


def avatar(cx, cy, initials, agent=False, role=None, r=12):
    if agent:
        add(f'<circle cx="{cx}" cy="{cy}" r="{r - 0.75}" fill="{C["surface"]}" stroke="{C["accent"]}" stroke-width="1.5"/>')
        t(cx, cy + r * 0.33, initials, r * 0.78, 600, C["accent"], anchor="middle")
        add(f'<circle cx="{cx + r * 0.72}" cy="{cy + r * 0.72}" r="{r * 0.36}" fill="{C["accent"]}" stroke="{C["surface"]}" stroke-width="1"/>')
    else:
        add(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{C["mist"]}"/>')
        t(cx, cy + r * 0.3, initials, r * 0.72, 600, C["ink"], anchor="middle")
    if role:
        tx_, ty_ = cx - r * 0.85, cy - r * 0.85
        add(f'<circle cx="{tx_}" cy="{ty_}" r="7.5" fill="{C["surface"]}" stroke="{C["control"]}" stroke-width="1"/>')
        t(tx_, ty_ + 3.2, role, 9, 700, C["neutral_ink"], anchor="middle")


def button(variant, state, x, cy, label=None):
    h = 36
    if variant == "icon":
        w = 36
    else:
        w = text_width(label, 14, 500) + 32 + (24 if variant == "primary" else 0)
    y = cy - h / 2
    add(f'<g opacity="{0.45 if state == "disabled" else 1}">')
    if variant == "primary":
        rect(x, y, w, h, fill=C["accent_hover"] if state == "hover" else C["accent"], r=8)
        t(x + 16, cy + 5, label, 14, 500, _dir_a["primary-foreground"])
        icon("arrow", x + w - 30, cy - 7, 14, _dir_a["primary-foreground"], 2)
    elif variant == "secondary":
        rect(x, y, w, h, fill=C["mist"] if state == "hover" else C["surface"], stroke=C["control"], r=8)
        t(x + w / 2, cy + 5, label, 14, 500, C["ink"], anchor="middle")
    elif variant == "quiet":
        if state == "hover":
            rect(x, y, w, h, fill=C["mist"], r=8)
        t(x + w / 2, cy + 5, label, 14, 500, C["ink"], anchor="middle")
    else:
        if state == "hover":
            rect(x, y, w, h, fill=C["mist"], r=8)
        icon("search", x + 9, cy - 9, 18, C["ink"])
    add("</g>")
    if state == "focus":
        rect(x - 4, y - 4, w + 8, h + 8, stroke=C["accent"], sw=2, r=12)
    return w


# ---------- document ----------
H = 3320
fonts = Path(__file__).with_name("fonts")
add(
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
)
add(
    "<defs><style>"
    "@font-face{font-family:'Otto Inter';font-weight:400;src:url('fonts/Inter-Regular.woff2') format('woff2');}"
    "@font-face{font-family:'Otto Inter';font-weight:500;src:url('fonts/Inter-Medium.woff2') format('woff2');}"
    "@font-face{font-family:'Otto Inter';font-weight:600;src:url('fonts/Inter-SemiBold.woff2') format('woff2');}"
    "@font-face{font-family:'Otto Inter';font-weight:700;src:url('fonts/Inter-SemiBold.woff2') format('woff2');}"
    "@font-face{font-family:'Otto Inter Display';font-weight:500;src:url('fonts/InterDisplay-Medium.woff2') format('woff2');}"
    "@font-face{font-family:'Otto Mono';font-weight:400;src:url('fonts/JetBrainsMono-Regular.woff2') format('woff2');}"
    "text{font-feature-settings:'cv11','ss01';}"
    "</style>"
    '<filter id="shadow-xs" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000" flood-opacity="0.04"/></filter>'
    '<filter id="shadow-sm" x="-20%" y="-20%" width="140%" height="170%">'
    '<feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.08"/>'
    '<feDropShadow dx="0" dy="1" stdDeviation="0.75" flood-color="#000" flood-opacity="0.06"/></filter>'
    "</defs>"
)
rect(0, 0, W, H, fill=C["surface"])

# header
t(M, 104, "Otto", 20, 600)
t(R, 104, "Design system · Foundations and components · Draft 01", 13, fill=C["stone"], family=MONO, anchor="end")
t(M, 212, "Calm work, side by side.", 68, 500, family=DISPLAY, ls="-1.4")
t(M, 262, "A working foundation for Otto. Quiet surfaces, precise type, and one blue accent", 19, fill=C["stone"])
t(M, 292, "reserved for action and focus, so people and agents can share work without noise.", 19, fill=C["stone"])
divider(344)

# 01 color
y = 400
section("01", "Color", "Neutral foundation. One restrained accent.", y)
sw_top, sw_h = y + 36, 136
swatches = [
    ("Canvas", C["canvas"], "App canvas", True),
    ("Surface", C["surface"], "Cards, floating chrome", True),
    ("Ink", C["ink"], "Text, icons, structure", False),
    ("Stone", C["stone"], "Secondary text", False),
    ("Mist", C["mist"], "Quiet fills, hover", True),
    ("Line", C["line"], "Dividers, card edges", False),
    ("Accent", C["accent"], "Action, focus, Running", False),
]
gap = 16
sw_w = (CW - gap * (len(swatches) - 1)) / len(swatches)
for i, (name, hexv, role, bordered) in enumerate(swatches):
    x = M + i * (sw_w + gap)
    rect(x, sw_top, sw_w, sw_h, fill=hexv, stroke=C["line"] if bordered else None, r=10)
    t(x, sw_top + sw_h + 28, name, 15, 500)
    t(x + sw_w, sw_top + sw_h + 28, hexv, 12.5, fill=C["stone"], family=MONO, anchor="end")
    t(x, sw_top + sw_h + 50, role, 13.5, fill=C["stone"])
cb = sw_top + sw_h + 76
rect(M, cb, CW, 52, fill=C["mist"], r=10)
t(M + 20, cb + 32, "Blue marks the primary action, the focus ring and a running Run. Nothing else.", 14.5)
ink_ratio = contrast(C["ink"], C["canvas"])
stone_ratio = contrast(C["stone"], C["canvas"])
t(R - 20, cb + 32, f'Ink on Canvas {ink_ratio:.2f}:1 \u00b7 Stone on Canvas {stone_ratio:.2f}:1', 14, fill=C["stone"], anchor="end")
sy = cb + 100
t(M, sy, "Supporting", 14, 500)
t(M, sy + 20, "Status and controls", 13, fill=C["stone"])
control_ratio = contrast(C["control"], C["canvas"])
supporting = [
    ("Control", C["control"], f"Input outlines \u00b7 {control_ratio:.2f}:1"),
    ("Success", C["success"], "Finished, Done"),
    ("Warning", C["warning"], "Waiting"),
    ("Danger", C["danger"], "Failed, errors"),
    ("Neutral", C["neutral"], "Queued, Stopped"),
]
sx = M + 200
col = (R - sx) / len(supporting)
for i, (name, hexv, role) in enumerate(supporting):
    x = sx + i * col
    rect(x, sy - 11, 22, 22, fill=hexv, r=6)
    t(x + 34, sy + 0, f"{name}", 14, 500)
    t(x + 34 + text_width(name, 14, 500) + 8, sy + 0, hexv, 12.5, fill=C["stone"], family=MONO)
    t(x + 34, sy + 20, role, 13, fill=C["stone"])
end = sy + 28
divider(end + 48)

# 02 typography
y = end + 48 + 56
section("02", "Typography", "Inter 400 · 500 · 600 · JetBrains Mono 400 · system fallback", y)
rows = [
    ("Display", "56 / 64 · Medium", 56, 500, DISPLAY, "Shared work, clearly owned.", 108, "-1.1"),
    ("Heading", "32 / 40 · Medium", 32, 500, DISPLAY, "A task, a conversation, a result.", 80, "-0.5"),
    ("Title", "20 / 28 · Semibold", 20, 600, SANS, "Fix sign-in redirect loop", 64, "-0.2"),
    ("Body", "16 / 24 · Regular", 16, 400, SANS, "Cody finished a Run and proposed the fix. Johan decides when the task is done.", 60, None),
    ("Interface", "14 / 20 · Medium", 14, 500, SANS, "Assign · Start run · Mark done", 56, None),
    ("Caption", "12 / 16 · Regular", 12, 400, SANS, "Updated 4 minutes ago · Otto web", 52, None),
    ("Mono", "13 / 20 · Regular", 13, 400, MONO, "run_8f2c · finished · 2m 14s", 52, None),
]
ry = y + 36
tokens = ["text-display", "text-heading", "text-lg", "text-base", "text-sm", "text-xs", "font-mono"]
for (name, spec, size, weight, fam, sample, rh, ls), tok in zip(rows, tokens):
    line(M, ry, R, ry)
    mid = ry + rh / 2
    t(M, mid - 3, name, 14, 500)
    t(M, mid + 16, spec, 12.5, fill=C["stone"], family=MONO)
    t(M + 300, mid + size * 0.36, sample, size, weight, family=fam, ls=ls)
    t(R, mid + 5, tok, 12.5, fill=C["stone"], family=MONO, anchor="end")
    ry += rh
end = ry
divider_y = end + 48
divider(divider_y)

# 03 space and shape
y = divider_y + 56
section("03", "Space and shape", "A 4-point rhythm. Flat by default, raised only when floating.", y)
pt = y + 36
ph = 256
rect(M, pt, CW, ph, fill=C["mist"], r=14)
base = pt + 200
steps = [4, 8, 12, 16, 24, 32, 48, 64, 96]
for i, v in enumerate(steps):
    bx = M + 48 + i * 66
    hgt = v * 1.4
    rect(bx, base - hgt, 30, hgt, fill=C["ink"], r=2)
    t(bx + 15, base + 28, str(v), 12.5, fill=C["stone"], family=MONO, anchor="middle")
t(M + 48, pt + 36, "Spacing", 14, 500)
radii = [("sm", 6), ("md", 8), ("lg", 10), ("xl", 14), ("full", 999)]
rx0 = M + 760
t(rx0, pt + 36, "Radius", 14, 500)
for i, (nm, r) in enumerate(radii):
    bx = rx0 + i * 98
    rr = 36 if r == 999 else r
    rect(bx, base - 72, 72, 72, fill=C["surface"], stroke=C["line"], r=rr)
    t(bx + 36, base + 28, f"{nm} {'' if r == 999 else r}".strip(), 12.5, fill=C["stone"], family=MONO, anchor="middle")
et = pt + ph + 40
elev = [
    ("Flat", "Canvas content · 1 px Line", None, C["line"]),
    ("Hover", "shadow-xs · Control edge", "shadow-xs", C["control"]),
    ("Floating", "shadow-sm · floating chrome", "shadow-sm", C["line"]),
]
for i, (nm, cap, f, st) in enumerate(elev):
    ex = M + i * 248
    extra = f'filter="url(#{f})"' if f else ""
    rect(ex, et, 224, 76, fill=C["surface"], stroke=st, r=10, extra=extra)
    t(ex + 18, et + 32, nm, 14, 500)
    t(ex + 18, et + 54, cap, 12.5, fill=C["stone"])
lx = M + 800
t(lx, et + 12, "Layout", 14, 500)
for j, s in enumerate([
    "Rail 56 · context card 212 · details card 300",
    "Reading column 640 · composer 640 max",
    "Canvas gutter 16 · card padding 16–20",
]):
    t(lx, et + 38 + j * 22, s, 13.5, fill=C["stone"])
end = et + 76
divider_y = end + 48
divider(divider_y)

# 04 actions
y = divider_y + 56
section("04", "Actions", "36 px height · 8 px radius · 2 px focus ring with a 2 px gap", y)
cols = [M + 220, M + 470, M + 720, M + 970]
hy = y + 44
t(M, hy, "Variant", 12.5, fill=C["stone"], family=MONO)
for cx_, lab in zip(cols, ["Default", "Hover", "Focus", "Disabled"]):
    t(cx_, hy, lab, 12.5, fill=C["stone"], family=MONO)
variants = [("Primary", "primary", "Start run"), ("Secondary", "secondary", "Assign"),
            ("Quiet", "quiet", "Cancel"), ("Icon", "icon", None)]
ry = hy + 20
for vname, v, lab in variants:
    line(M, ry, R, ry)
    cy = ry + 38
    t(M, cy + 5, vname, 15, 500)
    for cx_, st in zip(cols, ["default", "hover", "focus", "disabled"]):
        bw = button(v, st, cx_, cy, lab)
        if v == "icon" and st == "focus":
            tx = cx_ + bw + 12
            rect(tx, cy - 14, 84, 28, fill=C["ink"], r=6)
            add(f'<path d="M{tx},{cy - 5} l-5,5 l5,5 z" fill="{C["ink"]}"/>')
            t(tx + 42, cy + 5, "Search", 13, 500, C["surface"], anchor="middle")
    ry += 76
line(M, ry, R, ry)
t(M, ry + 30, "Icon buttons always carry an accessible name. The tooltip appears on hover and on keyboard focus.", 13.5, fill=C["stone"])
end = ry + 30
divider_y = end + 44
divider(divider_y)

# 05 inputs and status
y = divider_y + 56
section("05", "Inputs and status", "Clear labels, visible focus, specific feedback.", y)
iw = (CW - 2 * 40) / 3
fields = [
    ("Default", None, "Describe the task", "Visible to everyone in this project.", "default"),
    ("Focus", "Fix sign-in redirect loop", None, "Press Enter to create the task.", "focus"),
    ("Error", None, "Describe the task", "Add a title to create the task.", "error"),
]
fy = y + 44
for i, (st_lab, val, ph_, helper, st) in enumerate(fields):
    fx = M + i * (iw + 40)
    t(fx, fy, st_lab, 12.5, fill=C["stone"], family=MONO)
    t(fx, fy + 32, "Task title", 14, 500)
    by = fy + 44
    border = {"default": C["control"], "focus": C["accent"], "error": C["danger"]}[st]
    rect(fx, by, iw, 42, fill=C["surface"], stroke=border, sw=1.25 if st != "default" else 1, r=8)
    if st == "focus":
        rect(fx - 4, by - 4, iw + 8, 50, stroke=C["accent"], sw=2, r=11, extra='stroke-opacity="0.35"')
        t(fx + 14, by + 26, val, 15)
    else:
        t(fx + 14, by + 26, ph_, 15, fill=C["stone"])
    if st == "error":
        glyph("alert", fx + 6, by + 66, C["danger"])
        t(fx + 18, by + 70, helper, 13.5, 500, C["danger_ink"])
    else:
        t(fx, by + 70, helper, 13.5, fill=C["stone"])
sy = fy + 44 + 42 + 104
line(M, sy - 30, R, sy - 30)
status_x = M + 220


def status_row(cy, title, sub, items):
    t(M, cy - 2, title, 15, 500)
    t(M, cy + 17, sub, 13, fill=C["stone"])
    x = status_x
    for it in items:
        x += badge(x, cy, *it) + 10


status_row(sy, "Task stage", "Set by people", [
    ("To do", C["neutral_bg"], C["neutral_ink"], "ring", C["neutral"]),
    ("Doing", C["neutral_bg"], C["neutral_ink"], "half", C["ink"]),
    ("Done", C["success_bg"], C["success_ink"], "check", C["success"]),
])
line(M, sy + 36, R, sy + 36)
sy2 = sy + 72
status_row(sy2, "Run signal", "Reported by the run", [
    ("Queued", C["neutral_bg"], C["neutral_ink"], "dashed", C["neutral"]),
    ("Running", C["accent_tint"], C["accent"], "dot", C["accent"]),
    ("Waiting for input", C["warning_bg"], C["warning_ink"], "pause", C["warning"]),
    ("Finished", C["success_bg"], C["success_ink"], "check", C["success"]),
    ("Failed", C["danger_bg"], C["danger_ink"], "alert", C["danger"]),
    ("Stopped", C["neutral_bg"], C["neutral_ink"], "stop", C["neutral"]),
])
line(M, sy2 + 36, R, sy2 + 36)
sy3 = sy2 + 76
t(M, sy3 - 2, "Completion", 15, 500)
t(M, sy3 + 17, "Human-owned", 13, fill=C["stone"])
x = status_x
x += badge(x, sy3, "Run finished", C["success_bg"], C["success_ink"], "check", C["success"]) + 14
icon("arrow", x, sy3 - 8, 16, C["stone"])
x += 26
t(x, sy3 + 5, "proposes", 13.5, fill=C["stone"])
x += text_width("proposes", 13.5) + 14
x += badge(x, sy3, "Doing", C["neutral_bg"], C["neutral_ink"], "half", C["ink"]) + 14
icon("arrow", x, sy3 - 8, 16, C["stone"])
x += 26
t(x, sy3 + 5, "authorized human marks", 13.5, fill=C["stone"])
x += text_width("authorized human marks", 13.5) + 14
badge(x, sy3, "Done", C["success_bg"], C["success_ink"], "check", C["success"])
t(R, sy3 + 5, "A finished Run never completes a task by itself.", 13.5, 500, anchor="end")
end = sy3 + 30
divider_y = end + 44
divider(divider_y)

# 06 product patterns
y = divider_y + 56
section("06", "Product patterns", "Patterns, not screens. One rail, floating cards, an open canvas.", y)
tw = (CW - 2 * 24) / 3
th = 292
ty = y + 52
labels = ["Shell · composition", "Rail · names and context card", "Task row · pills and composer"]
for i, lab in enumerate(labels):
    t(M + i * (tw + 24), ty - 14, lab, 12.5, fill=C["stone"], family=MONO)

# tile 1: shell composition
x0 = M
rect(x0, ty, tw, th, fill=C["canvas"], stroke=C["line"], r=12)
add(f'<clipPath id="t1"><rect x="{x0}" y="{ty}" width="{tw}" height="{th}" rx="12"/></clipPath><g clip-path="url(#t1)">')
rect(x0, ty, 34, th, fill=C["surface"])
line(x0 + 34, ty, x0 + 34, ty + th)
for j in range(5):
    fill = C["accent_tint"] if j == 0 else C["mist"]
    rect(x0 + 9, ty + 16 + j * 26, 16, 16, fill=fill, r=4)
rect(x0 + 46, ty + 14, 104, 112, fill=C["surface"], stroke=C["line"], r=8, extra='filter="url(#shadow-sm)"')
rect(x0 + 56, ty + 26, 44, 6, fill=C["stone"], r=3, extra='opacity="0.5"')
rect(x0 + 54, ty + 42, 88, 16, fill=C["mist"], r=4)
for j in range(3):
    rect(x0 + 60, ty + 68 + j * 18, 60 - j * 10, 6, fill=C["line"], r=3)
cx0, cx1 = x0 + 162, x0 + tw - 118
for j in range(4):
    rect(cx0, ty + 18 + j * 34, cx1 - cx0, 26, fill=C["surface"], stroke=C["line"], r=6)
    rect(cx0 + 10, ty + 28 + j * 34, 60, 6, fill=C["line"], r=3)
rect(x0 + tw - 106, ty + 14, 94, 132, fill=C["surface"], stroke=C["line"], r=8, extra='filter="url(#shadow-sm)"')
rect(x0 + tw - 96, ty + 26, 30, 6, fill=C["ink"], r=3, extra='opacity="0.7"')
line(x0 + tw - 106, ty + 42, x0 + tw - 12, ty + 42)
rect(x0 + tw - 96, ty + 54, 74, 46, fill=C["mist"], r=4)
comp_w = 200
cxm = x0 + 34 + (tw - 34) / 2
rect(cxm - comp_w / 2, ty + th - 50, comp_w, 32, fill=C["surface"], stroke=C["control"], r=16, extra='filter="url(#shadow-sm)"')
rect(cxm - comp_w / 2 + 14, ty + th - 37, 70, 6, fill=C["line"], r=3)
add(f'<circle cx="{cxm + comp_w / 2 - 16}" cy="{ty + th - 34}" r="9" fill="{C["accent"]}"/>')
add("</g>")
t(x0, ty + th + 30, "Shell composition", 15, 500)
t(x0, ty + th + 52, "Icon rail, screen-specific context card, open canvas,", 13.5, fill=C["stone"])
t(x0, ty + th + 72, "optional details card, floating composer.", 13.5, fill=C["stone"])

# tile 2: rail + context card
x0 = M + tw + 24
rect(x0, ty, tw, th, fill=C["canvas"], stroke=C["line"], r=12)
add(f'<clipPath id="t2"><rect x="{x0}" y="{ty}" width="{tw}" height="{th}" rx="12"/></clipPath><g clip-path="url(#t2)">')
rect(x0, ty, 60, th, fill=C["surface"])
line(x0 + 60, ty, x0 + 60, ty + th)
t(x0 + 30, ty + 32, "O", 15, 600, anchor="middle")
rail = ["grid", "chat", "file", "bot", "library"]
for j, nm in enumerate(rail):
    iy = ty + 48 + j * 40
    if j == 0:
        rect(x0 + 12, iy, 36, 36, fill=C["mist"], r=8)
        icon(nm, x0 + 21, iy + 9, 18, C["accent"])
    else:
        icon(nm, x0 + 21, iy + 9, 18, C["stone"])
    if j == 4:
        rect(x0 + 8, iy - 4, 44, 44, stroke=C["accent"], sw=2, r=11)
avatar(x0 + 30, ty + th - 26, "JG")
cx_ = x0 + 78
rect(cx_, ty + 16, tw - 96, 178, fill=C["surface"], stroke=C["line"], r=12, extra='filter="url(#shadow-sm)"')
t(cx_ + 16, ty + 42, "My work", 13, 600, C["stone"])
filters = [("Assigned to me", "4", True), ("Doing", "1", False), ("To do", "2", False), ("Done", "1", False)]
for j, (nm, n, act) in enumerate(filters):
    ry_ = ty + 54 + j * 30
    if act:
        rect(cx_ + 8, ry_, tw - 112, 28, fill=C["mist"], r=6)
    t(cx_ + 16, ry_ + 19, nm, 13.5, 500 if act else 400)
    t(cx_ + tw - 112, ry_ + 19, n, 12.5, fill=C["stone"], anchor="end")
iy = ty + 48 + 4 * 40
tx = x0 + 62
rect(tx, iy + 4, 70, 28, fill=C["ink"], r=6)
add(f'<path d="M{tx},{iy + 13} l-5,5 l5,5 z" fill="{C["ink"]}"/>')
t(tx + 35, iy + 23, "Library", 13, 500, C["surface"], anchor="middle")
t(cx_ + 72, ty + 212, "Selected", 12.5, 500, C["stone"])
t(cx_ + 72, ty + 230, "aria-current, Mist fill", 12.5, fill=C["stone"])
t(cx_ + 72, ty + 252, "Focused", 12.5, 500, C["stone"])
t(cx_ + 72, ty + 270, "2 px ring, name shown", 12.5, fill=C["stone"])
add("</g>")
t(x0, ty + th + 30, "Icon rail with context card", 15, 500)
t(x0, ty + th + 52, "Every icon is named. The card shows this screen's", 13.5, fill=C["stone"])
t(x0, ty + th + 72, "filters, never a second copy of the rail.", 13.5, fill=C["stone"])

# tile 3: task row + pills + composer
x0 = M + 2 * (tw + 24)
rect(x0, ty, tw, th, fill=C["canvas"], stroke=C["line"], r=12)
add(f'<clipPath id="t3"><rect x="{x0}" y="{ty}" width="{tw}" height="{th}" rx="12"/></clipPath><g clip-path="url(#t3)">')
rx_, rw_ = x0 + 16, tw - 32
rect(rx_, ty + 16, rw_, 58, fill=C["surface"], stroke=C["line"], r=10)
avatar(rx_ + 26, ty + 45, "JG", role="O", r=13)
avatar(rx_ + 62, ty + 45, "C", agent=True, role="A", r=13)
t(rx_ + 88, ty + 50, "Fix sign-in redirect loop", 14, 500)
bw = text_width("Doing", 12, 500) + 36
badge(rx_ + rw_ - bw - 10, ty + 45, "Doing", C["neutral_bg"], C["neutral_ink"], "half", C["ink"], size=12, h=24)
px = rx_
for lab in ["#sign-in-bug", "Priority: High", "Otto web"]:
    px += pill(px, ty + 96, lab) + 8
rect(rx_, ty + 122, rw_, 40, fill=C["mist"], stroke=C["line"], r=8)
badge(rx_ + 8, ty + 142, "Finished", C["success_bg"], C["success_ink"], "check", C["success"], size=12, h=24)
t(rx_ + 104, ty + 146, "Run · patch cookie handling", 12.5, fill=C["stone"])
t(rx_ + rw_ - 12, ty + 146, "▸", 12, fill=C["stone"], anchor="end")
avatar(rx_ + 12, ty + 190, "C", agent=True, r=12)
t(rx_ + 32, ty + 189, "Fix is up for review. Done is your call.", 13.5)
t(rx_ + 32, ty + 207, "Cody · agent · 10:03", 12, fill=C["stone"])
cw_ = rw_
rect(rx_, ty + th - 62, cw_, 44, fill=C["surface"], stroke=C["control"], r=14, extra='filter="url(#shadow-sm)"')
t(rx_ + 16, ty + th - 35, "Reply in #sign-in-bug…", 14, fill=C["stone"])
add(f'<circle cx="{rx_ + cw_ - 24}" cy="{ty + th - 40}" r="14" fill="{C["accent"]}"/>')
icon("up", rx_ + cw_ - 32, ty + th - 48, 16, _dir_a["primary-foreground"], 2)
add("</g>")
t(x0, ty + th + 30, "Task row, pills and composer", 15, 500)
t(x0, ty + th + 52, "Owner (O) and assignee (A) always visible. Pills", 13.5, fill=C["stone"])
t(x0, ty + th + 72, "carry metadata, never status.", 13.5, fill=C["stone"])

end = ty + th + 72
fy = end + 56
divider(fy)
t(M, fy + 36, "Otto · Foundations draft 01 · October 2026", 12.5, fill=C["stone"], family=MONO)
t(R, fy + 36, "Proposal for review. Blue accent pending human approval.", 12.5, fill=C["stone"], family=MONO, anchor="end")
H_final = fy + 84
add("</svg>")

svg = "\n".join(out)
svg = svg.replace(f'height="{H}" viewBox="0 0 {W} {H}"', f'height="{H_final}" viewBox="0 0 {W} {H_final}"', 1)
svg = svg.replace(f'<rect x="0.0" y="0.0" width="{W:.1f}" height="{H:.1f}"', f'<rect x="0.0" y="0.0" width="{W:.1f}" height="{H_final:.1f}"', 1)
OUT.write_text(svg)
print(OUT, W, H_final)
