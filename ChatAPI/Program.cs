using ChatAPI.Data;
using ChatAPI.Helpers;
using ChatAPI.Hubs;
using ChatAPI.Models;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();

builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.AddSignalR();

builder.Services.AddCors(options =>
{
    options.AddPolicy("MvcClient", policy =>
    {
        policy
            .WithOrigins("http://localhost:5001")
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
    db.Database.Migrate();

    // Uygulama yeniden başlarken tüm SignalR bağlantıları kopar;
    // tüm kullanıcıları offline olarak işaretle.
    db.AppUsers.ExecuteUpdate(s => s
        .SetProperty(u => u.IsOnline, false)
        .SetProperty(u => u.ConnectionId, (string?)null));

    // Seed: test kullanıcıları yoksa ekle, varsa şifresini "hb" yap
    string[] seedUsers = ["yusa", "ahmet", "mehmet"];
    foreach (var name in seedUsers)
    {
        var existing = db.AppUsers.FirstOrDefault(u => u.Username == name);
        if (existing == null)
            db.AppUsers.Add(new AppUser { Username = name, PasswordHash = PasswordHelper.Hash("hb") });
        else
            existing.PasswordHash = PasswordHelper.Hash("hb");
    }
    db.SaveChanges();
}

app.UseCors("MvcClient");

app.MapControllers();
app.MapHub<ChatHub>("/chatHub");

app.Run();
