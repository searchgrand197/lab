"""Bulk seed doctors, patients, and completed reports for load testing."""

from __future__ import annotations

import random
import uuid
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from lab.models import Booking, BookingTest, Doctor, Patient, Test


FIRST_NAMES = [
    'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan',
    'Krishna', 'Ishaan', 'Shaurya', 'Atharv', 'Advait', 'Kabir', 'Ansh',
    'Ananya', 'Aadhya', 'Diya', 'Ira', 'Pari', 'Myra', 'Sara', 'Anika',
    'Aarohi', 'Navya', 'Kiara', 'Saanvi', 'Riya', 'Meera', 'Isha',
]
LAST_NAMES = [
    'Sharma', 'Verma', 'Singh', 'Kaur', 'Gupta', 'Yadav', 'Kumar', 'Patel',
    'Shah', 'Joshi', 'Malhotra', 'Chopra', 'Mehta', 'Reddy', 'Nair',
    'Kapoor', 'Bansal', 'Agarwal', 'Chauhan', 'Thakur',
]
SPECIALIZATIONS = [
    'General Physician', 'Cardiologist', 'Orthopedic', 'Pediatrician',
    'Gynecologist', 'ENT', 'Dermatologist', 'Neurologist', 'Pathologist',
]


class Command(BaseCommand):
    help = 'Seed bulk doctors, patients, and reports (completed) for load testing.'

    def add_arguments(self, parser):
        parser.add_argument('--doctors', type=int, default=5000)
        parser.add_argument('--patients', type=int, default=20000)
        parser.add_argument('--reports', type=int, default=20000)
        parser.add_argument('--batch', type=int, default=1000)
        parser.add_argument(
            '--reset-seed',
            action='store_true',
            help='Delete previously bulk-seeded rows (name/report_no prefix SEED-) before creating.',
        )

    def handle(self, *args, **options):
        doctors_n = options['doctors']
        patients_n = options['patients']
        reports_n = options['reports']
        batch = max(100, options['batch'])

        if options['reset_seed']:
            self._reset_seed_data()

        tests = list(Test.objects.filter(is_active=True).only('id', 'price')[:40])
        if not tests:
            self.stderr.write(self.style.ERROR('No tests found. Run: python manage.py seed_lab'))
            return

        with transaction.atomic():
            doctor_ids = self._seed_doctors(doctors_n, batch)
            patient_ids = self._seed_patients(patients_n, batch)
            self._seed_reports(reports_n, batch, doctor_ids, patient_ids, tests)

        self.stdout.write(self.style.SUCCESS(
            f'Done. Totals — doctors: {Doctor.objects.count()}, '
            f'patients: {Patient.objects.count()}, '
            f'reports (non-draft): {Booking.objects.exclude(status="draft").count()}'
        ))

    def _reset_seed_data(self):
        self.stdout.write('Removing previous SEED- bulk data…')
        deleted_b, _ = Booking.objects.filter(report_no__startswith='SEED-').delete()
        deleted_p, _ = Patient.objects.filter(name__startswith='SEED Patient ').delete()
        deleted_d, _ = Doctor.objects.filter(name__startswith='SEED Doctor ').delete()
        self.stdout.write(f'  Removed bookings≈{deleted_b}, patients≈{deleted_p}, doctors≈{deleted_d}')

    def _seed_doctors(self, target: int, batch: int) -> list[int]:
        existing = Doctor.objects.filter(name__startswith='SEED Doctor ').count()
        need = max(0, target - existing)
        self.stdout.write(f'Doctors: have {existing} SEED, creating {need}…')
        if need == 0:
            return list(Doctor.objects.filter(name__startswith='SEED Doctor ').values_list('id', flat=True))

        start = existing + 1
        created_ids: list[int] = []
        for offset in range(0, need, batch):
            chunk = []
            for i in range(offset, min(offset + batch, need)):
                n = start + i
                chunk.append(
                    Doctor(
                        name=f'SEED Doctor {n:05d}',
                        specialization=random.choice(SPECIALIZATIONS),
                        phone=f'9{n:09d}'[-10:],
                        is_active=True,
                        is_default=False,
                        sort_order=10_000 + n,
                    )
                )
            Doctor.objects.bulk_create(chunk, batch_size=batch)
            self.stdout.write(f'  doctors {min(offset + batch, need)}/{need}')

        created_ids = list(
            Doctor.objects.filter(name__startswith='SEED Doctor ').values_list('id', flat=True)
        )
        # Include a few real doctors if present so reports can use them too.
        other = list(Doctor.objects.exclude(name__startswith='SEED Doctor ').values_list('id', flat=True)[:200])
        return created_ids + other

    def _seed_patients(self, target: int, batch: int) -> list[int]:
        existing = Patient.objects.filter(name__startswith='SEED Patient ').count()
        need = max(0, target - existing)
        self.stdout.write(f'Patients: have {existing} SEED, creating {need}…')
        if need == 0:
            return list(Patient.objects.filter(name__startswith='SEED Patient ').values_list('id', flat=True))

        start = existing + 1
        for offset in range(0, need, batch):
            chunk = []
            for i in range(offset, min(offset + batch, need)):
                n = start + i
                gender = 'M' if n % 2 == 0 else 'F'
                title = 'Mr.' if gender == 'M' else 'Mrs.'
                chunk.append(
                    Patient(
                        title=title,
                        name=f'SEED Patient {n:05d} {random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}',
                        age=18 + (n % 60),
                        gender=gender,
                        mobile=f'8{(n % 10_000_000_000):09d}'[-10:],
                        remarks='Bulk seed',
                    )
                )
            Patient.objects.bulk_create(chunk, batch_size=batch)
            self.stdout.write(f'  patients {min(offset + batch, need)}/{need}')

        return list(Patient.objects.filter(name__startswith='SEED Patient ').values_list('id', flat=True))

    def _seed_reports(
        self,
        target: int,
        batch: int,
        doctor_ids: list[int],
        patient_ids: list[int],
        tests: list[Test],
    ):
        existing = Booking.objects.filter(report_no__startswith='SEED-').count()
        need = max(0, target - existing)
        self.stdout.write(f'Reports: have {existing} SEED, creating {need}…')
        if need == 0:
            return
        if not patient_ids:
            self.stderr.write(self.style.ERROR('No patients available for reports.'))
            return
        if not doctor_ids:
            self.stderr.write(self.style.ERROR('No doctors available for reports.'))
            return

        start = existing + 1
        now = timezone.now()
        referrals = ['Direct', 'Hospital', 'Camp', 'Other']
        statuses = ['booked', 'sample_collected', 'completed', 'completed', 'completed']

        for offset in range(0, need, batch):
            bookings = []
            links = []  # (report_no, test indices)
            for i in range(offset, min(offset + batch, need)):
                n = start + i
                report_no = f'SEED-{n:06d}'
                day_offset = n % 365
                test_date = now - timedelta(days=day_offset, hours=n % 12)
                status = statuses[n % len(statuses)]
                bookings.append(
                    Booking(
                        patient_id=patient_ids[n % len(patient_ids)],
                        doctor_id=doctor_ids[n % len(doctor_ids)],
                        report_no=report_no,
                        share_token=uuid.uuid4(),
                        room_no=str((n % 40) + 1),
                        referral_source=referrals[n % len(referrals)],
                        test_date=test_date,
                        sample_collected_at=test_date + timedelta(minutes=20),
                        sample_received_at=test_date + timedelta(minutes=45),
                        report_ready_at=test_date + timedelta(hours=2) if status == 'completed' else None,
                        status=status,
                        remarks='Bulk seed report',
                    )
                )
                # 1–2 tests per report
                pick = [tests[n % len(tests)]]
                if len(tests) > 1 and n % 3 == 0:
                    pick.append(tests[(n + 7) % len(tests)])
                links.append((report_no, pick))

            Booking.objects.bulk_create(bookings, batch_size=batch)

            # Map report_no -> booking id for this batch
            nos = [b.report_no for b in bookings]
            id_by_no = dict(
                Booking.objects.filter(report_no__in=nos).values_list('report_no', 'id')
            )
            bt_rows = []
            for report_no, pick in links:
                bid = id_by_no.get(report_no)
                if not bid:
                    continue
                seen = set()
                for test in pick:
                    if test.id in seen:
                        continue
                    seen.add(test.id)
                    bt_rows.append(
                        BookingTest(
                            booking_id=bid,
                            test_id=test.id,
                            price=test.price,
                        )
                    )
            BookingTest.objects.bulk_create(bt_rows, batch_size=batch, ignore_conflicts=True)
            self.stdout.write(f'  reports {min(offset + batch, need)}/{need}')
