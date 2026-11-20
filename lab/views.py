import base64

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.clickjacking import xframe_options_sameorigin
from django.views.decorators.http import require_GET, require_http_methods

from .forms import BookTestForm, CategoryForm, DoctorForm, TestForm, TestParameterFormSet
from .models import Booking, BookingTest, Category, Doctor, Patient, Test, TestResult
from .pdf import build_report_pdf, resolve_public_base_url


def _share_pdf_bytes(request, booking):
    from .models import PrintSettings

    base = resolve_public_base_url(request.build_absolute_uri('/'))
    cfg = PrintSettings.load()
    return build_report_pdf(
        booking,
        public_base_url=base,
        include_background=bool(cfg.show_background_on_qr),
    )


def _pdf_page_images(pdf_bytes, zoom=1.6):
    """Render PDF pages to PNG data-URIs so letterhead background is visible on mobile."""
    try:
        import pymupdf
    except ImportError:
        try:
            import fitz as pymupdf
        except ImportError:
            return []

    images = []
    doc = pymupdf.open(stream=pdf_bytes, filetype='pdf')
    try:
        matrix = pymupdf.Matrix(zoom, zoom)
        for page in doc:
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            images.append('data:image/png;base64,' + base64.b64encode(pix.tobytes('png')).decode('ascii'))
    finally:
        doc.close()
    return images


def _to_datetime_local(dt):
    if not dt:
        return ''
    local = timezone.localtime(dt)
    return local.strftime('%Y-%m-%dT%H:%M')


@login_required
def patients_list(request):
    q = request.GET.get('q', '').strip()
    patients = Patient.objects.all()
    if q:
        patients = patients.filter(
            Q(name__icontains=q) | Q(mobile__icontains=q) | Q(email__icontains=q)
        )
    patients = patients[:100]
    return render(
        request,
        'lab/patients.html',
        {'patients': patients, 'q': q, 'active_tab': 'patients'},
    )


@login_required
@require_GET
def patient_search_api(request):
    q = request.GET.get('q', '').strip()
    if len(q) < 1:
        return JsonResponse({'results': []})
    patients = Patient.objects.filter(
        Q(name__icontains=q) | Q(mobile__icontains=q) | Q(email__icontains=q)
    )[:15]
    results = [
        {
            'id': p.id,
            'name': p.name,
            'age': p.age,
            'gender': p.gender,
            'mobile': p.mobile,
            'email': p.email,
            'dob': p.dob.isoformat() if p.dob else '',
            'remarks': p.remarks,
        }
        for p in patients
    ]
    return JsonResponse({'results': results})


@login_required
@require_http_methods(['GET', 'POST'])
def book_test(request):
    initial = {}
    now = timezone.localtime()
    if request.method == 'GET':
        initial['test_date'] = now.strftime('%Y-%m-%dT%H:%M')
        initial['sample_collected_at'] = now.strftime('%Y-%m-%dT%H:%M')
        initial['sample_received_at'] = now.strftime('%Y-%m-%dT%H:%M')
        patient_id = request.GET.get('patient')
        if patient_id:
            patient = Patient.objects.filter(pk=patient_id).first()
            if patient:
                initial.update(
                    {
                        'patient_id': patient.id,
                        'name': patient.name,
                        'age': patient.age,
                        'gender': patient.gender,
                        'mobile': patient.mobile,
                        'dob': patient.dob,
                        'remarks': patient.remarks,
                    }
                )

    if request.method == 'POST':
        form = BookTestForm(request.POST)
        if form.is_valid():
            data = form.cleaned_data
            patient = None
            if data.get('patient_id'):
                patient = Patient.objects.filter(pk=data['patient_id']).first()
            if not patient and data.get('mobile'):
                patient = Patient.objects.filter(mobile=data['mobile'], name__iexact=data['name']).first()
            if patient:
                patient.name = data['name']
                patient.age = data.get('age')
                patient.gender = data['gender']
                patient.mobile = data.get('mobile') or patient.mobile
                patient.dob = data.get('dob') or patient.dob
                patient.remarks = data.get('remarks') or patient.remarks
                patient.save()
            else:
                patient = Patient.objects.create(
                    name=data['name'],
                    age=data.get('age'),
                    gender=data['gender'],
                    mobile=data.get('mobile') or '',
                    dob=data.get('dob'),
                    remarks=data.get('remarks') or '',
                )

            booking = Booking(
                patient=patient,
                doctor=data.get('doctor'),
                room_no=data.get('room_no') or '',
                referral_source=data['referral_source'],
                test_date=data.get('test_date') or timezone.now(),
                next_due_date=data.get('next_due_date'),
                sample_collected_at=data.get('sample_collected_at'),
                sample_received_at=data.get('sample_received_at'),
                report_ready_at=data.get('report_ready_at'),
                sample_collected_by=data.get('sample_collected_by') or '',
                sample_delivered_to=data.get('sample_delivered_to') or '',
                remarks=data.get('remarks') or '',
                status='booked',
            )
            if data.get('report_no'):
                booking.report_no = data['report_no']
            booking.save()

            messages.success(request, f'Booking {booking.report_no} created. Select tests and fill results.')
            return redirect('lab:report_workspace', pk=booking.pk)
    else:
        form = BookTestForm(initial=initial)

    return render(
        request,
        'lab/book_test.html',
        {
            'form': form,
            'active_tab': 'book',
        },
    )


