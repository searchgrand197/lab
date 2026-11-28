"""Create a few completed reports so layout and ranges can be checked."""

from django.core.management.base import BaseCommand
from django.utils import timezone

from lab.api import _apply_default_booking_test_order, _ensure_booking_test
from lab.models import Booking, Doctor, Patient, Test

SAMPLE_REMARK = 'Sample check report'


def _values_for(test_name):
    """Result values keyed by parameter name. Missing names are left blank."""
    samples = {
        'Complete Blood Count (CBC)': {
            'HAEMOGLOBIN (Hb)': '10.4',
            'Total Leucocytes (WBC) Count': '11500',
            'Neutrophils': '60',
            'Lymphocytes': '32',
            'Monocytes': '5',
            'Eosinophils': '3',
            'Basophils': '0',
            'RED BLOOD CELLS - RBC COUNT': '4.13',
            'PACKED CELL VOLUME (PCV) - HEMATOCRIT': '37.80',
            'Mean Cell Volume (MCV)': '91.70',
            'Mean Cell Haemoglobin (MCH)': '25.10',
            'Mean Corpuscular Hb Concn. (MCHC)': '27.50',
            'Red Cell Distribution Width (RDW-CV)': '14.2',
            'Red Cell Distribution Width (RDW-SD)': '42.0',
            'Absolute Neutrophil Count': '6900',
            'Absolute Lymphocyte Count': '3680',
            'Absolute Monocyte Count': '575',
            'Absolute Eosinophil Count': '345',
            'Absolute Basophils Count': '0',
            'Platelet Count': '2.45',
            'Mean Platelet Volume (MPV)': '8.1',
            'PCT': '0.22',
            'PDW-CV': '16.1',
            'E.S.R': '18',
        },
        'Widal Test': {
            'SALMONELLA TYPHI O @ 1/20': '+',
            'SALMONELLA TYPHI O @ 1/40': '+',
            'SALMONELLA TYPHI O @ 1/80': '+',
            'SALMONELLA TYPHI O @ 1/160': '+',
            'SALMONELLA TYPHI O @ 1/320': '*',
            'RESULT': 'NEGATIVE',
        },
        'Lipid Profile': {
            'TOTAL CHOLESTEROL': '220',
            'HDL CHOLESTEROL DIRECT': '38',
            'TRIGLYCERIDES': '180',
            'LDL CHOLESTEROL': '146',
            'VLDL CHOLESTEROL': '36',
            'TOTAL CHOLESTEROL / HDL RATIO': '5.79',
            'LDL / HDL CHOLESTEROL RATIO': '3.84',
            'NON-HDL CHOLESTEROL': '182',
            'Total Lipids': '620',
        },
        'Liver Function Tests (LFT)': {
            'BILIRUBIN - TOTAL': '1.40',
            'BILIRUBIN - DIRECT': '0.40',
            'BILIRUBIN (INDIRECT)': '1.00',
            'ASPARTATE AMINOTRANSFERASE (SGOT)': '52',
            'ALANINE TRANSAMINASE (SGPT)': '38',
            'SGOT/SGPT Ratio': '1.37',
            'Gamma Glutamyl Transferase (GGT)': '40',
            'ALKALINE PHOSPHATASE (ALP)': '120',
            'PROTEIN - TOTAL': '7.2',
            'ALBUMIN - SERUM': '4.0',
            'SERUM GLOBULIN': '3.2',
            'SERUM ALBUMIN/GLOBULIN RATIO': '1.25',
        },
        'Renal Function Tests (RFT)': {
            'BLOOD UREA KINETIC': '32',
            'BLOOD UREA NITROGEN (BUN)': '14.93',
            'CREATININE - SERUM': '1.10',
            'BLOOD UREA NITROGEN / CREATININE RATIO': '13.57',
            'URIC ACID': '5.4',
            'SODIUM (Na+)': '138',
            'POTASSIUM (K+)': '4.2',
            'CHLORIDE (CL-)': '102',
            'S.PROTEIN': '7.0',
            'S.ALBUMIN': '4.1',
            'GLOBULIN': '2.9',
            'A/G RATIO': '1.41',
        },
        'Thyroid Profile': {
            'Total Tri iodothyronine (T3)': '1.20',
            'Total Thyroxine (T4)': '8.40',
            'Thyroid Stimulating Hormone (h-TSH 3rd Gen)': '6.80',
        },
        '25-OH Vitamin D Total': {
            '25 OH VITAMIN D TOTAL ASSAY': '18',
        },
        'Urine Analysis': {
            'Colour': 'Pale Yellow',
            'Transparency': 'Clear',
            'Reaction': 'Acidic',
            'Protein': 'NIL',
            'Sugar': 'NIL',
            'Pus Cells': '2-3',
            'RBC': 'NIL',
            'Sp. Gravity': '1.015',
        },
    }
    return samples.get(test_name, {})


