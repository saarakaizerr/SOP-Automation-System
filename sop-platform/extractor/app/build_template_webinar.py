"""
Webinar Summary DOCX template — CloudNavision branded.
Rows-only layout: NO multi-column tables. All content is full-width.
"""

from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor

# ── Brand palette ──────────────────────────────────────────────────────────────
INDIGO_HEX    = "4338CA"
INDIGO_LT_HEX = "EDE9FE"
INDIGO_MED_HEX= "C4B5FD"
NAVY_HEX      = "0A1628"
WHITE_HEX     = "FFFFFF"
SLATE_HEX     = "64748B"

INDIGO  = RGBColor(0x43, 0x38, 0xCA)
NAVY    = RGBColor(0x0A, 0x16, 0x28)
WHITE   = RGBColor(0xFF, 0xFF, 0xFF)
DARK    = RGBColor(0x1E, 0x29, 0x3B)
SLATE   = RGBColor(0x64, 0x74, 0x8B)
TEAL    = RGBColor(0x06, 0xB6, 0xD4)
ORANGE  = RGBColor(0xF9, 0x73, 0x16)
GREEN   = RGBColor(0x16, 0xA3, 0x4A)

TEMPLATE_PATH     = Path("/data/templates/webinar_template.docx")
_VERSION_PATH     = TEMPLATE_PATH.with_suffix(".version")
_TEMPLATE_VERSION = "9"

_ASSETS_DIR = Path(__file__).parent / "assets"
_CN_LOGO    = _ASSETS_DIR / "cloudnavision_logo.jpg"


# ── Helpers ────────────────────────────────────────────────────────────────────

def _font(run, size, bold=False, italic=False, color=None):
    run.font.size   = Pt(size)
    run.font.bold   = bold
    run.font.italic = italic
    run.font.name   = "Calibri"
    if color:
        run.font.color.rgb = color


def _spacing(para, before=0, after=6):
    pPr = para._p.get_or_add_pPr()
    sp  = OxmlElement("w:spacing")
    sp.set(qn("w:before"), str(int(before * 20)))
    sp.set(qn("w:after"),  str(int(after  * 20)))
    pPr.append(sp)


def _shade(para, fill_hex):
    pPr = para._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"),   "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"),  fill_hex)
    pPr.append(shd)


def _border_bottom(para, color_hex=INDIGO_HEX, size=8):
    pPr  = para._p.get_or_add_pPr()
    pBdr = OxmlElement("w:pBdr")
    bot  = OxmlElement("w:bottom")
    bot.set(qn("w:val"),   "single")
    bot.set(qn("w:sz"),    str(size))
    bot.set(qn("w:space"), "1")
    bot.set(qn("w:color"), color_hex)
    pBdr.append(bot)
    pPr.append(pBdr)


def _ctrl(doc, tag):
    p = doc.add_paragraph(tag)
    p.style = "Normal"
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after  = Pt(0)


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


def _section_bar(doc, label):
    """Full-width navy bar + thin indigo accent line."""
    p = doc.add_paragraph()
    _shade(p, NAVY_HEX)
    _spacing(p, before=14, after=0)
    r = p.add_run(f"  {label}")
    _font(r, 10, bold=True, color=WHITE)

    p2 = doc.add_paragraph()
    _shade(p2, INDIGO_HEX)
    _spacing(p2, before=0, after=4)
    p2.add_run("").font.size = Pt(2)


def _detail_row(doc, label, value, bg_hex):
    """One full-width info row: bold label + value."""
    p = doc.add_paragraph()
    _shade(p, bg_hex)
    _spacing(p, before=2, after=2)
    rl = p.add_run(f"  {label}:  ")
    _font(rl, 9, bold=True, color=NAVY)
    rv = p.add_run(value)
    _font(rv, 9, color=DARK)


