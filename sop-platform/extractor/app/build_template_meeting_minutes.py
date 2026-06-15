"""
Meeting Minutes DOCX template — generic, no branding.
Blue colour scheme. Designed for video demos / client handover.
"""

from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

BLUE    = RGBColor(0x1D, 0x4E, 0xD8)
BLUE_LT = RGBColor(0xDB, 0xEA, 0xFE)
DARK    = RGBColor(0x1E, 0x29, 0x3B)
WHITE   = RGBColor(0xFF, 0xFF, 0xFF)
SLATE   = RGBColor(0x64, 0x74, 0x8B)

TEMPLATE_PATH = Path("/data/templates/meeting_minutes_template.docx")
_VERSION_PATH  = TEMPLATE_PATH.with_suffix(".version")
_TEMPLATE_VERSION = "1"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _font(run, size: float, bold=False, italic=False, color=None):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.name = "Calibri"
    if color:
        run.font.color.rgb = color


def _spacing(para, before=0, after=6):
    pPr = para._p.get_or_add_pPr()
    sp = OxmlElement("w:spacing")
    sp.set(qn("w:before"), str(int(before * 20)))
    sp.set(qn("w:after"),  str(int(after  * 20)))
    pPr.append(sp)


def _shade(para, fill_hex: str):
    pPr = para._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"),   "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"),  fill_hex)
    pPr.append(shd)


def _cell_bg(cell, fill_hex: str):
    tcPr = cell._tc.get_or_add_tcPr()
    shd  = OxmlElement("w:shd")
    shd.set(qn("w:val"),   "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"),  fill_hex)
    tcPr.append(shd)


def _border_bottom(para, color_hex="1D4ED8", size=8):
    pPr  = para._p.get_or_add_pPr()
    pBdr = OxmlElement("w:pBdr")
    bot  = OxmlElement("w:bottom")
    bot.set(qn("w:val"),   "single")
    bot.set(qn("w:sz"),    str(size))
    bot.set(qn("w:space"), "1")
    bot.set(qn("w:color"), color_hex)
    pBdr.append(bot)
    pPr.append(pBdr)


def _ctrl(doc, tag: str):
    """Jinja2 control-flow paragraph (for / endfor / if / endif)."""
    p = doc.add_paragraph(tag)
    p.style = "Normal"
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after  = Pt(0)


def _section_bar(doc, label: str):
    """Dark-blue full-width section header bar."""
    p = doc.add_paragraph()
    _shade(p, "1D4ED8")
    _spacing(p, before=10, after=0)
    r = p.add_run(f"  {label}")
    _font(r, 11, bold=True, color=WHITE)


def _add_page_number(run):
    for tag, text in [("begin", None), (None, " PAGE "), ("end", None)]:
        if tag:
            fc = OxmlElement("w:fldChar")
            fc.set(qn("w:fldCharType"), tag)
            run._r.append(fc)
        else:
            instr = OxmlElement("w:instrText")
            instr.set(qn("xml:space"), "preserve")
            instr.text = text
            run._r.append(instr)


def _build_footer(section):
    footer = section.footer
    footer.is_linked_to_previous = False
    p = footer.paragraphs[0]
    p.clear()
    _spacing(p, before=4, after=0)
    pPr = p._p.get_or_add_pPr()
    # Right-aligned page number
    tabs = OxmlElement("w:tabs")
    tab  = OxmlElement("w:tab")
    tab.set(qn("w:val"), "right")
    tab.set(qn("w:pos"), "8640")
    tabs.append(tab)
    pPr.append(tabs)
    r_left = p.add_run("Meeting Minutes")
    _font(r_left, 8, italic=True, color=SLATE)
    r_tab = p.add_run("\t")
    _font(r_tab, 8)
    r_pg = p.add_run("")
    _font(r_pg, 8, color=SLATE)
    _add_page_number(r_pg)


# ── Builder ───────────────────────────────────────────────────────────────────

