import json
from datetime import datetime, time
from functools import wraps

from django.contrib.auth import authenticate, login, logout
from django.db import IntegrityError
from django.db.models import ProtectedError
from django.http import HttpResponse, JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404, render
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_http_methods

from .models import (
    Booking,
    BookingTest,
    Category,
    Doctor,
    Package,
    Patient,
    PrintSettings,
    Test,
    TestParameter,
    TestResult,
)
from .pdf import _detect_lan_ip, build_report_pdf, resolve_public_base_url


def _aware_dt(value):
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        dt = parse_datetime(str(value).replace(' ', 'T'))
        if dt is None:
            return None
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


def _iso(value):
    if not value:
        return None
    if isinstance(value, datetime):
        # Prefer local lab timezone so frontend datetime-local fields stay accurate.
        if timezone.is_aware(value):
            value = timezone.localtime(value)
        return value.isoformat()
    if hasattr(value, 'isoformat'):
        # date / time objects
        return value.isoformat()
    return str(value)


def _parse_date_value(value):
    if not value:
        return None
    if hasattr(value, 'isoformat') and not isinstance(value, str):
        return value
    return parse_date(str(value)[:10])


def _paginate(qs, request, mapper, default_page_size=50):
    """Paginated JSON list. Pass ?all=1 to return every row (dropdowns)."""
    if (request.GET.get('all') or '').strip() == '1':
        items = list(qs)
        count = len(items)
        return JsonResponse({
            'results': [mapper(item) for item in items],
            'count': count,
            'page': 1,
            'page_size': count or default_page_size,
            'total_pages': 1 if count else 0,
        })

    try:
        page = max(1, int(request.GET.get('page') or 1))
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = int(request.GET.get('page_size') or default_page_size)
    except (TypeError, ValueError):
        page_size = default_page_size
    page_size = min(200, max(1, page_size))

    count = qs.count()
    total_pages = (count + page_size - 1) // page_size if count else 0
    if total_pages and page > total_pages:
        page = total_pages
    start = (page - 1) * page_size
    items = list(qs[start : start + page_size])
    return JsonResponse({
        'results': [mapper(item) for item in items],
        'count': count,
        'page': page,
        'page_size': page_size,
        'total_pages': total_pages,
    })


def api_login_required(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({'error': 'Authentication required'}, status=401)
        return view(request, *args, **kwargs)

    return wrapper


def _body(request):
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode('utf-8'))
    except json.JSONDecodeError:
        return {}


def _safe_delete(obj):
    try:
        obj.delete()
    except ProtectedError:
        return JsonResponse(
            {'error': 'This record is used on a report and cannot be deleted.'},
            status=400,
        )
    return JsonResponse({'ok': True})


def _apply_patient(patient, data):
    name = (data.get('name') or '').strip()
    if not name:
        return 'Name is required'
    if 'title' in data:
        title = (data.get('title') or '').strip()
        if title in dict(Patient.TITLE_CHOICES):
            patient.title = title
        elif title == '':
            patient.title = ''
    patient.name = name
    if 'age' in data:
        patient.age = data.get('age') or None
    if data.get('gender') in dict(Patient.GENDER_CHOICES):
        patient.gender = data['gender']
    if 'mobile' in data:
        patient.mobile = (data.get('mobile') or '').strip()
    if 'dob' in data:
        patient.dob = _parse_date_value(data.get('dob'))
    if 'remarks' in data:
        patient.remarks = data.get('remarks') or ''
    return None


def _patient_dict(p):
    return {
        'id': p.id,
        'title': p.title or '',
        'name': p.name,
        'display_name': p.display_name,
        'age': p.age,
        'gender': p.gender,
        'gender_display': p.get_gender_display(),
        'mobile': p.mobile,
        'dob': _iso(p.dob) or '',
        'remarks': p.remarks,
        'updated_at': _iso(p.updated_at) or '',
    }


def _doctor_dict(d):
    return {
        'id': d.id,
        'name': d.name,
        'specialization': d.specialization,
        'phone': d.phone,
        'is_active': d.is_active,
        'is_default': bool(d.is_default),
        'sort_order': d.sort_order,
    }


def _apply_sort_order(model, ordered_ids):
    ids = []
    for raw in ordered_ids or []:
        try:
            ids.append(int(raw))
        except (TypeError, ValueError):
            continue
    if not ids:
        return JsonResponse({'error': 'Provide ordered_ids.'}, status=400)
    objects = {obj.id: obj for obj in model.objects.filter(id__in=ids)}
    if len(objects) != len(set(ids)):
        return JsonResponse({'error': 'One or more items were not found.'}, status=400)
    for index, item_id in enumerate(ids, start=1):
        obj = objects[item_id]
        if obj.sort_order != index:
            obj.sort_order = index
            obj.save(update_fields=['sort_order'])
    return None