def _ensure_booking_test(booking, test):
    bt, created = BookingTest.objects.get_or_create(
        booking=booking,
        test=test,
        defaults={'price': test.price},
    )
    if created or not bt.results.exists():
        for param in test.parameters.all():
            TestResult.objects.get_or_create(
                booking_test=bt,
                parameter=param,
                defaults={'value': ''},
            )
    return bt


@login_required
@require_http_methods(['GET', 'POST'])
def report_workspace(request, pk):
    booking = get_object_or_404(
        Booking.objects.select_related('patient', 'doctor').prefetch_related(
            'booking_tests__test',
            'booking_tests__results__parameter',
        ),
        pk=pk,
    )
    categories = Category.objects.prefetch_related('tests__parameters').all()
    selected_ids = set(booking.booking_tests.values_list('test_id', flat=True))
    active_test = None
    booking_test = None

    if request.method == 'POST':
        action = request.POST.get('action', 'save_results')
        test_id = request.POST.get('test_id') or request.GET.get('test')

        if action == 'add_test' and test_id:
            test = get_object_or_404(Test, pk=test_id, is_active=True)
            _ensure_booking_test(booking, test)
            messages.success(request, f'Added {test.name}.')
            return redirect(f"{reverse('lab:report_workspace', kwargs={'pk': booking.pk})}?test={test.pk}")

        if action == 'remove_test' and test_id:
            bt = booking.booking_tests.filter(test_id=test_id).first()
            if bt:
                bt.delete()
                messages.success(request, 'Test removed from report.')
            return redirect('lab:report_workspace', pk=booking.pk)

        if action == 'save_results' and test_id:
            test = get_object_or_404(Test, pk=test_id)
            bt = _ensure_booking_test(booking, test)
            for result in bt.results.all():
                key = f'result_{result.id}'
                if key in request.POST:
                    result.value = request.POST.get(key, '').strip()
                    result.save(update_fields=['value'])
            status = request.POST.get('status')
            if status in dict(Booking.STATUS_CHOICES):
                booking.status = status
                if status == 'completed' and not booking.report_ready_at:
                    booking.report_ready_at = timezone.now()
                booking.save(update_fields=['status', 'report_ready_at', 'updated_at'])
            messages.success(request, f'Results saved for {test.name}.')
            return redirect(f"{reverse('lab:report_workspace', kwargs={'pk': booking.pk})}?test={test.pk}")

    test_id = request.GET.get('test')
    if test_id:
        active_test = Test.objects.filter(pk=test_id, is_active=True).select_related('category').first()
        if active_test:
            if active_test.id in selected_ids:
                booking_test = booking.booking_tests.filter(test=active_test).prefetch_related(
                    'results__parameter'
                ).first()
            else:
                # Show parameter template before adding — auto-add on open for smoother UX
                booking_test = _ensure_booking_test(booking, active_test)
                selected_ids.add(active_test.id)

    return render(
        request,
        'lab/report_workspace.html',
        {
            'booking': booking,
            'categories': categories,
            'selected_ids': selected_ids,
            'active_test': active_test,
            'booking_test': booking_test,
            'active_tab': 'book',
        },
    )


@login_required
def doctors_list(request):
    doctors = Doctor.objects.all()
    form = DoctorForm()
    return render(
        request,
        'lab/doctors.html',
        {'doctors': doctors, 'form': form, 'active_tab': 'doctors'},
    )


