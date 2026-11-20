from django.contrib import admin

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


class TestParameterInline(admin.TabularInline):
    model = TestParameter
    extra = 1


class BookingTestInline(admin.TabularInline):
    model = BookingTest
    extra = 0


@admin.register(Doctor)
class DoctorAdmin(admin.ModelAdmin):
    list_display = ('name', 'specialization', 'phone', 'is_active')
    list_filter = ('is_active',)
    search_fields = ('name', 'specialization')


@admin.register(Patient)
class PatientAdmin(admin.ModelAdmin):
    list_display = ('name', 'age', 'gender', 'mobile', 'email', 'updated_at')
    search_fields = ('name', 'mobile', 'email')


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'created_at')
    search_fields = ('name',)


@admin.register(Test)
class TestAdmin(admin.ModelAdmin):
    list_display = ('name', 'category', 'price', 'is_active')
    list_filter = ('category', 'is_active')
    search_fields = ('name',)
    inlines = [TestParameterInline]


@admin.register(Package)
class PackageAdmin(admin.ModelAdmin):
    list_display = ('name', 'price', 'is_active', 'created_at')
    list_filter = ('is_active',)
    search_fields = ('name',)
    filter_horizontal = ('tests',)


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = (
        'report_no',
        'patient',
        'doctor',
        'status',
        'test_date',
        'is_deleted',
        'deleted_at',
    )
    list_filter = ('status', 'referral_source', 'is_deleted')
    search_fields = ('report_no', 'patient__name', 'patient__mobile', 'deletion_reason')
    readonly_fields = ('deleted_at', 'created_at', 'updated_at', 'share_token')
    fieldsets = (
        (None, {
            'fields': (
                'report_no',
                'patient',
                'doctor',
                'status',
                'referral_source',
                'room_no',
                'test_date',
                'remarks',
            ),
        }),
        ('Soft delete (hidden from app)', {
            'fields': ('is_deleted', 'deletion_reason', 'deleted_at'),
        }),
        ('Meta', {
            'fields': ('share_token', 'created_at', 'updated_at'),
        }),
    )
    inlines = [BookingTestInline]


@admin.register(TestResult)
class TestResultAdmin(admin.ModelAdmin):
    list_display = ('parameter', 'value', 'booking_test')
    search_fields = ('parameter__name', 'booking_test__booking__report_no')


@admin.register(PrintSettings)
class PrintSettingsAdmin(admin.ModelAdmin):
    list_display = (
        'page_preset',
        'page_width_mm',
        'page_height_mm',
        'header_height_mm',
        'footer_height_mm',
        'updated_at',
    )

    def has_add_permission(self, request):
        return not PrintSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False
