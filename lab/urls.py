from django.urls import path

from . import views

app_name = 'lab'

urlpatterns = [
    path('r/<uuid:token>/', views.share_report_page, name='share_report_page'),
    path('r/<uuid:token>/report.pdf', views.share_report_pdf, name='share_report_pdf'),
    path('', views.patients_list, name='home'),
    path('patients/', views.patients_list, name='patients'),
    path('api/patients/', views.patient_search_api, name='patient_search_api'),
    path('book/', views.book_test, name='book_test'),
    path('doctors/', views.doctors_list, name='doctors'),
    path('doctors/add/', views.doctor_create, name='doctor_create'),
    path('doctors/<int:pk>/edit/', views.doctor_edit, name='doctor_edit'),
    path('doctors/<int:pk>/delete/', views.doctor_delete, name='doctor_delete'),
    path('categories/', views.categories_list, name='categories'),
    path('categories/add/', views.category_create, name='category_create'),
    path('categories/<int:pk>/edit/', views.category_edit, name='category_edit'),
    path('categories/<int:pk>/delete/', views.category_delete, name='category_delete'),
    path('tests/', views.tests_list, name='tests'),
    path('tests/add/', views.test_create, name='test_create'),
    path('tests/<int:pk>/edit/', views.test_edit, name='test_edit'),
    path('tests/<int:pk>/delete/', views.test_delete, name='test_delete'),
    path('reports/', views.reports_list, name='reports'),
    path('bookings/<int:pk>/', views.booking_detail, name='booking_detail'),
    path('bookings/<int:pk>/workspace/', views.report_workspace, name='report_workspace'),
    path('bookings/<int:pk>/report/', views.report_preview, name='report_preview'),
    path('bookings/<int:pk>/report.pdf', views.report_pdf, name='report_pdf'),
]
