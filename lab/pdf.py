from io import BytesIO
import re
from datetime import datetime
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape

from django.conf import settings
from django.utils import timezone
from reportlab.graphics.barcode import code128, qr
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.platypus import (
    Flowable,
    HRFlowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from .models import PrintSettings


class ActualSizeCanvas(pdfcanvas.Canvas):
    """Ask PDF viewers / drivers to print at 100% (no fit-to-page scaling).

    Pages are buffered so authorized signatory can be stamped on the last page
    only — never alone on a wasted nearly-empty trailing page.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Honoured by Adobe Reader, Edge, and many Windows print paths.
        self.setViewerPreference('PrintScaling', 'None')
        self._saved_page_states = []
        self._on_last_page = None

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            if self._pageNumber == total and callable(self._on_last_page):
                self._on_last_page(self)
            pdfcanvas.Canvas.showPage(self)
        pdfcanvas.Canvas.save(self)


class TranslucentBand(Flowable):
    """Draw a translucent filled rectangle, then the inner flowable on top.

    Table BACKGROUND alpha is ignored by many PDF viewers; canvas fill opacity works.
    """

    def __init__(self, inner, fill_rgb=(0.82, 0.82, 0.82), alpha=0.55, stroke=True):
        super().__init__()
        self.inner = inner
        self.fill_rgb = fill_rgb
        self.alpha = alpha
        self.stroke = stroke
        self._width = 0
        self._height = 0

    def wrap(self, availWidth, availHeight):
        self._width, self._height = self.inner.wrap(availWidth, availHeight)
        return self._width, self._height

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFillColorRGB(*self.fill_rgb)
        if hasattr(c, 'setFillAlpha'):
            c.setFillAlpha(self.alpha)
        c.rect(0, 0, self._width, self._height, stroke=0, fill=1)
        if self.stroke:
            c.setStrokeColor(INK)
            c.setLineWidth(0.7)
            if hasattr(c, 'setStrokeAlpha'):
                c.setStrokeAlpha(0.55)
            c.rect(0, 0, self._width, self._height, stroke=1, fill=0)
        c.restoreState()
        self.inner.drawOn(c, 0, 0)


# Pure B/W palette — colour printers are fine; mono printers stay crisp.
INK = colors.black
MUTED = colors.HexColor('#222222')
LINE = colors.black
# Patient card fill (opaque fallback; translucent drawn via TranslucentBand when wrapped).
HEADER_BG = colors.Color(1, 1, 1, alpha=0.75)
GREEN = INK  # kept for any legacy refs; print uses black
RED = INK

A4_W_MM = 210.0
A4_H_MM = 297.0


def _print_layout():
    """
    Settings define the printable plate (width × height from top-left).
    PDF media is always A4 so printers don't scale; content is clipped to
    that plate starting at the top-left corner of the A4 page.
    """
    cfg = PrintSettings.load()
    # Use sizes stored in the DB exactly — never rewrite them during PDF build.
    plate_w_mm = float(cfg.page_width_mm)
    plate_h_mm = float(cfg.page_height_mm)
    # Never larger than A4 — overflow would leave the printer page.
    plate_w_mm = min(max(plate_w_mm, 80.0), A4_W_MM)
    plate_h_mm = min(max(plate_h_mm, 80.0), A4_H_MM)

    media_w = A4_W_MM * mm
    media_h = A4_H_MM * mm
    plate_w = plate_w_mm * mm
    plate_h = plate_h_mm * mm

    left = float(cfg.margin_left_mm) * mm
    right_in_plate = float(cfg.margin_right_mm) * mm
    header_h = float(cfg.header_height_mm) * mm
    footer_h = float(cfg.footer_height_mm) * mm

    # Frame sits inside the top-left plate; unused A4 area stays blank.
    # rightMargin is measured from the A4 right edge.
    right = media_w - plate_w + right_in_plate
    # bottomMargin is measured from the A4 bottom edge.
    bottom = media_h - plate_h + footer_h
    top = header_h

    content_w = max(plate_w - left - right_in_plate, 60 * mm)
    return {
        'cfg': cfg,
        'pagesize': (media_w, media_h),
        'left': left,
        'right': right,
        'right_in_plate': right_in_plate,
        'header_h': header_h,
        'footer_h': footer_h,
        'bottom': bottom,
        'top': top,
        'content_w': content_w,
        'page_w': media_w,
        'page_h': media_h,
        'plate_w': plate_w,
        'plate_h': plate_h,
        'plate_w_mm': plate_w_mm,
        'plate_h_mm': plate_h_mm,
    }


def _detect_lan_ip():
    """Best-effort LAN IP so phone QR codes do not use localhost."""
    import socket

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(('8.8.8.8', 80))
        ip = sock.getsockname()[0]
        sock.close()
        if ip and not ip.startswith('127.'):
            return ip
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith('127.'):
                return ip
    except OSError:
        pass
    return ''


def _publicize_base_url(base):
    """Rewrite localhost / Vite proxy hosts to a phone-reachable LAN URL."""
    from urllib.parse import urlparse

    base = str(base or '').strip().rstrip('/')
    if not base:
        lan = _detect_lan_ip()
        return f'http://{lan}:8000' if lan else ''

    if ':5173' in base:
        base = base.replace(':5173', ':8000')

    parsed = urlparse(base if '://' in base else f'http://{base}')
    host = (parsed.hostname or '').lower()
    if host in ('localhost', '127.0.0.1', '0.0.0.0', '::1'):
        lan = _detect_lan_ip()
        if lan:
            port = parsed.port or 8000
            scheme = parsed.scheme or 'http'
            return f'{scheme}://{lan}:{port}'
    return base.rstrip('/')


def resolve_public_base_url(fallback=''):
    cfg = PrintSettings.load()
    configured = (cfg.public_base_url or '').strip().rstrip('/')
    if configured:
        return _publicize_base_url(configured)

    from django.conf import settings as dj_settings

    env_base = getattr(dj_settings, 'PUBLIC_BASE_URL', '') or ''
    env_base = str(env_base).strip().rstrip('/')
    if env_base:
        return _publicize_base_url(env_base)

    return _publicize_base_url(fallback)


def report_share_url(booking, public_base_url=''):
    if not booking.share_token:
        booking.share_token = __import__('uuid').uuid4()
        booking.save(update_fields=['share_token'])
    base = resolve_public_base_url(public_base_url)
    # Open the mobile viewer page (shows full pages including letterhead background).
    path = f'/r/{booking.share_token}/'
    if base:
        return f'{base}{path}'
    return path


def build_report_pdf(booking, public_base_url=None, include_background=True):
    layout = _print_layout()
    cfg = layout['cfg']
    page_w = layout['page_w']
    page_h = layout['page_h']
    content_w = layout['content_w']
    draw_background = bool(include_background)

    buffer = BytesIO()
    # topMargin is finalized after measuring the repeating patient header below.
    doc = SimpleDocTemplate(
        buffer,
        pagesize=layout['pagesize'],
        leftMargin=layout['left'],
        rightMargin=layout['right'],
        topMargin=layout['top'],
        bottomMargin=layout['bottom'],
        title=f'Report {booking.report_no}',
    )

    styles = getSampleStyleSheet()
    lab_title = ParagraphStyle(
        'LabTitle',
        parent=styles['Normal'],
        fontName='Times-Bold',
        fontSize=16,
        textColor=INK,
        alignment=1,
        spaceAfter=1,
    )
    lab_sub = ParagraphStyle(
        'LabSub',
        parent=styles['Normal'],
        fontName='Times-Roman',
        fontSize=9,
        textColor=INK,
        alignment=1,
        spaceAfter=8,
    )
    meta_label = ParagraphStyle(
        'MetaLabel',
        parent=styles['Normal'],
        fontName='Times-Roman',
        fontSize=9,
        textColor=INK,
        leading=12,
    )
    col_head = ParagraphStyle(
        'ColHead',
        parent=styles['Normal'],
        fontName='Times-Bold',
        fontSize=10,
        textColor=INK,
        leading=12,
    )
    test_head = ParagraphStyle(
        'TestHead',
        parent=styles['Normal'],
        fontName='Times-Bold',
        fontSize=11,
        textColor=INK,
        leading=13,
        spaceBefore=2,
        spaceAfter=1,
    )
    param_name = ParagraphStyle(
        'ParamName',
        parent=styles['Normal'],
        fontName='Times-Roman',
        fontSize=10,
        textColor=INK,
        leading=12,
    )
    result_normal = ParagraphStyle(
        'ResultNormal',
        parent=styles['Normal'],
        fontName='Times-Roman',
        fontSize=9.5,
        textColor=INK,
        alignment=1,
        leading=12,
    )
    result_in = ParagraphStyle(
        'ResultIn',
        parent=styles['Normal'],
        fontName='Times-Roman',
        fontSize=9.5,
        textColor=INK,
        alignment=1,
        leading=12,
    )
    result_out = ParagraphStyle(
        'ResultOut',
        parent=styles['Normal'],
        fontName='Times-Roman',
        fontSize=9.5,
        textColor=INK,
        alignment=1,
        leading=12,
    )
    unit_style = ParagraphStyle(
        'Unit',
        parent=styles['Normal'],
        fontName='Times-Roman',
        fontSize=8.5,
        textColor=INK,
        alignment=1,
        leading=11,
    )
    range_style = ParagraphStyle(
        'Range',
        parent=styles['Normal'],
        fontName='Times-Roman',
        fontSize=8.5,
        textColor=INK,
        alignment=2,
        leading=11,
    )
    range_head = ParagraphStyle(
        'RangeHead',
        parent=col_head,
        alignment=2,
    )
    end_style = ParagraphStyle(
        'End',
        parent=styles['Normal'],
        fontName='Times-Bold',
        fontSize=10,
        textColor=INK,
        alignment=1,
        spaceBefore=6,
        spaceAfter=2,
    )
    sign_style = ParagraphStyle(
        'Sign',
        parent=styles['Normal'],
        fontName='Times-Roman',
        fontSize=9,
        textColor=INK,
        alignment=2,
        leading=11,
        spaceBefore=0,
        spaceAfter=0,
    )

    patient = booking.patient
    doctor_name = booking.doctor.display_name if booking.doctor else '—'
    gender = patient.get_gender_display()
    age_gender = f'{patient.age if patient.age is not None else ""}/{gender}'
    now = timezone.localtime()

    from lab.widal import COLS as WIDAL_COLS
    from lab.widal import RESULT_NAME as WIDAL_RESULT
    from lab.widal import ROWS as WIDAL_ROWS
    from lab.widal import cell_name as widal_cell_name
    from lab.widal import is_widal_test

    lab_name = getattr(settings, 'LAB_NAME', 'Khalsa Clinical Laboratory')
    share_url = report_share_url(booking, public_base_url=public_base_url or '')
    col_desc = content_w * 0.48
    col_result = content_w * 0.15
    col_unit = content_w * 0.14
    col_range = content_w - col_desc - col_result - col_unit
    col_widths = [col_desc, col_result, col_unit, col_range]

    def _col_header_table():
        t = Table(
            [
                [
                    Paragraph('Test Description', col_head),
                    Paragraph('Result', col_head),
                    Paragraph('Unit', col_head),
                    Paragraph('Reference Range', range_head),
                ]
            ],
            colWidths=col_widths,
        )
        t.setStyle(
            TableStyle(
                [
                    # No Table BACKGROUND — translucent fill is drawn by TranslucentBand.
                    ('LINEBELOW', (0, 0), (-1, 0), 1.25, LINE),
                    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                    ('LEFTPADDING', (0, 0), (-1, -1), 3),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 3),
                    ('TOPPADDING', (0, 0), (-1, -1), 4),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                    ('ALIGN', (1, 0), (2, 0), 'CENTER'),
                    ('ALIGN', (3, 0), (3, 0), 'RIGHT'),
                ]
            )
        )
        return TranslucentBand(t, fill_rgb=(0.78, 0.78, 0.78), alpha=0.5, stroke=True)

    def _widal_flowable(all_results):
        by_name = {r.parameter.name: r for r in all_results}
        cell_style = ParagraphStyle(
            'WidalCell',
            parent=styles['Normal'],
            fontName='Times-Bold',
            fontSize=12,
            alignment=1,
            textColor=INK,
            leading=14,
        )
        label_style = ParagraphStyle(
            'WidalLabel',
            parent=styles['Normal'],
            fontName='Times-Roman',
            fontSize=8,
            alignment=0,
            textColor=INK,
        )
        matrix = [[''] + [Paragraph(c, cell_style) for c in WIDAL_COLS]]
        for row_name in WIDAL_ROWS:
            line = [Paragraph(row_name, label_style)]
            for col in WIDAL_COLS:
                cell = by_name.get(widal_cell_name(row_name, col))
                # Blank cells print as * (not − / —) so they don't look like negative.
                val = ((cell.value if cell else '') or '').strip() or '*'
                line.append(Paragraph(val, cell_style))
            matrix.append(line)
        result_val = ''
        if by_name.get(WIDAL_RESULT):
            result_val = (by_name[WIDAL_RESULT].value or '').strip()
        matrix.append(
            [
                Paragraph('RESULT', label_style),
                Paragraph(f'<b>{result_val or "*"}</b>', cell_style),
                '',
                '',
                '',
                '',
            ]
        )
        antigen_w = content_w * 0.38
        dil_w = (content_w - antigen_w) / len(WIDAL_COLS)
        inner = Table(matrix, colWidths=[antigen_w] + [dil_w] * len(WIDAL_COLS))
        inner.setStyle(
            TableStyle(
                [
                    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                    ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
                    ('LEFTPADDING', (0, 0), (-1, -1), 2),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 2),
                    ('TOPPADDING', (0, 0), (-1, -1), 3),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
                    ('SPAN', (1, -1), (-1, -1)),
                    ('LINEABOVE', (0, -1), (-1, -1), 0.5, LINE),
                ]
            )
        )
        return inner

    def _standard_param_rows(filled_results):
        from lab.param_methods import resolve_param_method

        rows = []
        for result in filled_results:
            param = result.parameter
            value = (result.value or '').strip()
            display_value = _format_indian_number(value)
            state = evaluate_result_range(value, param.reference_range)
            # No H/L markers; keep out-of-range readable without heavy bold.
            if state in ('high', 'low'):
                result_para = Paragraph(display_value, result_out)
            elif state == 'in':
                result_para = Paragraph(display_value, result_in)
            else:
                result_para = Paragraph(display_value, result_normal)
            method = resolve_param_method(param)
            name_text = xml_escape(param.name.upper())
            if method:
                # Single Paragraph — nested Tables inside result rows explode wrap height.
                name_para = Paragraph(
                    f'{name_text}<br/><font size="7">({xml_escape(method)})</font>',
                    param_name,
                )
            else:
                name_para = Paragraph(name_text, param_name)
            rows.append(
                [
                    name_para,
                    result_para,
                    Paragraph((param.unit or '').upper(), unit_style),
                    Paragraph(param.reference_range or '', range_style),
                ]
            )
        return rows

    def _test_block(bt):
        """Return flowables for one test. Title keeps with the start of its body;
        large result tables may paginate so we never force a blank trailing page.
        """
        all_results = list(bt.results.all())
        filled_results = [r for r in all_results if (r.value or '').strip()]
        if not filled_results:
            return None

        # Underline only under the title text (≈ half width), not full page.
        title_text = bt.test.name.upper()
        title_line_w = min(
            max(stringWidth(title_text, 'Times-Bold', test_head.fontSize) + 8, content_w * 0.28),
            content_w * 0.52,
        )
        title_block = KeepTogether(
            [
                Spacer(1, 6),
                Paragraph(title_text, test_head),
                HRFlowable(
                    width=title_line_w,
                    thickness=0.9,
                    color=LINE,
                    spaceBefore=1,
                    spaceAfter=4,
                    hAlign='LEFT',
                ),
            ]
        )
        title_block.keepWithNext = True

        if is_widal_test(bt.test):
            body = _widal_flowable(all_results)
            return [KeepTogether([title_block, body])]

        body_rows = _standard_param_rows(filled_results)
        body = Table(body_rows, colWidths=col_widths)
        body.setStyle(
            TableStyle(
                [
                    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                    ('LEFTPADDING', (0, 0), (-1, -1), 3),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 3),
                    ('TOPPADDING', (0, 0), (-1, -1), 3.5),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 3.5),
                    ('ALIGN', (1, 0), (2, -1), 'CENTER'),
                    ('ALIGN', (3, 0), (3, -1), 'RIGHT'),
                ]
            )
        )
        # Do not KeepTogether the whole CBC — oversized KeepTogether forces blank
        # pages. Title uses keepWithNext so it stays with the start of the table.
        return [title_block, body]

    def _build_patient_header():
        """Full 3-column header (patient / barcode+dates / QR) — same on every page."""
        if not cfg.show_patient_header:
            return None
        barcode_value = (booking.report_no or str(booking.id)).replace('-', '')
        barcode = code128.Code128(barcode_value, barHeight=10 * mm, barWidth=0.75, humanReadable=0)
        qr_widget = qr.QrCodeWidget(share_url)
        qr_bounds = qr_widget.getBounds()
        qr_w = qr_bounds[2] - qr_bounds[0]
        qr_h = qr_bounds[3] - qr_bounds[1]
        qr_size = min(28 * mm, content_w * 0.16)
        qr_drawing = Drawing(qr_size, qr_size, transform=[qr_size / qr_w, 0, 0, qr_size / qr_h, 0, 0])
        qr_drawing.add(qr_widget)

        left_w = content_w * 0.38
        mid_w = content_w * 0.42
        right_w = content_w - left_w - mid_w

        left_meta = [
            [Paragraph('Name', meta_label), Paragraph(f':  <b>{patient.display_name}</b>', meta_label)],
            [Paragraph('Age/Gender', meta_label), Paragraph(f':  {age_gender}', meta_label)],
            [Paragraph('Referred By', meta_label), Paragraph(f':  {doctor_name}', meta_label)],
            [Paragraph('Report ID', meta_label), Paragraph(f':  {booking.report_no or "—"}', meta_label)],
        ]
        left_table = Table(left_meta, colWidths=[left_w * 0.38, left_w * 0.62])
        left_table.setStyle(
            TableStyle(
                [
                    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                    ('LEFTPADDING', (0, 0), (-1, -1), 2),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 2),
                    ('TOPPADDING', (0, 0), (-1, -1), 2),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
                ]
            )
        )

        mid_meta = [
            [barcode],
            [Paragraph(f'<b>Regt. Date</b> : {_fmt_date(booking.test_date or booking.created_at)}', meta_label)],
            [Paragraph(f'<b>Rec. Date</b> : {_fmt_dt(booking.sample_received_at)}', meta_label)],
            [Paragraph(f'<b>Report Date</b> : {_fmt_dt(booking.report_ready_at)}', meta_label)],
            [Paragraph(f'<b>Print On</b> : {_fmt_dt(now)}', meta_label)],
        ]
        mid_table = Table(mid_meta, colWidths=[mid_w])
        mid_table.setStyle(
            TableStyle(
                [
                    ('ALIGN', (0, 0), (0, 0), 'CENTER'),
                    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                    ('LEFTPADDING', (0, 0), (-1, -1), 2),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 2),
                    ('TOPPADDING', (0, 0), (-1, -1), 1),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 1),
                ]
            )
        )

        header = Table(
            [[left_table, mid_table, qr_drawing]],
            colWidths=[left_w, mid_w, right_w],
        )
        header.setStyle(
            TableStyle(
                [
                    ('BOX', (0, 0), (-1, -1), 1.25, LINE),
                    ('LINEAFTER', (0, 0), (0, 0), 1, LINE),
                    ('LINEAFTER', (1, 0), (1, 0), 1, LINE),
                    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                    ('LEFTPADDING', (0, 0), (-1, -1), 6),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 6),
                    ('TOPPADDING', (0, 0), (-1, -1), 6),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
                ]
            )
        )
        # Soft white panel so letterhead shows through (table BACKGROUND alpha is ignored).
        return TranslucentBand(header, fill_rgb=(1, 1, 1), alpha=0.78, stroke=False)

    # Reserve vertical space so the same patient header can be drawn on every page.
    repeating_header_h = 0
    sample_header = _build_patient_header()
    if sample_header is not None:
        _, repeating_header_h = sample_header.wrap(content_w, page_h)
        repeating_header_h += 8  # gap below header before results
    if cfg.show_lab_title:
        # Lab title sits above the patient card on every page.
        repeating_header_h += 28
    doc.topMargin = layout['top'] + repeating_header_h

    booking_tests = list(
        booking.booking_tests.select_related('test__category').prefetch_related(
            'results__parameter',
            'test__parameters',
        )
    )
    test_blocks = []
    for bt in booking_tests:
        block = _test_block(bt)
        if block is not None:
            test_blocks.append(block)

    # Compact end marker — signature is stamped on the last page via canvas so
    # a tall KeepTogether cannot open a nearly blank trailing page by itself.
    end_marker = KeepTogether(
        [
            Paragraph('**** END OF REPORT ****', end_style),
            HRFlowable(width='100%', thickness=1, color=LINE, spaceBefore=2, spaceAfter=2),
        ]
    )

    story = [_col_header_table()]
    for block in test_blocks:
        story.extend(block)
    # Small end marker only — signature is drawn on the last page via canvas.
    # Never KeepTogether this with a tall results table (that caused empty pages).
    story.append(end_marker)

    bg_path = ''
    if draw_background and cfg.background_image:
        try:
            bg_path = cfg.background_image.path
        except ValueError:
            bg_path = ''

    plate_w = layout['plate_w']
    plate_h = layout['plate_h']
    # Plate origin: top-left of A4 → PDF y = media_h - plate_h
    plate_y = page_h - plate_h

    def _page_chrome(canvas, doc_):
        canvas.saveState()
        # Letterhead only inside the settings plate (top-left), never stretched to full A4.
        if bg_path and Path(bg_path).exists():
            canvas.drawImage(
                bg_path,
                0,
                plate_y,
                width=plate_w,
                height=plate_h,
                preserveAspectRatio=False,
                mask='auto',
            )

        # Footer chrome inside the plate footer band (disclaimer lives here so it
        # cannot force an almost-empty trailing page).
        footer_y = plate_y + max(4 * mm, layout['footer_h'] * 0.28)
        plate_right = plate_w - layout['right_in_plate']
        mid_x = (layout['left'] + plate_right) / 2
        canvas.setFillColor(MUTED)
        if layout['footer_h'] >= 10 * mm:
            canvas.setFont('Times-Italic', 7)
            canvas.drawCentredString(
                mid_x,
                footer_y + 4.2 * mm,
                'This is a computer-generated report from Khalsa Clinical Laboratory.',
            )
        canvas.setFont('Times-Roman', 8)
        canvas.drawString(layout['left'], footer_y, f'{booking.report_no or ""} · {patient.display_name}')
        canvas.drawRightString(plate_right, footer_y, f'Page {doc_.page}')

        # Same patient header (name / barcode / QR) on every page — including page 2+.
        y_cursor = page_h - layout['top']
        if cfg.show_lab_title:
            canvas.setFillColor(INK)
            canvas.setFont('Times-Bold', 14)
            canvas.drawCentredString(mid_x, y_cursor - 14, lab_name)
            canvas.setFont('Times-Roman', 8)
            canvas.drawCentredString(mid_x, y_cursor - 26, 'Laboratory Investigation Report')
            y_cursor -= 30
        header = _build_patient_header()
        if header is not None:
            _, hh = header.wrap(content_w, page_h)
            header.drawOn(canvas, layout['left'], y_cursor - hh)
        canvas.restoreState()

    def _draw_last_page_signature(canv):
        """Authorized signatory only on the last page (footer band)."""
        plate_right = plate_w - layout['right_in_plate']
        y = plate_y + max(10 * mm, layout['footer_h'] * 0.55)
        canv.saveState()
        canv.setFillColor(INK)
        canv.setFont('Times-Roman', 9)
        canv.drawRightString(plate_right, y + 11, '____________________________')
        canv.drawRightString(plate_right, y, 'Authorized Signatory')
        canv.restoreState()

    def _canvas_maker(*args, **kwargs):
        c = ActualSizeCanvas(*args, **kwargs)
        c._on_last_page = _draw_last_page_signature
        return c

    doc.build(
        story,
        onFirstPage=_page_chrome,
        onLaterPages=_page_chrome,
        canvasmaker=_canvas_maker,
    )
    pdf = buffer.getvalue()
    buffer.close()
    return pdf


def evaluate_result_range(value, reference_range):
    """Return 'in' | 'high' | 'low' | None when range cannot be compared."""
    num = _parse_number(value)
    if num is None:
        return None
    range_text = str(reference_range or '').strip()
    if not range_text:
        return None

    between = re.search(r'(-?\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(-?\d+(?:\.\d+)?)', range_text, re.I)
    if between:
        low = _parse_number(between.group(1))
        high = _parse_number(between.group(2))
        if low is None or high is None:
            return None
        lo = min(low, high)
        hi = max(low, high)
        if num < lo:
            return 'low'
        if num > hi:
            return 'high'
        return 'in'

    less = re.search(r'[<≤]\s*(-?\d+(?:\.\d+)?)', range_text)
    if less:
        limit = _parse_number(less.group(1))
        if limit is None:
            return None
        return 'in' if num < limit else 'high'

    greater_eq = re.search(r'≥\s*(-?\d+(?:\.\d+)?)', range_text)
    if greater_eq:
        limit = _parse_number(greater_eq.group(1))
        if limit is None:
            return None
        return 'in' if num >= limit else 'low'

    greater = re.search(r'>\s*(-?\d+(?:\.\d+)?)', range_text)
    if greater:
        limit = _parse_number(greater.group(1))
        if limit is None:
            return None
        return 'in' if num > limit else 'low'

    upto = re.search(r'(?:upto|up to)\s*(-?\d+(?:\.\d+)?)', range_text, re.I)
    if upto:
        limit = _parse_number(upto.group(1))
        if limit is None:
            return None
        return 'in' if num <= limit else 'high'

    return None


def _parse_number(raw):
    if raw is None or raw == '':
        return None
    cleaned = str(raw).replace(',', '').strip()
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _format_indian_number(raw):
    """Format numeric results in Indian style: 198000 → 1,98,000."""
    if raw is None:
        return ''
    text = str(raw).strip()
    if not text:
        return ''
    cleaned = text.replace(',', '')
    match = re.fullmatch(r'(-?)(\d+)(?:\.(\d+))?', cleaned)
    if not match:
        return text

    sign, int_part, dec_part = match.group(1), match.group(2), match.group(3)
    int_part = int_part.lstrip('0') or '0'
    if len(int_part) <= 3:
        formatted = int_part
    else:
        last3 = int_part[-3:]
        rest = int_part[:-3]
        groups = []
        while len(rest) > 2:
            groups.insert(0, rest[-2:])
            rest = rest[:-2]
        if rest:
            groups.insert(0, rest)
        formatted = ','.join(groups) + ',' + last3
    if dec_part is not None:
        formatted = f'{formatted}.{dec_part}'
    return f'{sign}{formatted}'


def _fmt_dt(value):
    if not value:
        return '—'
    if timezone.is_aware(value):
        value = timezone.localtime(value)
    return value.strftime('%d/%m/%Y %I:%M %p')


def _fmt_date(value):
    if not value:
        return '—'
    if isinstance(value, datetime):
        if timezone.is_aware(value):
            value = timezone.localtime(value)
        return value.strftime('%d/%m/%Y')
    return value.strftime('%d/%m/%Y')
