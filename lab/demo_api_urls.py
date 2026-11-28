from django.urls import path

from . import api

# Same lab APIs as production, mounted under /demo-api/ (demo DB via middleware).
urlpatterns = [
    path('csrf/', api.csrf, name='demo_api_csrf'),
    path('me/', api.me, name='demo_api_me'),
    path('enter/', api.demo_enter_api, name='demo_api_enter'),
    path('start/', api.demo_start_api, name='demo_api_start'),
    path('login/', api.login_api, name='demo_api_login'),
    path('logout/', api.logout_api, name='demo_api_logout'),
    path('patients/', api.patients_api, name='demo_api_patients'),
    path('patients/<int:pk>/', api.patient_detail_api, name='demo_api_patient_detail'),
    path('doctors/', api.doctors_api, name='demo_api_doctors'),
    path('doctors/reorder/', api.doctors_reorder_api, name='demo_api_doctors_reorder'),
    path('doctors/<int:pk>/', api.doctor_detail_api, name='demo_api_doctor_detail'),
    path('categories/', api.categories_api, name='demo_api_categories'),
    path('categories/reorder/', api.categories_reorder_api, name='demo_api_categories_reorder'),
    path('categories/<int:pk>/', api.category_detail_api, name='demo_api_category_detail'),
    path('catalog/', api.catalog_api, name='demo_api_catalog'),
    path('packages/', api.packages_api, name='demo_api_packages'),
    path('packages/<int:pk>/', api.package_detail_api, name='demo_api_package_detail'),
    path('tests/', api.tests_api, name='demo_api_tests'),
    path('tests/reorder/', api.tests_reorder_api, name='demo_api_tests_reorder'),
    path('tests/<int:pk>/', api.test_detail_api, name='demo_api_test_detail'),
    path('bookings/', api.bookings_api, name='demo_api_bookings'),
    path('bookings/<int:pk>/', api.booking_detail_api, name='demo_api_booking_detail'),
    path('bookings/<int:pk>/report.pdf', api.booking_pdf_api, name='demo_api_booking_pdf'),
    path('bookings/<int:pk>/print/', api.booking_print_api, name='demo_api_booking_print'),
    path('settings/print/', api.print_settings_api, name='demo_api_print_settings'),
]
