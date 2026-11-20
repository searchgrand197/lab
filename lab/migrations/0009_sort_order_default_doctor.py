from django.db import migrations, models


def backfill_sort_orders(apps, schema_editor):
    Doctor = apps.get_model('lab', 'Doctor')
    Category = apps.get_model('lab', 'Category')
    Test = apps.get_model('lab', 'Test')

    for idx, obj in enumerate(Doctor.objects.order_by('name', 'id'), start=1):
        Doctor.objects.filter(pk=obj.pk).update(sort_order=idx)

    for idx, obj in enumerate(Category.objects.order_by('name', 'id'), start=1):
        Category.objects.filter(pk=obj.pk).update(sort_order=idx)

    for category_id in Category.objects.values_list('id', flat=True):
        for idx, obj in enumerate(
            Test.objects.filter(category_id=category_id).order_by('name', 'id'),
            start=1,
        ):
            Test.objects.filter(pk=obj.pk).update(sort_order=idx)


class Migration(migrations.Migration):

    dependencies = [
        ('lab', '0008_patient_title'),
    ]

    operations = [
        migrations.AddField(
            model_name='doctor',
            name='is_default',
            field=models.BooleanField(
                default=False,
                help_text='Selected automatically on Book Test when no doctor is chosen yet.',
            ),
        ),
        migrations.AddField(
            model_name='doctor',
            name='sort_order',
            field=models.PositiveIntegerField(db_index=True, default=0),
        ),
        migrations.AddField(
            model_name='category',
            name='sort_order',
            field=models.PositiveIntegerField(db_index=True, default=0),
        ),
        migrations.AddField(
            model_name='test',
            name='sort_order',
            field=models.PositiveIntegerField(db_index=True, default=0),
        ),
        migrations.AlterModelOptions(
            name='doctor',
            options={'ordering': ['sort_order', 'name']},
        ),
        migrations.AlterModelOptions(
            name='category',
            options={'ordering': ['sort_order', 'name'], 'verbose_name_plural': 'categories'},
        ),
        migrations.AlterModelOptions(
            name='test',
            options={'ordering': ['category__sort_order', 'category__name', 'sort_order', 'name']},
        ),
        migrations.RunPython(backfill_sort_orders, migrations.RunPython.noop),
    ]