def _param_dict(param):
    return {
        'id': param.id,
        'name': param.name,
        'unit': param.unit,
        'reference_range': param.reference_range,
        'sort_order': param.sort_order,
    }


def _test_dict(test, include_params=False):
    data = {
        'id': test.id,
        'name': test.name,
        'price': str(test.price),
        'is_active': test.is_active,
        'category_id': test.category_id,
        'category_name': test.category.name,
        'sort_order': test.sort_order,
        'layout': getattr(test, 'layout', '') or '',
        'parameter_count': test.parameters.count(),
    }
    if include_params:
        data['parameters'] = [_param_dict(p) for p in test.parameters.all()]
    return data


def _booking_dict(b, detail=False):
    data = {
        'id': b.id,
        'report_no': b.report_no,
        'patient': _patient_dict(b.patient),
        'doctor': _doctor_dict(b.doctor) if b.doctor else None,
        'room_no': b.room_no,
        'referral_source': b.referral_source,
        'test_date': _iso(b.test_date),
        'next_due_date': _iso(b.next_due_date),
        'sample_collected_at': _iso(b.sample_collected_at),
        'sample_received_at': _iso(b.sample_received_at),
        'report_ready_at': _iso(b.report_ready_at),
        'sample_collected_by': b.sample_collected_by,
        'sample_delivered_to': b.sample_delivered_to,
        'status': b.status,
        'status_display': b.get_status_display(),
        'remarks': b.remarks,
        'test_count': b.booking_tests.count(),
        'created_at': b.created_at.isoformat(),
    }
    if detail:
        tests = []
        for bt in b.booking_tests.select_related('test__category').prefetch_related(
            'results__parameter', 'test__parameters'
        ):
            tests.append(
                {
                    'booking_test_id': bt.id,
                    'test': _test_dict(bt.test, include_params=True),
                    'results': [
                        {
                            'id': r.id,
                            'parameter_id': r.parameter_id,
                            'name': r.parameter.name,
                            'unit': r.parameter.unit,
                            'reference_range': r.parameter.reference_range,
                            'value': r.value,
                        }
                        for r in bt.results.all()
                    ],
                }
            )
        data['tests'] = tests
        data['selected_test_ids'] = [t['test']['id'] for t in tests]
    return data


def _ensure_booking_test(booking, test):
    bt, created = BookingTest.objects.get_or_create(
        booking=booking,
        test=test,
        defaults={'price': test.price},
    )
    # Always sync missing parameters (e.g. Widal matrix cells added later).
    for param in test.parameters.all():
        TestResult.objects.get_or_create(
            booking_test=bt,
            parameter=param,
            defaults={'value': ''},
        )
    return bt


@ensure_csrf_cookie
@require_GET
def csrf(request):
    return JsonResponse({'csrfToken': get_token(request)})


@require_GET
def me(request):
    if not request.user.is_authenticated:
        return JsonResponse({'authenticated': False})
    return JsonResponse(
        {
            'authenticated': True,
            'user': {'id': request.user.id, 'username': request.user.username},
        }
    )


@csrf_exempt
@require_http_methods(['POST'])
def login_api(request):
    data = _body(request)
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    user = authenticate(request, username=username, password=password)
    if user is None:
        return JsonResponse({'error': 'Invalid username or password'}, status=400)
    login(request, user)
    get_token(request)  # ensure CSRF cookie for later API calls
    return JsonResponse({'ok': True, 'user': {'id': user.id, 'username': user.username}})


@csrf_exempt
@require_http_methods(['POST'])
def logout_api(request):
    logout(request)
    return JsonResponse({'ok': True})


@api_login_required
@require_http_methods(['GET', 'POST'])
def patients_api(request):
    if request.method == 'GET':
        q = (request.GET.get('q') or '').strip()
        qs = Patient.objects.all()
        if q:
            from django.db.models import Q

            qs = qs.filter(Q(name__icontains=q) | Q(mobile__icontains=q) | Q(title__icontains=q))
        return _paginate(qs, request, _patient_dict)

    data = _body(request)
    patient = Patient()
    error = _apply_patient(patient, data)
    if error:
        return JsonResponse({'error': error}, status=400)
    patient.save()
    return JsonResponse(_patient_dict(patient), status=201)


