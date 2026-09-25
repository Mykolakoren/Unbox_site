"""Минимальный генератор .xlsx без внешних зависимостей.

На сервере нет openpyxl, а тянуть пакет в прод-окружение ради одной
выгрузки не хочется. Формат xlsx — это zip с несколькими XML-файлами;
для таблиц «заголовок + строки с текстом и числами» хватает ~100 строк.

Что умеет: несколько листов, жирная закреплённая первая строка, ширина
колонок, числа (формат 0.00) и текст. Формул и объединённых ячеек нет.
"""
from __future__ import annotations

import io
import re
import zipfile
from typing import Iterable, Optional, Sequence
from xml.sax.saxutils import escape

_BAD_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
_BAD_SHEET = re.compile(r"[\[\]\:\*\?\/\\]")


def _col(n: int) -> str:
    s = ""
    n += 1
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def _cell(ref: str, value, header: bool) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, bool):
        value = "да" if value else "нет"
    if isinstance(value, (int, float)) and not header:
        return f'<c r="{ref}" s="2"><v>{round(float(value), 2)}</v></c>'
    text = escape(_BAD_XML.sub("", str(value)))
    style = ' s="1"' if header else ""
    return f'<c r="{ref}"{style} t="inlineStr"><is><t xml:space="preserve">{text}</t></is></c>'


def _sheet_xml(rows: Sequence[Sequence], widths: Optional[Sequence[int]]) -> str:
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
           '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
           '<sheetViews><sheetView workbookViewId="0">'
           '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
           '</sheetView></sheetViews>']
    if widths:
        out.append("<cols>" + "".join(
            f'<col min="{i + 1}" max="{i + 1}" width="{w}" customWidth="1"/>' for i, w in enumerate(widths)
        ) + "</cols>")
    out.append("<sheetData>")
    for r_idx, row in enumerate(rows):
        cells = "".join(_cell(f"{_col(c_idx)}{r_idx + 1}", v, r_idx == 0) for c_idx, v in enumerate(row))
        out.append(f'<row r="{r_idx + 1}">{cells}</row>')
    out.append("</sheetData></worksheet>")
    return "".join(out)


def build_xlsx(sheets: Iterable[tuple[str, Sequence[Sequence], Optional[Sequence[int]]]]) -> bytes:
    """sheets: [(имя листа, строки (первая — заголовок), ширины колонок или None)]."""
    sheets = list(sheets)
    names = []
    for name, _, _ in sheets:
        n = _BAD_SHEET.sub(" ", name)[:31] or "Лист"
        while n in names:
            n = n[:28] + f" {len(names)}"
        names.append(n)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                   '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                   + "".join(
                       f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" '
                       f'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                       for i in range(len(sheets)))
                   + "</Types>")
        z.writestr("_rels/.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                   "</Relationships>")
        z.writestr("xl/workbook.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                   'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
                   + "".join(f'<sheet name="{escape(n)}" sheetId="{i + 1}" r:id="rId{i + 1}"/>' for i, n in enumerate(names))
                   + "</sheets></workbook>")
        z.writestr("xl/_rels/workbook.xml.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   + "".join(
                       f'<Relationship Id="rId{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i + 1}.xml"/>'
                       for i in range(len(sheets)))
                   + f'<Relationship Id="rId{len(sheets) + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                   "</Relationships>")
        z.writestr("xl/styles.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                   '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
                   '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
                   '<fills count="2"><fill><patternFill patternType="none"/></fill>'
                   '<fill><patternFill patternType="gray125"/></fill></fills>'
                   '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
                   '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
                   '<cellXfs count="3">'
                   '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
                   '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
                   '<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
                   "</cellXfs></styleSheet>")
        for i, (_, rows, widths) in enumerate(sheets):
            z.writestr(f"xl/worksheets/sheet{i + 1}.xml", _sheet_xml(rows, widths))
    return buf.getvalue()
