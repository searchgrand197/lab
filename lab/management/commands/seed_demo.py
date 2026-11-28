"""Create/refresh the isolated demo database (catalog only — no live patients)."""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.utils import timezone

from lab.api import _apply_default_booking_test_order, _ensure_booking_test
from lab.catalog_data import CATALOG
from lab.db import demo_db
from lab.models import Booking, Category, Doctor, Package, Patient, PrintSettings, Test, TestParameter, TestResult
from lab.param_methods import unpack_param_tuple


DEMO_USER = 'demo'
DEMO_PASSWORD = 'demo-try-out'


class Command(BaseCommand):
    help = 'Migrate and seed db_demo.sqlite3 with tests/packages/doctors for /demo.'

    def handle(self, *args, **options):
        self.stdout.write('==> Migrating demo database')
        call_command('migrate', database='demo', interactive=False, run_syncdb=True)

        with demo_db():
            self._seed_catalog()
            self._ensure_print_settings()
            self._seed_sample_reports()

        # Auth user lives on default (sessions/auth always default). Demo gate
        # does not password-login; this user is only a fallback marker.
        User = get_user_model()
        user, created = User.objects.db_manager('default').get_or_create(
            username=DEMO_USER,
            defaults={'is_staff': False, 'is_superuser': False},
        )
        if created:
            user.set_password(DEMO_PASSWORD)
            user.save(using='default')
            self.stdout.write(self.style.SUCCESS(f'Created default user "{DEMO_USER}"'))

        self.stdout.write(self.style.SUCCESS('Demo database ready (isolated from live data).'))

    def _seed_catalog(self):
        for name in [
            'KHALSA',
            'Dr. Manir',
            'Dr. Monti',
            'Dr. Ravina',
            'Dr. Suresh',
            'Dr. Bijender',
        ]:
            Doctor.objects.get_or_create(name=name, defaults={'is_active': True})

        for block in CATALOG:
            category, _ = Category.objects.get_or_create(
                name=block['category'],
                defaults={'description': block['category']},
            )
            for test_data in block['tests']:
                test, _ = Test.objects.update_or_create(
                    category=category,
                    name=test_data['name'],
                    defaults={
                        'price': test_data.get('price', 0),
                        'is_active': True,
                        'layout': test_data.get('layout', '') or '',
                    },
                )
                keep_names = {p[0] for p in test_data['parameters']}
                for old in test.parameters.exclude(name__in=keep_names):
                    qs = TestResult.objects.filter(parameter=old)
                    if not qs.exists() or not qs.exclude(value='').exists():
                        qs.delete()
                        old.delete()
                for order, row in enumerate(test_data['parameters'], start=1):
                    name, unit, reference_range, method = unpack_param_tuple(row)
                    TestParameter.objects.update_or_create(
                        test=test,
                        name=name,
                        defaults={
                            'unit': unit or '',
                            'reference_range': reference_range or '',
                            'method': method or '',
                            'sort_order': order,
                        },
                    )

        package_defs = [
            (
                'Basic Health Package',
                'CBC + basic biochemistry',
                Decimal('899.00'),
                ['Complete Blood Count (CBC)', 'Biochemistry Investigations'],
            ),
            (
                'Fever Panel',
                'Infection and fever workup',
                Decimal('1299.00'),
                ['Widal Test', 'Malaria Parasite (Thick & Thin)', 'Complete Blood Count (CBC)'],
            ),
        ]
        for name, desc, price, test_names in package_defs:
            pkg, _ = Package.objects.update_or_create(
                name=name,
                defaults={'description': desc, 'price': price, 'is_active': True},
            )
            pkg.tests.set(Test.objects.filter(name__in=test_names, is_active=True))

        self.stdout.write(
            self.style.SUCCESS(
                f'Demo catalog: {Category.objects.count()} categories, '
                f'{Test.objects.count()} tests, {Package.objects.count()} packages, '
                f'{Doctor.objects.count()} doctors'
            )
        )

    def _ensure_print_settings(self):
        cfg = PrintSettings.load()
        # Match typical plate used on production letterhead printers.
        if float(cfg.page_width_mm) >= 200:
            cfg.page_preset = 'Custom'
            cfg.page_width_mm = Decimal('186.00')
            cfg.page_height_mm = Decimal('246.00')
            cfg.margin_left_mm = Decimal('13.00')
            cfg.margin_right_mm = Decimal('13.00')
            cfg.header_height_mm = Decimal('34.00')
            cfg.footer_height_mm = Decimal('20.00')
            cfg.show_lab_title = True
            cfg.save()

    def _seed_sample_reports(self):
        """One completed CBC so Reports is not empty on first visit."""
        if Booking.objects.filter(remarks='Demo sample report').exists():
            return
        patient, _ = Patient.objects.get_or_create(
            mobile='9999900001',
            defaults={
                'title': 'Mr.',
                'name': 'Demo Patient',
                'age': 35,
                'gender': 'M',
            },
        )
        doctor = Doctor.objects.filter(is_active=True).first()
        now = timezone.now()
        booking = Booking(
            patient=patient,
            doctor=doctor,
            status='completed',
            remarks='Demo sample report',
            test_date=now,
            sample_collected_at=now,
            sample_received_at=now,
            report_ready_at=now,
        )
        booking.save()
        cbc = Test.objects.filter(name='Complete Blood Count (CBC)', is_active=True).first()
        if not cbc:
            return
        bt = _ensure_booking_test(booking, cbc)
        samples = {
            'HAEMOGLOBIN (Hb)': '13.2',
            'Total Leucocytes (WBC) Count': '7800',
            'Neutrophils': '58',
            'Lymphocytes': '32',
            'Monocytes': '6',
            'Eosinophils': '3',
            'Basophils': '1',
            'RED BLOOD CELLS - RBC COUNT': '4.40',
            'PACKED CELL VOLUME (PCV) - HEMATOCRIT': '39.60',
            'Mean Cell Volume (MCV)': '90.00',
            'Mean Cell Haemoglobin (MCH)': '30.00',
            'Mean Corpuscular Hb Concn. (MCHC)': '33.33',
            'Platelet Count': '2.40',
        }
        for result in bt.results.select_related('parameter'):
            if result.parameter.name in samples:
                result.value = samples[result.parameter.name]
                result.save(update_fields=['value'])
        _apply_default_booking_test_order(booking)
        self.stdout.write(self.style.SUCCESS(f'Demo sample report: {booking.report_no}'))