@api_login_required
@require_http_methods(['GET', 'PUT', 'DELETE'])
def patient_detail_api(request, pk):
    patient = get_object_or_404(Patient, pk=pk)
    if request.method == 'GET':
        return JsonResponse(_patient_dict(patient))
    if request.method == 'DELETE':
        return _safe_delete(patient)
    data = _body(request)
    error = _apply_patient(patient, data)
    if error:
        return JsonResponse({'error': error}, status=400)
    patient.save()
    return JsonResponse(_patient_dict(patient))


@api_login_required
@require_http_methods(['GET', 'POST'])
def doctors_api(request):
    if request.method == 'GET':
        q = (request.GET.get('q') or '').strip()
        qs = Doctor.objects.all()
        # Dropdowns: skip bulk SEED rows so the UI does not freeze on thousands of options.
        if (request.GET.get('select') or '').strip() == '1':
            qs = qs.exclude(name__startswith='SEED Doctor')
        if q:
            from django.db.models import Q

            qs = qs.filter(
                Q(name__icontains=q)
                | Q(specialization__icontains=q)
                | Q(phone__icontains=q)
            )
        return _paginate(qs, request, _doctor_dict)
    data = _body(request)
    next_order = (Doctor.objects.order_by('-sort_order').values_list('sort_order', flat=True).first() or 0) + 1
    doctor = Doctor(
        name=(data.get('name') or '').strip(),
        specialization=(data.get('specialization') or '').strip(),
        phone=(data.get('phone') or '').strip(),
        is_active=bool(data.get('is_active', True)),
        is_default=bool(data.get('is_default', False)),
        sort_order=next_order,
    )
    doctor.save()
    return JsonResponse(_doctor_dict(doctor), status=201)


@api_login_required
@require_http_methods(['PUT', 'DELETE'])
def doctor_detail_api(request, pk):
    doctor = get_object_or_404(Doctor, pk=pk)
    if request.method == 'DELETE':
        return _safe_delete(doctor)
    data = _body(request)
    doctor.name = (data.get('name') or doctor.name).strip()
    doctor.specialization = (data.get('specialization') or '').strip()
    doctor.phone = (data.get('phone') or '').strip()
    doctor.is_active = bool(data.get('is_active', doctor.is_active))
    if 'is_default' in data:
        doctor.is_default = bool(data.get('is_default'))
    if 'sort_order' in data:
        try:
            doctor.sort_order = int(data.get('sort_order'))
        except (TypeError, ValueError):
            pass
    doctor.save()
    return JsonResponse(_doctor_dict(doctor))


@api_login_required
@require_http_methods(['POST'])
def doctors_reorder_api(request):
    data = _body(request)
    err = _apply_sort_order(Doctor, data.get('ordered_ids'))
    if err:
        return err
    return JsonResponse({'results': [_doctor_dict(d) for d in Doctor.objects.all()]})


@api_login_required
@require_http_methods(['GET', 'POST'])
def categories_api(request):
    if request.method == 'GET':
        results = []
        for c in Category.objects.prefetch_related('tests').all():
            results.append(
                {
                    'id': c.id,
                    'name': c.name,
                    'description': c.description,
                    'sort_order': c.sort_order,
                    'test_count': c.tests.count(),
                }
            )
        return JsonResponse({'results': results})
    data = _body(request)
    name = (data.get('name') or '').strip()
    if not name:
        return JsonResponse({'error': 'Name is required'}, status=400)
    next_order = (Category.objects.order_by('-sort_order').values_list('sort_order', flat=True).first() or 0) + 1
    try:
        cat = Category.objects.create(
            name=name,
            description=(data.get('description') or '').strip(),
            sort_order=next_order,
        )
    except IntegrityError:
        return JsonResponse({'error': 'A category with this name already exists.'}, status=400)
    return JsonResponse(
        {
            'id': cat.id,
            'name': cat.name,
            'description': cat.description,
            'sort_order': cat.sort_order,
            'test_count': 0,
        },
        status=201,
    )


@api_login_required
@require_http_methods(['POST'])
def categories_reorder_api(request):
    data = _body(request)
    err = _apply_sort_order(Category, data.get('ordered_ids'))
    if err:
        return err
    results = [
        {
            'id': c.id,
            'name': c.name,
            'description': c.description,
            'sort_order': c.sort_order,
            'test_count': c.tests.count(),
        }
        for c in Category.objects.prefetch_related('tests').all()
    ]
    return JsonResponse({'results': results})


