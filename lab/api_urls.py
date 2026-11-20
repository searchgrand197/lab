from django.urls import path

from . import api

urlpatterns = [
    path('csrf/', api.csrf, name='api_csrf'),
    path('me/', api.me, name='api_me'),
    path('login/', api.login_api, name='api_login'),
    path('logout/', api.logout_api, name='api_logout'),
    path('patients/', api.patients_api, name='api_patients'),
    path('patients/<int:pk>/', api.patient_detail_api, name='api_patient_detail'),
    path('doctors/', api.doctors_api, name='api_doctors'),
    path('doctors/reorder/', api.doctors_reorder_api, name='api_doctors_reorder'),
    path('doctors/<int:pk>/', api.doctor_detail_api, name='api_doctor_detail'),
    path('categories/', api.categories_api, name='api_categories'),
    path('categories/reorder/', api.categories_reorder_api, name='api_categories_reorder'),
    path('categories/<int:pk>/', api.category_detail_api, name='api_category_detail'),
    path('catalog/', api.catalog_api, name='api_catalog'),
    path('packages/', api.packages_api, name='api_packages'),
    path('packages/<int:pk>/', api.package_detail_api, name='api_package_detail'),
    path('tests/', api.tests_api, name='api_tests'),
    path('tests/reorder/', api.tests_reorder_api, name='api_tests_reorder'),
    path('tests/<int:pk>/', api.test_detail_api, name='api_test_detail'),
    path('bookings/', api.bookings_api, name='api_bookings'),
    path('bookings/<int:pk>/', api.booking_detail_api, name='api_booking_detail'),
    path('bookings/<int:pk>/report.pdf', api.booking_pdf_api, name='api_booking_pdf'),
    path('bookings/<int:pk>/print/', api.booking_print_api, name='api_booking_print'),
    path('settings/print/', api.print_settings_api, name='api_print_settings'),
]
