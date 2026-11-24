from django.db import migrations, models


def fill_default_methods(apps, schema_editor):
    TestParameter = apps.get_model('lab', 'TestParameter')
    from lab.param_methods import default_method_for_param

    for param in TestParameter.objects.all().iterator():
        if (param.method or '').strip():
            continue
        method = default_method_for_param(param.name)
        if method:
            param.method = method
            param.save(update_fields=['method'])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('lab', '0011_test_layout'),
    ]

    operations = [
        migrations.AddField(
            model_name='testparameter',
            name='method',
            field=models.CharField(blank=True, default='', max_length=120),
        ),
        migrations.RunPython(fill_default_methods, noop_reverse),
    ]
