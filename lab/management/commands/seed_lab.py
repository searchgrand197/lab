from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from decimal import Decimal

from lab.catalog_data import CATALOG
from lab.models import Category, Doctor, Package, Test, TestParameter, TestResult


class Command(BaseCommand):
    help = 'Seed admin user, doctor, and full test catalog (categories, tests, units, ranges).'

    def add_arguments(self, parser):
        parser.add_argument('--username', default='admin')
        parser.add_argument('--password', default='admin123')

    def handle(self, *args, **options):
        User = get_user_model()
        username = options['username']
        password = options['password']

        user, created = User.objects.get_or_create(
            username=username,
            defaults={'is_staff': True, 'is_superuser': True},
        )
        if created:
            user.set_password(password)
            user.save()
            self.stdout.write(self.style.SUCCESS(f'Created user "{username}" / "{password}"'))
        else:
            self.stdout.write(f'User "{username}" already exists')

        doctor_names = [
            'KHALSA',
            'Dr. Manir',
            'Dr. Monti',
            'Dr. Bijender',
            'Dr. Jitender',
            'Dr. Gurender Singh',
            'Dr. Om Rattan',
            'Dr. Raj',
            'Dr. Suresh Goswami',
            'Dr. Nehal',
            'Dr. Ravina',
            'Dr. Hansraj',
            'Dr. Sunita',
            'Dr. Kuldeep',
            'Dr. Sanjay',
            'Dr. Jasvir',
            'Dr. Sunil',
            'Dr. D.S Pandit',
            'Dr. Suresh',
            'Dr. Ashok Chahal',
            'Dr. Inderjeet Khurana',
            'Dr. MADAN LAL GAIRA',
            'Dr. Joginder',
        ]
        for name in doctor_names:
            Doctor.objects.get_or_create(name=name, defaults={'is_active': True})
        self.stdout.write(self.style.SUCCESS(f'Doctors ready: {Doctor.objects.count()}'))

        categories_count = 0
        tests_count = 0
        params_count = 0

        for block in CATALOG:
            category, _ = Category.objects.get_or_create(
                name=block['category'],
                defaults={'description': block['category']},
            )
            categories_count += 1

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
                tests_count += 1

                # Remove unused old parameters (safe refresh).
                # Also drop orphan params that only have blank result rows (e.g. old Widal titres).
                keep_names = {p[0] for p in test_data['parameters']}
                for old in test.parameters.exclude(name__in=keep_names):
                    qs = TestResult.objects.filter(parameter=old)
                    if not qs.exists():
                        old.delete()
                    elif not qs.exclude(value='').exists():
                        qs.delete()
                        old.delete()

                for order, (name, unit, reference_range) in enumerate(test_data['parameters'], start=1):
                    param, created = TestParameter.objects.update_or_create(
                        test=test,
                        name=name,
                        defaults={
                            'unit': unit or '',
                            'reference_range': reference_range or '',
                            'sort_order': order,
                        },
                    )
                    params_count += 1

        self.stdout.write(
            self.style.SUCCESS(
                f'Seeded {categories_count} categories, {tests_count} tests, {params_count} parameters.'
            )
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
            (
                'Diabetes & Kidney Care',
                'Sugar, renal and electrolytes',
                Decimal('1499.00'),
                ['Glucose Challenge Test (GCT)', 'Renal Function Tests (RFT)', 'Electrolytes'],
            ),
            (
                'Heart Risk Package',
                'Lipid and cardiac markers',
                Decimal('1199.00'),
                ['Lipid Profile', 'Liver Function Tests (LFT)'],
            ),
        ]
        pkg_count = 0
        for name, desc, price, test_names in package_defs:
            pkg, _ = Package.objects.update_or_create(
                name=name,
                defaults={'description': desc, 'price': price, 'is_active': True},
            )
            tests = Test.objects.filter(name__in=test_names, is_active=True)
            pkg.tests.set(tests)
            pkg_count += 1
        self.stdout.write(self.style.SUCCESS(f'Seeded {pkg_count} packages.'))
        self.stdout.write(self.style.SUCCESS('Seed complete.'))