def _build_header(section):
    hdr = section.header
    hdr.is_linked_to_previous = False
    p = hdr.paragraphs[0]
    p.clear()
    _spacing(p, before=0, after=0)
    if _CN_LOGO.exists():
        r = p.add_run()
        r.add_picture(str(_CN_LOGO), height=Cm(1.2))
        p.add_run("  ").font.size = Pt(8)
    r2 = p.add_run("Webinar Summary")
    _font(r2, 9, italic=True, color=SLATE)
    p2 = hdr.add_paragraph()
    _spacing(p2, before=0, after=0)
    pPr = p2._p.get_or_add_pPr()
    pBdr = OxmlElement("w:pBdr")
    bot  = OxmlElement("w:bottom")
    bot.set(qn("w:val"),   "single")
    bot.set(qn("w:sz"),    "6")
    bot.set(qn("w:space"), "1")
    bot.set(qn("w:color"), INDIGO_HEX)
    pBdr.append(bot)
    pPr.append(pBdr)
    p2.add_run(" ").font.size = Pt(1)


def _build_footer(section):
    footer = section.footer
    footer.is_linked_to_previous = False
    p = footer.paragraphs[0]
    p.clear()
    _spacing(p, before=4, after=0)
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement("w:pBdr")
    top  = OxmlElement("w:top")
    top.set(qn("w:val"),   "single")
    top.set(qn("w:sz"),    "6")
    top.set(qn("w:space"), "1")
    top.set(qn("w:color"), INDIGO_HEX)
    pBdr.append(top)
    pPr.append(pBdr)
    tabs = OxmlElement("w:tabs")
    tab  = OxmlElement("w:tab")
    tab.set(qn("w:val"), "right")
    tab.set(qn("w:pos"), "8640")
    tabs.append(tab)
    pPr.append(tabs)
    r1 = p.add_run("CloudNavision Private Limited  |  cloudnavision.com")
    _font(r1, 8, italic=True, color=SLATE)
    p.add_run("\t").font.size = Pt(8)
    r3 = p.add_run("Page ")
    _font(r3, 8, color=SLATE)
    r4 = p.add_run("")
    _font(r4, 8, color=INDIGO)
    _add_page_number(r4)


# ── Builder ────────────────────────────────────────────────────────────────────

