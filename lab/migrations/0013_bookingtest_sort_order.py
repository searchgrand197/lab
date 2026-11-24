from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('lab', '0012_testparameter_method'),
    ]

    operations = [
        migrations.AddField(
            model_name='booking',
            name='test_order_custom',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='bookingtest',
            name='sort_order',
            field=models.PositiveIntegerField(db_index=True, default=0),
        ),
        migrations.AlterModelOptions(
            name='bookingtest',
            options={'ordering': ['sort_order', 'id']},
        ),
    ]