@login_required
@require_http_methods(['GET', 'POST'])
def doctor_create(request):
    if request.method == 'POST':
        form = DoctorForm(request.POST)
        if form.is_valid():
            form.save()
            messages.success(request, 'Doctor added.')
            return redirect('lab:doctors')
    else:
        form = DoctorForm()
    return render(
        request,
        'lab/doctor_form.html',
        {'form': form, 'title': 'Add Doctor', 'active_tab': 'doctors'},
    )


@login_required
@require_http_methods(['GET', 'POST'])
def doctor_edit(request, pk):
    doctor = get_object_or_404(Doctor, pk=pk)
    if request.method == 'POST':
        form = DoctorForm(request.POST, instance=doctor)
        if form.is_valid():
            form.save()
            messages.success(request, 'Doctor updated.')
            return redirect('lab:doctors')
    else:
        form = DoctorForm(instance=doctor)
    return render(
        request,
        'lab/doctor_form.html',
        {'form': form, 'title': 'Edit Doctor', 'active_tab': 'doctors', 'doctor': doctor},
    )


@login_required
@require_http_methods(['POST'])
def doctor_delete(request, pk):
    doctor = get_object_or_404(Doctor, pk=pk)
    doctor.delete()
    messages.success(request, 'Doctor removed.')
    return redirect('lab:doctors')


@login_required
def categories_list(request):
    categories = Category.objects.prefetch_related('tests').all()
    form = CategoryForm()
    return render(
        request,
        'lab/categories.html',
        {'categories': categories, 'form': form, 'active_tab': 'categories'},
    )


@login_required
@require_http_methods(['POST'])
def category_create(request):
    form = CategoryForm(request.POST)
    if form.is_valid():
        form.save()
        messages.success(request, 'Category added.')
    else:
        messages.error(request, 'Could not add category. Name may already exist.')
    return redirect('lab:categories')


@login_required
@require_http_methods(['GET', 'POST'])
def category_edit(request, pk):
    category = get_object_or_404(Category, pk=pk)
    if request.method == 'POST':
        form = CategoryForm(request.POST, instance=category)
        if form.is_valid():
            form.save()
            messages.success(request, 'Category updated.')
            return redirect('lab:categories')
    else:
        form = CategoryForm(instance=category)
    return render(
        request,
        'lab/category_form.html',
        {'form': form, 'category': category, 'active_tab': 'categories'},
    )


@login_required
@require_http_methods(['POST'])
def category_delete(request, pk):
    category = get_object_or_404(Category, pk=pk)
    category.delete()
    messages.success(request, 'Category deleted.')
    return redirect('lab:categories')


@login_required
def tests_list(request):
    tests = Test.objects.select_related('category').prefetch_related('parameters').all()
    categories = Category.objects.all()
    return render(
        request,
        'lab/tests.html',
        {'tests': tests, 'categories': categories, 'active_tab': 'tests'},
    )


@login_required
@require_http_methods(['GET', 'POST'])
def test_create(request):
    if request.method == 'POST':
        form = TestForm(request.POST)
        formset = TestParameterFormSet(request.POST)
        if form.is_valid() and formset.is_valid():
            test = form.save()
            formset.instance = test
            formset.save()
            messages.success(request, 'Test created.')
            return redirect('lab:tests')
    else:
        form = TestForm()
        formset = TestParameterFormSet()
        category_id = request.GET.get('category')
        if category_id:
            form.fields['category'].initial = category_id
    return render(
        request,
        'lab/test_form.html',
        {'form': form, 'formset': formset, 'title': 'Add Test', 'active_tab': 'tests'},
    )


@login_required
@require_http_methods(['GET', 'POST'])
def test_edit(request, pk):
    test = get_object_or_404(Test, pk=pk)
    if request.method == 'POST':
        form = TestForm(request.POST, instance=test)
        formset = TestParameterFormSet(request.POST, instance=test)
        if form.is_valid() and formset.is_valid():
            form.save()
            formset.save()
            messages.success(request, 'Test updated.')
            return redirect('lab:tests')
    else:
        form = TestForm(instance=test)
        formset = TestParameterFormSet(instance=test)
    return render(
        request,
        'lab/test_form.html',
        {
            'form': form,
            'formset': formset,
            'title': 'Edit Test',
            'active_tab': 'tests',
            'test': test,
        },
    )


@login_required
@require_http_methods(['POST'])
def test_delete(request, pk):
    test = get_object_or_404(Test, pk=pk)
    test.delete()
    messages.success(request, 'Test deleted.')
    return redirect('lab:tests')