@api_login_required
@require_http_methods(['PUT', 'DELETE'])
def category_detail_api(request, pk):
    cat = get_object_or_404(Category, pk=pk)
    if request.method == 'DELETE':
        return _safe_delete(cat)
    data = _body(request)
    cat.name = (data.get('name') or cat.name).strip()
    cat.description = (data.get('description') or '').strip()
    try:
        cat.save()
    except IntegrityError:
        return JsonResponse({'error': 'A category with this name already exists.'}, status=400)
    return JsonResponse(
        {
            'id': cat.id,
            'name': cat.name,
            'description': cat.description,
            'sort_order': cat.sort_order,
            'test_count': cat.tests.count(),
        }
    )


@api_login_required
@require_GET
def catalog_api(request):
    categories = []
    for c in Category.objects.prefetch_related('tests__parameters').all():
        tests = [
            _test_dict(t, include_params=True)
            for t in c.tests.filter(is_active=True).order_by('sort_order', 'name')
        ]
        categories.append({'id': c.id, 'name': c.name, 'sort_order': c.sort_order, 'tests': tests})
    return JsonResponse({'categories': categories})


def _package_dict(pkg):
    test_ids = list(pkg.tests.filter(is_active=True).values_list('id', flat=True))
    return {
        'id': pkg.id,
        'name': pkg.name,
        'description': pkg.description,
        'price': str(pkg.price),
        'is_active': pkg.is_active,
        'test_ids': test_ids,
        'test_count': len(test_ids),
    }


@api_login_required
@require_http_methods(['GET', 'POST'])
def packages_api(request):
    if request.method == 'GET':
        results = [
            _package_dict(pkg)
            for pkg in Package.objects.prefetch_related('tests').all()
        ]
        return JsonResponse({'results': results})

    data = _body(request)
    name = (data.get('name') or '').strip()
    if not name:
        return JsonResponse({'error': 'Name is required'}, status=400)
    try:
        pkg = Package.objects.create(
            name=name,
            description=(data.get('description') or '').strip(),
            price=data.get('price') or 0,
            is_active=bool(data.get('is_active', True)),
        )
    except IntegrityError:
        return JsonResponse({'error': 'A package with this name already exists.'}, status=400)

    test_ids = []
    for raw in data.get('test_ids') or []:
        try:
            test_ids.append(int(raw))
        except (TypeError, ValueError):
            continue
    if test_ids:
        pkg.tests.set(Test.objects.filter(id__in=test_ids, is_active=True))
    return JsonResponse(_package_dict(pkg), status=201)


@api_login_required
@require_http_methods(['PUT', 'DELETE'])
def package_detail_api(request, pk):
    pkg = get_object_or_404(Package, pk=pk)
    if request.method == 'DELETE':
        return _safe_delete(pkg)

    data = _body(request)
    name = (data.get('name') or pkg.name).strip()
    if not name:
        return JsonResponse({'error': 'Name is required'}, status=400)
    pkg.name = name
    pkg.description = (data.get('description') or '').strip()
    if 'price' in data:
        pkg.price = data.get('price') or 0
    if 'is_active' in data:
        pkg.is_active = bool(data.get('is_active'))
    try:
        pkg.save()
    except IntegrityError:
        return JsonResponse({'error': 'A package with this name already exists.'}, status=400)

    if 'test_ids' in data:
        test_ids = []
        for raw in data.get('test_ids') or []:
            try:
                test_ids.append(int(raw))
            except (TypeError, ValueError):
                continue
        pkg.tests.set(Test.objects.filter(id__in=test_ids, is_active=True))

    return JsonResponse(_package_dict(pkg))


@api_login_required
@require_http_methods(['GET', 'POST'])
def tests_api(request):
    if request.method == 'GET':
        tests = Test.objects.select_related('category').prefetch_related('parameters').all()
        return JsonResponse({'results': [_test_dict(t, include_params=True) for t in tests]})
    data = _body(request)
    name = (data.get('name') or '').strip()
    if not name:
        return JsonResponse({'error': 'Name is required'}, status=400)
    category = get_object_or_404(Category, pk=data.get('category_id'))
    next_order = (
        Test.objects.filter(category=category).order_by('-sort_order').values_list('sort_order', flat=True).first()
        or 0
    ) + 1
    try:
        test = Test.objects.create(
            category=category,
            name=name,
            price=data.get('price') or 0,
            description=(data.get('description') or '').strip(),
            is_active=bool(data.get('is_active', True)),
            sort_order=next_order,
        )
    except IntegrityError:
        return JsonResponse({'error': 'A test with this name already exists in the category.'}, status=400)
    for order, param in enumerate(data.get('parameters') or [], start=1):
        TestParameter.objects.create(
            test=test,
            name=(param.get('name') or '').strip(),
            unit=(param.get('unit') or '').strip(),
            reference_range=(param.get('reference_range') or '').strip(),
            sort_order=param.get('sort_order', order),
        )
    return JsonResponse(_test_dict(test, include_params=True), status=201)


