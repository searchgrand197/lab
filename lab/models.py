import uuid

from django.db import models
from django.utils import timezone


class Doctor(models.Model):
    name = models.CharField(max_length=120)
    specialization = models.CharField(max_length=120, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    is_active = models.BooleanField(default=True)
    is_default = models.BooleanField(
        default=False,
        help_text='Selected automatically on Book Test when no doctor is chosen yet.',
    )
    sort_order = models.PositiveIntegerField(default=0, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['sort_order', 'name']

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if self.is_default:
            Doctor.objects.exclude(pk=self.pk).filter(is_default=True).update(is_default=False)


class Patient(models.Model):
    GENDER_CHOICES = [
        ('M', 'Male'),
        ('F', 'Female'),
        ('O', 'Other'),
    ]
    TITLE_CHOICES = [
        ('Mr.', 'Mr.'),
        ('Mrs.', 'Mrs.'),
        ('Ms.', 'Ms.'),
        ('Miss', 'Miss'),
        ('Master', 'Master'),
        ('Dr.', 'Dr.'),
        ('Baby', 'Baby'),
        ('B/O', 'B/O'),
        ('Smt.', 'Smt.'),
        ('Shri', 'Shri'),
        ('', 'None'),
    ]

    title = models.CharField(max_length=20, choices=TITLE_CHOICES, default='Mr.', blank=True)
    name = models.CharField(max_length=150)
    age = models.PositiveIntegerField(null=True, blank=True)
    gender = models.CharField(max_length=1, choices=GENDER_CHOICES, default='M')
    mobile = models.CharField(max_length=20, blank=True, db_index=True)
    email = models.EmailField(blank=True)
    dob = models.DateField(null=True, blank=True)
    remarks = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    @property
    def display_name(self):
        title = (self.title or '').strip()
        name = (self.name or '').strip()
        return f'{title} {name}'.strip() if title else name

    def __str__(self):
        return f'{self.display_name} ({self.mobile or "no mobile"})'


class Category(models.Model):
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    sort_order = models.PositiveIntegerField(default=0, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = 'categories'
        ordering = ['sort_order', 'name']

    def __str__(self):
        return self.name


class Test(models.Model):
    category = models.ForeignKey(Category, on_delete=models.CASCADE, related_name='tests')
    name = models.CharField(max_length=150)
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['category__sort_order', 'category__name', 'sort_order', 'name']
        unique_together = [('category', 'name')]

    def __str__(self):
        return f'{self.name} ({self.category.name})'


class Package(models.Model):
    name = models.CharField(max_length=150, unique=True)
    description = models.TextField(blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    tests = models.ManyToManyField(Test, related_name='packages', blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class TestParameter(models.Model):
    test = models.ForeignKey(Test, on_delete=models.CASCADE, related_name='parameters')
    name = models.CharField(max_length=120)
    unit = models.CharField(max_length=40, blank=True)
    reference_range = models.CharField(max_length=255, blank=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['sort_order', 'name']

    def __str__(self):
        return f'{self.name} — {self.test.name}'


class Booking(models.Model):
    REFERRAL_CHOICES = [
        ('Direct', 'Direct'),
        ('Hospital', 'Hospital'),
        ('Camp', 'Camp'),
        ('Other', 'Other'),
    ]
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('booked', 'Booked'),
        ('sample_collected', 'Sample Collected'),
        ('completed', 'Completed'),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name='bookings')
    doctor = models.ForeignKey(
        Doctor, on_delete=models.SET_NULL, null=True, blank=True, related_name='bookings'
    )
    report_no = models.CharField(max_length=40, unique=True, blank=True)
    share_token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    room_no = models.CharField(max_length=40, blank=True)
    referral_source = models.CharField(max_length=20, choices=REFERRAL_CHOICES, default='Direct')
    test_date = models.DateTimeField(default=timezone.now)
    next_due_date = models.DateField(null=True, blank=True)
    sample_collected_at = models.DateTimeField(null=True, blank=True)
    sample_received_at = models.DateTimeField(null=True, blank=True)
    report_ready_at = models.DateTimeField(null=True, blank=True)
    sample_collected_by = models.CharField(max_length=100, blank=True)
    sample_delivered_to = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='booked')
    remarks = models.TextField(blank=True)
    # Soft-delete: hidden from the app UI, retained for admin audit.
    is_deleted = models.BooleanField(default=False, db_index=True)
    deletion_reason = models.TextField(blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        mark = ' [deleted]' if self.is_deleted else ''
        return f'{self.report_no} — {self.patient.name}{mark}'

    def save(self, *args, **kwargs):
        if not self.share_token:
            self.share_token = uuid.uuid4()
        if not self.report_no:
            today = timezone.localdate()
            prefix = f'KL-{today.strftime("%Y%m%d")}-'
            last = (
                Booking.objects.filter(report_no__startswith=prefix)
                .order_by('-report_no')
                .values_list('report_no', flat=True)
                .first()
            )
            seq = 1
            if last:
                try:
                    seq = int(last.rsplit('-', 1)[-1]) + 1
                except ValueError:
                    seq = 1
            self.report_no = f'{prefix}{seq:04d}'
        super().save(*args, **kwargs)


class BookingTest(models.Model):
    booking = models.ForeignKey(Booking, on_delete=models.CASCADE, related_name='booking_tests')
    test = models.ForeignKey(Test, on_delete=models.PROTECT, related_name='booking_tests')
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    class Meta:
        unique_together = [('booking', 'test')]

    def __str__(self):
        return f'{self.booking.report_no}: {self.test.name}'


class TestResult(models.Model):
    booking_test = models.ForeignKey(
        BookingTest, on_delete=models.CASCADE, related_name='results'
    )
    parameter = models.ForeignKey(
        TestParameter, on_delete=models.PROTECT, related_name='results'
    )
    value = models.CharField(max_length=100, blank=True)
    remarks = models.CharField(max_length=200, blank=True)

    class Meta:
        unique_together = [('booking_test', 'parameter')]
        ordering = ['parameter__sort_order', 'parameter__name']

    def __str__(self):
        return f'{self.parameter.name}: {self.value or "—"}'


class PrintSettings(models.Model):
    """Singleton print layout for laboratory reports."""

    PAGE_PRESETS = [
        ('A4', 'A4 (210 × 297 mm)'),
        ('A5', 'A5 (148 × 210 mm)'),
        ('Letter', 'Letter (216 × 279 mm)'),
        ('Custom', 'Custom size'),
    ]

    page_preset = models.CharField(max_length=20, choices=PAGE_PRESETS, default='A4')
    page_width_mm = models.DecimalField(max_digits=7, decimal_places=2, default=210)
    page_height_mm = models.DecimalField(max_digits=7, decimal_places=2, default=297)
    margin_left_mm = models.DecimalField(max_digits=6, decimal_places=2, default=12)
    margin_right_mm = models.DecimalField(max_digits=6, decimal_places=2, default=12)
    header_height_mm = models.DecimalField(max_digits=6, decimal_places=2, default=18)
    footer_height_mm = models.DecimalField(max_digits=6, decimal_places=2, default=16)
    background_image = models.ImageField(upload_to='print_backgrounds/', blank=True, null=True)
    show_lab_title = models.BooleanField(
        default=True,
        help_text='Show lab name above the patient box. Turn off when the background already has a letterhead.',
    )
    show_patient_header = models.BooleanField(
        default=True,
        help_text='Show the patient / barcode / QR header box in the content area.',
    )
    public_base_url = models.CharField(
        max_length=255,
        blank=True,
        help_text='Public URL for QR codes, e.g. http://192.168.1.10:8000 — phones must reach this address.',
    )
    show_background_on_pdf = models.BooleanField(
        default=True,
        help_text='Include the letterhead background on PDFs generated from the software (print / download).',
    )
    show_background_on_qr = models.BooleanField(
        default=True,
        help_text='Include the letterhead background when the report is opened from a QR code.',
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Print settings'
        verbose_name_plural = 'Print settings'

    def __str__(self):
        return 'Print settings'

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def apply_preset_size(self):
        presets = {
            'A4': (210, 297),
            'A5': (148, 210),
            'Letter': (215.9, 279.4),
        }
        if self.page_preset in presets:
            width, height = presets[self.page_preset]
            self.page_width_mm = width
            self.page_height_mm = height