REPORTS = [
    {
        'patient': {'title': 'Mrs.', 'name': 'Jyoti Kaur', 'age': 32, 'gender': 'F', 'mobile': '9811100001'},
        'doctor': 'Ravina',
        'tests': ['Complete Blood Count (CBC)', 'Widal Test'],
    },
    {
        'patient': {'title': 'Mr.', 'name': 'Harpreet Singh', 'age': 48, 'gender': 'M', 'mobile': '9811100002'},
        'doctor': 'Manir',
        'tests': ['Lipid Profile'],
    },
    {
        'patient': {'title': 'Mrs.', 'name': 'Simran Kaur', 'age': 41, 'gender': 'F', 'mobile': '9811100003'},
        'doctor': 'Monti',
        'tests': ['Liver Function Tests (LFT)', 'Renal Function Tests (RFT)'],
    },
    {
        'patient': {'title': 'Mr.', 'name': 'Arjun Sharma', 'age': 27, 'gender': 'M', 'mobile': '9811100004'},
        'doctor': 'Suresh',
        'tests': ['Thyroid Profile', '25-OH Vitamin D Total', 'Urine Analysis'],
    },
]


class Command(BaseCommand):
    help = 'Create completed sample reports for today so print layout can be checked.'

    def handle(self, *args, **options):
        now = timezone.now()
        removed, _ = Booking.objects.filter(remarks=SAMPLE_REMARK).delete()
        if removed:
            self.stdout.write(f'Replaced {removed} earlier sample rows.')

        created = []
        for spec in REPORTS:
            info = spec['patient']
            patient, _ = Patient.objects.update_or_create(
                mobile=info['mobile'],
                defaults={
                    'title': info['title'],
                    'name': info['name'],
                    'age': info['age'],
                    'gender': info['gender'],
                },
            )
            doctor = Doctor.objects.filter(name__icontains=spec['doctor'], is_active=True).first()
            booking = Booking(
                patient=patient,
                doctor=doctor,
                status='completed',
                remarks=SAMPLE_REMARK,
                referral_source='Direct',
                test_date=now,
                sample_collected_at=now,
                sample_received_at=now,
                report_ready_at=now,
                sample_collected_by='Lab',
            )
            booking.save()
            missing = []
            for name in spec['tests']:
                test = Test.objects.filter(name=name, is_active=True).first()
                if test is None:
                    missing.append(name)
                    continue
                bt = _ensure_booking_test(booking, test)
                wanted = _values_for(name)
                for result in bt.results.select_related('parameter'):
                    if result.parameter.name in wanted:
                        result.value = wanted[result.parameter.name]
                        result.save(update_fields=['value'])
            _apply_default_booking_test_order(booking)
            if missing:
                self.stdout.write(self.style.WARNING(f'{booking.report_no} missing tests: {", ".join(missing)}'))
            created.append((booking.report_no, patient.display_name, ', '.join(spec['tests'])))

        self.stdout.write(self.style.SUCCESS('Sample reports ready:'))
        for report_no, who, tests in created:
            self.stdout.write(f'  {report_no}  {who}  —  {tests}')
