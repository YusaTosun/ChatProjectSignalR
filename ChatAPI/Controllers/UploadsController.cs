using Microsoft.AspNetCore.Mvc;

namespace ChatAPI.Controllers;

[ApiController]
[Route("api/uploads")]
public class UploadsController : ControllerBase
{
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<UploadsController> _logger;

    private static readonly HashSet<string> AllowedImageTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    private static readonly HashSet<string> AllowedVideoTypes = ["video/mp4", "video/webm"];
    private const long MaxImageSize = 10 * 1024 * 1024;  // 10MB
    private const long MaxVideoSize = 50 * 1024 * 1024;  // 50MB

    public UploadsController(IWebHostEnvironment env, ILogger<UploadsController> logger)
    {
        _env = env;
        _logger = logger;
    }

    // POST /api/uploads
    [HttpPost]
    [RequestSizeLimit(52_428_800)]
    [RequestFormLimits(MultipartBodyLengthLimit = 52_428_800)]
    public async Task<IActionResult> Upload(IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { error = "No file provided." });

        string mediaType;
        if (AllowedImageTypes.Contains(file.ContentType))
        {
            if (file.Length > MaxImageSize)
                return BadRequest(new { error = "Image must be under 10MB." });
            mediaType = "image";
        }
        else if (AllowedVideoTypes.Contains(file.ContentType))
        {
            if (file.Length > MaxVideoSize)
                return BadRequest(new { error = "Video must be under 50MB." });
            mediaType = "video";
        }
        else
        {
            return BadRequest(new { error = "Only images (jpg, png, gif, webp) and videos (mp4, webm) are allowed." });
        }

        var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
        var fileName = $"{Guid.NewGuid()}{extension}";
        var uploadsPath = Path.Combine(_env.WebRootPath, "uploads");
        Directory.CreateDirectory(uploadsPath);

        var filePath = Path.Combine(uploadsPath, fileName);
        using (var stream = new FileStream(filePath, FileMode.Create))
            await file.CopyToAsync(stream);

        var url = $"{Request.Scheme}://{Request.Host}/uploads/{fileName}";
        _logger.LogInformation("Uploaded {MediaType}: {FileName}", mediaType, fileName);

        return Ok(new { url, mediaType });
    }
}