@api_login_required
@require_http_methods(['POST'])
def tests_reorder_api(request):
    data = _body(request)
    err = _apply_sort_order(Test, data.get('ordered_ids'))
    if err:
        return err
    tests = Test.objects.select_related('category').prefetch_related('parameters').all()
    return JsonResponse({'results': [_test_dict(t, include_params=True) for t in tests]})


@api_login_required
@require_http_methods(['PUT', 'DELETE'])
def test_detail_api(request, pk):
    test = get_object_or_404(Test.objects.select_related('category').prefetch_related('parameters'), pk=pk)
    if request.method == 'DELETE':
        return _safe_delete(test)
    data = _body(request)
    if data.get('category_id'):
        test.category = get_object_or_404(Category, pk=data['category_id'])
    test.name = (data.get('name') or test.name).strip()
    if 'price' in data:
        test.price = data.get('price') or 0
    test.description = (data.get('description') or '').strip()
    test.is_active = bool(data.get('is_active', test.is_active))
    try:
        test.save()
    except IntegrityError:
        return JsonResponse({'error': 'A test with this name already exists in the category.'}, status=400)
    if 'parameters' in data:
        keep_ids = []
        for order, param in enumerate(data.get('parameters') or [], start=1):
            pid = param.get('id')
            if pid:
                obj = TestParameter.objects.filter(pk=pid, test=test).first()
                if obj:
                    obj.name = (param.get('name') or obj.name).strip()
                    obj.unit = (param.get('unit') or '').strip()
                    obj.reference_range = (param.get('reference_range') or '').strip()
                    obj.sort_order = param.get('sort_order', order)
                    obj.save()
                    keep_ids.append(obj.id)
                    continue
            obj = TestParameter.objects.create(
                test=test,
                name=(param.get('name') or '').strip(),
                unit=(param.get('unit') or '').strip(),
                reference_range=(param.get('reference_range') or '').strip(),
                sort_order=param.get('sort_order', order),
            )
            keep_ids.append(obj.id)
        test.parameters.exclude(id__in=keep_ids).filter(results__isnull=True).distinct().delete()
    return JsonResponse(_test_dict(test, include_params=True))


@api_login_required
@require_http_methods(['GET', 'POST'])
def bookings_api(request):
    if request.method == 'GET':
        q = (request.GET.get('q') or '').strip()
        # Drafts stay on Book Test until Save and Print — never list them as reports.
        # Soft-deleted reports stay in DB/admin but are hidden from the app UI.
        qs = (
            Booking.objects.select_related('patient', 'doctor')
            .exclude(status='draft')
            .filter(is_deleted=False)
        )
        if q:
            from django.db.models import Q

            qs = qs.filter(
                Q(report_no__icontains=q)
                | Q(patient__name__icontains=q)
                | Q(patient__mobile__icontains=q)
            )
        date_from = parse_date(request.GET.get('from') or '')
        date_to = parse_date(request.GET.get('to') or '')
        tz = timezone.get_current_timezone()
        if date_from:
            start = timezone.make_aware(datetime.combine(date_from, time.min), tz)
            qs = qs.filter(test_date__gte=start)
        if date_to:
            end = timezone.make_aware(datetime.combine(date_to, time.max), tz)
            qs = qs.filter(test_date__lte=end)
        qs = qs.order_by('-created_at', '-id')
        return _paginate(qs, request, _booking_dict)

    data = _body(request)
    patient = None
    if data.get('patient_id'):
        patient = Patient.objects.filter(pk=data['patient_id']).first()
    if not patient and data.get('mobile'):
        patient = Patient.objects.filter(
            mobile=data['mobile'], name__iexact=(data.get('name') or '')
        ).first()
    if patient:
        err = _apply_patient(patient, {
            **data,
            'name': data.get('name') or patient.name,
            'age': data.get('age') if data.get('age') not in (None, '') else patient.age,
            'gender': data.get('gender') or patient.gender,
            'mobile': data.get('mobile') if 'mobile' in data else patient.mobile,
            'remarks': data.get('remarks') if 'remarks' in data else patient.remarks,
        })
        if err:
            return JsonResponse({'error': err}, status=400)
        patient.save()
    else:
        patient = Patient()
        err = _apply_patient(patient, data)
        if err:
            return JsonResponse({'error': err}, status=400)
        patient.save()

    doctor = None
    if data.get('doctor_id'):
        doctor = Doctor.objects.filter(pk=data['doctor_id']).first()

    booking = Booking(
        patient=patient,
        doctor=doctor,
        room_no=(data.get('room_no') or '').strip(),
        referral_source=data.get('referral_source') or 'Direct',
        sample_collected_by=(data.get('sample_collected_by') or '').strip(),
        sample_delivered_to=(data.get('sample_delivered_to') or '').strip(),
        remarks=(data.get('remarks') or '').strip(),
        status='draft' if data.get('status') == 'draft' else 'booked',
    )
    if data.get('report_no'):
        booking.report_no = data['report_no']
    for field in ('test_date', 'sample_collected_at', 'sample_received_at', 'report_ready_at'):
        parsed = _aware_dt(data.get(field))
        if parsed:
            setattr(booking, field, parsed)
    if data.get('next_due_date'):
        booking.next_due_date = parse_date(str(data['next_due_date']))
    if not booking.test_date:
        booking.test_date = timezone.now()
    booking.save()

    test_ids = data.get('test_ids') or []
    if test_ids:
        tests = Test.objects.filter(id__in=test_ids, is_active=True)
        for test in tests:
            _ensure_booking_test(booking, test)

    return JsonResponse(_booking_dict(booking, detail=True), status=201)


