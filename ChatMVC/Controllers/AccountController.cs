using ChatMVC.Models;
using Microsoft.AspNetCore.Mvc;
using System.Net.Http.Json;

namespace ChatMVC.Controllers;

public class AccountController : Controller
{
    private readonly IHttpClientFactory _httpFactory;

    public AccountController(IHttpClientFactory httpFactory)
    {
        _httpFactory = httpFactory;
    }

    // ── Login ─────────────────────────────────────────────

    [HttpGet]
    public IActionResult Login()
    {
        if (HttpContext.Session.GetString("Username") is not null)
            return RedirectToAction("Index", "Home");

        return View(new LoginViewModel());
    }

    [HttpPost]
    public async Task<IActionResult> Login(LoginViewModel model)
    {
        if (string.IsNullOrWhiteSpace(model.Username) || string.IsNullOrWhiteSpace(model.Password))
        {
            ModelState.AddModelError(string.Empty, "Username and password are required.");
            return View(model);
        }

        var client = _httpFactory.CreateClient("ChatAPI");
        var response = await client.PostAsJsonAsync("api/auth/login", new
        {
            model.Username,
            model.Password
        });

        if (!response.IsSuccessStatusCode)
        {
            var err = await response.Content.ReadFromJsonAsync<ApiError>();
            ModelState.AddModelError(string.Empty, err?.Error ?? "Invalid username or password.");
            return View(model);
        }

        var result = await response.Content.ReadFromJsonAsync<LoginResult>();
        HttpContext.Session.SetString("UserId", result!.Id.ToString());
        HttpContext.Session.SetString("Username", result.Username.Trim());
        return RedirectToAction("Index", "Home");
    }

    // ── Register ──────────────────────────────────────────

    [HttpGet]
    public IActionResult Register()
    {
        if (HttpContext.Session.GetString("Username") is not null)
            return RedirectToAction("Index", "Home");

        return View(new RegisterViewModel());
    }

    [HttpPost]
    public async Task<IActionResult> Register(RegisterViewModel model)
    {
        if (string.IsNullOrWhiteSpace(model.Username) ||
            string.IsNullOrWhiteSpace(model.Password) ||
            string.IsNullOrWhiteSpace(model.ConfirmPassword))
        {
            ModelState.AddModelError(string.Empty, "All fields are required.");
            return View(model);
        }

        if (model.Password != model.ConfirmPassword)
        {
            ModelState.AddModelError(nameof(model.ConfirmPassword), "Passwords do not match.");
            return View(model);
        }

        var client = _httpFactory.CreateClient("ChatAPI");
        var response = await client.PostAsJsonAsync("api/auth/register", new
        {
            model.Username,
            model.Password
        });

        if (!response.IsSuccessStatusCode)
        {
            var err = await response.Content.ReadFromJsonAsync<ApiError>();
            ModelState.AddModelError(string.Empty, err?.Error ?? "Registration failed.");
            return View(model);
        }

        // Kayıt başarılı → otomatik giriş yap
        var result = await response.Content.ReadFromJsonAsync<LoginResult>();
        HttpContext.Session.SetString("UserId", result!.Id.ToString());
        HttpContext.Session.SetString("Username", result.Username.Trim());
        return RedirectToAction("Index", "Home");
    }

    // ── Logout ────────────────────────────────────────────

    public IActionResult Logout()
    {
        HttpContext.Session.Clear();
        return RedirectToAction("Login");
    }

    // ── Helpers ───────────────────────────────────────────

    private record ApiError(string Error);
    private record LoginResult(Guid Id, string Username);
}
