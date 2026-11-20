from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('lab', '0006_printsettings_show_background_on_qr'),
    ]

    operations = [
        migrations.AddField(
            model_name='printsettings',
            name='show_background_on_pdf',
            field=models.BooleanField(
                default=True,
                help_text='Include the letterhead background on PDFs generated from the software (print / download).',
            ),
        ),
    ]