@api_login_required
@require_http_methods(['GET', 'POST', 'DELETE'])
def booking_detail_api(request, pk):
    booking = get_object_or_404(
        Booking.objects.select_related('patient', 'doctor'),
        pk=pk,
    )
    if request.method == 'DELETE':
        # Soft-delete only — row remains for Django admin.
        data = _body(request)
        reason = (data.get('deletion_reason') or data.get('reason') or '').strip()
        if not reason:
            return JsonResponse({'error': 'Please provide a reason for deleting this report.'}, status=400)
        booking.is_deleted = True
        booking.deletion_reason = reason
        booking.deleted_at = timezone.now()
        booking.save(update_fields=['is_deleted', 'deletion_reason', 'deleted_at', 'updated_at'])
        return JsonResponse({'ok': True, 'soft_deleted': True})
    if request.method == 'GET':
        if booking.is_deleted:
            return JsonResponse({'error': 'Report not found'}, status=404)
        test_id = request.GET.get('test')
        if test_id:
            test = get_object_or_404(Test, pk=test_id, is_active=True)
            _ensure_booking_test(booking, test)
        else:
            # Sync any new parameters (e.g. Widal matrix cells) onto existing booking tests.
            for bt in booking.booking_tests.select_related('test'):
                _ensure_booking_test(booking, bt.test)
        return JsonResponse(_booking_dict(booking, detail=True))

    data = _body(request)
    action = data.get('action') or 'save_results'
    test_id = data.get('test_id')

    if booking.is_deleted and action != 'restore':
        return JsonResponse({'error': 'Report not found'}, status=404)

    if action == 'soft_delete':
        reason = (data.get('deletion_reason') or data.get('reason') or '').strip()
        if not reason:
            return JsonResponse({'error': 'Please provide a reason for deleting this report.'}, status=400)
        booking.is_deleted = True
        booking.deletion_reason = reason
        booking.deleted_at = timezone.now()
        booking.save(update_fields=['is_deleted', 'deletion_reason', 'deleted_at', 'updated_at'])
        return JsonResponse({'ok': True, 'soft_deleted': True})

    if action == 'autosave':
        patient = booking.patient
        if data.get('name'):
            err = _apply_patient(patient, {
                **data,
                'name': data.get('name') or patient.name,
                'age': data.get('age') if data.get('age') not in (None, '') else patient.age,
                'gender': data.get('gender') or patient.gender,
                'mobile': data.get('mobile') if data.get('mobile') is not None else patient.mobile,
                'remarks': data.get('remarks') if data.get('remarks') is not None else patient.remarks,
            })
            if err:
                return JsonResponse({'error': err}, status=400)
            patient.save()
        elif 'title' in data or 'age' in data or 'gender' in data or 'mobile' in data or 'dob' in data:
            err = _apply_patient(patient, {**data, 'name': patient.name})
            if err:
                return JsonResponse({'error': err}, status=400)
            patient.save()

        if 'doctor_id' in data:
            booking.doctor = Doctor.objects.filter(pk=data['doctor_id']).first() if data.get('doctor_id') else None
        if 'room_no' in data:
            booking.room_no = (data.get('room_no') or '').strip()
        if data.get('referral_source'):
            booking.referral_source = data['referral_source']
        if 'sample_collected_by' in data:
            booking.sample_collected_by = (data.get('sample_collected_by') or '').strip()
        if 'sample_delivered_to' in data:
            booking.sample_delivered_to = (data.get('sample_delivered_to') or '').strip()
        if 'remarks' in data:
            booking.remarks = data.get('remarks') or ''
        for field in ('test_date', 'sample_collected_at', 'sample_received_at', 'report_ready_at'):
            parsed = _aware_dt(data.get(field))
            if parsed:
                setattr(booking, field, parsed)
        if 'next_due_date' in data:
            booking.next_due_date = _parse_date_value(data.get('next_due_date'))
        if data.get('report_no'):
            booking.report_no = data['report_no']
        new_status = data.get('status')
        if new_status in dict(Booking.STATUS_CHOICES):
            booking.status = new_status
        booking.save()

        if 'test_ids' not in data:
            return JsonResponse(_booking_dict(booking, detail=True))
        desired = {int(i) for i in (data.get('test_ids') or [])}
        current = set(booking.booking_tests.values_list('test_id', flat=True))
        for tid in current - desired:
            bt = booking.booking_tests.filter(test_id=tid).first()
            if not bt:
                continue
            if bt.results.exclude(value='').exists():
                continue
            bt.delete()
        for test in Test.objects.filter(id__in=desired - current, is_active=True):
            _ensure_booking_test(booking, test)
        return JsonResponse(_booking_dict(booking, detail=True))

    if action == 'remove_test' and test_id:
        bt = booking.booking_tests.filter(test_id=test_id).first()
        if bt:
            bt.delete()
        return JsonResponse(_booking_dict(booking, detail=True))

    if action == 'save_results' and test_id:
        test = get_object_or_404(Test, pk=test_id)
        bt = _ensure_booking_test(booking, test)
        results = data.get('results') or {}
        for result in bt.results.all():
            key = str(result.id)
            if key in results or result.id in results:
                result.value = str(results.get(key, results.get(result.id, ''))).strip()
                result.save(update_fields=['value'])
        status = data.get('status')
        if status in dict(Booking.STATUS_CHOICES):
            booking.status = status
            if status == 'completed' and not booking.report_ready_at:
                booking.report_ready_at = timezone.now()
            booking.save(update_fields=['status', 'report_ready_at', 'updated_at'])
        return JsonResponse(_booking_dict(booking, detail=True))

    return JsonResponse({'error': 'Unknown action'}, status=400)


