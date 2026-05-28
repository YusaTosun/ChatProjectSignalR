using ChatMVC.Models;
using Microsoft.AspNetCore.Mvc;

namespace ChatMVC.Controllers;

public class HomeController : Controller
{
    private readonly IConfiguration _config;

    public HomeController(IConfiguration config)
    {
        _config = config;
    }

    public IActionResult Index()
    {
        var username = HttpContext.Session.GetString("Username");
        if (string.IsNullOrWhiteSpace(username))
            return RedirectToAction("Login", "Account");

        var apiBase = _config["ChatAPI:BaseUrl"] ?? "http://localhost:5000";
        return View(new ChatViewModel
        {
            Username = username,
            ApiBaseUrl = apiBase,
            HubUrl = $"{apiBase}/chatHub"
        });
    }
}
