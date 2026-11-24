from django import forms
from django.forms import inlineformset_factory

from .models import Booking, Category, Doctor, Patient, Test, TestParameter


class DoctorForm(forms.ModelForm):
    class Meta:
        model = Doctor
        fields = ['name', 'specialization', 'phone', 'is_active']
        widgets = {
            'name': forms.TextInput(attrs={'class': 'field-input', 'placeholder': 'Doctor name'}),
            'specialization': forms.TextInput(attrs={'class': 'field-input', 'placeholder': 'Specialization'}),
            'phone': forms.TextInput(attrs={'class': 'field-input', 'placeholder': 'Phone'}),
            'is_active': forms.CheckboxInput(attrs={'class': 'field-check'}),
        }


class CategoryForm(forms.ModelForm):
    class Meta:
        model = Category
        fields = ['name', 'description']
        widgets = {
            'name': forms.TextInput(attrs={'class': 'field-input', 'placeholder': 'Category name'}),
            'description': forms.Textarea(attrs={'class': 'field-input', 'rows': 3, 'placeholder': 'Optional description'}),
        }


class TestForm(forms.ModelForm):
    class Meta:
        model = Test
        fields = ['category', 'name', 'price', 'description', 'is_active']
        widgets = {
            'category': forms.Select(attrs={'class': 'field-input'}),
            'name': forms.TextInput(attrs={'class': 'field-input', 'placeholder': 'Test name'}),
            'price': forms.NumberInput(attrs={'class': 'field-input', 'step': '0.01', 'min': '0'}),
            'description': forms.Textarea(attrs={'class': 'field-input', 'rows': 2}),
            'is_active': forms.CheckboxInput(attrs={'class': 'field-check'}),
        }


class TestParameterForm(forms.ModelForm):
    class Meta:
        model = TestParameter
        fields = ['name', 'unit', 'reference_range', 'method', 'sort_order']
        widgets = {
            'name': forms.TextInput(attrs={'class': 'field-input', 'placeholder': 'Parameter'}),
            'unit': forms.TextInput(attrs={'class': 'field-input', 'placeholder': 'Unit'}),
            'reference_range': forms.TextInput(attrs={'class': 'field-input', 'placeholder': 'e.g. 12-16'}),
            'method': forms.TextInput(
                attrs={'class': 'field-input', 'placeholder': 'e.g. VCSn Technology'}
            ),
            'sort_order': forms.NumberInput(attrs={'class': 'field-input', 'min': '0'}),
        }


TestParameterFormSet = inlineformset_factory(
    Test,
    TestParameter,
    form=TestParameterForm,
    extra=2,
    can_delete=True,
)


class BookTestForm(forms.Form):
    patient_id = forms.IntegerField(required=False, widget=forms.HiddenInput())
    name = forms.CharField(
        max_length=150,
        widget=forms.TextInput(attrs={'class': 'field-input', 'placeholder': 'Patient name', 'id': 'id_name'}),
    )
    age = forms.IntegerField(
        required=False,
        min_value=0,
        max_value=150,
        widget=forms.NumberInput(attrs={'class': 'field-input', 'placeholder': 'Age', 'id': 'id_age'}),
    )
    gender = forms.ChoiceField(
        choices=Patient.GENDER_CHOICES,
        widget=forms.RadioSelect(attrs={'class': 'gender-radio'}),
        initial='M',
    )
    remarks = forms.CharField(
        required=False,
        widget=forms.Textarea(attrs={'class': 'field-input', 'rows': 2, 'placeholder': 'Remarks', 'id': 'id_remarks'}),
    )
    doctor = forms.ModelChoiceField(
        queryset=Doctor.objects.filter(is_active=True),
        required=False,
        empty_label='— Select doctor —',
        widget=forms.Select(attrs={'class': 'field-input'}),
    )
    referral_source = forms.ChoiceField(
        choices=Booking.REFERRAL_CHOICES,
        initial='Direct',
        widget=forms.Select(attrs={'class': 'field-input'}),
    )
    mobile = forms.CharField(
        required=False,
        max_length=20,
        widget=forms.TextInput(attrs={'class': 'field-input', 'placeholder': 'Mobile number', 'id': 'id_mobile'}),
    )
    dob = forms.DateField(
        required=False,
        widget=forms.DateInput(attrs={'class': 'field-input', 'type': 'date', 'id': 'id_dob'}),
    )
    room_no = forms.CharField(
        required=False,
        max_length=40,
        widget=forms.TextInput(attrs={'class': 'field-input', 'placeholder': 'Room no'}),
    )
    report_no = forms.CharField(
        required=False,
        max_length=40,
        widget=forms.TextInput(attrs={'class': 'field-input', 'placeholder': 'Auto if blank'}),
    )
    test_date = forms.DateTimeField(
        required=False,
        widget=forms.DateTimeInput(attrs={'class': 'field-input', 'type': 'datetime-local'}),
    )
    next_due_date = forms.DateField(
        required=False,
        widget=forms.DateInput(attrs={'class': 'field-input', 'type': 'date'}),
    )
    sample_collected_at = forms.DateTimeField(
        required=False,
        widget=forms.DateTimeInput(attrs={'class': 'field-input', 'type': 'datetime-local'}),
    )
    sample_received_at = forms.DateTimeField(
        required=False,
        widget=forms.DateTimeInput(attrs={'class': 'field-input', 'type': 'datetime-local'}),
    )
    report_ready_at = forms.DateTimeField(
        required=False,
        widget=forms.DateTimeInput(attrs={'class': 'field-input', 'type': 'datetime-local'}),
    )
    sample_collected_by = forms.CharField(
        required=False,
        max_length=100,
        widget=forms.TextInput(attrs={'class': 'field-input', 'placeholder': 'Collected by'}),
    )
    sample_delivered_to = forms.CharField(
        required=False,
        max_length=100,
        widget=forms.TextInput(attrs={'class': 'field-input', 'placeholder': 'Delivered to'}),
    )
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['doctor'].queryset = Doctor.objects.filter(is_active=True)