@api_login_required
@require_GET
def booking_pdf_api(request, pk):
    booking = get_object_or_404(
        Booking.objects.select_related('patient', 'doctor').prefetch_related(
            'booking_tests__test',
            'booking_tests__results__parameter',

            'booking_tests__test__parameters',
        ),
        pk=pk,
        is_deleted=False,
    )
    base = resolve_public_base_url(request.build_absolute_uri('/'))
    cfg = PrintSettings.load()
    pdf_bytes = build_report_pdf(
        booking,
        public_base_url=base,
        include_background=bool(cfg.show_background_on_pdf),
    )
    response = HttpResponse(pdf_bytes, content_type='application/pdf')
    response['Content-Disposition'] = f'inline; filename="{booking.report_no or "report"}.pdf"'
    return response


@api_login_required
@require_GET
def booking_print_api(request, pk):
    """HTML print helper — opens PDF and print dialog (Actual size / 100%)."""
    booking = get_object_or_404(Booking, pk=pk, is_deleted=False)
    return render(
        request,
        'lab/print_report.html',
        {
            'report_no': booking.report_no or f'Report {booking.pk}',
            'pdf_url': f'/api/bookings/{booking.pk}/report.pdf',
        },
    )


def _print_settings_dict(obj, request=None):
    bg_url = ''
    bg_name = ''
    if obj.background_image:
        # Prefer relative /media/... so the Vite proxy can serve it in the Settings UI.
        bg_url = obj.background_image.url
        bg_name = obj.background_image.name.rsplit('/', 1)[-1]
    return {
        'page_preset': obj.page_preset,
        'page_width_mm': float(obj.page_width_mm),
        'page_height_mm': float(obj.page_height_mm),
        'margin_left_mm': float(obj.margin_left_mm),
        'margin_right_mm': float(obj.margin_right_mm),
        'header_height_mm': float(obj.header_height_mm),
        'footer_height_mm': float(obj.footer_height_mm),
        'background_image_url': bg_url,
        'background_image_name': bg_name,
        'has_background': bool(obj.background_image),
        'show_lab_title': obj.show_lab_title,
        'show_patient_header': obj.show_patient_header,
        'show_background_on_pdf': bool(obj.show_background_on_pdf),
        'show_background_on_qr': bool(obj.show_background_on_qr),
        'public_base_url': obj.public_base_url or '',
        'suggested_public_base_url': (
            f'http://{_detect_lan_ip()}:8000' if _detect_lan_ip() else 'http://127.0.0.1:8000'
        ),
        'updated_at': obj.updated_at.isoformat() if obj.updated_at else None,
    }