@login_required
def reports_list(request):
    q = request.GET.get('q', '').strip()
    bookings = Booking.objects.select_related('patient', 'doctor').prefetch_related('booking_tests')
    if q:
        bookings = bookings.filter(
            Q(report_no__icontains=q)
            | Q(patient__name__icontains=q)
            | Q(patient__mobile__icontains=q)
        )
    return render(
        request,
        'lab/reports.html',
        {'bookings': bookings[:100], 'q': q, 'active_tab': 'reports'},
    )


@login_required
@require_http_methods(['GET', 'POST'])
def booking_detail(request, pk):
    booking = get_object_or_404(
        Booking.objects.select_related('patient', 'doctor').prefetch_related(
            'booking_tests__test',
            'booking_tests__results__parameter',
        ),
        pk=pk,
    )

    if request.method == 'POST':
        action = request.POST.get('action', 'save_results')
        if action == 'save_results':
            for bt in booking.booking_tests.all():
                for result in bt.results.all():
                    key = f'result_{result.id}'
                    if key in request.POST:
                        result.value = request.POST.get(key, '').strip()
                        result.save(update_fields=['value'])
            status = request.POST.get('status')
            if status in dict(Booking.STATUS_CHOICES):
                booking.status = status
                if status == 'completed' and not booking.report_ready_at:
                    booking.report_ready_at = timezone.now()
                booking.save(update_fields=['status', 'report_ready_at', 'updated_at'])
            messages.success(request, 'Results saved.')
            return redirect('lab:booking_detail', pk=booking.pk)

    return render(
        request,
        'lab/booking_detail.html',
        {'booking': booking, 'active_tab': 'reports'},
    )


@login_required
@require_GET
def report_preview(request, pk):
    booking = get_object_or_404(
        Booking.objects.select_related('patient', 'doctor').prefetch_related(
            'booking_tests__test',
            'booking_tests__results__parameter',
            'booking_tests__test__parameters',
        ),
        pk=pk,
    )
    return render(request, 'lab/report_preview.html', {'booking': booking, 'active_tab': 'reports'})


@login_required
@require_GET
def report_pdf(request, pk):
    booking = get_object_or_404(
        Booking.objects.select_related('patient', 'doctor').prefetch_related(
            'booking_tests__test',
            'booking_tests__results__parameter',
            'booking_tests__test__parameters',
        ),
        pk=pk,
    )
    from .models import PrintSettings

    base = resolve_public_base_url(request.build_absolute_uri('/'))
    cfg = PrintSettings.load()
    pdf_bytes = build_report_pdf(
        booking,
        public_base_url=base,
        include_background=bool(cfg.show_background_on_pdf),
    )
    response = HttpResponse(pdf_bytes, content_type='application/pdf')
    filename = f'{booking.report_no or "report"}.pdf'
    response['Content-Disposition'] = f'inline; filename="{filename}"'
    return response


def _share_booking(token):
    return get_object_or_404(
        Booking.objects.select_related('patient', 'doctor').prefetch_related(
            'booking_tests__test',
            'booking_tests__results__parameter',
            'booking_tests__test__parameters',
        ),
        share_token=token,
    )


@require_GET
@xframe_options_sameorigin
def share_report_page(request, token):
    booking = _share_booking(token)
    patient = booking.patient
    age = patient.age if patient.age is not None else '—'
    gender = patient.get_gender_display()
    filename = f'{booking.report_no or "report"}.pdf'
    pdf_bytes = _share_pdf_bytes(request, booking)
    page_images = _pdf_page_images(pdf_bytes)
    return render(
        request,
        'lab/share_report.html',
        {
            'booking': booking,
            'age_gender': f'{age} / {gender}',
            'filename': filename,
            'page_images': page_images,
            'download_url': reverse('lab:share_report_pdf', kwargs={'token': token}) + '?download=1',
            'view_url': reverse('lab:share_report_pdf', kwargs={'token': token}),
        },
    )


@require_GET
@xframe_options_sameorigin
def share_report_pdf(request, token):
    booking = _share_booking(token)
    pdf_bytes = _share_pdf_bytes(request, booking)
    response = HttpResponse(pdf_bytes, content_type='application/pdf')
    filename = f'{booking.report_no or "report"}.pdf'
    disposition = 'attachment' if request.GET.get('download') == '1' else 'inline'
    response['Content-Disposition'] = f'{disposition}; filename="{filename}"'
    response['Cache-Control'] = 'private, max-age=60'
    response['X-Content-Type-Options'] = 'nosniff'
    return response
