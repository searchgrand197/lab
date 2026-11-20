from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required
from django.shortcuts import redirect, render
from django.views.decorators.http import require_http_methods


@require_http_methods(['GET', 'POST'])
def login_view(request):
    if request.user.is_authenticated:
        return redirect('lab:patients')

    error = ''
    if request.method == 'POST':
        username = request.POST.get('username', '').strip()
        password = request.POST.get('password', '')
        user = authenticate(request, username=username, password=password)
        if user is not None:
            login(request, user)
            next_url = request.GET.get('next') or 'lab:patients'
            return redirect(next_url)
        error = 'Invalid username or password.'

    return render(request, 'accounts/login.html', {'error': error})


@login_required
@require_http_methods(['POST', 'GET'])
def logout_view(request):
    logout(request)
    return redirect('accounts:login')
