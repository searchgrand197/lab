import uuid

from django.db import migrations, models


def backfill_share_tokens(apps, schema_editor):
    Booking = apps.get_model('lab', 'Booking')
    for booking in Booking.objects.all():
        if not booking.share_token:
            booking.share_token = uuid.uuid4()
            booking.save(update_fields=['share_token'])


class Migration(migrations.Migration):

    dependencies = [
        ('lab', '0004_print_settings'),
    ]

    operations = [
        migrations.AddField(
            model_name='booking',
            name='share_token',
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.RunPython(backfill_share_tokens, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='booking',
            name='share_token',
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
        migrations.AddField(
            model_name='printsettings',
            name='public_base_url',
            field=models.CharField(
                blank=True,
                help_text='Public URL for QR codes, e.g. http://192.168.1.10:8000 — phones must reach this address.',
                max_length=255,
            ),
        ),
    ]
