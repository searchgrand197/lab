from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('lab', '0007_printsettings_show_background_on_pdf'),
    ]

    operations = [
        migrations.AddField(
            model_name='patient',
            name='title',
            field=models.CharField(
                blank=True,
                choices=[
                    ('Mr.', 'Mr.'),
                    ('Mrs.', 'Mrs.'),
                    ('Ms.', 'Ms.'),
                    ('Miss', 'Miss'),
                    ('Master', 'Master'),
                    ('Dr.', 'Dr.'),
                    ('Baby', 'Baby'),
                    ('B/O', 'B/O'),
                    ('Smt.', 'Smt.'),
                    ('Shri', 'Shri'),
                    ('', 'None'),
                ],
                default='Mr.',
                max_length=20,
            ),
        ),
    ]