def _to_float(value, default):
    if value in (None, ''):
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


@api_login_required
@require_http_methods(['GET', 'PUT', 'POST'])
def print_settings_api(request):
    obj = PrintSettings.load()
    if request.method == 'GET':
        return JsonResponse(_print_settings_dict(obj, request))

    data = request.POST if request.POST else _body(request)
    if 'page_preset' in data and data.get('page_preset'):
        preset = str(data.get('page_preset'))
        if preset in dict(PrintSettings.PAGE_PRESETS):
            obj.page_preset = preset

    obj.page_width_mm = _to_float(data.get('page_width_mm'), float(obj.page_width_mm))
    obj.page_height_mm = _to_float(data.get('page_height_mm'), float(obj.page_height_mm))
    obj.margin_left_mm = _to_float(data.get('margin_left_mm'), float(obj.margin_left_mm))
    obj.margin_right_mm = _to_float(data.get('margin_right_mm'), float(obj.margin_right_mm))
    obj.header_height_mm = _to_float(data.get('header_height_mm'), float(obj.header_height_mm))
    obj.footer_height_mm = _to_float(data.get('footer_height_mm'), float(obj.footer_height_mm))

    if 'show_lab_title' in data:
        raw = data.get('show_lab_title')
        obj.show_lab_title = str(raw).lower() in ('1', 'true', 'yes', 'on')
    if 'show_patient_header' in data:
        raw = data.get('show_patient_header')
        obj.show_patient_header = str(raw).lower() in ('1', 'true', 'yes', 'on')
    if 'show_background_on_pdf' in data:
        raw = data.get('show_background_on_pdf')
        obj.show_background_on_pdf = str(raw).lower() in ('1', 'true', 'yes', 'on')
    if 'show_background_on_qr' in data:
        raw = data.get('show_background_on_qr')
        obj.show_background_on_qr = str(raw).lower() in ('1', 'true', 'yes', 'on')
    if 'public_base_url' in data:
        obj.public_base_url = str(data.get('public_base_url') or '').strip().rstrip('/')

    # Named presets lock width/height. Custom keeps the values the user entered.
    if obj.page_preset != 'Custom':
        obj.apply_preset_size()
    else:
        # Guard: never let a stale named-preset path wipe a custom plate.
        obj.page_preset = 'Custom'

    if obj.page_width_mm < 80 or obj.page_height_mm < 80:
        return JsonResponse({'error': 'Page size must be at least 80 × 80 mm.'}, status=400)
    if obj.header_height_mm < 0 or obj.footer_height_mm < 0:
        return JsonResponse({'error': 'Header and footer height cannot be negative.'}, status=400)
    content_height = float(obj.page_height_mm) - float(obj.header_height_mm) - float(obj.footer_height_mm)
    if content_height < 40:
        return JsonResponse(
            {'error': 'Header + footer leave too little space for content. Reduce their heights.'},
            status=400,
        )

    clear_bg = str(data.get('clear_background', '')).lower() in ('1', 'true', 'yes', 'on')
    upload = request.FILES.get('background_image')
    if upload and not clear_bg:
        from pathlib import Path

        # Replace previous file, keep a stable stored name under media/print_backgrounds/
        if obj.background_image:
            obj.background_image.delete(save=False)
        ext = Path(upload.name or 'letterhead.png').suffix.lower()
        if ext not in ('.png', '.jpg', '.jpeg', '.webp'):
            ext = '.png'
        obj.background_image.save(f'letterhead{ext}', upload, save=False)
    elif clear_bg:
        if obj.background_image:
            obj.background_image.delete(save=False)
        obj.background_image = None

    obj.save()
    return JsonResponse(_print_settings_dict(obj, request))
