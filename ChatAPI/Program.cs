using ChatAPI.Data;
using ChatAPI.Hubs;
using ChatAPI.Services;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();

builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.AddSignalR();
builder.Services.AddSingleton<RoomTracker>();

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
    // Uygulama yeniden başlarken tüm SignalR bağlantıları sıfırlanır;
    // DB'de kalan kullanıcı kayıtları artık geçersizdir.
    db.Users.ExecuteDelete();
}

app.UseCors("MvcClient");

app.MapControllers();
app.MapHub<ChatHub>("/chatHub");

app.Run();