def build(force=False):
    if not force and TEMPLATE_PATH.exists():
        try:
            if _VERSION_PATH.read_text().strip() == _TEMPLATE_VERSION:
                return
        except Exception:
            pass

    TEMPLATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(11)
    style.paragraph_format.space_after = Pt(6)

    sec = doc.sections[0]
    sec.page_width    = Cm(21)
    sec.page_height   = Cm(29.7)
    sec.top_margin    = Cm(2.8)
    sec.bottom_margin = Cm(2.5)
    sec.left_margin   = Cm(2.5)
    sec.right_margin  = Cm(2.5)
    _build_header(sec)
    _build_footer(sec)

    # ── TITLE ──────────────────────────────────────────────────────────────────
    p = doc.add_paragraph()
    _shade(p, NAVY_HEX)
    _spacing(p, before=0, after=0)
    _font(p.add_run("  WEBINAR SUMMARY"), 24, bold=True, color=WHITE)

    p2 = doc.add_paragraph()
    _shade(p2, INDIGO_HEX)
    _spacing(p2, before=0, after=0)
    p2.add_run("").font.size = Pt(3)

    p3 = doc.add_paragraph()
    _shade(p3, INDIGO_LT_HEX)
    _spacing(p3, before=0, after=0)
    _font(p3.add_run("  {{ doc_title }}"), 13, bold=True, color=NAVY)

    doc.add_paragraph().paragraph_format.space_after = Pt(6)

    # ── SESSION DETAILS — full-width rows, no table ────────────────────────────
    _section_bar(doc, "SESSION DETAILS")

    detail_rows = [
        ("Session Title",   "{{ doc_title }}"),
        ("Date",            "{{ session_date }}"),
        ("Presenter",       "{{ presenter }}"),
        ("Platform / Host", ""),
        ("Duration",        ""),
        ("Prepared By",     "CloudNavision"),
        ("Reference No.",   "WS-{{ generated_date }}"),
        ("Status",          "Completed"),
    ]
    for i, (lbl, val) in enumerate(detail_rows):
        _detail_row(doc, lbl, val, INDIGO_LT_HEX if i % 2 == 0 else WHITE_HEX)

    doc.add_paragraph().paragraph_format.space_after = Pt(6)

    # ── SESSION OVERVIEW ───────────────────────────────────────────────────────
    _ctrl(doc, "{% if overview_text %}")
    _section_bar(doc, "SESSION OVERVIEW")
    p_ov = doc.add_paragraph()
    _font(p_ov.add_run("{{ overview_text }}"), 10, color=DARK)
    _spacing(p_ov, before=4, after=8)
    _ctrl(doc, "{% endif %}")

    # ── LEARNING OBJECTIVES ────────────────────────────────────────────────────
    _section_bar(doc, "LEARNING OBJECTIVES")
    objectives = [
        "Understand the end-to-end process covered in this session",
        "Identify key steps, decisions, and system interactions",
        "Apply the demonstrated workflow in day-to-day operations",
    ]
    for i, obj in enumerate(objectives):
        p_obj = doc.add_paragraph()
        _shade(p_obj, INDIGO_LT_HEX if i % 2 == 0 else WHITE_HEX)
        _spacing(p_obj, before=3, after=3)
        _font(p_obj.add_run(f"  {i+1}.  "), 10, bold=True, color=INDIGO)
        _font(p_obj.add_run(obj), 10, color=DARK)

    doc.add_paragraph().paragraph_format.space_after = Pt(6)

    # ── TOPICS COVERED — full-width rows ───────────────────────────────────────
    _section_bar(doc, "TOPICS COVERED")

    _ctrl(doc, "{% for topic in topics %}")

    # Topic heading row
    p_th = doc.add_paragraph()
    _shade(p_th, INDIGO_LT_HEX)
    _spacing(p_th, before=10, after=0)
    _font(p_th.add_run("  {{ topic.number }}."), 11, bold=True, color=INDIGO)
    _font(p_th.add_run("  {{ topic.title }}"), 11, bold=True, color=NAVY)
    _border_bottom(p_th, INDIGO_HEX, size=6)

    # Topic summary label
    p_sl = doc.add_paragraph()
    _spacing(p_sl, before=6, after=0)
    _font(p_sl.add_run("  Topic Summary:"), 9, bold=True, color=INDIGO)

    # Content
    p_cnt = doc.add_paragraph()
    _font(p_cnt.add_run("{{ topic.content }}"), 10, color=DARK)
    _spacing(p_cnt, before=2, after=4)

    # Key points header
    _ctrl(doc, "{% if topic.key_points %}")
    p_kh = doc.add_paragraph()
    _shade(p_kh, INDIGO_HEX)
    _spacing(p_kh, before=4, after=0)
    _font(p_kh.add_run("  Key Points:"), 9, bold=True, color=WHITE)

    _ctrl(doc, "{% for point in topic.key_points %}")
    p_kp = doc.add_paragraph()
    _spacing(p_kp, before=1, after=1)
    _font(p_kp.add_run("  ▸  "), 10, color=INDIGO)
    _font(p_kp.add_run("{{ point }}"), 10, color=DARK)
    _ctrl(doc, "{% endfor %}")
    _ctrl(doc, "{% endif %}")

    # Screenshot — full-width paragraph
    _ctrl(doc, "{% if topic.screenshot %}")
    p_ss = doc.add_paragraph()
    p_ss.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _spacing(p_ss, before=8, after=2)
    _font(p_ss.add_run("{{ topic.screenshot }}"), 10)

    p_cap = doc.add_paragraph()
    p_cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _spacing(p_cap, before=0, after=8)
    _font(p_cap.add_run("Screenshot — Topic {{ topic.number }}: {{ topic.title }}"),
          9, italic=True, color=SLATE)
    _ctrl(doc, "{% endif %}")

    # Topic divider
    p_div = doc.add_paragraph()
    _spacing(p_div, before=6, after=0)
    _border_bottom(p_div, INDIGO_HEX, size=2)
    p_div.add_run("").font.size = Pt(1)

    _ctrl(doc, "{% endfor %}")

    doc.add_paragraph().paragraph_format.space_after = Pt(6)

    # ── KEY TAKEAWAYS — full-width rows ────────────────────────────────────────
    doc.add_page_break()
    _section_bar(doc, "KEY TAKEAWAYS SUMMARY")

    _ctrl(doc, "{% for topic in topics %}")
    _ctrl(doc, "{% if topic.key_points %}")

    p_ktt = doc.add_paragraph()
    _shade(p_ktt, INDIGO_LT_HEX)
    _spacing(p_ktt, before=8, after=0)
    _font(p_ktt.add_run("  {{ topic.number }}."), 10, bold=True, color=INDIGO)
    _font(p_ktt.add_run("  {{ topic.title }}"), 10, bold=True, color=NAVY)
    _border_bottom(p_ktt, INDIGO_HEX, size=4)

    _ctrl(doc, "{% for point in topic.key_points %}")
    p_ktb = doc.add_paragraph()
    _spacing(p_ktb, before=2, after=2)
    _font(p_ktb.add_run("    ▸  "), 10, color=INDIGO)
    _font(p_ktb.add_run("{{ point }}"), 10, color=DARK)
    _ctrl(doc, "{% endfor %}")

    _ctrl(doc, "{% endif %}")
    _ctrl(doc, "{% endfor %}")

    doc.add_paragraph().paragraph_format.space_after = Pt(8)

    # ── RESOURCES & REFERENCES ─────────────────────────────────────────────────
    _ctrl(doc, "{% if resource_sections %}")
    _section_bar(doc, "RESOURCES & REFERENCES")
    _ctrl(doc, "{% for section in resource_sections %}")
    p_rt = doc.add_paragraph()
    _spacing(p_rt, before=8, after=2)
    _font(p_rt.add_run("{{ section.section_title }}"), 10, bold=True, color=NAVY)
    p_rc = doc.add_paragraph()
    _font(p_rc.add_run("{{ section.content_text }}"), 10, color=DARK)
    _ctrl(doc, "{% endfor %}")
    doc.add_paragraph().paragraph_format.space_after = Pt(6)
    _ctrl(doc, "{% endif %}")

    # ── POST-WEBINAR ACTION ITEMS — rows ───────────────────────────────────────
    _section_bar(doc, "POST-WEBINAR ACTION ITEMS")

    # Header row
    p_pah = doc.add_paragraph()
    _shade(p_pah, NAVY_HEX)
    _spacing(p_pah, before=0, after=0)
    _font(p_pah.add_run("  #    Action Item    |    Owner    |    Target Date"), 9, bold=True, color=WHITE)

    for i in range(1, 4):
        bg = INDIGO_LT_HEX if i % 2 != 0 else WHITE_HEX
        p_par = doc.add_paragraph()
        _shade(p_par, bg)
        _spacing(p_par, before=3, after=3)
        _font(p_par.add_run(f"  {i}."), 9, bold=True, color=INDIGO)
        _font(p_par.add_run("                                                              "), 9, color=DARK)

    doc.add_paragraph().paragraph_format.space_after = Pt(8)

    # ── FEEDBACK & EVALUATION — rows ───────────────────────────────────────────
    _section_bar(doc, "FEEDBACK & EVALUATION")

    p_fh = doc.add_paragraph()
    _shade(p_fh, NAVY_HEX)
    _spacing(p_fh, before=0, after=0)
    _font(p_fh.add_run("  Evaluation Criteria    |    Rating (1–5)    |    Comments"), 9, bold=True, color=WHITE)

    fb_criteria = [
        "Content Relevance & Clarity",
        "Presenter's Delivery",
        "Visual Aids & Screenshots",
        "Overall Session Value",
    ]
    for i, crit in enumerate(fb_criteria):
        bg = INDIGO_LT_HEX if i % 2 == 0 else WHITE_HEX
        p_fb = doc.add_paragraph()
        _shade(p_fb, INDIGO_MED_HEX if i % 2 == 0 else bg)
        _spacing(p_fb, before=4, after=4)
        _font(p_fb.add_run(f"  {crit}"), 9, bold=True, color=NAVY)

    doc.add_paragraph().paragraph_format.space_after = Pt(6)

    # ── GENERATED NOTE ─────────────────────────────────────────────────────────
    p_gen = doc.add_paragraph()
    p_gen.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    _font(p_gen.add_run("Generated by CloudNavision SOP Platform  |  {{ generated_date }}"),
          8, italic=True, color=SLATE)

    doc.save(str(TEMPLATE_PATH))
    _VERSION_PATH.write_text(_TEMPLATE_VERSION)
    print(f"Webinar template v{_TEMPLATE_VERSION} written to {TEMPLATE_PATH}")


if __name__ == "__main__":
    build(force=True)
