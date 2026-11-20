from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('lab', '0005_booking_share_token_public_url'),
    ]

    operations = [
        migrations.AddField(
            model_name='printsettings',
            name='show_background_on_qr',
            field=models.BooleanField(
                default=True,
                help_text='Include the letterhead background when the report is opened from a QR code.',
            ),
        ),
    ]