def build(force: bool = False):
    if not force and TEMPLATE_PATH.exists():
        try:
            if _VERSION_PATH.read_text().strip() == _TEMPLATE_VERSION:
                return
        except Exception:
            pass

    TEMPLATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    doc = Document()

    # Default style
    style = doc.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(11)
    style.paragraph_format.space_after = Pt(6)

    # Page margins
    sec = doc.sections[0]
    sec.page_width    = Cm(21)
    sec.page_height   = Cm(29.7)
    sec.top_margin    = Cm(2.5)
    sec.bottom_margin = Cm(2.5)
    sec.left_margin   = Cm(3.0)
    sec.right_margin  = Cm(2.5)
    _build_footer(sec)

    # ── Title bar ─────────────────────────────────────────────────────────────
    title_bar = doc.add_paragraph()
    _shade(title_bar, "1D4ED8")
    _spacing(title_bar, before=0, after=0)
    r = title_bar.add_run("  MEETING MINUTES")
    _font(r, 22, bold=True, color=WHITE)

    subtitle = doc.add_paragraph()
    _shade(subtitle, "DBEAFE")
    _spacing(subtitle, before=0, after=0)
    r = subtitle.add_run("  {{ doc_title }}")
    _font(r, 13, bold=True, color=DARK)

    doc.add_paragraph().paragraph_format.space_after = Pt(4)

    # ── Meeting details table ─────────────────────────────────────────────────
    tbl = doc.add_table(rows=4, cols=2)
    tbl.style = "Table Grid"
    tbl.alignment = WD_TABLE_ALIGNMENT.LEFT

    rows_data = [
        ("Date / Time",        "{{ meeting_date }}"),
        ("Location / Platform","{{ location }}"),
        ("Facilitator",        "{{ facilitator }}"),
        ("Prepared",           "{{ generated_date }}"),
    ]
    for i, (lbl, val) in enumerate(rows_data):
        lc = tbl.rows[i].cells[0]
        vc = tbl.rows[i].cells[1]
        _cell_bg(lc, "DBEAFE")
        r_lbl = lc.paragraphs[0].add_run(lbl)
        _font(r_lbl, 10, bold=True, color=DARK)
        r_val = vc.paragraphs[0].add_run(val)
        _font(r_val, 10, color=DARK)

    doc.add_paragraph()

    # ── Attendees ─────────────────────────────────────────────────────────────
    _section_bar(doc, "ATTENDEES")
    att = doc.add_paragraph()
    r = att.add_run("{{ attendees }}")
    _font(r, 10, color=DARK)
    _spacing(att, before=4, after=8)

    # ── Agenda & Discussion ───────────────────────────────────────────────────
    _section_bar(doc, "AGENDA & DISCUSSION")
    doc.add_paragraph()

    _ctrl(doc, "{%- for item in agenda_items %}")

    # Item heading with bottom border
    h_item = doc.add_paragraph()
    _border_bottom(h_item)
    _spacing(h_item, before=8, after=2)
    r = h_item.add_run("{{ item.sequence }}.  {{ item.title }}")
    _font(r, 12, bold=True, color=BLUE)

    # Discussion notes
    p_disc = doc.add_paragraph()
    r = p_disc.add_run("{{ item.discussion_notes }}")
    _font(r, 10, color=DARK)
    _spacing(p_disc, before=2, after=4)

    # Action items block
    _ctrl(doc, "{%- if item.action_items %}")
    p_al = doc.add_paragraph()
    r = p_al.add_run("Action Items:")
    _font(r, 10, bold=True, color=BLUE)
    _spacing(p_al, before=2, after=1)
    _ctrl(doc, "{%- for action in item.action_items %}")
    p_ai = doc.add_paragraph(style="List Bullet")
    r = p_ai.add_run("{{ action }}")
    _font(r, 10, color=DARK)
    _ctrl(doc, "{%- endfor %}")
    _ctrl(doc, "{%- endif %}")

    # Screenshot
    _ctrl(doc, "{%- if item.screenshot %}")
    p_ss = doc.add_paragraph()
    r = p_ss.add_run("{{ item.screenshot }}")
    _font(r, 10)
    _spacing(p_ss, before=6, after=2)
    p_cap = doc.add_paragraph()
    p_cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p_cap.add_run("Screenshot {{ item.sequence }}")
    _font(r, 9, bold=True, color=SLATE)
    _spacing(p_cap, before=0, after=6)
    _ctrl(doc, "{%- endif %}")

    _ctrl(doc, "{%- endfor %}")

    # ── Follow-up & Next Steps ────────────────────────────────────────────────
    _ctrl(doc, "{%- if follow_up_sections %}")
    _section_bar(doc, "NEXT STEPS & FOLLOW-UP")
    _ctrl(doc, "{%- for section in follow_up_sections %}")
    p_st = doc.add_paragraph()
    r = p_st.add_run("{{ section.section_title }}")
    _font(r, 11, bold=True, color=DARK)
    _spacing(p_st, before=10, after=2)
    p_sc = doc.add_paragraph()
    r = p_sc.add_run("{{ section.content_text }}")
    _font(r, 10, color=DARK)
    _ctrl(doc, "{%- endfor %}")
    _ctrl(doc, "{%- endif %}")

    # ── Footer note ───────────────────────────────────────────────────────────
    doc.add_paragraph()
    p_gen = doc.add_paragraph()
    p_gen.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    r = p_gen.add_run("Generated: {{ generated_date }}")
    _font(r, 8, italic=True, color=SLATE)

    doc.save(str(TEMPLATE_PATH))
    _VERSION_PATH.write_text(_TEMPLATE_VERSION)
    print(f"Meeting Minutes template v{_TEMPLATE_VERSION} written to {TEMPLATE_PATH}")


if __name__ == "__main__":
    build(force=True)
