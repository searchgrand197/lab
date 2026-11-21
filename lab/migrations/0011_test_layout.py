from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('lab', '0010_booking_soft_delete'),
    ]

    operations = [
        migrations.AddField(
            model_name='test',
            name='layout',
            field=models.CharField(blank=True, default='', max_length=32),
        ),
    ]
